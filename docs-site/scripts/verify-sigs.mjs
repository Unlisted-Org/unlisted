// Checks every transaction signature the built docs show. Run after `npm run build`:
//
//   node scripts/verify-sigs.mjs [--dist <dir>] [--origin https://…]
//
// With --origin, each page listed in dist/ is fetched from the deployed site and checked as served.
// For each page in dist/:
// 1. Every signature appears only as a Solana Explorer link, whose URL names its network
//    (`?cluster=devnet`, or no cluster for mainnet). A full signature in the page text, or in
//    any other kind of link, fails: it could be cited without being checked.
// 2. Every signature comes from a committed record: it must appear in a file tracked by git
//    outside docs-site/. A signature typed from memory fails here even if it happens to exist.
// 3. Every signature is finalized, without error, on its network (getSignatureStatuses, as
//    web/scripts/verify-evidence.mjs does). Where the link's title says "slot N", the chain
//    must report exactly that slot.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const DIST = opt('--dist', new URL('../dist/', import.meta.url).pathname);
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const RPC = { devnet: 'https://api.devnet.solana.com', mainnet: 'https://api.mainnet-beta.solana.com' };
const SIG = /[1-9A-HJ-NP-Za-km-z]{86,88}/g;
const ORIGIN = opt('--origin', null)?.replace(/\/$/, '');

const htmlFiles = [];
(function walk(dir) {
	for (const f of readdirSync(dir)) {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) walk(p);
		else if (f.endsWith('.html')) htmlFiles.push(p);
	}
})(DIST);

const problems = [];
const cited = new Map(); // sig -> { network, slot, pages }
for (const f of htmlFiles) {
	const page = '/' + relative(DIST, f).replace(/index\.html$/, '');
	let html = readFileSync(f, 'utf8');
	if (ORIGIN) {
		const r = await fetch(ORIGIN + page);
		if (!r.ok && page !== '/404.html') problems.push(`${page}: ${r.status} from ${ORIGIN}`);
		html = await r.text();
	}
	// Pagefind's and Starlight's own scripts carry no signatures; drop them so they can't hide one.
	html = html.replace(/<script[\s\S]*?<\/script>/g, '');
	const linkRe = /<a\s[^>]*href="https:\/\/explorer\.solana\.com\/tx\/([1-9A-HJ-NP-Za-km-z]{86,88})(\?cluster=([a-z-]+))?"[^>]*>/g;
	for (const m of html.matchAll(linkRe)) {
		const [tag, sig, , cluster] = m;
		const network = cluster ?? 'mainnet';
		const title = /title="slot (\d+)"/.exec(tag);
		const slot = title ? Number(title[1]) : null;
		const prev = cited.get(sig);
		if (prev && prev.network !== network) problems.push(`${page}: ${sig.slice(0, 8)}… cited on ${prev.network} and ${network}`);
		if (prev && prev.slot !== null && slot !== null && prev.slot !== slot) problems.push(`${page}: ${sig.slice(0, 8)}… cited at slots ${prev.slot} and ${slot}`);
		cited.set(sig, { network, slot: slot ?? prev?.slot ?? null, pages: [...(prev?.pages ?? []), page] });
	}
	// Anything signature-shaped that isn't the target of an explorer tx link.
	const rest = html.replace(linkRe, '');
	for (const m of rest.matchAll(SIG)) problems.push(`${page}: signature-shaped string outside an explorer tx link: ${m[0].slice(0, 12)}…`);
}
for (const [, v] of cited) if (!RPC[v.network]) problems.push(`unknown network ${v.network}`);

// 2. committed records
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' })
	.split('\0')
	.filter((p) => p && !p.startsWith('docs-site/') && !/\.(png|jpg|webm|so|ico|woff2?)$/.test(p));
const known = new Set();
for (const p of tracked) {
	let text;
	try {
		text = readFileSync(join(REPO, p), 'utf8');
	} catch {
		continue;
	}
	for (const m of text.matchAll(SIG)) known.add(m[0]);
}
for (const [sig, v] of cited) if (!known.has(sig)) problems.push(`${v.pages[0]}: ${sig.slice(0, 12)}… is in no committed record outside docs-site/`);

// 3. on chain
async function statuses(url, sigs) {
	for (let attempt = 0; attempt < 6; attempt++) {
		const r = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses', params: [sigs, { searchTransactionHistory: true }] }),
		})
			.then((x) => x.json())
			.catch(() => null);
		if (r?.result) return r.result.value;
		if (r?.error && r.error.code !== 429) throw new Error(`${url}: ${JSON.stringify(r.error)}`);
		await new Promise((ok) => setTimeout(ok, 5000 * (attempt + 1)));
	}
	throw new Error(`${url}: no answer`);
}
const counts = {};
for (const [network, url] of Object.entries(RPC)) {
	const mine = [...cited].filter(([, v]) => v.network === network);
	counts[network] = mine.length;
	for (let i = 0; i < mine.length; i += 200) {
		const chunk = mine.slice(i, i + 200);
		const vals = await statuses(url, chunk.map(([s]) => s));
		chunk.forEach(([sig, v], j) => {
			const s = vals[j];
			const where = `${v.pages[0]}: ${network} ${sig.slice(0, 12)}…`;
			if (!s) return problems.push(`${where} not found`);
			if (s.err !== null) problems.push(`${where} failed on chain ${JSON.stringify(s.err)}`);
			if (s.confirmationStatus !== 'finalized') problems.push(`${where} is ${s.confirmationStatus}, not finalized`);
			if (v.slot !== null && s.slot !== v.slot) problems.push(`${where} page says slot ${v.slot}, chain says ${s.slot}`);
		});
	}
}

const withSlot = [...cited.values()].filter((v) => v.slot !== null).length;
console.log(
	`${ORIGIN ? ORIGIN + ': ' : ''}signatures: ${cited.size} cited across ${htmlFiles.length} pages (devnet ${counts.devnet}, mainnet ${counts.mainnet}); ` +
		`${withSlot} with a stated slot; ${known.size} signature-shaped strings in committed records`,
);
if (problems.length) {
	console.log(`SIGNATURE CHECK FAILED (${problems.length}):\n  ` + problems.join('\n  '));
	process.exit(1);
}
console.log('SIGNATURE CHECK PASSED: every signature is linked, committed, and finalized without error on its network');
