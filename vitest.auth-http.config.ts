import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/server/adapters/cloudflare/hostedHttp.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
