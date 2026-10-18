import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'vitest';
import { repositoryRoot } from './configuration.mjs';
import { renderStoreConfiguration, storeTarget } from './store-target.mjs';
import { runHostedWorkflow, workflowArguments, workflowReport } from './test-workflow.mjs';

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const settings = storeTarget;

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'minsky-workflow-runner-test-'));
  temporaryDirectories.push(directory);
  const config = join(directory, 'wrangler.jsonc');
  await writeFile(config, JSON.stringify(renderStoreConfiguration(config)));
  const migrations = (await readdir(join(repositoryRoot, 'src/server/adapters/d1/migrations')))
    .filter((name) => name.endsWith('.sql')).sort();
  const calls = [];
  const reports = [];
  return {
    arguments: [`--account=${settings.accountId}`, `--database=${settings.databaseId}`, `--config=${config}`],
    config, calls, reports,
    dependencies: {
      report: (message) => reports.push(message),
      runWrangler: async (args) => {
        calls.push(args);
        if (args[0] === 'whoami') return settings.accountId;
        if (args[1] === 'info') return JSON.stringify({ uuid: settings.databaseId, name: settings.databaseName });
        return JSON.stringify([{ success: true, results: migrations.map((name) => ({ name })) }]);
      },
    },
  };
}

function result(overrides = {}) {
  return { status: 0, stdout: JSON.stringify({ numTotalTestSuites: 1, numTotalTests: 70,
    numPassedTests: 70, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true, ...overrides }),
  stderr: 'private-provider-diagnostic' };
}

test('workflow runner accepts only explicit target options and forbids narrowed test selections', () => {
  for (const args of [[], ['--account=value'],
    ['--account=value', '--database=value', '--config=value', '--test-name-pattern=claim'],
    ['--account=value', '--account=other', '--database=value', '--config=value'],
  ]) assert.throws(() => workflowArguments(args));
});

test('full hosted workflow uses only the confirmed D1 binding and production test mode', async () => {
  const setup = await fixture();
  let runtime;
  setup.dependencies.execute = async (args, options) => {
    runtime = options.env.MINSKY_CONNECTOR_D1_CONFIG;
    const proxy = JSON.parse(await readFile(runtime, 'utf8'));
    assert.deepEqual(proxy.d1_databases, [{ binding: 'DB', database_name: settings.databaseName, database_id: settings.databaseId, remote: true }]);
    assert.equal(Object.hasOwn(proxy, 'r2_buckets'), false);
    assert.equal(Object.hasOwn(proxy, 'durable_objects'), false);
    assert.equal(Object.hasOwn(proxy, 'assets'), false);
    assert.equal(options.env.MINSKY_D1_REMOTE, undefined);
    assert.equal(options.env.MINSKY_AUTH_REMOTE, undefined);
    assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID, settings.accountId);
    assert.equal((await stat(runtime)).mode & 0o777, 0o600);
    const testConfig = await readFile(args[3], 'utf8');
    const parsed = JSON.parse(testConfig.slice('export default '.length).trim().replace(/;$/, ''));
    assert.deepEqual(parsed.test.reporters, [['json', { stdout: true }]]);
    assert.equal(parsed.test.include.length, 1);
    assert.equal(parsed.test.include[0].endsWith('/d1/store.test.ts'), true);
    return result();
  };
  assert.deepEqual(await runHostedWorkflow(setup.arguments, setup.dependencies), { total: 70, passed: 70, failed: 0, skipped: 0, success: true, failedPositions: [] });
  assert.deepEqual(setup.calls.map((args) => args.slice(0, 2)), [['whoami'], ['d1', 'info'], ['d1', 'execute']]);
  assert.equal(setup.calls[2].at(-1), 'SELECT name FROM d1_migrations ORDER BY id');
  assert.equal(setup.calls.some((args) => args.includes('apply') || args.includes('deploy') || args.includes('create')), false);
  assert.equal(setup.reports.some((message) => message.includes('private-provider')), false);
  await assert.rejects(stat(runtime), { code: 'ENOENT' });
});

test('mismatched target or migration metadata prevents fixture execution', async () => {
  const setup = await fixture();
  let executed = false;
  setup.dependencies.execute = () => { executed = true; return result(); };
  for (const database of ['de43cf95-c024-4e44-860d-8ff179e4e08d', '00000000-0000-4000-8000-000000000002']) {
    const wrongTarget = setup.arguments.map((arg) => arg.startsWith('--database=') ? `--database=${database}` : arg);
    await assert.rejects(runHostedWorkflow(wrongTarget, setup.dependencies), /exact isolated dedicated store/);
  }
  assert.equal(setup.calls.length, 0);
  const original = setup.dependencies.runWrangler;
  setup.dependencies.runWrangler = (args) => args[1] === 'execute' ? JSON.stringify([{ success: true, results: [] }]) : original(args);
  await assert.rejects(runHostedWorkflow(setup.arguments, setup.dependencies), /migrations differ/);
  assert.equal(executed, false);
});

test('runner rejects failed, skipped, or narrowed reports without relaying provider diagnostics', async () => {
  const setup = await fixture();
  for (const report of [
    { numPassedTests: 69, numFailedTests: 1, success: false },
    { numPassedTests: 69, numPendingTests: 1 },
    { numPassedTests: 69, numTotalTests: 69 },
  ]) {
    setup.dependencies.execute = () => result(report);
    await assert.rejects(runHostedWorkflow(setup.arguments, setup.dependencies), /70 full D1 workflow cases/);
  }
  assert.equal(setup.reports.some((message) => message.includes('private-provider')), false);
  assert.throws(() => workflowReport('private-provider-diagnostic'), /could not be read/);
});

test('failed workflow diagnostics expose only numeric positions and counters from credential-bearing reports', async () => {
  const setup = await fixture();
  const secret = 'sb_secret_fixture-password-cookie-provider-body';
  const assertions = Array.from({ length: 70 }, (_, index) => ({
    status: index === 2 || index === 50 ? 'failed' : 'passed',
    title: `${secret} title`, fullName: `${secret} full name`,
    ancestorTitles: [secret], failureMessages: [`${secret} message and stack`],
  }));
  const report = result({ numPassedTests: 68, numFailedTests: 2, success: false,
    testResults: [
      { name: secret, message: secret, assertionResults: assertions.slice(0, 35) },
      { name: secret, message: secret, assertionResults: assertions.slice(35) },
    ],
  });
  report.stdout = `${secret}\n${report.stdout}`;
  report.stderr = secret;
  setup.dependencies.execute = () => report;
  await assert.rejects(runHostedWorkflow(setup.arguments, setup.dependencies), /70 full D1 workflow cases/);
  assert.deepEqual(setup.reports, [
    'Hosted full D1 workflow: 68 passed, 2 failed, 0 skipped.',
    'Failed workflow assertion positions (1-based): 3, 51.',
  ]);
  assert.equal(JSON.stringify(workflowReport(report.stdout)).includes(secret), false);
});

test('an incomplete assertion list cannot produce misleading workflow failure positions', async () => {
  const setup = await fixture();
  setup.dependencies.execute = () => result({ numPassedTests: 69, numFailedTests: 1, success: false,
    testResults: [{ assertionResults: [{ status: 'failed', title: 'private-fixture-value' }] }],
  });
  await assert.rejects(runHostedWorkflow(setup.arguments, setup.dependencies), /70 full D1 workflow cases/);
  assert.deepEqual(setup.reports, ['Hosted full D1 workflow: 69 passed, 1 failed, 0 skipped.']);
});

test('surviving fixture journals preserve the runtime configuration and prevent a cleanup pass', async () => {
  const setup = await fixture();
  let runtime;
  setup.dependencies.execute = async (_args, options) => {
    runtime = options.env.MINSKY_CONNECTOR_D1_CONFIG;
    const directory = await mkdtemp(join(tmpdir(), 'minsky-d1-proof-'));
    temporaryDirectories.push(directory, dirname(runtime));
    await writeFile(join(directory, 'fixture.json'), JSON.stringify({ config: runtime, remote: true, workflow: true }), { mode: 0o600 });
    return result();
  };
  await assert.rejects(runHostedWorkflow(setup.arguments, setup.dependencies), /cleanup is incomplete/);
  assert.equal((await stat(runtime)).isFile(), true);
  assert.equal(setup.reports.some((message) => message.includes('Fixture recovery journal:')), true);
});
