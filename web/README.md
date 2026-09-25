# Unlisted web

The landing page (`/`) and, next, the holder app (`/app`) for Unlisted. Built from the Aceternity Agenforce and Nodus templates, recoloured into the Unlisted palette (`app/globals.css`).

```sh
npm install
npm run evidence      # regenerate lib/evidence.json from the branch records and verify every signature on chain
npm run build         # prebuild verifies the evidence first; the build fails if any signature isn't finalized
PLAYWRIGHT_BROWSERS_PATH=../.playwright-browsers npx playwright test   # proof bar: see e2e/BROKEN-VERSIONS.md
```

Registry: `components.json` reads `ACETERNITY_UI_API_KEY` from the environment (`.env.local`, gitignored). See `docs/reports/2026-09-25-aceternity-registry-key.md`.
