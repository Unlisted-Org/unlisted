import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 10 * 60_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:5183", trace: "retain-on-failure", screenshot: "only-on-failure", viewport: { width: 1280, height: 1000 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], headless: true } }],
  webServer: { command: "npx vite --port 5183 --strictPort --host 127.0.0.1", url: "http://127.0.0.1:5183", reuseExistingServer: false, timeout: 60_000 },
});
