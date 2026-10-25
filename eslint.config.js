import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";

// UI, shared server rules, and shared scenarios use the same provider boundary.
// The selected backend and its contracts remain valid application imports.
const providerImportPattern = [
  "^(?:@supabase/|@aws-sdk/|@cloudflare/|@google-cloud/|@azure/|cloudflare(?::|/|$)|wrangler(?:/|$)|miniflare(?:/|$)|better-auth(?:/|$))",
  String.raw`(^|/)backend/(?!contracts(?:\.ts)?$|errors(?:\.ts)?$|index(?:\.ts)?$)`,
  String.raw`(^|/)adapters/`,
  String.raw`^(?:\.\.?/)+(?:cloudflare|aws|gcp|azure)(?:/|$)`,
].join("|");
const providerImportMessage = "Keep provider SDKs and implementations inside provider modules. Use the shared contracts.";

export default tseslint.config(
  { ignores: ["dist", "design", "node_modules", "playwright-report", "test-results", "site/dist", "site/.astro", "site/node_modules", "**/.wrangler/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // The Lapiz preview scripts run in Node.
  { files: [".lapiz/**/*.mjs"], languageOptions: { globals: globals.node } },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": hooks },
    // Preserve the existing Hooks checks during this tooling upgrade.
    // Version 7's recommended preset also adds React Compiler diagnostics.
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/backend/*/**", "src/backend/index.ts", "src/server/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          regex: providerImportPattern,
          message: providerImportMessage,
        }],
      }],
      "no-restricted-syntax": ["error", {
        selector: `ImportExpression[source.value=/${providerImportPattern.replaceAll("/", "\\/")}/]`,
        message: providerImportMessage,
      }, {
        selector: "ImportExpression[source.type!='Literal']",
        message: "Use a literal dynamic import path so the provider boundary can be checked.",
      }],
    },
  },
  {
    files: ["src/server/**/*.ts"],
    ignores: ["src/server/adapters/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ regex: providerImportPattern, message: providerImportMessage }, {
          group: ["**/backend/index", "**/backend/index.ts"],
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
        patterns: [{ regex: providerImportPattern, message: providerImportMessage }, {
          group: [
            "**/backend/index", "**/backend/index.ts",
            "**/providers/cloudflare/**", "**/providers/aws/**",
            "../cloudflare/**", "../aws/**", "**/cloud/**",
          ],
          message: "Shared provider scenarios use Backend and the test fixture contracts. Keep provider setup and SDK calls in provider fixtures.",
        }],
      }],
    },
  },
);
