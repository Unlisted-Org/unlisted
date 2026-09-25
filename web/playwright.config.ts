import { defineConfig } from "@playwright/test";
import path from "node:path";

// Browsers live in a project-local path (see CONTRIBUTING.md §5); never the shared cache.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(__dirname, "../.playwright-browsers");

const PORT = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
