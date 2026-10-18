import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { repositoryRoot } from './configuration.mjs';
import { confirmTarget, wranglerRunner } from './operations.mjs';
import { safeWranglerEnvironment } from './safe-environment.mjs';
import { assertCurrentMigrations } from './migrations.mjs';
import { readStoreTarget, storeArguments } from './store-target.mjs';

const expectedCases = 70;

export function workflowArguments(arguments_) {
  return storeArguments(arguments_);
}

export function workflowReport(output) {
  // Wrangler diagnostics can precede the reporter. Parse only the reporter's
  // JSON line and never forward diagnostics, assertions, or provider bodies.
  const line = output.split('\n').find((value) => value.startsWith('{"numTotalTestSuites":'));
  let result;
  try {
    result = JSON.parse(line);
  } catch {
    throw new Error('The full hosted workflow result could not be read. Inspect retained fixture journals.');
  }
  const counters = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'];
  if (counters.some((key) => !Number.isInteger(result[key]) || result[key] < 0)) {
    throw new Error('The hosted workflow result has invalid test counts.');
  }
  const assertions = Array.isArray(result.testResults) ? result.testResults.flatMap((suite) =>
    Array.isArray(suite?.assertionResults) ? suite.assertionResults : []) : [];
  // Positions identify cases in this checkout without exposing fixture values
  // from titles, assertion messages, stacks, or provider response bodies.
  const failedPositions = assertions.length === result.numTotalTests ? assertions.flatMap((assertion, index) =>
    assertion?.status === 'failed' ? [index + 1] : []) : [];
  return {
    total: result.numTotalTests, passed: result.numPassedTests, failed: result.numFailedTests,
    skipped: result.numPendingTests + result.numTodoTests,
    success: result.success === true,
    failedPositions,
  };
}

async function fixtureDirectories() {
  return (await readdir(tmpdir())).filter((name) => name.startsWith('minsky-d1-proof-'));
}

async function retainedJournals(runtimeConfig, before) {
  const retained = [];
  for (const directory of await fixtureDirectories()) {
    const path = join(tmpdir(), directory, 'fixture.json');
    try {
      const journal = JSON.parse(await readFile(path, 'utf8'));
      if (journal.config === runtimeConfig) retained.push(path);
    } catch {
      // A newly interrupted journal can be incomplete. Preserve the runtime
      // configuration until an operator establishes ownership and cleanup.
      if (!before.has(directory)) retained.push(path);
    }
  }
  return retained;
}

/** Exact hosted target only. This runner never deploys or changes migrations. */
export async function runHostedWorkflow(arguments_, dependencies = {}) {
  const options = workflowArguments(arguments_);
  const settings = await readStoreTarget(options);
  const runWrangler = dependencies.runWrangler ?? wranglerRunner(settings, options.config);
  await confirmTarget(options, settings, runWrangler);
  await assertCurrentMigrations(settings, runWrangler);
  const report = dependencies.report ?? ((message) => process.stdout.write(message + '\n'));
  const before = new Set(await fixtureDirectories());
  const directory = await mkdtemp(join(tmpdir(), 'minsky-connector-workflow-'));
  const runtimeConfig = join(directory, 'wrangler.jsonc');
  let keepRuntime;
  let summary;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(runtimeConfig, JSON.stringify({
      name: settings.workerName, account_id: settings.accountId,
      compatibility_date: '2026-10-13', compatibility_flags: ['nodejs_compat'],
      workers_dev: false, preview_urls: false,
      d1_databases: [{ binding: 'DB', database_name: settings.databaseName,
        database_id: settings.databaseId, remote: true }],
    }, null, 2), { mode: 0o600 });
    const testConfig = join(directory, 'vitest.config.mjs');
    await writeFile(testConfig, `export default ${JSON.stringify({
      root: repositoryRoot,
      test: {
        include: [resolve(repositoryRoot, 'src/server/adapters/d1/store.test.ts')],
        testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false, maxWorkers: 1,
        reporters: [['json', { stdout: true }]],
      },
    })};\n`, { mode: 0o600 });
    const environment = { ...safeWranglerEnvironment(), MINSKY_CONNECTOR_D1_CONFIG: runtimeConfig,
      CLOUDFLARE_ACCOUNT_ID: settings.accountId, WRANGLER_SEND_METRICS: 'false' };
    delete environment.MINSKY_D1_REMOTE;
    delete environment.MINSKY_AUTH_REMOTE;
    const execute = dependencies.execute ?? ((argumentsChild, commandOptions) => spawnSync(process.execPath, argumentsChild, commandOptions));
    const result = await execute([resolve(repositoryRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--config', testConfig], {
      cwd: repositoryRoot, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30 * 60_000, maxBuffer: 16 * 1024 * 1024,
    });
    summary = workflowReport(result.stdout ?? '');
    report(`Hosted full D1 workflow: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped.`);
    if (summary.failed && summary.failedPositions.length) {
      report(`Failed workflow assertion positions (1-based): ${summary.failedPositions.join(', ')}.`);
    }
    if (result.error || result.status !== 0 || !summary.success || summary.total !== expectedCases ||
        summary.passed !== expectedCases || summary.failed !== 0 || summary.skipped !== 0) {
      throw new Error(`All ${expectedCases} full D1 workflow cases must pass without skips. Provider output was withheld.`);
    }
  } finally {
    const journals = await retainedJournals(runtimeConfig, before);
    keepRuntime = journals.length > 0;
    if (keepRuntime) {
      report(`Retained credential-free runtime configuration: ${runtimeConfig}`);
      for (const path of journals) report(`Fixture recovery journal: ${path}`);
    } else {
      await rm(directory, { recursive: true, force: true });
    }
  }
  if (keepRuntime) throw new Error('Fixture cleanup is incomplete. Retain the runtime configuration and recovery journals.');
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHostedWorkflow(process.argv.slice(2)).catch((error) => {
    // Every public error above omits provider output and credential values.
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
