// Rewrites the visible label of every Solana Explorer link in the docs from the
// signature or address in its URL: first 8 characters, an ellipsis, last 8. A
// label typed by hand can drift from its URL; one derived from it cannot.
//
//   node scripts/sig-labels.mjs          rewrite in place
//   node scripts/sig-labels.mjs --check  exit 1 if any label differs
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/content/docs/', import.meta.url).pathname;
const check = process.argv.includes('--check');
export const label = (id) => (id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-8)}` : id);

const files = [];
(function walk(d) {
	for (const f of readdirSync(d)) {
		const p = join(d, f);
		if (statSync(p).isDirectory()) walk(p);
		else if (/\.mdx?$/.test(f)) files.push(p);
	}
})(root);

// [`label`](https://explorer.solana.com/(tx|address)/<id>[?cluster=devnet] ["slot N"])
const link = /\[`([^`]*)`\]\((https:\/\/explorer\.solana\.com\/(?:tx|address)\/([1-9A-HJ-NP-Za-km-z]+)(?:\?[^)\s]*)?)((?:\s+"[^"]*")?)\)/g;
let changed = 0;
let total = 0;
for (const f of files) {
	const src = readFileSync(f, 'utf8');
	const out = src.replace(link, (whole, text, url, id, title) => {
		total++;
		if (text === label(id)) return whole;
		changed++;
		if (check) console.log(`${f.slice(root.length)}: "${text}" should be "${label(id)}"`);
		return `[\`${label(id)}\`](${url}${title})`;
	});
	if (!check && out !== src) writeFileSync(f, out);
}
console.log(check ? `${changed} of ${total} explorer labels mismatched` : `rewrote ${changed} of ${total} explorer labels`);
if (check && changed) process.exit(1);
