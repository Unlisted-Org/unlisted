import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Browsers live in a project-local path (see CONTRIBUTING.md §5); never the shared cache.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(__dirname, "../.playwright-browsers");

// Each run gets its own port (derived from the runner's pid), so a server left over from an earlier,
// interrupted run can never block the next one. E2E_PORT overrides.
// Chosen once in the main runner and inherited by the workers through the environment.
process.env.E2E_PORT ??= String(3300 + (process.pid % 600));
const PORT = Number(process.env.E2E_PORT);
const REPO = path.resolve(__dirname, "..");

// The demo's issuer control and faucet need the fixture issuer key and a passcode on the server.
// For a devnet run they are read here and handed to the server's environment only; never written.
const read = (p: string) => { try { return fs.readFileSync(p, "utf8").trim(); } catch { return undefined; } };
const serverEnv: Record<string, string> = {};
if (process.env.E2E_ENV === "devnet") {
  const key = read(path.join(os.homedir(), ".config/solana/stocklana/fixture-issuer.json"));
  const code = process.env.E2E_DEMO_PASSCODE ?? read(path.join(__dirname, "e2e/holder/.local/demo-passcode"));
  if (key) serverEnv.FIXTURE_ISSUER_KEY = key;
  if (code) serverEnv.DEMO_PASSCODE = code;
}

export default defineConfig({
  testDir: "e2e",
  testIgnore: ["tmp/**"],
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  // E2E_BASE_URL runs the same checks against a deployed site (no local servers started).
  // No step may wait forever: a click on a button that never appears or never enables fails after 60 s
  // (with a screenshot and trace) instead of hanging until the test's own timeout.
  use: { baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`, actionTimeout: 60_000, navigationTimeout: 60_000, trace: "retain-on-failure" },
  webServer: process.env.E2E_BASE_URL ? undefined : [
    { command: `npx next start -p ${PORT}`, url: `http://localhost:${PORT}`, reuseExistingServer: false, timeout: 120_000, env: serverEnv },
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
