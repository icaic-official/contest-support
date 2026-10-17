import {defineConfig} from '@playwright/test';
import process from 'node:process';

const docsUrl = process.env.MINSKY_DOCS_URL;

export default defineConfig({
  testDir: './site/tests',
  fullyParallel: true,
  outputDir: './test-results/docs',
  use: {baseURL: docsUrl ?? 'http://127.0.0.1:4189', trace: 'retain-on-failure'},
  webServer: docsUrl ? undefined : {
    command: 'npm run docs:preview -- --port 4189',
    url: 'http://127.0.0.1:4189',
    reuseExistingServer: false,
  },
});
