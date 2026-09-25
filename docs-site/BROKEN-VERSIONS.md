# Proof bar and broken versions

Every check below was first run against a deliberately broken version of the site and seen to
**fail**, then run against the real site and seen to pass. Each mutation was made in the working
tree, built, checked, and reverted with `git checkout`; none was committed.

Run on 2026-09-25, with browsers from the worktree's `.playwright-browsers` (Playwright's
`chromium_headless_shell-1243`), never the shared cache.

```sh
export PLAYWRIGHT_BROWSERS_PATH="$(git rev-parse --show-toplevel)/.playwright-browsers"
npm run build
node scripts/verify.mjs [--origin https://unlisted-docs.vercel.app] [--shots <dir>]
node scripts/verify-sigs.mjs [--origin https://unlisted-docs.vercel.app]
```

| # | Check | Script |
|---|---|---|
| 1 | Screenshots of the home page and three content pages at 1440 and 390, light and dark, each in the theme it claims to be | `verify.mjs --shots` (theme asserted per page in the overflow pass) |
| 2 | No page-level horizontal scroll at 390 (or 1440), and no table clipped inside its own box | `verify.mjs` |
| 3 | Searching "claim" returns the claims page | `verify.mjs` |
| 4 | Every internal link and `#anchor` on every page resolves | `verify.mjs` |
| 5 | Every signature is an explorer link, comes from a committed record, and is finalized without error on its network at its stated slot | `verify-sigs.mjs` |

## 1. Screenshots in the right theme

**Broken version:** `src/components/ThemeProvider.astro` forced every page light, ignoring the
stored choice and the OS:
`document.documentElement.dataset.theme = 'light';`

**Failing output:**

```
overflow: 13 pages × 2 widths × 2 themes, 26 problems
  / @1440: theme is light, expected dark
  /product/concepts/ @1440: theme is light, expected dark
  … (every page, at 1440 and 390, in the dark pass)
first visit with OS set to dark: theme=light FAIL
toggle click: theme=dark stored=dark FAIL
FAILED: 28 problem(s)
exit=1
```

A "dark" screenshot from this build would have been light; the check refuses it.

**Passing run (deployed site):** `node scripts/verify.mjs --origin https://unlisted-docs.vercel.app --shots …`
wrote 16 page screenshots (home, the user flow, claims and settlement, the program; 1440 and 390;
light and dark), the 390 menu in both themes and the search results. They are in
`proof/screenshots/` (converted to WebP, or JPEG where a page is taller than WebP allows).

## 2. No sideways scroll at 390

**Broken version (a), page-level:** one element wider than a phone, appended to
`src/styles/theme.css`: `.sl-markdown-content > p:first-child { min-width: 480px; }`

```
overflow: 13 pages × 2 widths × 2 themes, 18 problems
  / @390 light: scrollWidth 496 > innerWidth 390
  /product/concepts/ @390 light: scrollWidth 496 > innerWidth 390
  … (every page whose content starts with a paragraph, in both themes)
FAILED: 18 problem(s)
exit=1
```

**Broken version (b), tables:** the narrow-screen table rules (wrapping, and stacking the
instruction, fee, multiplier and error tables) removed from `src/styles/theme.css`. The page
itself doesn't scroll, but tables scroll inside their box and hide columns; the check counts that too.

```
overflow: 13 pages × 2 widths × 2 themes, 6 problems
  /product/problem/ @390 light: 2 table(s) wider than their box
  /protocol/flow/ @390 light: 4 table(s) wider than their box
  /trust/evidence/ @390 light: 1 table(s) wider than their box
  … (the same in dark)
FAILED: 6 problem(s)
exit=1
```

This one was also the real state of the site during development (4 problems before the table
rules were written); the rules are the fix.

## 3. Search finds the claims page

**Broken version:** `pagefind: false` in the front matter of `protocol/claims.md`, leaving the
page out of the search index.

```
search "claim": 20 results, first /product/user-flow/, /product/user-flow/#3-redeem-anyway-six-legs-now-a-claim-on-the-seventh, /product/user-flow/#5-the-claim-pays-out — FAIL: /protocol/claims/ not found
FAILED: 1 problem(s)
exit=1
```

**A false failure, found and fixed.** The first run against the deployed site failed although
the page was indexed: `search "claim": 16 results, first /product/user-flow/, … — FAIL`. The
check read the result list as soon as the first result appeared, while Pagefind was still
loading and reordering results. A probe reading the same search at 0.5 s, 1.5 s and 4 s found
`/protocol/claims/` first every time. The check now waits until the list has been unchanged for a
second. The broken version above was re-run against the fixed check and still fails; the
deployed site now passes (`search "claim": 20 results, first /protocol/claims/ … — ok`).

## 4. Every internal link resolves

**Broken version:** two links appended to `trust/faq.md`: one to a page that doesn't exist
(`/app/dashboard/`) and one to an anchor that doesn't exist (`/protocol/claims/#no-such-section`).

```
links: 636 internal links across 14 pages, 2 broken
  BROKEN /trust/faq/ → /app/dashboard/ (no such page)
  BROKEN /trust/faq/ → /protocol/claims/#no-such-section (no #no-such-section)
FAILED: 2 problem(s)
exit=1
```

## 5. Every signature is committed and finalized

**Broken version,** four mutations at once:
- (a) one character changed in a real devnet signature (the user flow's in-kind deposit);
- (b) a real mainnet signature (OpenAI's multiplier change) cited as devnet;
- (c) a real devnet signature (the claim settlement) cited at the wrong slot, 503950580 instead of 503950579;
- (d) a full signature pasted as plain text instead of a link.

```
signatures: 66 cited across 14 pages (devnet 56, mainnet 10); 50 with a stated slot; 791 signature-shaped strings in committed records
SIGNATURE CHECK FAILED (5):
  /product/user-flow/: signature-shaped string outside an explorer tx link: 3aYQyrBPgsFJ…
  /product/user-flow/: 2smfMbGR9WfU… is in no committed record outside docs-site/
  /product/problem/: devnet 2bNNe87cA182… not found
  /product/user-flow/: devnet 2smfMbGR9WfU… not found
  /product/user-flow/: devnet EKbAkhDtadbg… page says slot 503950580, chain says 503950579
exit=1
```

The "committed record" rule has a real reason: while writing the claims page, two signatures
were first typed from their 12-character prefixes, with invented endings. They were replaced
with the full signatures from `tests/program/devnet/pause-mid-redemption.json` before any check
ran; this rule, and the on-chain lookup, would each have failed them.

## Passing runs

**Local build:**

```
links: 634 internal links across 14 pages, 0 broken
explorer labels: all match their URLs
overflow: 13 pages × 2 widths × 2 themes, 0 problems
first visit with OS set to dark: theme=dark ok
toggle click: theme=light stored=light ok
first visit with OS set to light: theme=light ok
toggle click: theme=dark stored=dark ok
search "claim": 20 results, first /protocol/claims/, /protocol/claims/#how-a-claim-is-created, /protocol/claims/#what-a-claim-is-owed — ok
ALL CHECKS PASSED

signatures: 65 cited across 14 pages (devnet 54, mainnet 11); 49 with a stated slot; 791 signature-shaped strings in committed records
SIGNATURE CHECK PASSED: every signature is linked, committed, and finalized without error on its network
```

**Deployed site** (https://unlisted-docs.vercel.app):

```
links: 634 internal links across 14 pages, 0 broken
explorer labels: all match their URLs
live: 16 URLs fetched from https://unlisted-docs.vercel.app, 0 not 200
overflow: 13 pages × 2 widths × 2 themes, 0 problems
first visit with OS set to dark: theme=dark ok
toggle click: theme=light stored=light ok
first visit with OS set to light: theme=light ok
toggle click: theme=dark stored=dark ok
search "claim": 20 results, first /protocol/claims/, /protocol/claims/#how-a-claim-is-created, /protocol/claims/#what-a-claim-is-owed — ok
screenshots written to …: 4 pages × 2 widths × 2 themes
ALL CHECKS PASSED

https://unlisted-docs.vercel.app: signatures: 65 cited across 14 pages (devnet 54, mainnet 11); 49 with a stated slot; 791 signature-shaped strings in committed records
SIGNATURE CHECK PASSED: every signature is linked, committed, and finalized without error on its network
```
