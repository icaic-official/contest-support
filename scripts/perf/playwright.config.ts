import { defineConfig } from "@playwright/test";

const prod = Number(process.env.PERF_PROD_PORT ?? 4180);
const dev = Number(process.env.PERF_DEV_PORT ?? 4181);

// One worker, one test at a time, so timings do not compete with each other.
export default defineConfig({
  testDir: ".",
  testMatch: "client.spec.ts",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  webServer: [
    { command: `node ${import.meta.dirname}/serve.mjs ${prod}`, url: `http://127.0.0.1:${prod}/`, reuseExistingServer: false, cwd: process.cwd() },
    { command: `npm run dev -- --port ${dev} --strictPort`, url: `http://127.0.0.1:${dev}/`, reuseExistingServer: false, cwd: process.cwd() },
  ],
});
