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
  },
});
