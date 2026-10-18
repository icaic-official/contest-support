import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { getPlatformProxy, unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';
import { renderWranglerConfiguration } from '../src/server/adapters/cloudflare/tooling/configuration.mjs';
import { maintainFixtureSessions, SessionLiveCoordinator } from '../src/server/adapters/cloudflare/live';
import { passwordHasher } from '../src/server/adapters/cloudflare/password';
import { D1AuthenticationService } from '../src/server/adapters/cloudflare/authentication';
import { createBetterAuthIdentity } from '../src/server/adapters/cloudflare/identity';
import { checkFixtureSchema, cleanupFixture, createFixture, inspectFixtureAuthentication } from '../tests/providers/cloudflare/fixture';
import { checkCloudflareBackend, connectorTarget, readFixtureTarget } from '../tests/providers/cloudflare/target.mjs';
import { createBrowserBackend } from '../tests/providers/browser-backend';
import { createBrowserProvider } from '../tests/providers/cloudflare/browser';
import { createResponseFaults } from '../tests/providers/support/response-fault';
import { providerTestOptions } from './provider-test-options.mjs';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
let directory;
let config;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'minsky-provider-cloudflare-'));
  config = join(directory, 'wrangler.jsonc');
  await writeFile(config, JSON.stringify(renderWranglerConfiguration(connectorTarget, config)));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

describe('hosted-origin browser bridge boundaries', () => {
  test('shared response faults consume only the selected successful response and never expose its body', async () => {
    for (const paths of [{ workflow: '/api/workflow', account: '/api/accounts' },
      { workflow: '/rest/v1/rpc/workflow', account: '/functions/v1/admin' }]) {
      const responses = [];
      const request = vi.fn(async (input) => {
        const reply = globalThis.Response.json({ temporaryPassword: 'private-one-time-body' },
          { status: new URL(input).pathname === '/unrelated' ? 401 : 200 });
        responses.push(reply);
        return reply;
      });
      vi.stubGlobal('fetch', request);
      const faults = createResponseFaults(paths);
      faults.discard('account');
      await faults.fetch('https://fictional.invalid/unrelated');
      await faults.fetch(`https://fictional.invalid${paths.workflow}`);
      await expect(faults.fetch(`https://fictional.invalid${paths.account}`)).rejects.toThrow('discarded the committed account response');
      expect(responses.map((reply) => reply.bodyUsed)).toEqual([false, false, true]);
      expect(await (await faults.fetch(`https://fictional.invalid${paths.account}`)).json()).toEqual({ temporaryPassword: 'private-one-time-body' });
      expect(request).toHaveBeenCalledTimes(4);
    }
  });

  test('records cookie presence without its value and finishes diagnostics before browser logout', async () => {
    const handlers = new Map();
    const order = [];
    let release;
    let observed;
    const ready = new Promise((resolve) => { observed = resolve; });
    const diagnostics = {
      observe: vi.fn(async () => {
        order.push('observe');
        observed();
        await new Promise((resolve) => { release = resolve; });
      }),
      flush: async () => { order.push('flush'); },
      summary: () => ({ requests: [] }),
    };
    const page = {
      on: (event, callback) => handlers.set(event, callback),
      exposeBinding: async () => {}, goto: async () => {},
      evaluate: async (_callback, request) => {
        if (request?.type === 'close') order.push('logout');
        return { ok: true, value: undefined };
      },
    };
    const context = { newPage: async () => page, routeWebSocket: async () => {}, close: async () => { order.push('context-close'); } };
    const output = vi.spyOn(globalThis.console, 'log').mockImplementation(() => {});
    try {
      const connection = await createBrowserBackend({ newContext: async () => context }, {
        origin: connectorTarget.origin, module: '/tests/providers/cloudflare/browser.ts',
        configuration: { origin: connectorTarget.origin }, diagnostics,
      });
      const request = { url: () => `${connectorTarget.origin}/api/snapshot?sessionId=${randomUUID()}`,
        method: () => 'GET', headerValue: async () => '__Host-minsky-session=private-cookie-token' };
      handlers.get('request')(request);
      handlers.get('response')({ request: () => request, status: () => 401 });
      const closing = connection.close();
      await ready;
      expect(order).toEqual(['observe']);
      release();
      await closing;
      expect(order).toEqual(['observe', 'flush', 'logout', 'context-close']);
      expect(diagnostics.observe.mock.calls[0][0]).toMatchObject({ status: 401, hasSessionCookie: true });
      expect(JSON.stringify(diagnostics.observe.mock.calls)).not.toContain('private-cookie-token');
      expect(JSON.stringify(output.mock.calls)).not.toContain('private-cookie-token');
    } finally {
      output.mockRestore();
    }
  });

  test('proxies only source assets to Vite and sends no cookies or credentials to the asset server', async () => {
    let predicate;
    let handler;
    const page = { exposeBinding: async () => {}, goto: vi.fn(async () => {}), evaluate: async () => ({ ok: true, value: undefined }) };
    const context = { newPage: async () => page, routeWebSocket: async () => {}, route: async (matches, callback) => { predicate = matches; handler = callback; }, close: async () => {} };
    const browser = { newContext: vi.fn(async () => context) };
    const request = vi.fn(async () => new globalThis.Response('<script type="module" src="/@vite/client"></script><p>Bridge</p>', { headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', request);
    const connection = await createBrowserBackend(browser, { origin: connectorTarget.origin, assetOrigin: 'http://127.0.0.1:4174',
      module: '/tests/providers/cloudflare/browser.ts', configuration: { origin: connectorTarget.origin } });
    expect(browser.newContext).toHaveBeenCalledWith({ baseURL: connectorTarget.origin });
    for (const path of ['/api/workflow', '/api/auth/session', '/api/updates', '/api/image/private']) {
      expect(predicate(new URL(path, connectorTarget.origin))).toBe(false);
    }
    for (const path of ['/tests/providers/browser.html', '/src/backend/cloudflare/backend.ts', '/node_modules/.vite/deps/zod.js']) {
      expect(predicate(new URL(path, connectorTarget.origin))).toBe(true);
    }
    const fulfill = vi.fn(async () => {});
    await handler({ request: () => ({ url: () => `${connectorTarget.origin}/tests/providers/browser.html`,
      headers: () => ({ cookie: 'private-cookie', authorization: 'private-value', accept: 'text/html' }) }), fulfill });
    expect(request.mock.calls[0][0].href).toBe('http://127.0.0.1:4174/tests/providers/browser.html');
    expect(request.mock.calls[0][1].headers).toEqual({ Accept: 'text/html' });
    expect(fulfill.mock.calls[0][0].body.toString()).not.toContain('/@vite/client');
    await connection.close();
  });

  test('discards a committed workflow response through the real Cloudflare browser transport', async () => {
    const issueId = randomUUID();
    const userId = randomUUID();
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const path = new URL(input).pathname;
      return globalThis.Response.json(path === '/api/auth/session' ? { user: { id: userId },
        status: { username: 'fictional', must_change: false, session_valid: true }, csrf: 'fictional-csrf' }
        : path === '/api/workflow' ? { outcome: 'committed', issueId } : {});
    }));
    const provider = createBrowserProvider({ origin: connectorTarget.origin });
    const command = { type: 'submit', category: 'Other', description: 'Fictional response fault' };
    const sessionId = randomUUID();
    const requestId = randomUUID();
    provider.discardNextWorkflowResponse();
    await expect(provider.backend.workflows.execute(sessionId, requestId, command)).rejects.toThrow('discarded the committed workflow response');
    expect(await provider.backend.workflows.execute(sessionId, requestId, command)).toBe(issueId);
    await provider.close();
  });

  test('discards a successful account HTTP response once without replaying creation or leaking the password', async () => {
    let creations = 0;
    const userId = randomUUID();
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const path = new URL(input).pathname;
      if (path === '/api/auth/session') return globalThis.Response.json({ user: { id: userId },
        status: { username: 'fictional', must_change: false, session_valid: true }, csrf: 'fictional-csrf' });
      if (path === '/api/accounts') { creations++; return globalThis.Response.json({ temporaryPassword: 'private-fixture-password' }); }
      return globalThis.Response.json({});
    }));
    const provider = createBrowserProvider({ origin: connectorTarget.origin });
    const command = { action: 'create_account', username: 'fictional-created', name: 'Fictional created',
      teamId: randomUUID(), roles: [], isAdmin: false };
    provider.discardNextAccountResponse();
    await expect(provider.backend.admin.account(randomUUID(), command)).rejects.toThrow('discarded the committed account response');
    expect(creations).toBe(1);
    await expect(provider.backend.admin.account(randomUUID(), command)).resolves.toEqual({ temporaryPassword: 'private-fixture-password' });
    expect(creations).toBe(2);
    await provider.close();
  });
});

function arguments_() {
  return ['--provider=cloudflare', `--account=${connectorTarget.accountId}`,
    `--database=${connectorTarget.databaseId}`, `--config=${config}`, `--origin=${connectorTarget.origin}`];
}
function options() { return providerTestOptions(arguments_(), {}); }
function environment() {
  vi.stubEnv('MINSKY_CF_TEST_ACCOUNT', connectorTarget.accountId);
  vi.stubEnv('MINSKY_CF_TEST_DATABASE', connectorTarget.databaseId);
  vi.stubEnv('MINSKY_CF_TEST_CONFIG', config);
  vi.stubEnv('MINSKY_CF_TEST_ORIGIN', connectorTarget.origin);
}

describe('Cloudflare provider runner safety', () => {
  test('requires four explicit matching target fields without Supabase credentials', () => {
    expect(options()).toEqual({ provider: 'cloudflare', account: connectorTarget.accountId,
      database: connectorTarget.databaseId, config, origin: connectorTarget.origin,
      recoveryPath: undefined, arguments: [] });
    for (const field of ['account', 'database', 'config', 'origin']) {
      const retained = arguments_().filter((arg) => !arg.startsWith(`--${field}=`));
      expect(() => providerTestOptions(retained, {})).toThrow();
      expect(() => providerTestOptions([...arguments_(), `--${field}=duplicate`], {})).toThrow();
    }
  });

  test('refuses development, old auth/proof resources, different accounts, and unreviewed origins', () => {
    for (const database of ['06560c1c-8907-47d6-b2b6-f22e129ebbe4', '5d746d29-0a66-4346-96a6-4974126685d7', randomUUID()]) {
      expect(() => providerTestOptions(arguments_().map((arg) => arg.startsWith('--database=') ? `--database=${database}` : arg), {})).toThrow();
    }
    for (const origin of ['https://minsky-dev.icaic-minsky.workers.dev', 'http://127.0.0.1:8788', `${connectorTarget.origin}/path`]) {
      expect(() => providerTestOptions(arguments_().map((arg) => arg.startsWith('--origin=') ? `--origin=${origin}` : arg), {})).toThrow();
    }
    expect(() => providerTestOptions(arguments_().map((arg) => arg.startsWith('--account=') ? '--account=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : arg), {})).toThrow();
  });

  test('retains runner isolation and permits only explicit journal recovery', () => {
    for (const override of ['--workers=2', '-j2', '--trace=on', '--reporter=html', '--output=/tmp/shared', '--retries=1', '--debug', '--token=private']) {
      expect(() => providerTestOptions([...arguments_(), override], {})).toThrow();
    }
    expect(providerTestOptions([...arguments_(), '--recover=/tmp/fixture/recovery.json'], {}).recoveryPath).toBe('/tmp/fixture/recovery.json');
    expect(() => providerTestOptions([...arguments_(), '--recover=relative.json'], {})).toThrow();
    expect(() => providerTestOptions([...arguments_(), '--recover=/tmp/recovery.json', '--grep=workflow'], {})).toThrow();
    expect(providerTestOptions([...arguments_(), '--grep', 'workflow'], {}).arguments).toEqual(['--grep', 'workflow']);
  });

  test('rejects altered bindings and authentication-only entries before opening a provider client', async () => {
    expect(await readFixtureTarget(options())).toMatchObject(connectorTarget);
    const expected = JSON.parse(await readFile(config, 'utf8'));
    for (const altered of [
      { ...expected, main: '../authentication.ts' },
      { ...expected, env: { development: {} } },
      { ...expected, r2_buckets: [{ binding: 'IMAGES', bucket_name: 'minsky-development-images', remote: true }] },
      { ...expected, vars: { AUTH_ORIGIN: connectorTarget.origin, AUTH_SECRET: 'must-not-be-in-config' } },
    ]) {
      await writeFile(config, JSON.stringify(altered));
      await expect(readFixtureTarget(options())).rejects.toThrow();
    }
  });

  test('placement configuration preserves the exact resource identity used by fixture journals', async () => {
    await writeFile(config, JSON.stringify(renderWranglerConfiguration({
      ...connectorTarget, placementRegion: 'aws:ap-southeast-1',
    }, config)));
    expect(await readFixtureTarget(options())).toEqual({ ...connectorTarget, configPath: config });
  });

  test('preflights account, exact database metadata, and the protected full entry using read-only calls', async () => {
    const calls = [];
    const request = vi.fn(async () => new globalThis.Response(JSON.stringify({ error: 'Sign in to continue.' }),
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } }));
    const runWrangler = async (args) => {
      calls.push(args);
      return args[0] === 'whoami' ? connectorTarget.accountId
        : JSON.stringify({ uuid: connectorTarget.databaseId, name: connectorTarget.databaseName });
    };
    expect(await checkCloudflareBackend(options(), { runWrangler, request })).toMatchObject(connectorTarget);
    expect(calls).toEqual([['whoami'], ['d1', 'info', connectorTarget.databaseName, '--json']]);
    expect(request.mock.calls[0][0].href).toBe(`${connectorTarget.origin}/api/sessions`);
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: 'error', cache: 'no-store' });
    await expect(checkCloudflareBackend(options(), { runWrangler: async () => 'wrong account', request })).rejects.toThrow();
    await expect(checkCloudflareBackend(options(), { runWrangler, request: async () => new globalThis.Response('<html>Other deployment</html>') })).rejects.toThrow('expected protected application entry');
  });
});

describe('Cloudflare fixture setup and exact cleanup with real local D1/R2', () => {
  let platform;
  let bindingDirectory;
  const fixturePaths = [];
  const liveObjects = new Map();

  function liveObject(sessionId) {
    if (!liveObjects.has(sessionId)) {
      const data = new Map();
      let alarm;
      const state = { storage: {
        get: async (key) => data.get(key), put: async (key, value) => { data.set(key, value); },
        list: async () => new Map(data), deleteAll: async () => { data.clear(); alarm = undefined; },
        getAlarm: async () => alarm ?? null, setAlarm: async (value) => { alarm = value; },
        deleteAlarm: async () => { alarm = undefined; },
      }, getWebSockets: () => [], acceptWebSocket: () => {} };
      liveObjects.set(sessionId, { data, coordinator: new SessionLiveCoordinator(state, { DB: platform.env.DB }) });
    }
    return liveObjects.get(sessionId);
  }
  const maintenance = { fetch: (input, init) => maintainFixtureSessions(new globalThis.Request(input, init), {
    DB: platform.env.DB, LIVE_UPDATES: { idFromName: (name) => name,
      get: (name) => ({ fetch: (request) => liveObject(name).coordinator.fetch(request) }) },
  }) };

  beforeAll(async () => {
    bindingDirectory = await mkdtemp(join(tmpdir(), 'minsky-provider-binding-'));
    const entry = join(bindingDirectory, 'worker.js');
    await writeFile(entry, 'export default { fetch() { return new Response("Isolated provider test"); } };');
    const path = join(bindingDirectory, 'wrangler.json');
    await writeFile(path, JSON.stringify({ name: 'isolated-provider-tests', main: entry,
      compatibility_date: '2026-10-13', d1_databases: [{ binding: 'DB', database_name: 'isolated-provider-tests', database_id: randomUUID() }],
      r2_buckets: [{ binding: 'IMAGES', bucket_name: 'isolated-provider-tests-images' }] }));
    platform = await getPlatformProxy({ configPath: path, persist: false, remoteBindings: false, envFiles: [] });
    const migrationPath = new URL('../src/server/adapters/d1/migrations/', import.meta.url);
    await platform.env.DB.prepare('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)').run();
    for (const name of (await readdir(migrationPath)).filter((name) => name.endsWith('.sql')).sort()) {
      await platform.env.DB.batch(splitSqlQuery(await readFile(new URL(name, migrationPath), 'utf8')).map((sql) => platform.env.DB.prepare(sql)));
      await platform.env.DB.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name).run();
    }
  });
  afterAll(async () => {
    if (platform) await platform.dispose();
    if (bindingDirectory) await rm(bindingDirectory, { recursive: true, force: true });
  });
  afterEach(async () => {
    for (const path of fixturePaths.splice(0)) {
      if (existsSync(path)) throw new Error('The local fixture test left a recovery journal.');
    }
  });

  function dependencies(overrides = {}) {
    const open = overrides.openPlatform ?? (async () => ({ env: platform.env, dispose: async () => {} }));
    return { confirmTarget: async () => {}, ...overrides, openPlatform: async (configPath) => {
      const selected = await open(configPath);
      return { ...selected, env: { ...selected.env, MAINTENANCE: selected.env.MAINTENANCE ?? maintenance } };
    } };
  }
  function journalPath() {
    const path = join(directory, 'recovery.json');
    fixturePaths.push(path);
    return path;
  }
  function statement(sql, ...values) { return platform.env.DB.prepare(sql).bind(...values); }

  test('authentication diagnostics reject an unowned account and preserve the fixture', async () => {
    environment();
    const path = journalPath();
    const fixture = await createFixture(path, dependencies());
    try {
      await expect(inspectFixtureAuthentication(path, randomUUID(), dependencies())).rejects.toThrow('does not belong');
      const flags = await inspectFixtureAuthentication(path, fixture.accounts.admin.id, dependencies());
      expect(flags).toMatchObject({ accountExists: true, accountReady: true, wrapperExists: false });
      expect(await statement('SELECT id FROM accounts WHERE id = ?', fixture.accounts.admin.id).first()).not.toBeNull();
    } finally {
      await cleanupFixture(path, dependencies());
    }
  });

  test('discovers an application-created account from its pre-recorded marker and cleans its exact UUID', async () => {
    environment();
    const path = journalPath();
    const fixture = await createFixture(path, dependencies());
    const marker = fixture.createdAccounts.staff;
    const identity = createBetterAuthIdentity(platform.env.DB, {
      origin: 'http://127.0.0.1:8788', secret: randomUUID() + randomUUID(), secureCookies: false,
    });
    const auth = new D1AuthenticationService(platform.env.DB, identity, passwordHasher);
    const login = await auth.signIn(fixture.accounts.admin.username, fixture.accounts.admin.password);
    const headers = new globalThis.Headers({ cookie: login.cookie.split(';')[0] });
    const foreign = randomUUID();
    await statement('INSERT INTO accounts(id,name) VALUES (?,?)', foreign, 'Unrelated control account').run();
    try {
      // Ignore the credential response, as a browser with a lost create response would.
      await auth.account(headers, fixture.sessionId, { action: 'create_account', ...marker,
        teamId: null, roles: ['volunteer', 'jury'], isAdmin: false });
      const created = await statement('SELECT id FROM accounts WHERE name=? AND username=?', marker.name, marker.username).first();
      expect(created?.id).toBeTypeOf('string');
      expect(JSON.parse(await readFile(path, 'utf8')).createdAccounts.every((account) => !account.id)).toBe(true);
      await statement('INSERT INTO authentication_limits(key,window_start,attempts) VALUES (?,unixepoch(),1)', `username:${marker.username}`).run();
      let failFinish = true;
      const interrupted = dependencies({ openPlatform: async () => ({ env: { ...platform.env, MAINTENANCE: {
        fetch: async (input, init) => {
          if (init?.body && JSON.parse(init.body).phase === 'finish' && failFinish) { failFinish = false; throw new Error('Interrupted final fixture confirmation'); }
          return maintenance.fetch(input, init);
        },
      } }, dispose: async () => {} }) });
      await expect(cleanupFixture(path, interrupted)).rejects.toThrow('Interrupted final fixture confirmation');
      const retained = JSON.parse(await readFile(path, 'utf8'));
      expect(retained.createdAccounts.find((account) => account.username === marker.username)).toEqual({ ...marker, id: created.id });
      expect(await statement('SELECT id FROM accounts WHERE id=?', created.id).first()).toBeNull();
      await cleanupFixture(path, dependencies());
      expect(await statement('SELECT id FROM ba_user WHERE id=?', created.id).first()).toBeNull();
      expect(await statement('SELECT key FROM authentication_limits WHERE key=?', `username:${marker.username}`).first()).toBeNull();
      expect(await statement('SELECT id FROM accounts WHERE id=?', foreign).first()).toEqual({ id: foreign });
    } finally {
      if (existsSync(path)) await cleanupFixture(path, dependencies());
      await statement('DELETE FROM accounts WHERE id=?', foreign).run();
    }
  });

  test('removes exact fixture Durable Object cursors while preserving another session object', async () => {
    environment();
    const path = journalPath();
    const fixture = await createFixture(path, dependencies());
    const otherEvent = randomUUID();
    const otherSession = randomUUID();
    await platform.env.DB.batch([
      statement('INSERT INTO events (id, name) VALUES (?, ?)', otherEvent, 'Unrelated control event'),
      statement('INSERT INTO sessions (id, event_id) VALUES (?, ?)', otherSession, otherEvent),
    ]);
    const notify = (sessionId) => liveObject(sessionId).coordinator.fetch(new globalThis.Request('https://live.internal/notify', {
      method: 'POST', body: JSON.stringify({ id: randomUUID(), sessionId, audience: 'staff', sequence: 1 }),
    }));
    try {
      expect((await notify(fixture.sessionId)).status).toBe(204);
      expect((await notify(otherSession)).status).toBe(204);
      const control = new Map(liveObject(otherSession).data);
      expect(liveObject(fixture.sessionId).data.size).toBe(1);
      await cleanupFixture(path, dependencies());
      expect(liveObject(fixture.sessionId).data.size).toBe(0);
      expect(liveObject(fixture.otherSessionId).data.size).toBe(0);
      expect(liveObject(otherSession).data).toEqual(control);
      expect(await statement('SELECT id FROM sessions WHERE id = ?', otherSession).first()).not.toBeNull();
      await notify(fixture.sessionId);
      expect(liveObject(fixture.sessionId).data.size).toBe(0);
    } finally {
      if (existsSync(path)) await cleanupFixture(path, dependencies());
      await statement('DELETE FROM events WHERE id = ?', otherEvent).run();
    }
  });

  test('creates all actors with maintained hashes, keeps secrets in memory, and removes only owned D1/R2 records', async () => {
    environment();
    const path = journalPath();
    const fixture = await createFixture(path, dependencies());
    const journal = JSON.parse(await readFile(path, 'utf8'));
    const contents = await readFile(path, 'utf8');
    expect(Object.keys(fixture.accounts)).toHaveLength(10);
    for (const account of Object.values(fixture.accounts)) expect(contents).not.toContain(account.password);
    expect(Object.keys(journal).sort()).toEqual(['accountIds', 'createdAccounts', 'eventId', 'images', 'provider', 'runId', 'sessionIds', 'target', 'teamIds', 'version']);
    const hash = await statement('SELECT password FROM ba_account WHERE userId = ?', fixture.accounts.admin.id).first();
    expect(await passwordHasher.verify(fixture.accounts.admin.password, hash.password)).toBe(true);
    expect(contents).not.toContain(hash.password);
    const memberships = (await statement(`SELECT m.session_id, m.account_id, m.team_id, m.is_admin, a.must_change,
      (SELECT json_group_array(role) FROM membership_roles r WHERE r.session_id = m.session_id AND r.account_id = m.account_id) AS roles
      FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.session_id IN (?, ?)`, ...journal.sessionIds).all()).results;
    expect(memberships).toHaveLength(11);
    expect(memberships.filter((row) => row.is_admin)).toHaveLength(2);
    expect(memberships.filter((row) => row.must_change)).toHaveLength(1);
    expect(memberships.find((row) => row.account_id === fixture.accounts.temporary.id).team_id).toBe(fixture.teamId);
    expect(memberships.filter((row) => row.account_id === fixture.accounts.revoked.id)).toHaveLength(2);
    const foreignEvent = randomUUID();
    const foreignAccount = randomUUID();
    const foreignKey = `unrelated/${randomUUID()}`;
    const issueId = randomUUID();
    const imageId = randomUUID();
    const original = `${fixture.sessionId}/${issueId}/${imageId}/original`;
    const thumbnail = `${fixture.sessionId}/${issueId}/${imageId}/thumbnail`;
    const sessionId = randomUUID();
    const rateKey = `ip:shared-${randomUUID()}`;
    try {
      await platform.env.DB.batch([
        statement('INSERT INTO events (id, name) VALUES (?, ?)', foreignEvent, 'Unrelated test event'),
        statement('INSERT INTO accounts (id, name) VALUES (?, ?)', foreignAccount, 'Unrelated test account'),
        statement(`INSERT INTO issues (id, session_id, team_id, reporter, number, category, description, status)
          VALUES (?, ?, ?, ?, 1, 'Other', 'Fictional fixture issue', 'open')`, issueId, fixture.sessionId, fixture.teamId, fixture.accounts.contestant.id),
        statement(`INSERT INTO issue_images (id, session_id, issue_id, uploader, request_id, uploader_name, visibility,
          declared_bytes, original_name, original_path, thumbnail_path) VALUES (?, ?, ?, ?, ?, 'Fixture uploader', 'public', 17, 'fictional.png', ?, ?)`,
        imageId, fixture.sessionId, issueId, fixture.accounts.volunteer.id, randomUUID(), original, thumbnail),
        statement('INSERT INTO image_deletions (attachment_id) VALUES (?)', imageId),
        statement(`INSERT INTO ba_session (id, userId, token, expiresAt, createdAt, updatedAt)
          VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', '2026-10-18T00:00:00.000Z', '2026-10-18T00:00:00.000Z')`, sessionId, fixture.accounts.volunteer.id, randomUUID()),
        statement('INSERT INTO logins (id, account_id, expires_at, identity_session_id) VALUES (?, ?, unixepoch() + 3600, ?)', randomUUID(), fixture.accounts.volunteer.id, sessionId),
        statement(`INSERT INTO account_operations (id, account_id, actor, action, state) VALUES (?, ?, ?, 'change_password', 'completed')`,
          randomUUID(), fixture.accounts.volunteer.id, fixture.accounts.volunteer.id),
        statement('INSERT INTO authentication_limits (key, window_start, attempts) VALUES (?, unixepoch(), 1), (?, unixepoch(), 1), (?, unixepoch(), 1)',
          `username:${fixture.accounts.volunteer.username}`, `change:${fixture.accounts.volunteer.id}`, rateKey),
      ]);
      await platform.env.IMAGES.put(original, new Uint8Array([1, 2, 3]));
      await platform.env.IMAGES.put(thumbnail, new Uint8Array([1, 2, 3]));
      await platform.env.IMAGES.put(foreignKey, new Uint8Array([4, 5, 6]));
      await statement("UPDATE events SET name = 'Changed ownership marker' WHERE id = ?", journal.eventId).run();
      await expect(cleanupFixture(path, dependencies())).rejects.toThrow('event does not belong');
      expect(await platform.env.IMAGES.head(original)).not.toBeNull();
      await statement('UPDATE events SET name = ? WHERE id = ?', `Provider contract ${journal.runId}`, journal.eventId).run();
      await statement('UPDATE sessions SET event_id = ? WHERE id = ?', foreignEvent, fixture.sessionId).run();
      await expect(cleanupFixture(path, dependencies())).rejects.toThrow('session does not belong');
      await statement('UPDATE sessions SET event_id = ? WHERE id = ?', journal.eventId, fixture.sessionId).run();
      await statement("UPDATE accounts SET name = 'Unrelated account marker' WHERE id = ?", fixture.accounts.volunteer.id).run();
      await expect(cleanupFixture(path, dependencies())).rejects.toThrow('account does not belong');
      await statement('UPDATE accounts SET name = ? WHERE id = ?', `Provider volunteer ${journal.runId}`, fixture.accounts.volunteer.id).run();
      let deletion = 0;
      const interrupted = dependencies({ openPlatform: async () => ({
        env: { DB: platform.env.DB, IMAGES: {
          head: (key) => platform.env.IMAGES.head(key),
          delete: async (keys) => {
            if (++deletion === 2) {
              await platform.env.IMAGES.put(original, new Uint8Array([7, 8, 9]));
              throw new Error('Injected late object after DB cleanup');
            }
            await platform.env.IMAGES.delete(keys);
          },
        } }, dispose: async () => {},
      }) });
      await expect(cleanupFixture(path, interrupted)).rejects.toThrow('Injected late object');
      expect(existsSync(path)).toBe(true);
      expect(await statement('SELECT id FROM events WHERE id = ?', journal.eventId).first()).toBeNull();
      expect(JSON.parse(await readFile(path, 'utf8')).images).toEqual([{ id: imageId, session_id: fixture.sessionId, issue_id: issueId }]);
      await cleanupFixture(path, dependencies());
      expect(existsSync(path)).toBe(false);
      expect(await platform.env.IMAGES.head(original)).toBeNull();
      expect(await platform.env.IMAGES.head(thumbnail)).toBeNull();
      expect(await platform.env.IMAGES.head(foreignKey)).not.toBeNull();
      expect(await statement('SELECT id FROM events WHERE id = ?', foreignEvent).first()).toEqual({ id: foreignEvent });
      expect(await statement('SELECT id FROM accounts WHERE id = ?', foreignAccount).first()).toEqual({ id: foreignAccount });
      expect(await statement('SELECT attempts FROM authentication_limits WHERE key = ?', rateKey).first()).toEqual({ attempts: 1 });
    } finally {
      if (existsSync(path)) await cleanupFixture(path, dependencies());
      await platform.env.IMAGES.delete([foreignKey]);
      await statement('DELETE FROM events WHERE id = ?', foreignEvent).run();
      await statement('DELETE FROM accounts WHERE id = ?', foreignAccount).run();
      await statement('DELETE FROM authentication_limits WHERE key = ?', rateKey).run();
    }
  });

  test('refuses credential-bearing journals and mismatched targets before any provider connection', async () => {
    environment();
    const path = journalPath();
    let connected = 0;
    const injected = dependencies({ openPlatform: async () => { connected++; throw new Error('Must not open'); } });
    const accountIds = Object.fromEntries(['admin', 'otherAdmin', 'contestant', 'otherTeam', 'volunteer', 'specialist', 'jury', 'isolated', 'temporary', 'revoked'].map((actor) => [actor, randomUUID()]));
    const journal = { version: 1, provider: 'cloudflare', runId: randomUUID(), eventId: randomUUID(), sessionIds: [randomUUID(), randomUUID()],
      teamIds: [randomUUID(), randomUUID(), randomUUID()], accountIds, target: { ...connectorTarget, configPath: config } };
    await writeFile(path, JSON.stringify({ ...journal, password: 'must-not-be-saved' }));
    await expect(cleanupFixture(path, injected)).rejects.toThrow();
    await writeFile(path, JSON.stringify({ ...journal, target: { ...journal.target, databaseId: randomUUID() } }));
    await expect(cleanupFixture(path, injected)).rejects.toThrow('Recovery target');
    expect(connected).toBe(0);
    await rm(path);
  });

  test('rejects stale schema before setup and recovers a lost atomic fixture-creation response', async () => {
    await expect(checkFixtureSchema({ prepare: () => ({ all: async () => { throw new Error('Missing schema'); } }) })).rejects.toThrow('required application schema');
    environment();
    const path = journalPath();
    let first = true;
    const db = { prepare: (sql) => platform.env.DB.prepare(sql), batch: async (queries) => {
      const result = await platform.env.DB.batch(queries);
      if (first) { first = false; throw new Error('Injected response loss after commit'); }
      return result;
    } };
    await expect(createFixture(path, dependencies({ openPlatform: async () => ({ env: { DB: db, IMAGES: platform.env.IMAGES }, dispose: async () => {} }) })))
      .rejects.toThrow('could not be prepared');
    expect(existsSync(path)).toBe(false);
    expect((await statement("SELECT id FROM events WHERE name LIKE 'Provider contract %'").all()).results).toEqual([]);
  });
});
