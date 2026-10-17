import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";
export default tseslint.config(
  { ignores: ["dist", "node_modules", "playwright-report", "test-results", "site/dist", "site/.astro", "site/node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": hooks },
    // Preserve the demo's existing Hooks checks during this tooling upgrade.
    // Version 7's recommended preset also adds React Compiler diagnostics.
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/backend/supabase/**", "src/backend/index.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@supabase/*", "**/backend/supabase/**", "./supabase/**"],
          message: "Use the backend contracts. Provider imports belong in src/backend/supabase or src/backend/index.ts.",
        }],
      }],
    },
  },
  {
    files: ["src/server/**/*.ts"],
    ignores: ["src/server/adapters/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@supabase/*", "@aws-sdk/*", "cloudflare:*", "@cloudflare/*", "**/adapters/**"],
          message: "Server contracts and domain rules must not import provider adapters.",
        }],
      }],
    },
  },
  {
    files: [
      "tests/providers/scenarios/**/*.ts", "tests/providers/contracts.ts",
      "tests/providers/browser-backend.ts", "tests/providers/browser-dispatch.ts",
      "tests/providers/browser-protocol.ts", "tests/providers/contract.spec.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: [
            "@supabase/*", "@aws-sdk/*", "cloudflare:*", "@cloudflare/*",
            "**/backend/index", "**/backend/index.ts",
            "**/backend/supabase/**", "**/backend/cloudflare/**", "**/backend/aws/**",
            "**/providers/supabase/**", "**/providers/cloudflare/**", "**/providers/aws/**",
            "../supabase/**", "../cloudflare/**", "../aws/**", "**/cloud/**",
          ],
          message: "Shared provider scenarios use Backend and the test fixture contracts. Keep provider setup and SDK calls in provider fixtures.",
        }],
      }],
    },
  },
);
