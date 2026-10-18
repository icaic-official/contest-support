import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/connector',
  testMatch: 'hosted-ui.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 360_000,
  expect: { timeout: 20_000 },
  reporter: 'json',
  outputDir: process.env.MINSKY_CF_UI_OUTPUT ?? 'test-results/connector-ui',
  preserveOutput: 'never',
  use: {
    baseURL: process.env.MINSKY_CF_TEST_ORIGIN,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
});
