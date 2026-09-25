import { defineConfig } from "@playwright/test";
import path from "node:path";

// Browsers live in a project-local path (see CONTRIBUTING.md §5); never the shared cache.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(__dirname, "../.playwright-browsers");

// Each run gets its own port (derived from the runner's pid), so a server left over from an earlier,
// interrupted run can never block the next one. E2E_PORT overrides.
// Chosen once in the main runner and inherited by the workers through the environment.
process.env.E2E_PORT ??= String(3300 + (process.pid % 600));
const PORT = Number(process.env.E2E_PORT);
const REPO = path.resolve(__dirname, "..");

export default defineConfig({
  testDir: "e2e",
  testIgnore: ["tmp/**"],
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  // E2E_BASE_URL runs the same checks against a deployed site (no local servers started).
  use: { baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}` },
  webServer: process.env.E2E_BASE_URL ? undefined : [
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
