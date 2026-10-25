import { defineConfig } from "@playwright/test";

// Specs that already run against the Cloudflare Worker fixture.
const cloudflare = [
  "landing.spec.ts",
  "images.spec.ts",
  "skip-link.spec.ts",
  "ui-selection.spec.ts",
  "team-search.spec.ts",
  "workspace-refresh.spec.ts",
  "avatars.spec.ts",
];

const ignored = ["cloud/**", "providers/**", "auth/**", "workflow/**", "connector/**"];

export default defineConfig({
  testDir: "./tests",
  testIgnore: ignored,
  fullyParallel: true,
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "cloudflare", testMatch: cloudflare, use: { baseURL: "http://127.0.0.1:4176" } },
    { name: "supabase", testIgnore: [...ignored, ...cloudflare], use: { baseURL: "http://127.0.0.1:4175" } },
  ],
  webServer: [
    {
      command: "npm run dev -- --port 4175 --strictPort",
      url: "http://127.0.0.1:4175",
      reuseExistingServer: !process.env.CI,
      env: {
        // This suite mocks the Supabase browser client. Select that provider explicitly.
        VITE_BACKEND: "supabase",
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
      },
    },
    {
      command: "npm run dev -- --port 4176 --strictPort",
      url: "http://127.0.0.1:4176",
      reuseExistingServer: !process.env.CI,
      env: { VITE_BACKEND: "cloudflare" },
    },
  ],
});
