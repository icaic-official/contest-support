import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test, vi } from 'vitest';
import { repositoryRoot } from './configuration.mjs';
import { renderStoreConfiguration, storeTarget } from './store-target.mjs';
import { runHostedStore, storeReport } from './test-store.mjs';

const directories = [];
const suites = [
  { name: 'workflow', total: 70, label: 'full D1 workflow', maxWorkers: 1,
    include: ['src/server/adapters/d1/store.test.ts'] },
  { name: 'accounts', total: 82, label: 'connector accounts', maxWorkers: 4,
    include: ['authentication.test.ts', 'authenticationRecovery.test.ts',
      'authenticationInitiation.test.ts', 'authenticationCompletion.test.ts']
      .map((file) => `src/server/adapters/cloudflare/${file}`) },
];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'minsky-store-runner-test-'));
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

function result(total, overrides = {}, status = 0) {
  return { status, stdout: `private-provider-diagnostic\n${JSON.stringify({ numTotalTestSuites: 1,
    numTotalTests: total, numPassedTests: total, numFailedTests: 0, numPendingTests: 0,
    numTodoTests: 0, success: true, ...overrides })}\n`, stderr: 'private-provider-error' };
}

test('only the complete workflow and accounts suites accept the three explicit target options', async () => {
  const valid = ['--account=value', '--database=value', '--config=value'];
  for (const name of [undefined, 'constructor', '__proto__', 'other']) {
    await assert.rejects(runHostedStore([name, ...valid]), /Select the complete/);
  }
  for (const { name } of suites) for (const args of [[], valid.slice(0, 2), [...valid, '--account=other'],
    ...['test-name-pattern=claim', 'skip=reset', 'expected-count=1', 'password=private-value',
      'token=private-value', 'origin=https://elsewhere.invalid'].map((option) => [...valid, `--${option}`]),
  ]) await assert.rejects(runHostedStore([name, ...args]));
});

for (const suite of suites) {
  test(`${suite.name} runs the full suite with the reviewed D1-only configuration and private output`, async () => {
    vi.stubEnv('MINSKY_AUTH_REMOTE', '1');
    const setup = await fixture();
    const original = await readFile(setup.config, 'utf8');
    let scratch;
    setup.dependencies.execute = async (args, options) => {
      assert.equal(options.env.MINSKY_CONNECTOR_D1_CONFIG, setup.config);
      assert.deepEqual(JSON.parse(await readFile(setup.config, 'utf8')), renderStoreConfiguration(setup.config));
      assert.equal(options.env.MINSKY_AUTH_REMOTE, undefined);
      assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID, storeTarget.accountId);
      assert.equal(options.env.WRANGLER_LOG_SANITIZE, 'true');
      assert.equal(options.env.WRANGLER_WRITE_LOGS, 'false');
      assert.equal(options.env.MINSKY_D1_METRICS, '1');
      assert.equal(options.stdio.join(','), 'ignore,pipe,pipe');
      assert.deepEqual(args.slice(1, 3), ['run', '--config']);
      assert.equal(args.length, 4);
      scratch = dirname(args[3]);
      assert.equal(options.env.TMPDIR, scratch);
      assert.equal((await stat(scratch)).mode & 0o777, 0o700);
      assert.equal((await stat(args[3])).mode & 0o777, 0o600);
      assert.deepEqual(await readdir(scratch), ['vitest.config.mjs']);
      const text = await readFile(args[3], 'utf8');
      const config = JSON.parse(text.slice('export default '.length).trim().replace(/;$/, ''));
      assert.deepEqual(config.test.reporters, [['json', { stdout: true }],
        [join(repositoryRoot, 'src/server/adapters/cloudflare/tooling/hosted-progress-reporter.mjs'), { total: suite.total }]]);
      assert.deepEqual(config.test.include, suite.include.map((file) => join(repositoryRoot, file)));
      assert.equal(config.test.fileParallelism, suite.maxWorkers > 1);
      assert.equal(config.test.maxWorkers, suite.maxWorkers);
      return result(suite.total);
    };
    assert.deepEqual(await runHostedStore([suite.name, ...setup.arguments], setup.dependencies), {
      total: suite.total, passed: suite.total, failed: 0, skipped: 0, success: true, failedPositions: [],
    });
    assert.deepEqual(setup.calls.map((args) => args.slice(0, 2)), [['whoami'], ['d1', 'info'], ['d1', 'execute']]);
    assert.equal(setup.calls[2].at(-1), 'SELECT name FROM d1_migrations ORDER BY id');
    assert.equal(setup.calls.some((args) => args.some((arg) => ['apply', 'deploy', 'create', 'delete'].includes(arg))), false);
    assert.deepEqual(setup.reports, [`Hosted ${suite.label}: ${suite.total} passed, 0 failed, 0 skipped.`]);
    assert.equal(await readFile(setup.config, 'utf8'), original);
    await assert.rejects(stat(scratch), { code: 'ENOENT' });
  });

  test(`${suite.name} cannot pass after failed, skipped, narrowed, or unsuccessful executions`, async () => {
    const setup = await fixture();
    for (const report of [
      { numPassedTests: suite.total - 1, numFailedTests: 1, success: false },
      { numPassedTests: suite.total - 1, numPendingTests: 1 }, { numTodoTests: 1 },
      { numPassedTests: suite.total - 1, numTotalTests: suite.total - 1 },
      { numPassedTests: suite.total + 1, numTotalTests: suite.total + 1 }, { success: false },
    ]) {
      setup.dependencies.execute = () => result(suite.total, report);
      await assert.rejects(runHostedStore([suite.name, ...setup.arguments], setup.dependencies), new RegExp(`All ${suite.total} `));
    }
    for (const failure of [{ ...result(suite.total), error: new Error('private-provider-error') }, result(suite.total, {}, 1)]) {
      setup.dependencies.execute = () => failure;
      await assert.rejects(runHostedStore([suite.name, ...setup.arguments], setup.dependencies), new RegExp(`All ${suite.total} `));
    }
    assert.equal(setup.reports.some((message) => message.includes('private-provider')), false);
  });
}

test('live connector, authentication, proof, and unknown targets stop before any provider execution', async () => {
  const setup = await fixture();
  setup.dependencies.execute = () => assert.fail('Fixtures must not start');
  for (const suite of suites) {
    for (const database of ['de43cf95-c024-4e44-860d-8ff179e4e08d', '5d746d29-0a66-4346-96a6-4974126685d7',
      '06560c1c-8907-47d6-b2b6-f22e129ebbe4', '00000000-0000-4000-8000-000000000001']) {
      await assert.rejects(runHostedStore([suite.name, ...setup.arguments.map((arg) => arg.startsWith('--database=')
        ? `--database=${database}` : arg)], setup.dependencies), /exact isolated/);
    }
    await assert.rejects(runHostedStore([suite.name, ...setup.arguments.map((arg) => arg.startsWith('--account=')
      ? '--account=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : arg)], setup.dependencies), /exact isolated/);
  }
  assert.equal(setup.calls.length, 0);
});

test('changed configuration resources or Worker entries stop before any provider execution', async () => {
  const setup = await fixture();
  for (const change of [
    (config) => { config.d1_databases[0].database_name = 'minsky-dev'; },
    (config) => { config.main = '../authWorker.ts'; },
    (config) => { config.r2_buckets = [{ binding: 'IMAGES', bucket_name: 'minsky-dev-images' }]; },
  ]) {
    const config = renderStoreConfiguration(setup.config);
    change(config);
    await writeFile(setup.config, JSON.stringify(config));
    await assert.rejects(runHostedStore(['workflow', ...setup.arguments], setup.dependencies));
  }
  assert.equal(setup.calls.length, 0);
});

test('live account or database metadata mismatches prevent fixture execution', async () => {
  const setup = await fixture();
  setup.dependencies.execute = () => assert.fail('Fixtures must not start');
  setup.dependencies.runWrangler = async () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await assert.rejects(runHostedStore(['workflow', ...setup.arguments], setup.dependencies), /could not be confirmed/);
  setup.dependencies.runWrangler = async (args) => args[0] === 'whoami' ? storeTarget.accountId
    : JSON.stringify({ name: storeTarget.databaseName, uuid: '00000000-0000-4000-8000-000000000001' });
  await assert.rejects(runHostedStore(['workflow', ...setup.arguments], setup.dependencies), /does not match/);
});

test('missing, malformed, or extra migration metadata prevents fixture execution', async () => {
  const setup = await fixture();
  setup.dependencies.execute = () => assert.fail('Fixtures must not start');
  const original = setup.dependencies.runWrangler;
  for (const metadata of ['private-provider-error', JSON.stringify([{ success: true, results: [] }]),
    JSON.stringify([{ success: true, results: [{ name: '9999_unreviewed.sql' }] }])]) {
    setup.dependencies.runWrangler = (args) => args[1] === 'execute' ? metadata : original(args);
    await assert.rejects(runHostedStore(['accounts', ...setup.arguments], setup.dependencies), /migration/);
  }
});

test('malformed reports are rejected without exposing their contents', () => {
  for (const output of ['private-provider-error', '{}', JSON.stringify({ numTotalTestSuites: 1, numTotalTests: -1 }),
    result(70, { numPassedTests: '70' }).stdout]) {
    assert.throws(() => storeReport(output), (error) => !error.message.includes('private-provider'));
  }
});

test('failed assertions expose only numeric positions and counters', async () => {
  const setup = await fixture();
  const secret = 'sb_secret_fixture-password-cookie-provider-body';
  const assertions = Array.from({ length: 70 }, (_, index) => ({ status: index === 2 || index === 50 ? 'failed' : 'passed',
    title: secret, fullName: secret, ancestorTitles: [secret], failureMessages: [secret] }));
  const report = result(70, { numPassedTests: 68, numFailedTests: 2, success: false,
    testResults: [{ name: secret, message: secret, assertionResults: assertions.slice(0, 35) },
      { name: secret, message: secret, assertionResults: assertions.slice(35) }] });
  setup.dependencies.execute = () => report;
  await assert.rejects(runHostedStore(['workflow', ...setup.arguments], setup.dependencies), /All 70/);
  assert.deepEqual(setup.reports, ['Hosted full D1 workflow: 68 passed, 2 failed, 0 skipped.',
    'Failed workflow assertion positions (1-based): 3, 51.']);
  assert.equal(JSON.stringify(storeReport(report.stdout)).includes(secret), false);
  assert.deepEqual(storeReport(result(70, { numPassedTests: 69, numFailedTests: 1,
    testResults: [{ assertionResults: [{ status: 'failed', title: secret }] }] }).stdout).failedPositions, []);
});

test('surviving or incomplete journals retain only this run scratch directory and the original configuration', async () => {
  for (const content of [JSON.stringify({ remote: true, eventId: '00000000-0000-4000-8000-000000000001' }), '{']) {
    const setup = await fixture();
    const original = await readFile(setup.config, 'utf8');
    let scratch;
    let journal;
    setup.dependencies.execute = async (_args, options) => {
      scratch = options.env.TMPDIR;
      directories.push(scratch);
      const directory = await mkdtemp(join(scratch, 'minsky-d1-proof-'));
      journal = join(directory, 'fixture.json');
      await writeFile(journal, content, { mode: 0o600 });
      return result(82);
    };
    await assert.rejects(runHostedStore(['accounts', ...setup.arguments], setup.dependencies), /cleanup is incomplete/);
    assert.equal(await readFile(journal, 'utf8'), content);
    assert.equal(await readFile(setup.config, 'utf8'), original);
    await assert.rejects(stat(join(scratch, 'vitest.config.mjs')), { code: 'ENOENT' });
    assert.deepEqual(setup.reports, ['Hosted connector accounts: 82 passed, 0 failed, 0 skipped.',
      `Fixture recovery journal: ${journal}`]);
  }
});

test('a new unrelated global journal with the same source config is untouched and ignored', async () => {
  const setup = await fixture();
  let journal;
  setup.dependencies.execute = async () => {
    const directory = await mkdtemp(join(tmpdir(), 'minsky-d1-proof-'));
    directories.push(directory);
    journal = join(directory, 'fixture.json');
    await writeFile(journal, JSON.stringify({ config: setup.config }));
    return result(70);
  };
  await runHostedStore(['workflow', ...setup.arguments], setup.dependencies);
  assert.equal((await stat(journal)).isFile(), true);
  assert.equal(setup.reports.length, 1);
});

test('concurrent suites using one source configuration cannot inherit each other journals', async () => {
  const setup = await fixture();
  const reports = [];
  let retained;
  const outcomes = await Promise.allSettled(suites.map((suite) => runHostedStore([suite.name, ...setup.arguments], {
    ...setup.dependencies, report: (message) => reports.push(message),
    execute: async (_args, options) => {
      if (suite.name === 'workflow') {
        retained = options.env.TMPDIR;
        directories.push(retained);
        const directory = await mkdtemp(join(retained, 'minsky-d1-proof-'));
        await writeFile(join(directory, 'fixture.json'), JSON.stringify({ config: setup.config }));
      }
      return result(suite.total);
    },
  })));
  assert.equal(outcomes[0].status, 'rejected');
  assert.match(outcomes[0].reason.message, /cleanup is incomplete/);
  assert.equal(outcomes[1].status, 'fulfilled');
  assert.equal(reports.filter((message) => message.startsWith('Fixture recovery journal:')).length, 1);
});
