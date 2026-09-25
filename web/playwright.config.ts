import { defineConfig } from "@playwright/test";
import path from "node:path";

// Browsers live in a project-local path (see CONTRIBUTING.md §5); never the shared cache.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(__dirname, "../.playwright-browsers");

const PORT = Number(process.env.E2E_PORT ?? 3200);
const REPO = path.resolve(__dirname, "..");

export default defineConfig({
  testDir: "e2e",
  testIgnore: ["tmp/**"],
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: [
    { command: `npx next start -p ${PORT}`, url: `http://localhost:${PORT}`, reuseExistingServer: false, timeout: 120_000 },
    {
      // Agent C's valuation API (spec 03) against the canonical devnet basket; the app's three values come from it.
      command: `CLUSTER=devnet PORT=8907 FIXTURE_BACKFILL=0 MAINNET_BACKFILL=0 BASKET_SHARE_MINT=HjpaxrkjftbtcRJuyAEm7oR8scasnWNxKNgnN26p7iqj IDL_PATH=${REPO}/programs/basket/idl/basket.json node src/server.ts`,
      cwd: path.join(REPO, "services/valuation"),
      url: "http://127.0.0.1:8907/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
