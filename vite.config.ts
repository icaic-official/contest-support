import { execFileSync } from "node:child_process";
import { accessSync, constants, statfsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Workers Builds installs node_modules fresh, so Vitest has no earlier durations.
// It then starts larger files first, and these short files that start the local
// Cloudflare runtime would run last. Start them first so they do not extend the run.
// The pattern matches the authentication*.test.ts set in vitest.auth.config.ts.
const slowTestFile = /\/src\/server\/adapters\/cloudflare\/authentication[^/]*\.test\.ts$/;

class SlowFirstSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const slow = (file: TestSpecification) => slowTestFile.test(file.moduleId);
    return [...sorted.filter(slow), ...sorted.filter((file) => !slow(file))];
  }
}

// A local D1 database lives in SQLite files under the temp directory, and each commit writes to
// that disk. A process that writes to the same disk slows the commits.
// A full run holds about 50 MB at its peak, so use tmpfs only when this process can write to it
// and it has 512 MiB free. A read-only mount has free space that no test can use.
function memoryTempDirectory(): string | undefined {
  if (process.env.TMPDIR) return undefined;
  try {
    accessSync("/dev/shm", constants.W_OK);
    const { bavail, bsize } = statfsSync("/dev/shm");
    return bavail * bsize >= 512 * 1024 * 1024 ? "/dev/shm" : undefined;
  } catch {
    return undefined;
  }
}
const tempDirectory = memoryTempDirectory();

// The footer shows this commit. Workers Builds supplies it; a local build asks git.
function buildId(): string {
  const supplied = process.env.WORKERS_CI_COMMIT_SHA;
  if (supplied) return supplied;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  // The verification helper sets this to an empty directory so the build does
  // not read .env.local. A normal build keeps Vite's project-root default.
  ...(process.env.MINSKY_VERIFY_ENV_DIR ? { envDir: process.env.MINSKY_VERIFY_ENV_DIR } : {}),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.mjs", "scripts/**/*.test.mjs"],
    // readerCompile.test.ts compares timings. It runs in `npm run test:d1`, one file
    // at a time, so a busy Workers Builds runner cannot fail a deploy with it.
    exclude: ["**/hostedHttp.test.ts", "**/readerCompile.test.ts"],
    // Some tests start miniflare, esbuild, embedded PostgreSQL, or a child process.
    // A slow Workers Builds runner can pass Vitest's 5 s default. Longer explicit limits still apply.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Most test time waits on local Workers runtimes (each D1 call crosses the Wrangler
    // proxy) and password hashing. Use every CPU instead of Vitest's default of one fewer.
    maxWorkers: "100%",
    ...(tempDirectory ? { env: { TMPDIR: tempDirectory } } : {}),
    sequence: { sequencer: SlowFirstSequencer },
  },
});
