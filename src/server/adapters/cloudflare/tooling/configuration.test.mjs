import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, test, vi } from 'vitest';
import { parseArguments, readInstallationTarget, renderWranglerConfiguration, repositoryRoot, validateProviderConfiguration } from './configuration.mjs';
import { runCli } from './install.mjs';

const temporaryDirectories = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const settings = {
  accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  workerName: 'fictional-contest-app',
  databaseName: 'fictional-contest-database',
  databaseId: '00000000-0000-4000-8000-000000000001',
  bucketName: 'fictional-contest-images',
  origin: 'https://fictional-contest-app.fictional-account.workers.dev',
};

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'minsky-install-configuration-'));
  temporaryDirectories.push(path);
  return path;
}

test('configuration contains only public independent settings and complete Cloudflare bindings', () => {
  const path = '/tmp/independent-install/wrangler.jsonc';
  const config = renderWranglerConfiguration(settings, path);
  assert.equal(config.account_id, settings.accountId);
  assert.equal(config.name, settings.workerName);
  assert.equal(resolve(dirname(path), config.main), resolve(repositoryRoot, 'src/server/adapters/cloudflare/applicationWorker.ts'));
  assert.equal(resolve(dirname(path), config.assets.directory), resolve(repositoryRoot, 'dist'));
  assert.deepEqual(config.vars, { AUTH_ORIGIN: settings.origin });
  assert.deepEqual(config.d1_databases.map(({ binding, database_id, remote }) => ({ binding, database_id, remote })), [
    { binding: 'DB', database_id: settings.databaseId, remote: true },
  ]);
  assert.deepEqual(config.r2_buckets, [{ binding: 'IMAGES', bucket_name: settings.bucketName, remote: true }]);
  assert.deepEqual(config.durable_objects.bindings, [{ name: 'LIVE_UPDATES', class_name: 'SessionLiveCoordinator' }]);
  assert.deepEqual(config.migrations, [{ tag: 'v1', new_sqlite_classes: ['SessionLiveCoordinator'] }]);
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.placement, { mode: 'smart' });
  assert.equal(config.limits.cpu_ms, 1000);
  assert.deepEqual(config.triggers.crons, ['* * * * *']);
  assert.equal(JSON.stringify(config).includes('AUTH_SECRET'), false);
  assert.equal(validateProviderConfiguration({ ...settings, databaseName: settings.workerName }).databaseName, settings.workerName);
});

test('committed connector CI configuration matches the full configuration generator', async () => {
  const path = resolve(repositoryRoot, 'src/server/adapters/cloudflare/deploy/connector-ci.wrangler.jsonc');
  const settings = JSON.parse(await readFile(resolve(dirname(path), 'connector-ci.settings.json'), 'utf8'));
  assert.deepEqual(await readInstallationTarget(path), settings);
  const config = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(config, renderWranglerConfiguration(settings, path));
});

test('optional placement regions round-trip without changing other installation settings', async () => {
  const path = join(await directory(), 'wrangler.jsonc');
  const original = renderWranglerConfiguration(settings, path);
  for (const placementRegion of ['aws:ap-southeast-1', 'gcp:asia-east1', 'azure:southeastasia']) {
    const input = { ...settings, placementRegion };
    assert.deepEqual(validateProviderConfiguration(input), input);
    const config = renderWranglerConfiguration(input, path);
    assert.deepEqual(config, { ...original, placement: { region: placementRegion } });
    await writeFile(path, JSON.stringify(config));
    assert.deepEqual(await readInstallationTarget(path), input);
  }
});

test('placement regions reject malformed values without echoing rejected input', () => {
  for (const placementRegion of [
    undefined, null, false, 12, {}, [], '', 'APAC', 'aws:', 'AWS:ap-southeast-1',
    'other:ap-southeast-1', 'aws: ap-southeast-1', ' aws:ap-southeast-1',
    'aws:ap-southeast-1 ', 'aws:ap-southeast-1:443', 'gcp:asia-east1/path',
    'azure:southeastasia?token=private-placeholder', 'https://private-placeholder',
  ]) assert.throws(() => validateProviderConfiguration({ ...settings, placementRegion }), (error) => {
    assert.equal(error.message.includes('private-placeholder'), false);
    return true;
  });
});

test('configuration rejects credentials, placeholders, and malformed resource names and identifiers', () => {
  for (const input of [
    null, [], {},
    { ...settings, accountId: 'REPLACE_WITH_ACCOUNT_ID' },
    { ...settings, databaseId: 'REPLACE_WITH_DATABASE_UUID' },
    { ...settings, workerName: 'Your-Worker' },
    { ...settings, bucketName: 'INVALID_BUCKET' },
    { ...settings, databaseName: 'db' },
    { ...settings, databaseName: '../other-database' },
    { ...settings, AUTH_SECRET: 'private-setting' },
    { ...settings, apiToken: 'private-setting' },
  ]) assert.throws(() => validateProviderConfiguration(input));
});

test('origins are exact, use HTTPS, and match their workers.dev name', () => {
  for (const origin of [
    '', 'not-a-url', 'http://remote.example.org',
    'https://user:password@remote.example.org', 'https://remote.example.org/path',
    'https://remote.example.org?secret=private', 'https://remote.example.org#fragment',
    'https://remote.example.org/', 'https://remote.example.org:443',
    'https://your-domain.example.org', 'https://a..example.org',
    'https://another-app.fictional-account.workers.dev',
    'https://fictional-contest-app.workers.dev',
    'http://localhost:8788', 'https://localhost:8788', 'http://127.0.0.2:8788',
  ]) assert.throws(() => validateProviderConfiguration({ ...settings, origin }));
  for (const origin of ['http://localhost:8788', 'http://127.0.0.2:8788', 'https://[::1]:8788']) {
    assert.equal(validateProviderConfiguration({ ...settings, origin }, { allowLocal: true }).origin, origin);
  }
  const custom = renderWranglerConfiguration({ ...settings, origin: 'https://support.example.org' }, '/tmp/wrangler.jsonc');
  assert.deepEqual(custom.routes, [{ pattern: 'support.example.org', custom_domain: true }]);
});

test('argument parser accepts public options once and never echoes rejected secrets', () => {
  const parsed = parseArguments(['bootstrap', '--config=config.jsonc', `--account=${settings.accountId}`, `--database=${settings.databaseId}`, '--competition=competition.json', '--credentials=/tmp/new-private-file.json']);
  assert.equal(parsed.config, resolve('config.jsonc'));
  assert.equal(parsed.credentials, '/tmp/new-private-file.json');
  for (const args of [
    ['delete'],
    ['configure', '--settings=settings.json', '--config=config.jsonc', '--config=other.jsonc'],
    ['bootstrap', '--config=config.jsonc'],
    ['plan', '--settings=settings.json', '--config=config.jsonc', '--password=private-placeholder'],
    ['migrate', '--config=config.jsonc', `--account=${settings.accountId}`, `--database=${settings.databaseId}`, '--local'],
  ]) {
    assert.throws(() => parseArguments(args), (error) => {
      assert.equal(error.message.includes('private-placeholder'), false);
      return true;
    });
  }
});

test('plan is read-only and configure creates an exclusive configuration with no provider connection', async () => {
  const path = await directory();
  const settingsPath = join(path, 'provider.json');
  const configPath = join(path, 'wrangler.jsonc');
  await writeFile(settingsPath, JSON.stringify(settings));
  const reports = [];
  const dependencies = { report: (message) => reports.push(message), execute: () => assert.fail('Provider must not start') };
  await runCli(['plan', `--settings=${settingsPath}`, `--config=${configPath}`], dependencies);
  assert.equal(JSON.parse(reports[0]).status, 'plan_only');
  await assert.rejects(stat(configPath), { code: 'ENOENT' });
  await runCli(['configure', `--settings=${settingsPath}`, `--config=${configPath}`], dependencies);
  assert.deepEqual(await readInstallationTarget(configPath), settings);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  const before = await readFile(configPath, 'utf8');
  await assert.rejects(runCli(['configure', `--settings=${settingsPath}`, `--config=${configPath}`], dependencies), /Existing files are never replaced/);
  assert.equal(await readFile(configPath, 'utf8'), before);
});

test('hosted operations reject modified entry points, placement, bindings, origins, or secret values', async () => {
  const path = await directory();
  const configPath = join(path, 'wrangler.jsonc');
  const original = renderWranglerConfiguration(settings, configPath);
  for (const change of [
    (value) => { value.main = './untrusted.ts'; },
    (value) => { value.d1_databases.push(value.d1_databases[0]); },
    (value) => { value.vars.AUTH_SECRET = 'private-placeholder'; },
    (value) => { value.vars.AUTH_ORIGIN = 'http://localhost:8788'; },
    (value) => { value.env = { other: { account_id: settings.accountId } }; },
    (value) => { delete value.placement; },
    (value) => { value.placement.mode = 'off'; },
    (value) => { value.placement.region = 'aws:us-east-1'; },
    (value) => { value.placement = { host: 'db.example.org:5432' }; },
    (value) => { value.placement = { hostname: 'db.example.org' }; },
    (value) => { value.placement = { region: 'aws:ap-southeast-1', mode: 'smart' }; },
    (value) => { value.placement = { region: 'aws:ap-southeast-1', host: 'db.example.org:5432' }; },
    (value) => { value.placement = { region: 'aws:ap-southeast-1', extra: true }; },
  ]) {
    const modified = globalThis.structuredClone(original);
    change(modified);
    await writeFile(configPath, JSON.stringify(modified));
    await assert.rejects(readInstallationTarget(configPath), (error) => {
      assert.equal(error.message.includes('private-placeholder'), false);
      return true;
    });
  }
});

test('CLI never relays provider stdout or stderr from the private child', async () => {
  const reports = [];
  const args = ['secret', '--config=/tmp/config.jsonc', `--account=${settings.accountId}`, `--database=${settings.databaseId}`];
  await assert.rejects(runCli(args, {
    report: (message) => reports.push(message),
    execute: () => ({ status: 1, stdout: 'private-provider-output', stderr: 'private-provider-error' }),
  }), (error) => {
    assert.equal(error.message.includes('private-provider'), false);
    return true;
  });
  assert.equal(reports.length, 0);
});

test('CLI forces private logging before starting the trusted operator child', async () => {
  vi.stubEnv('WRANGLER_LOG_SANITIZE', 'false');
  vi.stubEnv('WRANGLER_WRITE_LOGS', 'true');
  vi.stubEnv('WRANGLER_SEND_METRICS', 'true');
  let spawned = false;
  await runCli(['secret', '--config=/tmp/config.jsonc', `--account=${settings.accountId}`, `--database=${settings.databaseId}`], {
    report: () => undefined,
    spawn: (_executable, _args, options) => {
      spawned = true;
      assert.equal(options.env.WRANGLER_LOG_SANITIZE, 'true');
      assert.equal(options.env.WRANGLER_WRITE_LOGS, 'false');
      assert.equal(options.env.WRANGLER_SEND_METRICS, 'false');
      assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID, settings.accountId);
      return { status: 0 };
    },
  });
  assert.equal(spawned, true);
});
