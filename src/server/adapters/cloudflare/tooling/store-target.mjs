import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readPublicJson, repositoryRoot } from './configuration.mjs';
import { assertCurrentMigrations, currentMigrationNames } from './migrations.mjs';
import { confirmTarget, wranglerRunner } from './operations.mjs';

export const storeTarget = {
  accountId: '458ad6a930b0fb717796dfa19ca6a2b1',
  databaseName: 'minsky-connector-store-ci', databaseId: '341350ba-7c74-4c46-8b21-edfdcda475f5',
  workerName: 'minsky-connector-store-ci',
};

export function storeArguments(arguments_) {
  const options = {};
  for (const argument of arguments_) {
    const match = /^--(account|database|config)=(.+)$/.exec(argument);
    if (!match || Object.hasOwn(options, match[1])) throw new Error('Supply --account, --database, and --config once. Test filters and count overrides are forbidden.');
    options[match[1]] = match[2];
  }
  if (Object.keys(options).length !== 3) throw new Error('Supply the explicit dedicated store CI account, database, and configuration.');
  options.config = resolve(options.config);
  return options;
}

export function renderStoreConfiguration(configPath) {
  const path = (target) => relative(dirname(resolve(configPath)), resolve(repositoryRoot, target)).replaceAll('\\', '/');
  return {
    $schema: path('node_modules/wrangler/config-schema.json'),
    name: storeTarget.workerName, account_id: storeTarget.accountId,
    compatibility_date: '2026-10-13', compatibility_flags: ['nodejs_compat'],
    workers_dev: false, preview_urls: false,
    d1_databases: [{ binding: 'DB', database_name: storeTarget.databaseName,
      database_id: storeTarget.databaseId, migrations_dir: path('src/server/adapters/d1/migrations'), remote: true }],
  };
}

/** The store suites must never share a database with an active Worker cron. */
export async function readStoreTarget(options) {
  if (options.account !== storeTarget.accountId || options.database !== storeTarget.databaseId ||
      typeof options.config !== 'string' || !options.config) {
    throw new Error('Select the exact isolated dedicated store CI target. Live connector, authentication, proof, and development resources are forbidden.');
  }
  const configPath = resolve(options.config);
  const config = await readPublicJson(configPath);
  if (!isDeepStrictEqual(config, renderStoreConfiguration(configPath))) {
    throw new Error('The dedicated store CI configuration changed. Only its exact D1 binding and reviewed migration path are permitted.');
  }
  return { ...storeTarget, configPath };
}

async function readRows(settings, runWrangler, query) {
  try {
    const response = JSON.parse(await runWrangler(['d1', 'execute', settings.databaseName, '--remote', '--json', '--command', query]));
    if (!Array.isArray(response) || response.length !== 1 || response[0]?.success !== true || !Array.isArray(response[0].results) ||
        response[0].results.some((row) => !row || typeof row.name !== 'string')) throw new Error();
    return response[0].results;
  } catch {
    throw new Error('The dedicated store CI migration metadata could not be confirmed. No migration started.');
  }
}

/** Allow only a clean database or the ordered prefix of reviewed migrations. */
async function assertPartialMigrations(settings, runWrangler) {
  const tables = await readRows(settings, runWrangler, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  if (!tables.some((row) => row.name === 'd1_migrations')) {
    if (tables.some((row) => typeof row.name !== 'string' || !row.name.startsWith('sqlite_') && !row.name.startsWith('_cf_'))) {
      throw new Error('The dedicated store CI database has foreign tables without migration metadata. No migration started.');
    }
    return;
  }
  const expected = await currentMigrationNames();
  const applied = await readRows(settings, runWrangler, 'SELECT name FROM d1_migrations ORDER BY id');
  if (applied.length > expected.length || applied.some((row, index) => row.name !== expected[index])) {
    throw new Error('The dedicated store CI migrations are not a reviewed prefix. No migration started.');
  }
}

/** This command applies schema only. It never deploys a Worker or other binding. */
export async function migrateStore(arguments_, dependencies = {}) {
  const options = storeArguments(arguments_);
  const settings = await readStoreTarget(options);
  const runWrangler = dependencies.runWrangler ?? wranglerRunner(settings, settings.configPath);
  await confirmTarget(options, settings, runWrangler);
  await assertPartialMigrations(settings, runWrangler);
  try {
    await runWrangler(['d1', 'migrations', 'apply', settings.databaseName, '--remote']);
  } catch {
    throw new Error('The dedicated store CI migration outcome is unknown. Inspect applied versions before retrying. Provider output was withheld.');
  }
  await assertCurrentMigrations(settings, runWrangler);
  (dependencies.report ?? ((message) => process.stdout.write(message + '\n')))('Dedicated store CI migrations match this checkout.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...arguments_] = process.argv.slice(2);
  Promise.resolve().then(() => {
    if (command !== 'migrate') throw new Error('Choose migrate for the dedicated store CI schema.');
    return migrateStore(arguments_);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
