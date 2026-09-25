# Unlisted web

Two surfaces on one design system (`app/globals.css`):
- **`/`, the landing page:** the issuer story, with every claim linked to a transaction. Built from the Aceternity Agenforce template and the registry.
- **`/app`, the holder app** (devnet only):
  - what you own, and its value by three labelled values (sell now, last trade, PreStocks' reference);
  - deposits in kind and by USDC ticket;
  - redemption, including while a leg is paused;
  - open claims and their settlement;
  - issuer-event banners.

  Its logic is Agent B's app (`app/src`) ported unchanged in behaviour, restyled (`app/app/holder.css`) in the Nodus dashboard layout. It has no motion.

```sh
npm install
npm run evidence      # regenerate lib/evidence.json from the records and verify every signature on chain
npm run build         # prebuild verifies the evidence first; builds use webpack (the SDK's .js→.ts imports)
npm run test-wallet   # bundles the Wallet Standard test wallet used by the devnet flow

PLAYWRIGHT_BROWSERS_PATH=../.playwright-browsers npx playwright test                 # landing + app proof bar
LINKS=1 npx playwright test e2e/links.spec.ts                                          # logged-out link check
E2E_ENV=devnet E2E_VALUATION_URL=http://127.0.0.1:8907 npx playwright test e2e/holder/flow.spec.ts   # fresh-wallet devnet flow
```

**Runtime dependencies:**
- **Config:** the app reads `public/config.json`, which covers the cluster, program, share mint, lookup table, router and valuation API. Anything but devnet or localnet is refused.
- **Valuation API:** the three values come from Agent C's service (`services/valuation`). The Playwright config starts it on port 8907 against the canonical devnet basket.

**Proof bar and broken versions:** `e2e/BROKEN-VERSIONS.md`.

**Registry:** `components.json` reads `ACETERNITY_UI_API_KEY` from the environment (`.env.local`, gitignored). See `docs/reports/2026-09-25-aceternity-registry-key.md`.
