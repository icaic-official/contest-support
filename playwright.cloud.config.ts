import { defineConfig } from "@playwright/test";
// Error-page DOM snapshots can contain one-time fictional credentials.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: "./tests/cloud",
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/cloud/setup.ts",
  globalTeardown: "./tests/cloud/teardown.ts",
  timeout: 90000,
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "off",
    actionTimeout: 15000,
  },
  webServer: {
    command: "npm run dev -- --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
  },
});
