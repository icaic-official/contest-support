import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test, vi } from 'vitest';
import { D1ApplicationStore } from '../../d1/store.ts';
import { createD1ApiConnection, openStoreDatabase } from './store-database.mjs';
import { renderStoreConfiguration, storeTarget } from './store-target.mjs';

const privateToken = 'fictional-private-api-token';
const privateSql = 'SELECT fictional_private_sql_sentinel';
const privateDetails = `${privateToken} ${privateSql} fictional-password-cookie`;
const directories = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function configurationFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'minsky-store-database-test-'));
  directories.push(directory);
  const configPath = join(directory, 'wrangler.jsonc');
  await writeFile(configPath, JSON.stringify(renderStoreConfiguration(configPath)));
  return {
    configPath,
    options: { configPath, remoteBindings: true },
    environment: {
      MINSKY_CONNECTOR_D1_TRANSPORT: 'api', MINSKY_CONNECTOR_D1_CONFIG: configPath,
      CLOUDFLARE_ACCOUNT_ID: storeTarget.accountId, MINSKY_CONNECTOR_D1_DATABASE_ID: storeTarget.databaseId,
      MINSKY_CONNECTOR_D1_API_TOKEN: privateToken, MINSKY_CONNECTOR_D1_API_INTERVAL_MS: '1200',
    },
  };
}

function result(results = [], overrides = {}) {
  return {
    success: true,
    results,
    meta: {
      duration: 1.25, changes: 1, last_row_id: 7, rows_read: 2, rows_written: 1,
      served_by_region: 'APAC', served_by_primary: true,
      timings: { sql_duration_ms: 0.5 },
    },
    ...overrides,
  };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fixture({ intervalMs = 300, fetch } = {}) {
  let clock = 0;
  const calls = [];
  const waits = [];
  const settings = { ...storeTarget, token: privateToken, intervalMs };
  const dependencies = {
    now: () => clock,
    wait: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds; },
    fetch: async (url, options) => {
      const call = { url, options, startedAt: clock, body: JSON.parse(options.body) };
      calls.push(call);
      return fetch ? fetch(call) : response({ success: true, result: call.body.batch.map(() => result()) });
    },
  };
  return { db: createD1ApiConnection(settings, dependencies), settings, dependencies, calls, waits,
    advance: (milliseconds) => { clock += milliseconds; } };
}

test('a batch uses one POST with ordered bound numbers, strings, null, and full result metadata', async () => {
  const rows = [result([{ id: 7 }]), result([{ id: 8 }], { meta: { duration: 3, changes: 2, rows_written: 2 } })];
  const setup = fixture({ fetch: () => response({ success: true, result: rows }) });
  const original = setup.db.prepare('SELECT ?, ?, ?');
  const first = original.bind(7, 'fictional value', null);
  const second = setup.db.prepare('SELECT ?').bind(8.5);
  assert.deepEqual(await setup.db.batch([first, second]), rows);
  assert.equal(setup.calls.length, 1);
  const { url, options, body } = setup.calls[0];
  assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${storeTarget.accountId}/d1/database/${storeTarget.databaseId}/query`);
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.authorization, `Bearer ${privateToken}`);
  assert.equal(options.headers['content-type'], 'application/json');
  assert.ok(options.signal instanceof globalThis.AbortSignal);
  assert.deepEqual(body, { batch: [
    { sql: 'SELECT ?, ?, ?', params: [7, 'fictional value', null] },
    { sql: 'SELECT ?', params: [8.5] },
  ] });
  const unbound = fixture();
  const statement = unbound.db.prepare('SELECT ?');
  statement.bind(99);
  await statement.all();
  assert.deepEqual(unbound.calls[0].body.batch[0].params, []);
});

test('first returns one row or null, all retains metadata, and run retains metadata without rows', async () => {
  const full = result([{ number: 7 }, { number: 8 }]);
  const setup = fixture({ fetch: () => response({ success: true, result: [full] }) });
  assert.deepEqual(await setup.db.prepare('SELECT number').first(), { number: 7 });
  assert.deepEqual(await setup.db.prepare('SELECT number').all(), full);
  assert.deepEqual(await setup.db.prepare('UPDATE fictional').run(), { ...full, results: [] });
  const empty = fixture();
  assert.equal(await empty.db.prepare('SELECT missing').first(), null);
});

test('foreign statements and unsupported bindings fail before any request', async () => {
  const setup = fixture();
  const foreign = fixture();
  const own = setup.db.prepare('SELECT 1');
  for (const statement of [foreign.db.prepare('SELECT 2'), {}, null]) {
    await assert.rejects(setup.db.batch([own, statement]), /statements from this connection/);
  }
  for (const value of [undefined, true, [], {}, NaN, Infinity, -Infinity]) {
    assert.throws(() => own.bind(value), /strings, finite numbers, or null/);
  }
  assert.deepEqual(await setup.db.batch([]), []);
  assert.equal(setup.calls.length, 0);
  assert.equal(foreign.calls.length, 0);
});

test('foreign targets, missing credentials, and unsupported intervals fail before any request', () => {
  const setup = fixture();
  const overrides = [
    { accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { databaseId: 'de43cf95-c024-4e44-860d-8ff179e4e08d' },
    { databaseId: '00000000-0000-4000-8000-000000000001' },
    { token: '' }, { token: undefined },
    ...[0, 299, 301, 1199, 1201, NaN, undefined, '300'].map((intervalMs) => ({ intervalMs })),
  ];
  for (const override of overrides) {
    assert.throws(() => createD1ApiConnection({ ...setup.settings, ...override }, setup.dependencies), /exact store CI target/);
  }
  assert.equal(setup.calls.length, 0);
});

test('opening API transport requires hosted mode, the exact selected config, and the reviewed target', async () => {
  const setup = await configurationFixture();
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('Unexpected provider request.'); });
  await assert.rejects(openStoreDatabase({ ...setup.options, remoteBindings: false }, setup.environment), /guarded hosted store runner/);
  await assert.rejects(openStoreDatabase({ ...setup.options, configPath: join(tmpdir(), 'foreign-config.jsonc') }, setup.environment), /guarded hosted store runner/);
  for (const override of [
    { CLOUDFLARE_ACCOUNT_ID: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { MINSKY_CONNECTOR_D1_DATABASE_ID: 'de43cf95-c024-4e44-860d-8ff179e4e08d' },
  ]) {
    await assert.rejects(openStoreDatabase(setup.options, { ...setup.environment, ...override }), /exact isolated dedicated store CI target/);
  }
  for (const change of [
    (config) => { config.name = 'minsky-dev'; },
    (config) => { config.account_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; },
    (config) => { config.d1_databases[0].database_id = 'de43cf95-c024-4e44-860d-8ff179e4e08d'; },
    (config) => { config.assets = { directory: './dist' }; },
  ]) {
    const config = renderStoreConfiguration(setup.configPath);
    change(config);
    await writeFile(setup.configPath, JSON.stringify(config));
    await assert.rejects(openStoreDatabase(setup.options, setup.environment), /configuration changed/);
  }
  assert.equal(fetch.mock.calls.length, 0);
});

test('opening a valid API transport creates a guarded connection without fetching or changing resources', async () => {
  const setup = await configurationFixture();
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('Unexpected provider request.'); });
  const opened = await openStoreDatabase(setup.options, setup.environment);
  assert.equal(typeof opened.db.prepare, 'function');
  assert.equal(typeof opened.db.batch, 'function');
  assert.equal(typeof opened.db.exec, 'function');
  await opened.dispose();
  await assert.rejects(openStoreDatabase(setup.options, { ...setup.environment, MINSKY_CONNECTOR_D1_TRANSPORT: 'automatic' }), /binding or api/);
  assert.equal(fetch.mock.calls.length, 0);
});

const failureCases = [
  ['fetch error', () => { throw new Error(privateDetails); }],
  ['HTTP 429', () => response({ success: false, errors: [{ message: privateDetails }] }, 429)],
  ['invalid JSON', () => ({ ok: true, status: 200, json: async () => { throw new Error(privateDetails); } })],
  ['missing body', () => response(null)],
  ['malformed result', () => response({ success: true, result: [result([], { meta: null }), result()] })],
  ['partial batch', () => response({ success: true, result: [result()] })],
  ['failed batch member', () => response({ success: true, result: [result(), { success: false, error: privateDetails }] })],
];

for (const [name, fetch] of failureCases) {
  test(`${name} fails without replay or private provider details`, async () => {
    const setup = fixture({ fetch });
    await assert.rejects(setup.db.batch([
      setup.db.prepare(privateSql).bind(privateToken), setup.db.prepare('SELECT 2'),
    ]), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(/D1 API request/.test(error.message));
      for (const sentinel of [privateToken, privateSql, 'fictional-password-cookie']) {
        assert.equal(String(error).includes(sentinel), false);
        assert.equal(error.stack.includes(sentinel), false);
      }
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(setup.calls.length, 1);
    assert.deepEqual(setup.waits, []);
  });
}

test('constraint failures retain only the fixed rule needed by shared assertions', async () => {
  for (const message of ['CHECK constraint failed', 'FOREIGN KEY constraint failed',
    'UNIQUE constraint failed', 'NOT NULL constraint failed', 'Issue versions must advance with each write']) {
    for (const source of ['errors', 'result']) {
      const body = source === 'errors'
        ? { success: false, errors: [{ message: `${message}: ${privateDetails}` }] }
        : { success: false, result: [{ error: `${message}: ${privateDetails}` }] };
      const setup = fixture({ fetch: () => response(body, 400) });
      await assert.rejects(setup.db.prepare(privateSql).run(), (error) => {
        assert.equal(error.message, `D1_ERROR: ${message}`);
        assert.equal(String(error).includes(privateToken), false);
        assert.equal(String(error).includes(privateSql), false);
        return true;
      });
      assert.equal(setup.calls.length, 1);
    }
  }
});

test('workflow commits retain known rollback identities and preserve unknown outcomes for other failures', async () => {
  const command = { type: 'claim', issue_id: 'fictional-issue', revision: 1 };
  const caller = { accountId: 'fictional-account', loginId: 'fictional-login' };
  const read = {
    state: {
      actor: { id: caller.accountId, name: 'Fictional organizer' },
      membership: { team_id: null, roles: ['volunteer'], is_admin: false },
      session: { id: 'fictional-session', intake_open: true, categories: ['Devices'] },
      archived: false, teams: ['fictional-team'],
      issue: { id: command.issue_id, team_id: 'fictional-team', status: 'open', owner: null, revision: 1 },
      resolution: null, award: null,
    },
    dependency: 'captured-state',
    receipt: { sessionId: 'fictional-session', issueId: command.issue_id, command },
  };
  const decision = { type: 'claim', issueId: command.issue_id, teamId: 'fictional-team',
    history: { text: 'Issue claimed.', visibility: 'public' } };
  for (const [message, outcome] of [
    ['CHECK constraint failed: valid = 1', 'retry'],
    ['UNIQUE constraint failed: command_receipts.actor, command_receipts.request_id', 'retry'],
    ['CHECK constraint failed: unrelated_guard', 'unknown'],
    ['UNIQUE constraint failed: unrelated_table.id', 'unknown'],
  ]) {
    const setup = fixture({ fetch: () => response({ success: false, errors: [{ message: `${message}: ${privateDetails}` }] }, 400) });
    const store = new D1ApplicationStore(setup.db);
    assert.deepEqual(await store.commit(caller, 'fictional-session', 'fictional-request', command, read, decision), { outcome });
    assert.equal(setup.calls.length, 1);
  }
  const disconnected = fixture({ fetch: () => { throw new Error(privateDetails); } });
  assert.deepEqual(await new D1ApplicationStore(disconnected.db).commit(caller,
    'fictional-session', 'fictional-request', command, read, decision), { outcome: 'unknown' });
  assert.equal(disconnected.calls.length, 1);
});

test('request starts respect both reviewed intervals without actual sleeps', async () => {
  for (const intervalMs of [300, 1200]) {
    const setup = fixture({ intervalMs });
    await setup.db.prepare('SELECT 1').all();
    setup.advance(100);
    await setup.db.prepare('SELECT 2').all();
    setup.advance(intervalMs + 1);
    await setup.db.prepare('SELECT 3').all();
    assert.deepEqual(setup.calls.map((call) => call.startedAt), [0, intervalMs, intervalMs * 2 + 1]);
    assert.deepEqual(setup.waits, [intervalMs - 100]);
  }
});

test('concurrent starts are paced while earlier responses remain outstanding', async () => {
  const pending = [];
  let notifyStarted;
  const started = new Promise((resolve) => { notifyStarted = resolve; });
  const setup = fixture({ fetch: () => new Promise((resolve) => {
    pending.push(resolve);
    if (pending.length === 3) notifyStarted();
  }) });
  const operations = [1, 2, 3].map((number) => setup.db.prepare('SELECT ?').bind(number).all());
  await started;
  assert.deepEqual(setup.calls.map((call) => call.startedAt), [0, 300, 600]);
  assert.deepEqual(setup.waits, [300, 300]);
  for (const resolve of pending) resolve(response({ success: true, result: [result()] }));
  await Promise.all(operations);
});

test('exec sends triggers and semicolons inside strings as one correctly split API batch', async () => {
  const setup = fixture();
  const sql = `CREATE TABLE fictional (id INTEGER, name TEXT);
CREATE TRIGGER fictional_audit AFTER INSERT ON fictional BEGIN
  INSERT INTO fictional(id,name) VALUES (NEW.id + 1,'trigger;literal');
  UPDATE fictional SET name='still;one' WHERE id=NEW.id;
END;
INSERT INTO fictional(id,name) VALUES (1,'text;with;semicolons');`;
  assert.deepEqual(await setup.db.exec(sql), { count: 3, duration: 3.75 });
  assert.equal(setup.calls.length, 1);
  const { batch } = setup.calls[0].body;
  assert.equal(batch.length, 3);
  assert.match(batch[0].sql, /^CREATE TABLE fictional/);
  assert.match(batch[1].sql, /^CREATE TRIGGER fictional_audit/);
  assert.ok(batch[1].sql.includes("'trigger;literal'"));
  assert.ok(batch[1].sql.includes("'still;one'"));
  assert.match(batch[1].sql.trim(), /END;?$/);
  assert.match(batch[2].sql, /^INSERT INTO fictional/);
  assert.deepEqual(batch.map((query) => query.params), [[], [], []]);
});
