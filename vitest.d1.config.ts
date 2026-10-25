import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/server/adapters/d1/store.test.ts", "src/server/adapters/d1/queryPlans.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
