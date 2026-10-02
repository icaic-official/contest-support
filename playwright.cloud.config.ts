import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/cloud",
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/cloud/setup.ts",
  globalTeardown: "./tests/cloud/teardown.ts",
  timeout: 90000,
  use: {
    baseURL: process.env.MINSKY_HOSTED_URL || "http://127.0.0.1:4174",
    trace: "off",
    actionTimeout: 15000,
  },
  webServer: process.env.MINSKY_HOSTED_URL
    ? undefined
    : {
        command: "npm run dev -- --port 4174 --strictPort",
        url: "http://127.0.0.1:4174",
        reuseExistingServer: false,
      },
});
