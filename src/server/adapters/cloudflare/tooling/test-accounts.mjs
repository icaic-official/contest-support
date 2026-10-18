import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { repositoryRoot } from './configuration.mjs';
import { assertCurrentMigrations } from './migrations.mjs';
import { confirmTarget, wranglerRunner } from './operations.mjs';
import { safeWranglerEnvironment } from './safe-environment.mjs';
import { readStoreTarget, storeArguments } from './store-target.mjs';

const expectedCases = 82;

export function accountArguments(arguments_) {
  return storeArguments(arguments_);
}

export function accountReport(output) {
  const line = output.split('\n').find((value) => value.startsWith('{"numTotalTestSuites":'));
  let result;
  try {
    result = JSON.parse(line);
  } catch {
    throw new Error('The hosted account result could not be read. Inspect retained fixture journals.');
  }
  const counters = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'];
  if (counters.some((key) => !Number.isInteger(result[key]) || result[key] < 0)) throw new Error('The hosted account result has invalid test counts.');
  return {
    total: result.numTotalTests, passed: result.numPassedTests, failed: result.numFailedTests,
    skipped: result.numPendingTests + result.numTodoTests, success: result.success === true,
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
      if (!before.has(directory)) retained.push(path);
    }
  }
  return retained;
}

/** The dedicated store CI target only. No Worker, bucket, or schema mutation. */
export async function runHostedAccounts(arguments_, dependencies = {}) {
  const options = accountArguments(arguments_);
  const settings = await readStoreTarget(options);
  const runWrangler = dependencies.runWrangler ?? wranglerRunner(settings, options.config);
  await confirmTarget(options, settings, runWrangler);
  await assertCurrentMigrations(settings, runWrangler);
  const report = dependencies.report ?? ((message) => process.stdout.write(message + '\n'));
  const before = new Set(await fixtureDirectories());
  const directory = await mkdtemp(join(tmpdir(), 'minsky-connector-accounts-'));
  const runtimeConfig = join(directory, 'wrangler.jsonc');
  let keepRuntime;
  let summary;
  try {
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
        include: [resolve(repositoryRoot, 'src/server/adapters/cloudflare/authentication.test.ts')],
        testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false, maxWorkers: 1,
        reporters: [['json', { stdout: true }]],
      },
    })};\n`, { mode: 0o600 });
    const environment = { ...safeWranglerEnvironment(), MINSKY_CONNECTOR_D1_CONFIG: runtimeConfig,
      CLOUDFLARE_ACCOUNT_ID: settings.accountId, WRANGLER_SEND_METRICS: 'false' };
    delete environment.MINSKY_D1_REMOTE;
    delete environment.MINSKY_AUTH_REMOTE;
    delete environment.MINSKY_AUTH_LEGACY;
    const execute = dependencies.execute ?? ((argumentsChild, commandOptions) => spawnSync(process.execPath, argumentsChild, commandOptions));
    const result = await execute([resolve(repositoryRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--config', testConfig], {
      cwd: repositoryRoot, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30 * 60_000, maxBuffer: 16 * 1024 * 1024,
    });
    summary = accountReport(result.stdout ?? '');
    report(`Hosted connector accounts: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped.`);
    if (result.error || result.status !== 0 || !summary.success || summary.total !== expectedCases ||
        summary.passed !== expectedCases || summary.failed !== 0 || summary.skipped !== 0) {
      throw new Error(`All ${expectedCases} hosted account cases must pass without skips. Provider output was withheld.`);
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
  runHostedAccounts(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
