import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/server/adapters/d1/assertions.test.ts", "src/server/adapters/d1/store.test.ts", "src/server/adapters/d1/queryPlans.test.ts", "src/server/adapters/d1/readVolume.test.ts", "src/server/adapters/d1/cronReads.test.ts", "src/server/adapters/d1/previousWorker.test.ts", "src/server/adapters/cloudflare/authority.test.ts", "src/server/adapters/d1/readerCompile.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
