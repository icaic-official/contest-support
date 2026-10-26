import assert from 'node:assert/strict';
import { fileURLToPath, URL } from 'node:url';
import { ESLint } from 'eslint';
import { test } from 'vitest';

const boundaryRules = new Set(['no-restricted-imports', 'no-restricted-syntax']);
// The cases lint virtual files, which the TypeScript project service cannot
// load. The boundary rules need no type information.
const eslint = new ESLint({
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  overrideConfig: { languageOptions: { parserOptions: { projectService: false } } },
  ruleFilter: ({ ruleId }) => boundaryRules.has(ruleId),
});

async function boundaryErrors(code, filePath = 'src/connected/BoundaryCheck.tsx') {
  const [result] = await eslint.lintText(code, { filePath });
  assert.deepEqual(result.messages.filter(({ fatal }) => fatal), [], code);
  return result.messages.filter(({ ruleId }) => boundaryRules.has(ruleId));
}

test('UI static imports, re-exports, and literal dynamic imports reject provider SDKs and implementations', async () => {
  const modules = [
    '@aws-sdk/client-s3', '@cloudflare/workers-types',
    '@google-cloud/storage', '@azure/storage-blob', 'cloudflare', 'cloudflare:workers',
    'wrangler', 'wrangler/api', 'miniflare', 'better-auth', 'better-auth/client',
    '../backend/cloudflare/backend',
    '../backend/future-provider/backend', '../server/adapters/d1/store',
  ];
  for (const module of modules) {
    for (const code of [`import ${JSON.stringify(module)};`,
      `export * from ${JSON.stringify(module)};`, `void import(${JSON.stringify(module)});`]) {
      assert.equal((await boundaryErrors(code)).length, 1, code);
    }
  }
// The 45 cases each run a full lint. A busy runner can pass 5 seconds.
}, 60_000);

test('UI uses shared contracts, errors, the selected backend, and ordinary lazy imports', async () => {
  for (const module of ['../backend', '../backend/index', '../backend/index.ts',
    '../backend/contracts', '../backend/contracts.ts', '../backend/errors', '../backend/errors.ts',
    './TeamSearch']) {
    assert.deepEqual(await boundaryErrors(`import ${JSON.stringify(module)};`), []);
    assert.deepEqual(await boundaryErrors(`void import(${JSON.stringify(module)});`), []);
  }
});

test('computed UI imports cannot hide a provider path from the boundary check', async () => {
  for (const code of [
    'const path = "../backend/cloudflare/backend"; void import(path);',
    'void import(`../backend/cloudflare/backend`);',
  ]) {
    const errors = await boundaryErrors(code);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, 'Use a literal dynamic import path so the provider boundary can be checked.');
  }
});

test('shared backend files cannot import a provider while registration and provider modules can', async () => {
  const code = 'import "cloudflare:workers";';
  for (const file of ['src/backend/contracts.ts', 'src/backend/errors.ts']) {
    assert.equal((await boundaryErrors(code, file)).length, 1);
    assert.equal((await boundaryErrors('import "./cloudflare/backend";', file)).length, 1);
  }
  for (const file of ['src/backend/index.ts', 'src/backend/future-provider/backend.ts',
    'src/server/adapters/future-provider/runtime.ts']) {
    assert.deepEqual(await boundaryErrors(code, file), []);
  }
});

test('shared server rules and scenarios reject provider imports and backend selection', async () => {
  for (const file of ['src/server/workflow.ts', 'tests/providers/scenarios/live-updates.ts']) {
    for (const module of ['@google-cloud/storage', '../backend/future-provider/backend',
      '../adapters/d1/store', '../../src/backend/index']) {
      assert.equal((await boundaryErrors(`import ${JSON.stringify(module)};`, file)).length, 1);
    }
  }
});
