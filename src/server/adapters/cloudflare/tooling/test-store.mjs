import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { repositoryRoot } from './configuration.mjs';
import { assertCurrentMigrations } from './migrations.mjs';
import { confirmTarget, wranglerRunner } from './operations.mjs';
import { safeWranglerEnvironment } from './safe-environment.mjs';
import { readStoreTarget, storeArguments } from './store-target.mjs';
import { runHostedChild } from './hosted-progress.mjs';

const suites = {
  workflow: {
    total: 70, label: 'full D1 workflow', maxWorkers: 1,
    include: ['src/server/adapters/d1/store.test.ts'],
  },
  accounts: {
    total: 82, label: 'connector accounts', maxWorkers: 4,
    include: ['authentication.test.ts', 'authenticationRecovery.test.ts',
      'authenticationInitiation.test.ts', 'authenticationCompletion.test.ts']
      .map((file) => `src/server/adapters/cloudflare/${file}`),
  },
};

/** Read only counts and assertion positions from the private Vitest report. */
export function storeReport(output) {
  const line = output.split('\n').find((value) => value.startsWith('{"numTotalTestSuites":'));
  let result;
  try {
    result = JSON.parse(line);
  } catch {
    throw new Error('The hosted D1 result could not be read. Inspect retained fixture journals.');
  }
  const counters = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'];
  if (counters.some((key) => !Number.isInteger(result[key]) || result[key] < 0)) {
    throw new Error('The hosted D1 result has invalid test counts.');
  }
  const assertions = Array.isArray(result.testResults) ? result.testResults.flatMap((suite) =>
    Array.isArray(suite?.assertionResults) ? suite.assertionResults : []) : [];
  const failedPositions = assertions.length === result.numTotalTests ? assertions.flatMap((assertion, index) =>
    assertion?.status === 'failed' ? [index + 1] : []) : [];
  return {
    total: result.numTotalTests, passed: result.numPassedTests, failed: result.numFailedTests,
    skipped: result.numPendingTests + result.numTodoTests, success: result.success === true, failedPositions,
  };
}

async function retainedJournals(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('minsky-d1-proof-'))
    .map((entry) => join(directory, entry.name, 'fixture.json')).filter(existsSync);
}

/** Both suites use the exact D1-only CI target. Neither mutates its schema. */
export async function runHostedStore(arguments_, dependencies = {}) {
  const [name, ...targetArguments] = arguments_;
  if (!Object.hasOwn(suites, name)) throw new Error('Select the complete workflow or accounts suite.');
  const suite = suites[name];
  const transportArguments = targetArguments.filter((argument) => argument.startsWith('--transport='));
  if (transportArguments.length > 1 || transportArguments.length === 1 &&
      !['--transport=binding', '--transport=api'].includes(transportArguments[0])) {
    throw new Error('Select --transport=binding or --transport=api once.');
  }
  const transport = transportArguments[0]?.slice('--transport='.length) ?? 'binding';
  const options = storeArguments(targetArguments.filter((argument) => !argument.startsWith('--transport=')));
  const settings = await readStoreTarget(options);
  const runWrangler = dependencies.runWrangler ?? wranglerRunner(settings, settings.configPath);
  await confirmTarget(options, settings, runWrangler);
  await assertCurrentMigrations(settings, runWrangler);
  let apiToken;
  if (transport === 'api') {
    try {
      const credential = JSON.parse(await runWrangler(['auth', 'token', '--json']));
      if (!['oauth', 'api_token'].includes(credential.type) || typeof credential.token !== 'string' || !credential.token) throw new Error();
      apiToken = credential.token;
    } catch {
      throw new Error('Existing Wrangler access could not supply the private D1 API credential. No fixtures started.');
    }
  }
  const report = dependencies.report ?? ((message) => process.stdout.write(message + '\n'));
  const directory = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'minsky-connector-store-'));
  const testConfig = join(directory, 'vitest.config.mjs');
  let journals;
  let summary;
  try {
    await writeFile(testConfig, `export default ${JSON.stringify({
      root: repositoryRoot,
      test: {
        include: suite.include.map((file) => resolve(repositoryRoot, file)),
        testTimeout: 120_000, hookTimeout: 120_000,
        fileParallelism: suite.maxWorkers > 1, maxWorkers: suite.maxWorkers,
        reporters: [['json', { stdout: true }],
          [resolve(repositoryRoot, 'src/server/adapters/cloudflare/tooling/hosted-progress-reporter.mjs'), { total: suite.total }]],
      },
    })};\n`, { mode: 0o600 });
    const environment = { ...safeWranglerEnvironment(), MINSKY_CONNECTOR_D1_CONFIG: settings.configPath,
      CLOUDFLARE_ACCOUNT_ID: settings.accountId, MINSKY_D1_METRICS: '1', MINSKY_CONNECTOR_D1_TRANSPORT: transport,
      // D1Fixture uses tmpdir(). Each child owns its journals even when another
      // suite runs concurrently against the same reviewed configuration.
      TMPDIR: directory,
    };
    delete environment.MINSKY_AUTH_REMOTE;
    // The CLI option owns transport selection. Inherited shell values cannot
    // inject a credential, destination, or faster request interval.
    delete environment.MINSKY_CONNECTOR_D1_API_TOKEN;
    delete environment.MINSKY_CONNECTOR_D1_API_INTERVAL_MS;
    delete environment.MINSKY_CONNECTOR_D1_DATABASE_ID;
    if (transport === 'api') {
      environment.MINSKY_CONNECTOR_D1_API_TOKEN = apiToken;
      environment.MINSKY_CONNECTOR_D1_API_INTERVAL_MS = String(300 * suite.maxWorkers);
      environment.MINSKY_CONNECTOR_D1_DATABASE_ID = settings.databaseId;
    }
    const execute = dependencies.execute ?? ((argumentsChild, commandOptions) =>
      runHostedChild(argumentsChild, commandOptions, { report, expectedTotal: suite.total }));
    const result = await execute([resolve(repositoryRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--config', testConfig], {
      cwd: repositoryRoot, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30 * 60_000, maxBuffer: 16 * 1024 * 1024,
    });
    summary = storeReport(result.stdout ?? '');
    report(`Hosted ${suite.label}: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped.`);
    if (summary.failed && summary.failedPositions.length) {
      report(`Failed ${name} assertion positions (1-based): ${summary.failedPositions.join(', ')}.`);
    }
    if (result.error || result.status !== 0 || !summary.success || summary.total !== suite.total ||
        summary.passed !== suite.total || summary.failed || summary.skipped) {
      throw new Error(`All ${suite.total} ${suite.label} cases must pass without skips. Provider output was withheld.`);
    }
  } finally {
    journals = await retainedJournals(directory);
    if (journals.length) {
      await rm(testConfig, { force: true });
      for (const path of journals) report(`Fixture recovery journal: ${path}`);
    } else {
      await rm(directory, { recursive: true, force: true });
    }
  }
  if (journals.length) throw new Error('Fixture cleanup is incomplete. Retain the IDs-only recovery journals and the reviewed target configuration.');
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHostedStore(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
