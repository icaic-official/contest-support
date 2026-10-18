import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vitest';
import { currentMigrationNames } from './migrations.mjs';
import { migrateStore, readStoreTarget, renderStoreConfiguration, storeArguments, storeTarget } from './store-target.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture({ tables = ['d1_migrations'], applied, after } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'minsky-store-target-test-'));
  directories.push(directory);
  const config = join(directory, 'wrangler.jsonc');
  await writeFile(config, JSON.stringify(renderStoreConfiguration(config)));
  const migrations = await currentMigrationNames();
  const calls = [];
  const reports = [];
  let migrated = false;
  return {
    config, calls, reports, migrations,
    arguments: [`--account=${storeTarget.accountId}`, `--database=${storeTarget.databaseId}`, `--config=${config}`],
    dependencies: {
      report: (message) => reports.push(message),
      runWrangler: async (args) => {
        calls.push(args);
        if (args[0] === 'whoami') return storeTarget.accountId;
        if (args[1] === 'info') return JSON.stringify({ name: storeTarget.databaseName, uuid: storeTarget.databaseId });
        if (args[1] === 'migrations') {
          migrated = true;
          return 'private-provider-apply-body';
        }
        const names = args.at(-1).includes('sqlite_master') ? tables
          : migrated ? after ?? migrations : applied ?? migrations;
        return JSON.stringify([{ success: true, results: names.map((name) => ({ name })) }]);
      },
    },
  };
}

test('store options require explicit target IDs and reject filters, credential flags, and duplicate options', () => {
  const valid = ['--account=value', '--database=value', '--config=value'];
  for (const arguments_ of [[], valid.slice(1), [...valid, '--account=other'],
    ...['test-name-pattern=claim', 'expected-count=1', 'skip=reset', 'token=private-value', 'password=private-value']
      .map((option) => [...valid, `--${option}`]),
  ]) assert.throws(() => storeArguments(arguments_));
});

test('store target is the exact reviewed D1-only configuration', async () => {
  const setup = await fixture();
  assert.deepEqual(await readStoreTarget(storeArguments(setup.arguments)), { ...storeTarget, configPath: setup.config });
  const config = renderStoreConfiguration(setup.config);
  assert.deepEqual(Object.keys(config).sort(), ['$schema', 'account_id', 'compatibility_date', 'compatibility_flags',
    'd1_databases', 'name', 'preview_urls', 'workers_dev'].sort());
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.d1_databases[0].remote, true);
});

test('live connector, authentication, proof, and unknown targets are refused before any provider access', async () => {
  const setup = await fixture();
  for (const database of ['de43cf95-c024-4e44-860d-8ff179e4e08d', '5d746d29-0a66-4346-96a6-4974126685d7',
    '06560c1c-8907-47d6-b2b6-f22e129ebbe4', '00000000-0000-4000-8000-000000000001']) {
    const arguments_ = setup.arguments.map((argument) => argument.startsWith('--database=') ? `--database=${database}` : argument);
    await assert.rejects(migrateStore(arguments_, setup.dependencies), /exact isolated dedicated store/);
  }
  const arguments_ = setup.arguments.map((argument) => argument.startsWith('--account=') ? '--account=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : argument);
  await assert.rejects(migrateStore(arguments_, setup.dependencies), /exact isolated dedicated store/);
  assert.deepEqual(setup.calls, []);
});

test('changed resource bindings, migration paths, runtime settings, and all Worker features are refused before provider access', async () => {
  const setup = await fixture();
  const changes = [
    (config) => { config.name = 'minsky-connector-ci'; },
    (config) => { config.account_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; },
    (config) => { config.d1_databases[0].database_id = 'de43cf95-c024-4e44-860d-8ff179e4e08d'; },
    (config) => { config.d1_databases[0].database_name = 'minsky-dev'; },
    (config) => { config.d1_databases[0].binding = 'OTHER'; },
    (config) => { config.d1_databases[0].remote = false; },
    (config) => { config.d1_databases[0].migrations_dir = './unreviewed'; },
    (config) => { config.d1_databases.push({ ...config.d1_databases[0] }); },
    (config) => { config.compatibility_date = '2026-10-14'; },
    (config) => { config.compatibility_flags = []; },
    (config) => { config.workers_dev = true; },
    (config) => { config.preview_urls = true; },
    ...['main', 'assets', 'r2_buckets', 'durable_objects', 'services', 'vars', 'env', 'triggers', 'routes']
      .map((key) => (config) => { config[key] = 'private-unreviewed-value'; }),
  ];
  for (const change of changes) {
    const config = renderStoreConfiguration(setup.config);
    change(config);
    await writeFile(setup.config, JSON.stringify(config));
    await assert.rejects(migrateStore(setup.arguments, setup.dependencies), /configuration changed/);
  }
  assert.deepEqual(setup.calls, []);
});

test('migration confirms live account and database metadata before reading or applying schema', async () => {
  for (const mismatch of ['account', 'database']) {
    const setup = await fixture();
    const original = setup.dependencies.runWrangler;
    setup.dependencies.runWrangler = (args) => {
      if (mismatch === 'account' && args[0] === 'whoami') return 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      if (mismatch === 'database' && args[1] === 'info') return JSON.stringify({ name: storeTarget.databaseName, uuid: 'de43cf95-c024-4e44-860d-8ff179e4e08d' });
      return original(args);
    };
    await assert.rejects(migrateStore(setup.arguments, setup.dependencies), /could not be confirmed|does not match/);
    assert.equal(setup.calls.some((args) => ['execute', 'migrations'].includes(args[1])), false);
  }
});

test('migration accepts a clean D1 database and verifies the full applied schema afterward', async () => {
  const setup = await fixture({ tables: ['_cf_KV', 'sqlite_sequence'] });
  await migrateStore(setup.arguments, setup.dependencies);
  assert.deepEqual(setup.calls.map((args) => args.slice(0, 2)), [
    ['whoami'], ['d1', 'info'], ['d1', 'execute'], ['d1', 'migrations'], ['d1', 'execute'],
  ]);
  assert.deepEqual(setup.calls[3], ['d1', 'migrations', 'apply', storeTarget.databaseName, '--remote']);
  assert.equal(setup.calls[4].at(-1), 'SELECT name FROM d1_migrations ORDER BY id');
  assert.deepEqual(setup.reports, ['Dedicated store CI migrations match this checkout.']);
});

test('migration resumes only an ordered reviewed prefix, including an already current schema', async () => {
  const migrations = await currentMigrationNames();
  for (const applied of [[], migrations.slice(0, 4), migrations]) {
    const setup = await fixture({ applied });
    await migrateStore(setup.arguments, setup.dependencies);
    assert.equal(setup.calls.filter((args) => args[1] === 'migrations').length, 1);
    assert.equal(setup.reports.length, 1);
  }
});

test('foreign, missing, duplicated, or reordered migration versions stop before apply', async () => {
  const migrations = await currentMigrationNames();
  for (const applied of [[migrations[1]], [migrations[0], migrations[0]],
    [migrations[1], migrations[0]], [...migrations, '9999_unreviewed.sql']]) {
    const setup = await fixture({ applied });
    await assert.rejects(migrateStore(setup.arguments, setup.dependencies), /not a reviewed prefix/);
    assert.equal(setup.calls.some((args) => args[1] === 'migrations'), false);
  }
  const setup = await fixture({ tables: ['accounts'] });
  await assert.rejects(migrateStore(setup.arguments, setup.dependencies), /foreign tables/);
  assert.equal(setup.calls.some((args) => args[1] === 'migrations'), false);
});

test('malformed or failed migration metadata is withheld and stops before apply', async () => {
  const secret = 'private-fixture-password-token-provider-body';
  for (const response of [secret, JSON.stringify([{ success: false, results: [] }]),
    JSON.stringify([{ success: true, results: [null] }]), JSON.stringify([{ success: true, results: [{ name: 4 }] }])]) {
    const setup = await fixture();
    const original = setup.dependencies.runWrangler;
    setup.dependencies.runWrangler = (args) => args[1] === 'execute' ? response : original(args);
    await assert.rejects(migrateStore(setup.arguments, setup.dependencies), (error) => {
      assert.match(error.message, /metadata could not be confirmed/);
      assert.equal(error.message.includes(secret), false);
      return true;
    });
    assert.equal(setup.calls.some((args) => args[1] === 'migrations'), false);
  }
});

test('failed apply reports an unknown outcome without printing provider bodies', async () => {
  const setup = await fixture();
  const secret = 'private-fixture-password-token-provider-body';
  const original = setup.dependencies.runWrangler;
  setup.dependencies.runWrangler = (args) => {
    if (args[1] === 'migrations') throw new Error(secret);
    return original(args);
  };
  await assert.rejects(migrateStore(setup.arguments, setup.dependencies), (error) => {
    assert.match(error.message, /outcome is unknown/);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  assert.deepEqual(setup.reports, []);
});

test('an incomplete post-apply schema cannot produce a migration pass', async () => {
  const setup = await fixture({ after: [] });
  await assert.rejects(migrateStore(setup.arguments, setup.dependencies), /migrations differ/);
  assert.equal(setup.calls.some((args) => args[1] === 'migrations'), true);
  assert.deepEqual(setup.reports, []);
});
