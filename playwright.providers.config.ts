import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/providers',
  testMatch: process.env.MINSKY_PROVIDER_RECOVERY === 'true'
    ? 'recovery.spec.ts'
    : 'contract.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90000,
  reporter: 'line',
  outputDir: 'test-results/providers',
  use: {
    baseURL: process.env.MINSKY_CF_TEST_ORIGIN || 'http://127.0.0.1:4174',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  ...(process.env.MINSKY_PROVIDER_RECOVERY === 'true' ? {} : {
    webServer: {
      command: 'npm run dev -- --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174/tests/providers/browser.html',
      reuseExistingServer: false,
    },
  }),
});
