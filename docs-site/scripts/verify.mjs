// Checks the built site the way a reader meets it. Run after `npm run build`:
//
//   node scripts/verify.mjs [--shots <dir>] [--pages /,/product/user-flow/,…] [--query claim --expect /protocol/claims/]
//
// 1. Every internal link and #anchor in dist/ resolves to a built page and id.
// 2. No page scrolls sideways at 1440 or 390 px, in either theme.
// 3. Search returns the expected page for a real query.
// 4. Every Explorer link's label matches its URL. (Signatures on chain: scripts/verify-sigs.mjs.)
// 5. Screenshots of the listed pages at 1440 and 390, light and dark, into --shots.
// 6. The header logo loads in both themes (the right lockup file per theme), and the favicon is the brand icon.
//
// Browsers come from PLAYWRIGHT_BROWSERS_PATH (the worktree's .playwright-browsers), never the
// shared cache. Uses chrome-headless-shell: plain headless Chrome ignores --window-size and lays
// out at 500 px, which fakes a narrow-screen overflow.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const DIST = opt('--dist', new URL('../dist/', import.meta.url).pathname);
const SHOTS = opt('--shots', null);
const PAGES = opt('--pages', '/,/product/user-flow/,/app/dashboard/,/protocol/claims/').split(',');
const QUERY = opt('--query', 'claim');
const EXPECT = opt('--expect', '/protocol/claims/');

const shell = (() => {
	const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (!base || base === '0') throw new Error('set PLAYWRIGHT_BROWSERS_PATH to the worktree\'s .playwright-browsers (never the shared cache)');
	const dirs = readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
	for (const d of dirs) {
		for (const sub of readdirSync(join(base, d))) {
			const p = join(base, d, sub, 'chrome-headless-shell');
			if (existsSync(p)) return p;
		}
	}
	throw new Error(`chrome-headless-shell not found in ${base}; run PLAYWRIGHT_BROWSERS_PATH=${base} npx playwright-core install chromium-headless-shell`);
})();

// ---------------------------------------------------------------- 1. links
const htmlFiles = [];
(function walk(dir) {
	for (const f of readdirSync(dir)) {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) walk(p);
		else if (f.endsWith('.html')) htmlFiles.push(p);
	}
})(DIST);

const route = (file) => '/' + relative(DIST, file).replace(/index\.html$/, '').replace(/\\/g, '/');
const idsOf = new Map(htmlFiles.map((f) => [route(f), new Set([...readFileSync(f, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
const resolves = (path) => {
	const clean = decodeURIComponent(path);
	if (idsOf.has(clean)) return clean;
	if (idsOf.has(clean + '/')) return clean + '/';
	return existsSync(join(DIST, clean)) && statSync(join(DIST, clean)).isFile() ? clean : null;
};

const broken = [];
let linkCount = 0;
for (const f of htmlFiles) {
	const html = readFileSync(f, 'utf8');
	for (const [, href] of html.matchAll(/<a\s[^>]*href="([^"]+)"/g)) {
		if (/^(https?:|mailto:|tel:|\/\/)/.test(href)) continue;
		linkCount++;
		const here = route(f);
		const [pathPart, hash] = href.split('#');
		const target = pathPart === '' ? here : resolves(new URL(pathPart, 'http://x' + here).pathname);
		if (!target) broken.push(`${here} → ${href} (no such page)`);
		else if (hash && idsOf.has(target) && !idsOf.get(target).has(decodeURIComponent(hash))) broken.push(`${here} → ${href} (no #${hash})`);
	}
}
console.log(`links: ${linkCount} internal links across ${htmlFiles.length} pages, ${broken.length} broken`);
for (const b of broken) console.log('  BROKEN ' + b);

// ---------------------------------------------------------------- 4. explorer labels
import { execFileSync } from 'node:child_process';
let labelsOk = true;
try {
	execFileSync('node', [new URL('./sig-labels.mjs', import.meta.url).pathname, '--check'], { stdio: 'pipe' });
	console.log('explorer labels: all match their URLs');
} catch (e) {
	labelsOk = false;
	console.log('explorer labels: MISMATCH\n' + e.stdout);
}

// ---------------------------------------------------------------- server
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.xml': 'application/xml' };
const server = createServer((req, res) => {
	let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
	let file = join(DIST, p);
	if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
	if (!existsSync(file)) {
		res.writeHead(404, { 'content-type': 'text/html' });
		return res.end(readFileSync(join(DIST, '404.html')));
	}
	res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
	res.end(readFileSync(file));
});
// --origin https://… checks a deployed copy instead of dist/ served locally.
// Links and signatures are still read from dist/, which is the same build.
const REMOTE = opt('--origin', null);
if (!REMOTE) await new Promise((r) => server.listen(0, r));
const ORIGIN = REMOTE ? REMOTE.replace(/\/$/, '') : `http://localhost:${server.address().port}`;
if (REMOTE) {
	const bad = [];
	for (const r of [...idsOf.keys(), '/favicon.svg', '/pagefind/pagefind.js']) {
		const res = await fetch(ORIGIN + r, { redirect: 'manual' });
		if (res.status !== 200) bad.push(`${r} → ${res.status}`);
	}
	console.log(`live: ${idsOf.size + 2} URLs fetched from ${ORIGIN}, ${bad.length} not 200`);
	for (const b of bad) console.log('  ' + b);
	broken.push(...bad);
}

const browser = await chromium.launch({ executablePath: shell });
const pageAt = async (width, theme) => {
	const ctx = await browser.newContext({ viewport: { width, height: width > 800 ? 900 : 844 }, deviceScaleFactor: width > 800 ? 1 : 2 });
	await ctx.addInitScript((t) => localStorage.setItem('starlight-theme', t), theme);
	return ctx.newPage();
};

// ---------------------------------------------------------------- 2. overflow
const overflow = [];
const routes = [...idsOf.keys()].filter((r) => !r.endsWith('.html'));
for (const width of [1440, 390]) {
	for (const theme of ['light', 'dark']) {
		const page = await pageAt(width, theme);
		for (const r of routes) {
			await page.goto(ORIGIN + r, { waitUntil: 'load' });
			const m = await page.evaluate(() => ({
				sw: document.documentElement.scrollWidth,
				iw: window.innerWidth,
				theme: document.documentElement.dataset.theme,
				// A table that scrolls inside itself keeps the page from overflowing
				// but hides columns; report those too.
				clipped: [...document.querySelectorAll('.sl-markdown-content table')].filter((t) => t.scrollWidth > t.clientWidth + 1).length,
			}));
			if (m.theme !== theme) overflow.push(`${r} @${width}: theme is ${m.theme}, expected ${theme}`);
			if (m.sw > m.iw) overflow.push(`${r} @${width} ${theme}: scrollWidth ${m.sw} > innerWidth ${m.iw}`);
			if (m.clipped) overflow.push(`${r} @${width} ${theme}: ${m.clipped} table(s) wider than their box`);
		}
		await page.context().close();
	}
}
console.log(`overflow: ${routes.length} pages × 2 widths × 2 themes, ${overflow.length} problems`);
for (const o of overflow) console.log('  ' + o);

// A first visit, with nothing stored, follows the OS (as the app does); the toggle then sticks.
{
	for (const os of ['dark', 'light']) {
		const ctx = await browser.newContext({ colorScheme: os });
		const page = await ctx.newPage();
		await page.goto(ORIGIN + PAGES[0]);
		const t = await page.evaluate(() => document.documentElement.dataset.theme);
		console.log(`first visit with OS set to ${os}: theme=${t} ${t === os ? 'ok' : 'FAIL'}`);
		if (t !== os) overflow.push(`first visit with OS ${os}: theme ${t}`);
		await page.click('unlisted-theme-toggle button');
		const after = await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('starlight-theme')]);
		const want = os === 'dark' ? 'light' : 'dark';
		const ok = after[0] === want && after[1] === want;
		console.log(`toggle click: theme=${after[0]} stored=${after[1]} ${ok ? 'ok' : 'FAIL'}`);
		if (!ok) overflow.push(`toggle from ${os}: ${after}`);
		await ctx.close();
	}
}

// ---------------------------------------------------------------- 6. logo
// The header logo is the Unlisted lockup: exactly one visible image per theme, loaded (non-zero
// natural size, drawn at least 16 px tall), the black file on light and the white file on dark.
// The favicon served is byte-identical to public/favicon.svg (the brand app icon).
const logoProblems = [];
for (const width of [1440, 390]) {
	for (const theme of ['light', 'dark']) {
		const page = await pageAt(width, theme);
		await page.goto(ORIGIN + PAGES[0], { waitUntil: 'load' });
		await page.waitForFunction(() => [...document.querySelectorAll('.site-title img')].every((i) => i.complete), null, { timeout: 10_000 }).catch(() => {});
		const imgs = await page.$$eval('.site-title img', (els) =>
			els.map((i) => {
				const r = i.getBoundingClientRect();
				const cs = getComputedStyle(i);
				return { src: i.getAttribute('src'), alt: i.getAttribute('alt'), complete: i.complete, nw: i.naturalWidth, h: r.height, w: r.width, visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 };
			}),
		);
		const shown = imgs.filter((i) => i.visible);
		const want = theme === 'light' ? 'unlisted-lockup-black' : 'unlisted-lockup-white';
		const tag = `logo @${width} ${theme}`;
		if (shown.length !== 1) logoProblems.push(`${tag}: ${shown.length} visible logo images (of ${imgs.length})`);
		for (const i of shown) {
			if (!i.complete || i.nw === 0) logoProblems.push(`${tag}: ${i.src} did not load (naturalWidth ${i.nw})`);
			if (i.h < 16) logoProblems.push(`${tag}: drawn ${i.h.toFixed(1)} px tall`);
			if (!i.src?.includes(want)) logoProblems.push(`${tag}: shows ${i.src}, expected ${want}`);
		}
		if (width === 1440) console.log(`${tag}: ${shown.map((i) => `${i.src} ${Math.round(i.w)}×${Math.round(i.h)} loaded=${i.complete && i.nw > 0}`).join(', ') || 'none visible'}`);
		await page.context().close();
	}
}
{
	const want = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
	const page = await pageAt(1440, 'light');
	await page.goto(ORIGIN + PAGES[0]);
	const href = await page.$eval('link[rel="shortcut icon"], link[rel="icon"]', (l) => l.getAttribute('href')).catch(() => null);
	await page.context().close();
	const r = href ? await fetch(new URL(href, ORIGIN + '/')) : null;
	const body = r?.ok ? await r.text() : null;
	if (body !== want) logoProblems.push(`favicon ${href}: ${r ? r.status : 'no link'}${body && body !== want ? ', differs from public/favicon.svg' : ''}`);
	console.log(`favicon ${href}: ${r?.status ?? 'none'} ${body === want ? 'matches public/favicon.svg' : 'MISMATCH'}`);
}
console.log(`logo: ${logoProblems.length} problems`);
for (const p of logoProblems) console.log('  ' + p);

// ---------------------------------------------------------------- 3. search
let searchOk = false;
{
	const page = await pageAt(1440, 'light');
	await page.goto(ORIGIN + '/');
	await page.click('button[data-open-modal]');
	await page.fill('dialog[open] input', QUERY);
	await page.waitForSelector('dialog[open] .pagefind-ui__result-link', { timeout: 10_000 });
	// Pagefind renders results as their fragments load, and the order can change while it does
	// (seen against the deployed site: read too early, the top result wasn't there yet). Read
	// only once the list has stopped changing for a second.
	const read = () => page.$$eval('dialog[open] .pagefind-ui__result-link', (as) => as.map((a) => a.getAttribute('href')));
	let hits = await read();
	for (let i = 0, stable = 0; i < 40 && stable < 2; i++) {
		await page.waitForTimeout(500);
		const next = await read();
		stable = JSON.stringify(next) === JSON.stringify(hits) ? stable + 1 : 0;
		hits = next;
	}
	searchOk = hits.some((h) => h.startsWith(EXPECT));
	console.log(`search "${QUERY}": ${hits.length} results, first ${hits.slice(0, 3).join(', ')} — ${searchOk ? 'ok' : 'FAIL: ' + EXPECT + ' not found'}`);
	if (SHOTS) {
		mkdirSync(SHOTS, { recursive: true });
		await page.screenshot({ path: join(SHOTS, 'search-1440-light.png') });
	}
	await page.context().close();
}

// ---------------------------------------------------------------- 5. shots
if (SHOTS) {
	for (const width of [1440, 390]) {
		for (const theme of ['light', 'dark']) {
			const page = await pageAt(width, theme);
			for (const P of PAGES) {
				await page.goto(ORIGIN + P, { waitUntil: 'networkidle' });
				const name = `${P === '/' ? 'home' : P.replace(/\//g, '_').replace(/^_|_$/g, '')}-${width}-${theme}`;
				await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
			}
			if (width === 390) {
				await page.click('button.sl-menu-button');
				await page.waitForTimeout(300);
				await page.screenshot({ path: join(SHOTS, `menu-390-${theme}.png`) });
			}
			await page.context().close();
		}
	}
	console.log(`screenshots written to ${SHOTS}: ${PAGES.length} pages × 2 widths × 2 themes`);
}

await browser.close();
if (!REMOTE) server.close();
const failed = broken.length + overflow.length + logoProblems.length + (searchOk ? 0 : 1) + (labelsOk ? 0 : 1);
console.log(failed ? `FAILED: ${failed} problem(s)` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
