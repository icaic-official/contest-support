import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'vitest';
import { repositoryRoot } from './configuration.mjs';
import { renderStoreConfiguration, storeTarget } from './store-target.mjs';
import { accountArguments, accountReport, runHostedAccounts } from './test-accounts.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'minsky-account-runner-test-'));
  directories.push(directory);
  const config = join(directory, 'wrangler.jsonc');
  await writeFile(config, JSON.stringify(renderStoreConfiguration(config)));
  const migrations = (await readdir(join(repositoryRoot, 'src/server/adapters/d1/migrations')))
    .filter((name) => name.endsWith('.sql')).sort();
  const calls = [];
  const reports = [];
  return {
    config, calls, reports,
    arguments: [`--account=${storeTarget.accountId}`, `--database=${storeTarget.databaseId}`, `--config=${config}`],
    dependencies: {
      report: (message) => reports.push(message),
      runWrangler: async (args) => {
        calls.push(args);
        if (args[0] === 'whoami') return storeTarget.accountId;
        if (args[1] === 'info') return JSON.stringify({ uuid: storeTarget.databaseId, name: storeTarget.databaseName });
        return JSON.stringify([{ success: true, results: migrations.map((name) => ({ name })) }]);
      },
    },
  };
}

function result(overrides = {}, status = 0) {
  return { status, stdout: `private-provider-diagnostic\n${JSON.stringify({ numTotalTestSuites: 1,
    numTotalTests: 82, numPassedTests: 82, numFailedTests: 0, numPendingTests: 0,
    numTodoTests: 0, success: true, ...overrides })}\n`, stderr: 'private-provider-error' };
}

test('account runner requires three exact options and rejects all test or credential overrides', () => {
  const valid = ['--account=value', '--database=value', '--config=value'];
  for (const args of [[], valid.slice(0, 2), [...valid, '--account=other'],
    ...['test-name-pattern=reset', 'skip=reset', 'expected-count=1', 'password=private-value', 'token=private-value', 'origin=https://elsewhere.invalid']
      .map((option) => [...valid, `--${option}`]),
  ]) assert.throws(() => accountArguments(args));
});

test('hosted accounts use the complete suite, private logging, and only the confirmed D1 binding', async () => {
  const setup = await fixture();
  let runtime;
  setup.dependencies.execute = async (args, options) => {
    runtime = options.env.MINSKY_CONNECTOR_D1_CONFIG;
    const proxy = JSON.parse(await readFile(runtime, 'utf8'));
    assert.equal(proxy.account_id, storeTarget.accountId);
    assert.deepEqual(proxy.d1_databases, [{ binding: 'DB', database_name: storeTarget.databaseName,
      database_id: storeTarget.databaseId, remote: true }]);
    for (const binding of ['r2_buckets', 'durable_objects', 'assets', 'vars']) assert.equal(Object.hasOwn(proxy, binding), false);
    for (const variable of ['MINSKY_D1_REMOTE', 'MINSKY_AUTH_REMOTE', 'MINSKY_AUTH_LEGACY']) assert.equal(options.env[variable], undefined);
    assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID, storeTarget.accountId);
    assert.equal(options.env.WRANGLER_LOG_SANITIZE, 'true');
    assert.equal(options.env.WRANGLER_WRITE_LOGS, 'false');
    assert.equal((await stat(runtime)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(runtime))).mode & 0o777, 0o700);
    assert.deepEqual(args.slice(1, 3), ['run', '--config']);
    assert.equal(args.length, 4);
    assert.equal(options.stdio.join(','), 'ignore,pipe,pipe');
    const text = await readFile(args[3], 'utf8');
    const config = JSON.parse(text.slice('export default '.length).trim().replace(/;$/, ''));
    assert.deepEqual(config.test.reporters, [['json', { stdout: true }]]);
    assert.deepEqual(config.test.include, [join(repositoryRoot, 'src/server/adapters/cloudflare/authentication.test.ts')]);
    return result();
  };
  assert.deepEqual(await runHostedAccounts(setup.arguments, setup.dependencies), {
    total: 82, passed: 82, failed: 0, skipped: 0, success: true,
  });
  assert.deepEqual(setup.calls.map((args) => args.slice(0, 2)), [['whoami'], ['d1', 'info'], ['d1', 'execute']]);
  assert.equal(setup.calls[2].at(-1), 'SELECT name FROM d1_migrations ORDER BY id');
  assert.equal(setup.calls.some((args) => args.some((arg) => ['apply', 'deploy', 'create', 'delete'].includes(arg))), false);
  assert.deepEqual(setup.reports, ['Hosted connector accounts: 82 passed, 0 failed, 0 skipped.']);
  await assert.rejects(stat(runtime), { code: 'ENOENT' });
});

test('live connector, authentication, proof, and unapproved databases stop before provider execution', async () => {
  const setup = await fixture();
  setup.dependencies.execute = () => { throw new Error('Fixtures must not start'); };
  for (const database of ['de43cf95-c024-4e44-860d-8ff179e4e08d', '5d746d29-0a66-4346-96a6-4974126685d7',
    '06560c1c-8907-47d6-b2b6-f22e129ebbe4', '00000000-0000-4000-8000-000000000001']) {
    await assert.rejects(runHostedAccounts(setup.arguments.map((arg) => arg.startsWith('--database=') ? `--database=${database}` : arg), setup.dependencies), /exact isolated/);
  }
  await assert.rejects(runHostedAccounts(setup.arguments.map((arg) => arg.startsWith('--account=') ? '--account=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : arg), setup.dependencies), /exact isolated/);
  assert.equal(setup.calls.length, 0);
});

test('changed configuration resources or Worker entry stop before provider execution', async () => {
  const setup = await fixture();
  for (const change of [
    (config) => { config.d1_databases[0].database_name = 'minsky-dev'; },
    (config) => { config.main = '../authWorker.ts'; },
    (config) => { config.r2_buckets = [{ binding: 'IMAGES', bucket_name: 'minsky-dev-images' }]; },
  ]) {
    const config = renderStoreConfiguration(setup.config);
    change(config);
    await writeFile(setup.config, JSON.stringify(config));
    await assert.rejects(runHostedAccounts(setup.arguments, setup.dependencies));
  }
  assert.equal(setup.calls.length, 0);
});

test('live account or database metadata mismatch prevents fixture execution', async () => {
  const setup = await fixture();
  let executed = false;
  setup.dependencies.execute = () => { executed = true; return result(); };
  setup.dependencies.runWrangler = async () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await assert.rejects(runHostedAccounts(setup.arguments, setup.dependencies), /could not be confirmed/);
  setup.dependencies.runWrangler = async (args) => args[0] === 'whoami' ? storeTarget.accountId
    : JSON.stringify({ name: storeTarget.databaseName, uuid: '00000000-0000-4000-8000-000000000001' });
  await assert.rejects(runHostedAccounts(setup.arguments, setup.dependencies), /does not match/);
  assert.equal(executed, false);
});

test('missing, malformed, or extra migration metadata prevents fixture execution', async () => {
  const setup = await fixture();
  let executed = false;
  setup.dependencies.execute = () => { executed = true; return result(); };
  const original = setup.dependencies.runWrangler;
  for (const metadata of ['private-provider-error', JSON.stringify([{ success: true, results: [] }]),
    JSON.stringify([{ success: true, results: [{ name: '9999_unreviewed.sql' }] }])]) {
    setup.dependencies.runWrangler = (args) => args[1] === 'execute' ? metadata : original(args);
    await assert.rejects(runHostedAccounts(setup.arguments, setup.dependencies), /migration/);
  }
  assert.equal(executed, false);
});

test('failed, skipped, narrowed, or unsuccessful executions cannot produce a hosted account pass', async () => {
  const setup = await fixture();
  for (const report of [
    { numPassedTests: 81, numFailedTests: 1, success: false },
    { numPassedTests: 81, numPendingTests: 1 }, { numTodoTests: 1 },
    { numPassedTests: 81, numTotalTests: 81 }, { numPassedTests: 83, numTotalTests: 83 }, { success: false },
  ]) {
    setup.dependencies.execute = () => result(report);
    await assert.rejects(runHostedAccounts(setup.arguments, setup.dependencies), /82 hosted account cases/);
  }
  setup.dependencies.execute = () => result({}, 1);
  await assert.rejects(runHostedAccounts(setup.arguments, setup.dependencies), /82 hosted account cases/);
  assert.equal(setup.reports.some((message) => message.includes('private-provider')), false);
  for (const output of ['private-provider-error', JSON.stringify({ numTotalTestSuites: 1, numTotalTests: -1 }),
    result({ numPassedTests: '82' }).stdout]) assert.throws(() => accountReport(output));
});

test('fixture cleanup failure retains its credential-free runtime configuration and UUID journal', async () => {
  const setup = await fixture();
  let runtime;
  setup.dependencies.execute = async (_args, options) => {
    runtime = options.env.MINSKY_CONNECTOR_D1_CONFIG;
    directories.push(dirname(runtime));
    const directory = await mkdtemp(join(tmpdir(), 'minsky-d1-proof-'));
    directories.push(directory);
    await writeFile(join(directory, 'fixture.json'), JSON.stringify({ config: runtime, remote: true,
      accountId: storeTarget.accountId, databaseId: storeTarget.databaseId,
      eventId: '00000000-0000-4000-8000-000000000001' }), { mode: 0o600 });
    return result();
  };
  await assert.rejects(runHostedAccounts(setup.arguments, setup.dependencies), /cleanup is incomplete/);
  assert.equal((await stat(runtime)).isFile(), true);
  assert.equal(setup.reports.some((message) => message.startsWith('Fixture recovery journal:')), true);
});

test('a newly interrupted journal is preserved even when its JSON is incomplete', async () => {
  const setup = await fixture();
  let runtime;
  setup.dependencies.execute = async (_args, options) => {
    runtime = options.env.MINSKY_CONNECTOR_D1_CONFIG;
    directories.push(dirname(runtime));
    const directory = await mkdtemp(join(tmpdir(), 'minsky-d1-proof-'));
    directories.push(directory);
    await writeFile(join(directory, 'fixture.json'), '{');
    return result();
  };
  await assert.rejects(runHostedAccounts(setup.arguments, setup.dependencies), /cleanup is incomplete/);
  assert.equal((await stat(runtime)).isFile(), true);
});

test('an unrelated retained fixture is neither removed nor attributed to this run', async () => {
  const setup = await fixture();
  const directory = await mkdtemp(join(tmpdir(), 'minsky-d1-proof-'));
  directories.push(directory);
  const journal = join(directory, 'fixture.json');
  await writeFile(journal, JSON.stringify({ config: 'unrelated-public-config', eventId: '00000000-0000-4000-8000-000000000001' }));
  setup.dependencies.execute = () => result();
  await runHostedAccounts(setup.arguments, setup.dependencies);
  assert.equal((await stat(journal)).isFile(), true);
  assert.equal(setup.reports.length, 1);
});
