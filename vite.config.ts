import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
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
    // Many files start their own miniflare process. On a slow Workers Builds runner,
    // startup can pass Vitest's 5 s default and fail an otherwise correct test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
