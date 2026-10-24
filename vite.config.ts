import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Workers Builds installs node_modules fresh, so Vitest has no earlier durations.
// It then starts larger files first, and these short files that start the local
// Cloudflare runtime would run last. Start them first so they do not extend the run.
const slowTestFiles = [
  "src/server/adapters/cloudflare/authenticationCompletion.test.ts",
  "src/server/adapters/cloudflare/authenticationInitiation.test.ts",
  "src/server/adapters/cloudflare/authentication.test.ts",
  "src/server/adapters/cloudflare/authenticationRecovery.test.ts",
];

class SlowFirstSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const slow = (file: TestSpecification) =>
      slowTestFiles.some((path) => file.moduleId.endsWith(`/${path}`));
    return [...sorted.filter(slow), ...sorted.filter((file) => !slow(file))];
  }
}
export default defineConfig({
  // The verification helper sets this to an empty directory so the build does
  // not read .env.local. A normal build keeps Vite's project-root default.
  ...(process.env.MINSKY_VERIFY_ENV_DIR ? { envDir: process.env.MINSKY_VERIFY_ENV_DIR } : {}),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.mjs", "scripts/**/*.test.mjs"],
    exclude: ["**/hostedHttp.test.ts"],
    // Some tests start miniflare, esbuild, embedded PostgreSQL, or a child process.
    // A slow Workers Builds runner can pass Vitest's 5 s default. Longer explicit limits still apply.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Most test time waits on local Workers runtimes and password hashing.
    // Use every CPU instead of Vitest's default of one fewer.
    maxWorkers: "100%",
    sequence: { sequencer: SlowFirstSequencer },
  },
});
