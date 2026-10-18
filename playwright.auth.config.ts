import { defineConfig } from '@playwright/test';

// Error-page DOM snapshots can contain one-time fictional credentials.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

export default defineConfig({
  testDir: './tests/auth',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  // Login requests and fixture responses contain credentials. Do not save them.
  use: {
    baseURL: 'https://127.0.0.1:8788',
    ignoreHTTPSErrors: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'node scripts/auth-browser-fixture.mjs',
    url: 'https://127.0.0.1:8788/__fixture/health',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
