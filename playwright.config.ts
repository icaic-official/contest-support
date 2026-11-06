import { defineConfig } from "@playwright/test";

// Parallel checkouts can each run the suite. Give each one its own port.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  testIgnore: ["providers/**", "auth/**", "connector/**"],
  fullyParallel: true,
  // Each worker runs a browser against one shared Vite dev server. Eight
  // workers on a 16-core machine pushed the load average past 40, and
  // 5-second assertions then failed at random. Four workers fail less often.
  workers: 4,
  use: { baseURL: origin, trace: "retain-on-failure" },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: !process.env.CI,
  },
});
