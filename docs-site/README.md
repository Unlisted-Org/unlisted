# Unlisted docs

The documentation site for Unlisted, built with Astro Starlight. The setup (theme override,
two-state theme toggle, explorer-label script and verification discipline) is copied from the
Uncross docs site; the content, palette (`web/app/globals.css`), type (IBM Plex) and logo are
Unlisted's. The logo files in `src/assets/brand/` and `public/favicon.svg` are copied unchanged
from `brand/svg/` (see `brand/README.md`).

```sh
npm install
npm run build          # static site in dist/, search index built by Pagefind
node scripts/sig-labels.mjs   # derive every explorer link's label from its URL

# browsers are project-local; never the shared Playwright cache
export PLAYWRIGHT_BROWSERS_PATH="$(git rev-parse --show-toplevel)/.playwright-browsers"
npx playwright-core install chromium-headless-shell

npm run verify         # links and anchors, sideways scroll at 1440/390 in both themes, search, labels
npm run verify-sigs    # every signature: linked, in a committed record, finalized at its stated slot
node scripts/verify.mjs --shots <dir>   # the same as verify, plus screenshots
```

Every claim on a page comes from the code or a committed record in this repository; each page
ends with the sources it rests on. What isn't verified says so on the page.

The proof bar and the broken version each check was first seen failing against are in
`BROKEN-VERSIONS.md`.
