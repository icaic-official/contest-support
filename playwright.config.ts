import { defineConfig } from "@playwright/test";

// Parallel checkouts can each run the suite. Give each one its own port.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  testIgnore: ["cloud/**", "providers/**", "auth/**", "workflow/**", "connector/**"],
  fullyParallel: true,
  use: { baseURL: origin, trace: "retain-on-failure" },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: !process.env.CI,
  },
});
