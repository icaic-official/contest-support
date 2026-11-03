import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { afterEach, test, vi } from 'vitest';
import { renderWranglerConfiguration, repositoryRoot } from './configuration.mjs';
import { currentMigrationNames } from './migrations.mjs';
import { confirmTarget, loadInstallationLibrary, reserveCredentialOutput, runTrustedCommand, wranglerRunner } from './operations.mjs';
import { safeWranglerEnvironment } from './safe-environment.mjs';

const temporaryDirectories = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const settings = {
  accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', workerName: 'fictional-contest-app',
  databaseName: 'fictional-contest-database', databaseId: '00000000-0000-4000-8000-000000000001',
  bucketName: 'fictional-contest-images', origin: 'https://fictional-contest-app.fictional-account.workers.dev',
};
const webmaster = { accountId: '00000000-0000-4000-8000-000000000003' };
const migrationNames = await currentMigrationNames();
const migrationArguments = ['d1', 'execute', settings.databaseName, '--remote', '--json',
  '--command', 'SELECT name FROM d1_migrations ORDER BY id'];

function migrationResult(names = migrationNames) {
  return JSON.stringify([{ success: true, results: names.map((name) => ({ name })) }]);
}

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'minsky-install-operations-'));
  temporaryDirectories.push(path);
  const config = join(path, 'wrangler.jsonc');
  const site = join(path, 'site.json');
  await writeFile(config, JSON.stringify(renderWranglerConfiguration(settings, config)));
  await writeFile(site, JSON.stringify({ webmasterHandle: 'organizer' }));
  return { command: 'bootstrap', config, site, credentials: join(path, 'private-result.json'),
    account: settings.accountId, database: settings.databaseId };
}

function dependencies(overrides = {}) {
  const state = { calls: [], connected: 0, disposed: 0, invoked: 0, unbundled: 0 };
  const db = {};
  const result = { ...webmaster, handle: 'organizer', temporaryPassword: 'fictional-private-credential' };
  return {
    state,
    runWrangler: async (args, options) => {
      state.calls.push({ args, options });
      if (args[0] === 'whoami') return `Authorized account: ${settings.accountId}`;
      if (args[0] === 'd1' && args[1] === 'info') return JSON.stringify({ uuid: settings.databaseId, name: settings.databaseName });
      if (args[0] === 'd1' && args[1] === 'execute') return migrationResult();
      if (args[0] === 'secret' && args[1] === 'list') return '[]';
      return '';
    },
    openPlatform: async () => {
      state.connected += 1;
      return { env: { DB: db }, dispose: async () => { state.disposed += 1; } };
    },
    loadLibrary: async () => ({
      library: {
        validateSiteConfiguration: () => undefined,
        bootstrapSite: async (connection) => {
          assert.equal(connection, db);
          state.invoked += 1;
          return result;
        },
      },
      dispose: async () => { state.unbundled += 1; },
    }),
    ...overrides,
  };
}

test('explicit account and database must match before any provider command', async () => {
  let calls = 0;
  const run = () => { calls += 1; return ''; };
  for (const options of [
    { account: settings.accountId },
    { account: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', database: settings.databaseId },
    { account: settings.accountId, database: webmaster.accountId },
  ]) await assert.rejects(confirmTarget(options, settings, run), /exactly match/);
  assert.equal(calls, 0);
});

test('Wrangler subprocesses force private logging despite inherited debug settings', () => {
  vi.stubEnv('WRANGLER_LOG_SANITIZE', 'false');
  vi.stubEnv('WRANGLER_WRITE_LOGS', 'true');
  vi.stubEnv('WRANGLER_SEND_METRICS', 'true');
  vi.stubEnv('CLOUDFLARE_ENV', 'staging');
  const inherited = { WRANGLER_LOG_SANITIZE: 'false', WRANGLER_WRITE_LOGS: 'true', WRANGLER_SEND_METRICS: 'true', CLOUDFLARE_ENV: 'staging', KEEP_SETTING: 'public' };
  const safe = safeWranglerEnvironment(inherited);
  assert.equal(safe.WRANGLER_LOG_SANITIZE, 'true');
  assert.equal(safe.WRANGLER_WRITE_LOGS, 'false');
  assert.equal(safe.WRANGLER_SEND_METRICS, 'false');
  assert.equal(safe.KEEP_SETTING, 'public');
  assert.equal(safe.CLOUDFLARE_ENV, undefined);
  assert.equal(inherited.CLOUDFLARE_ENV, 'staging');
  assert.equal(inherited.WRANGLER_LOG_SANITIZE, 'false');
  let spawned = false;
  const run = wranglerRunner(settings, '/tmp/fictional-wrangler.jsonc', (_executable, _args, options) => {
    spawned = true;
    assert.equal(options.env.WRANGLER_LOG_SANITIZE, 'true');
    assert.equal(options.env.WRANGLER_WRITE_LOGS, 'false');
    assert.equal(options.env.WRANGLER_SEND_METRICS, 'false');
    assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID, settings.accountId);
    assert.equal(options.env.CLOUDFLARE_ENV, undefined);
    return { status: 0, stdout: 'safe response' };
  });
  assert.equal(run(['whoami']), 'safe response');
  assert.equal(spawned, true);
});

test('trusted commands disable current-process logs before provider setup', async () => {
  vi.stubEnv('WRANGLER_LOG_SANITIZE', 'false');
  vi.stubEnv('WRANGLER_WRITE_LOGS', 'true');
  vi.stubEnv('CLOUDFLARE_ENV', 'staging');
  const options = await fixture();
  const injected = dependencies();
  const original = injected.runWrangler;
  injected.runWrangler = async (...args) => {
    assert.equal(process.env.CLOUDFLARE_ENV, undefined);
    assert.equal(process.env.WRANGLER_LOG_SANITIZE, 'true');
    assert.equal(process.env.WRANGLER_WRITE_LOGS, 'false');
    return original(...args);
  };
  await runTrustedCommand(options, injected);
});

test('target checks require current Wrangler access and matching hosted D1 metadata', async () => {
  const options = { account: settings.accountId, database: settings.databaseId };
  await assert.rejects(confirmTarget(options, settings, async () => 'wrong account'), /could not be confirmed/);
  await assert.rejects(confirmTarget(options, settings, async (args) => args[0] === 'whoami'
    ? settings.accountId : JSON.stringify({ uuid: webmaster.accountId, name: settings.databaseName })), /does not match/);
  await assert.rejects(confirmTarget(options, settings, async () => { throw new Error('private-provider-diagnostic'); }), (error) => {
    assert.equal(error.message.includes('private-provider'), false);
    return true;
  });
});

test('bootstrap writes credentials only to a new 0600 file after target confirmation', async () => {
  const options = await fixture();
  const injected = dependencies();
  await runTrustedCommand(options, injected);
  const result = JSON.parse(await readFile(options.credentials, 'utf8'));
  assert.equal(result.status, 'completed');
  assert.equal(Boolean(result.temporaryPassword), true);
  assert.equal(result.accountId, webmaster.accountId);
  assert.equal((await stat(options.credentials)).mode & 0o777, 0o600);
  assert.deepEqual(injected.state.calls.map(({ args }) => args), [['whoami'], ['d1', 'info', settings.databaseName, '--json'], migrationArguments]);
  assert.equal(injected.state.connected, 1);
  assert.equal(injected.state.invoked, 1);
  assert.equal(injected.state.disposed, 1);
  assert.equal(injected.state.unbundled, 1);
});

test('missing or extra migrations block bootstrap and initial secret creation', async () => {
  for (const command of ['bootstrap', 'secret']) {
    for (const names of [migrationNames.slice(0, -1), [...migrationNames, '9999_foreign.sql']]) {
      const options = { ...await fixture(), command };
      const injected = dependencies();
      const original = injected.runWrangler;
      injected.runWrangler = async (args, input) => args[0] === 'd1' && args[1] === 'execute'
        ? migrationResult(names) : original(args, input);
      await assert.rejects(runTrustedCommand(options, injected), /migrations differ/);
      assert.equal(injected.state.connected, 0);
      assert.equal(injected.state.invoked, 0);
      assert.equal(injected.state.calls.some(({ args }) => args[0] === 'secret'), false);
      await assert.rejects(stat(options.credentials), { code: 'ENOENT' });
    }
  }
});

test('unreadable or malformed migration metadata stops before a credential operation', async () => {
  for (const response of ['not-json', '{}', '[{"success":false,"results":[]}]', '[{"success":true,"results":[null]}]']) {
    const options = await fixture();
    const injected = dependencies();
    const original = injected.runWrangler;
    injected.runWrangler = async (args, input) => args[0] === 'd1' && args[1] === 'execute' ? response : original(args, input);
    await assert.rejects(runTrustedCommand(options, injected), /migration list could not be confirmed/);
    assert.equal(injected.state.connected, 0);
    await assert.rejects(stat(options.credentials), { code: 'ENOENT' });
  }
});

test('existing credential output is preserved and blocks the database operation', async () => {
  const options = await fixture();
  await writeFile(options.credentials, 'retain this private result', { mode: 0o600 });
  const injected = dependencies();
  await assert.rejects(runTrustedCommand(options, injected), /did not finish normally/);
  assert.equal(await readFile(options.credentials, 'utf8'), 'retain this private result');
  assert.equal(injected.state.connected, 0);
  assert.equal(injected.state.invoked, 0);
});

test('credential output rejects a path in the repository and an existing symbolic link', async () => {
  const options = await fixture();
  await assert.rejects(reserveCredentialOutput(resolve(repositoryRoot, 'must-not-create-private-result.json')), /outside the repository/);
  const target = join(options.credentials, '..', 'existing-private-result.json');
  await writeFile(target, 'retain existing result', { mode: 0o600 });
  await symlink(target, options.credentials);
  await assert.rejects(reserveCredentialOutput(options.credentials), /Existing files are never replaced/);
  assert.equal(await readFile(target, 'utf8'), 'retain existing result');
});

test('failed and unknown credential operations retain their private file and redact diagnostics', async () => {
  const options = await fixture();
  const injected = dependencies();
  const originalLoader = injected.loadLibrary;
  injected.loadLibrary = async () => {
    const prepared = await originalLoader();
    prepared.library.bootstrapSite = async () => { throw new Error('private-provider-diagnostic'); };
    return prepared;
  };
  await assert.rejects(runTrustedCommand(options, injected), (error) => {
    assert.equal(error.message.includes('private-provider'), false);
    return true;
  });
  const retained = JSON.parse(await readFile(options.credentials, 'utf8'));
  assert.equal(retained.status, 'operation_started');
  assert.equal(Object.hasOwn(retained, 'temporaryPassword'), false);
  assert.equal((await stat(options.credentials)).mode & 0o777, 0o600);
  assert.equal(injected.state.disposed, 1);
});

test('bootstrap retains saved credentials if proxy cleanup fails', async () => {
  const options = await fixture();
  const injected = dependencies({ openPlatform: async () => ({ env: { DB: {} }, dispose: async () => { throw new Error('private-cleanup-detail'); } }) });
  injected.loadLibrary = async () => ({
    library: {
      validateSiteConfiguration: () => undefined,
      bootstrapSite: async () => ({ ...webmaster, handle: 'organizer', temporaryPassword: 'fictional-private-credential' }),
    },
    dispose: async () => undefined,
  });
  await assert.rejects(runTrustedCommand(options, injected), /Credentials were saved/);
  const retained = JSON.parse(await readFile(options.credentials, 'utf8'));
  assert.equal(retained.status, 'completed');
  assert.equal(Boolean(retained.temporaryPassword), true);
});

test('authentication secret travels through private stdin after target checks', async () => {
  const options = { ...await fixture(), command: 'secret' };
  const injected = dependencies();
  await runTrustedCommand(options, injected);
  assert.deepEqual(injected.state.calls[3].args, ['secret', 'list', '--format', 'json']);
  const secretCall = injected.state.calls[4];
  assert.deepEqual(secretCall.args, ['secret', 'put', 'AUTH_SECRET']);
  assert.equal(/^[a-f0-9]{64}\n$/.test(secretCall.options.input), true);
  assert.equal(secretCall.args.some((argument) => argument.includes(secretCall.options.input.trim())), false);
  assert.equal(injected.state.connected, 0);
  await assert.rejects(stat(options.credentials), { code: 'ENOENT' });
});

test('initial secret creation never rotates an existing AUTH_SECRET', async () => {
  const options = { ...await fixture(), command: 'secret' };
  const injected = dependencies();
  const originalRunner = injected.runWrangler;
  injected.runWrangler = async (args, input) => args[0] === 'secret' && args[1] === 'list'
    ? JSON.stringify([{ name: 'AUTH_SECRET', type: 'secret_text' }]) : originalRunner(args, input);
  await assert.rejects(runTrustedCommand(options, injected), /already exists/);
  assert.equal(injected.state.calls.some(({ args }) => args[0] === 'secret' && args[1] === 'put'), false);
});

test('failed or invalid secret metadata prevents creation instead of assuming an empty Worker', async () => {
  const options = { ...await fixture(), command: 'secret' };
  for (const response of ['not-json', '{}', '[{}]']) {
    const injected = dependencies();
    const originalRunner = injected.runWrangler;
    injected.runWrangler = async (args, input) => args[0] === 'secret' && args[1] === 'list'
      ? response : originalRunner(args, input);
    await assert.rejects(runTrustedCommand(options, injected), /could not be confirmed/);
    assert.equal(injected.state.calls.some(({ args }) => args[0] === 'secret' && args[1] === 'put'), false);
  }
  const injected = dependencies();
  const originalRunner = injected.runWrangler;
  injected.runWrangler = async (args, input) => {
    if (args[0] === 'secret' && args[1] === 'list') throw new Error('Worker not found or private-provider-diagnostic');
    return originalRunner(args, input);
  };
  await assert.rejects(runTrustedCommand(options, injected), /could not be confirmed/);
  assert.equal(injected.state.calls.some(({ args }) => args[0] === 'secret' && args[1] === 'put'), false);
});

test('migration command follows exact target checks and never selects a local or linked database', async () => {
  const options = { ...await fixture(), command: 'migrate' };
  const injected = dependencies();
  await runTrustedCommand(options, injected);
  assert.deepEqual(injected.state.calls[2].args, ['d1', 'migrations', 'apply', settings.databaseName, '--remote']);
  assert.equal(injected.state.calls.some(({ args }) => args[0] === 'd1' && args[1] === 'execute'), false);
  assert.equal(injected.state.connected, 0);
});

test('installation library bundles from current provider source without provider access', async () => {
  const prepared = await loadInstallationLibrary();
  try {
    assert.equal(typeof prepared.library.bootstrapSite, 'function');
    assert.equal(typeof prepared.library.validateSiteConfiguration, 'function');
  } finally {
    await prepared.dispose();
  }
});
