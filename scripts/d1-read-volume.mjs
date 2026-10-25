import console from 'node:console';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from '../src/server/adapters/cloudflare/tooling/configuration.mjs';
import { enforceWranglerEnvironment } from '../src/server/adapters/cloudflare/tooling/safe-environment.mjs';

const usage = `Usage: npm run perf:reads -- [--plan=full|base] [--repeats=3] [--explain] [--out=<file.json>]

Seeds a local D1 database with fictional data, sends real requests through the
application Worker, and prints D1 calls, statements, rows read and rows written
for each request. It uses only a temporary local database. It never contacts Cloudflare.`;

const options = { plan: 'full', repeats: 3, explain: false, out: '' };
for (const argument of process.argv.slice(2)) {
  const [key, value] = argument.replace(/^--/, '').split('=');
  if (key === 'plan' && ['full', 'base'].includes(value)) options.plan = value;
  else if (key === 'repeats' && /^[1-9]$/.test(value)) options.repeats = Number(value);
  else if (key === 'explain' && value === undefined) options.explain = true;
  else if (key === 'out' && value) options.out = resolve(value);
  else { console.error(usage); process.exit(1); }
}

// Local D1 only. A credential in the shell must not reach Wrangler.
for (const key of Object.keys(process.env)) {
  if (/^(?:CLOUDFLARE_|MINSKY_CONNECTOR_|MINSKY_AUTH_REMOTE)/.test(key)) delete process.env[key];
}
enforceWranglerEnvironment();
const { openStoreDatabase } = await import('../src/server/adapters/cloudflare/tooling/store-database.mjs');
const { unstable_splitSqlQuery: splitSqlQuery } = await import('wrangler');
const configPath = 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';
const origin = 'https://read-volume.minsky.invalid';

/**
 * One bundle, so http.ts and the services share one AuthenticationError class.
 * The real applicationWorker.ts runs. Only its `cloudflare:workers` import is a
 * stub, as in applicationWorker.test.ts.
 */
async function loadWorker() {
  const { build } = await import('esbuild');
  const scratch = resolve(repositoryRoot, '.wrangler');
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(scratch, 'read-volume-'));
  const outfile = join(directory, 'module.mjs');
  try {
    await build({
      stdin: { resolveDir: repositoryRoot, loader: 'ts', contents: `
        export { default as worker, SessionLiveCoordinator } from './src/server/adapters/cloudflare/applicationWorker.ts';
        export { claimSql, dispatchNotifications } from './src/server/adapters/cloudflare/live.ts';
        export { currentAccessBindings, currentAccessForLoginsSql, currentAccessSql, sessionsListSql, snapshotSql } from './src/server/adapters/cloudflare/application.ts';
        export { snapshotSql as announcementSnapshotSql } from './src/server/adapters/cloudflare/announcements.ts';
        export { passwordHasher } from './src/server/adapters/cloudflare/password.ts';
        export { measureD1 } from './src/server/adapters/d1/testMetrics.ts';` },
      outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
      plugins: [{ name: 'workers-stub', setup(stub) {
        stub.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'workers', namespace: 'stub' }));
        stub.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class WorkerEntrypoint {}', loader: 'js' }));
      } }],
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const lib = await loadWorker();

/** The same steps as applyMigrations in testFixture.ts, whose folder lookup does not survive bundling. */
async function applyMigrations(db) {
  const folder = resolve(repositoryRoot, 'src/server/adapters/d1/migrations');
  for (const name of (await readdir(folder)).filter((file) => file.endsWith('.sql')).sort()) {
    await db.batch(splitSqlQuery(await readFile(join(folder, name), 'utf8')).map((sql) => db.prepare(sql)));
  }
}

// Node rejects status 101. The Worker runtime returns the paired socket. Same stub as live.test.ts.
const NativeResponse = globalThis.Response;
globalThis.Response = class extends NativeResponse {
  constructor(body, init) {
    super(body, init?.status === 101 ? { status: 200 } : init);
    this.webSocket = init?.webSocket;
  }
};
class FakeSocket {
  messages = [];
  closed = false;
  attachment = undefined;
  get readyState() { return this.closed ? 3 : 1; }
  send(value) { this.messages.push(value); }
  close() { this.closed = true; }
  serializeAttachment(value) { this.attachment = globalThis.structuredClone(value); }
  deserializeAttachment() { return globalThis.structuredClone(this.attachment); }
}
globalThis.WebSocketPair = class { 0 = new FakeSocket(); 1 = new FakeSocket(); };
class FakeState {
  sockets = [];
  data = new Map();
  alarmAt = undefined;
  storage = {
    get: async (key) => this.data.get(key),
    put: async (key, value) => { this.data.set(key, value); },
    setAlarm: async (at) => { this.alarmAt = at; },
    deleteAlarm: async () => { this.alarmAt = undefined; },
    getAlarm: async () => this.alarmAt ?? null,
    deleteAll: async () => { this.data.clear(); this.alarmAt = undefined; },
    list: async () => new Map(this.data),
  };
  acceptWebSocket(socket) { this.sockets.push(socket); }
  getWebSockets() { return this.sockets.filter((socket) => !socket.closed); }
}

/**
 * Records one entry for each executed statement. `first()` runs as `all()`:
 * local D1 executes every row of a statement for either call (miniflare
 * database.worker.js), and only `all()` returns `meta`. Bound values stay in
 * memory for EXPLAIN and are never printed.
 */
function meter(inner, source, log, clock) {
  const originals = new WeakMap();
  let calls = 0;
  const begin = (sql, values, call) => {
    const entry = { source, call, sql, values, phase: clock.phase, rowsRead: NaN, rowsWritten: NaN };
    log.push(entry);
    return entry;
  };
  const finish = (entry, result) => {
    entry.rowsRead = result?.meta?.rows_read ?? NaN;
    entry.rowsWritten = result?.meta?.rows_written ?? NaN;
  };
  function statement(original, sql, values) {
    const execute = async (operation) => {
      const entry = begin(sql, values, ++calls);
      const result = await operation();
      finish(entry, result);
      return result;
    };
    const wrapped = {
      bind: (...next) => statement(original.bind(...next), sql, next),
      first: async () => (await execute(() => original.all())).results[0] ?? null,
      all: () => execute(() => original.all()),
      run: () => execute(() => original.run()),
      raw: () => { throw new Error('raw() is not measured.'); },
    };
    originals.set(wrapped, { original, sql, values });
    return wrapped;
  }
  return {
    prepare: (sql) => statement(inner.prepare(sql), sql, []),
    async batch(list) {
      const items = list.map((item) => originals.get(item));
      if (items.some((item) => !item)) throw new Error('A batch statement came from another connection.');
      const call = ++calls;
      const entries = items.map((item) => begin(item.sql, item.values, call));
      const results = await inner.batch(items.map((item) => item.original));
      results.forEach((result, index) => finish(entries[index], result));
      return results;
    },
    // Better Auth selects its D1 dialect only when exec exists. Fail if it is used.
    exec: () => { throw new Error('exec() is not measured.'); },
  };
}

const prefix = { event: 'e0000000', session: 'd0000000', team: 'b0000000', otherTeam: 'b1000000',
  account: 'a0000000', login: 'a1000000', identity: 'a2000000', avatar: 'a3000000', credential: 'a4000000',
  issue: 'c0000000', otherIssue: 'c1000000', history: 'c2000000', image: 'c3000000', otherImage: 'c4000000',
  announcement: 'f0000000', announcementImage: 'f1000000' };
// Deterministic UUIDs. The HTTP and live boundaries accept only UUIDs.
const sqlId = (kind, n) => `'${prefix[kind]}-0000-4000-8000-' || printf('%012d', ${n})`;
const id = (kind, n) => `${prefix[kind]}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const roles = { admin: 1, volunteer: 2, jury: 3, contestant: 7 };
const password = 'read-volume-fictional-password';

/**
 * Copy of the readVolume.test.ts seed with UUID keys and a variable shape. It
 * adds the volunteer and jury callers, open intake, a ready avatar for every
 * account, announcements with images, and credentials for the four callers.
 */
async function seed(db, shape, hash) {
  const { accounts, teams, issues, historyPerIssue } = shape;
  const series = (count) => `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})`;
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const later = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day')";
  const run = (sql, ...values) => db.prepare(sql).bind(...values).run();
  const session = id('session', 1);
  const other = id('session', 2);
  const images = (sessionId, count, issueCount, kind, issueKind) => run(`${series(count)}
    INSERT INTO issue_images (id, session_id, issue_id, uploader, request_id, uploader_name, uploaded_at, visibility,
      declared_bytes, byte_size, content_type, original_name, state, original_path, thumbnail_path)
    SELECT ${sqlId(kind, 'i')}, ?, ${sqlId(issueKind, `1 + i % ${issueCount}`)}, ?, '${kind}-req-' || i,
      'Person 1', ${now}, 'public', 1000, 1000, 'image/png', 'a.png', 'ready', '${kind}-o-' || i, '${kind}-t-' || i FROM n`,
  sessionId, id('account', 1));
  await run('INSERT INTO events (id, name) VALUES (?, ?)', id('event', 1), 'Scale event');
  await run('INSERT INTO sessions (id, event_id, name, intake_open) VALUES (?, ?, ?, 1)', session, id('event', 1), 'Scale session');
  await run(`${series(teams)} INSERT INTO teams (id, session_id, name, location) SELECT ${sqlId('team', 'i')}, ?, 'Team ' || i, 'Table ' || i FROM n`, session);
  await run(`${series(accounts)} INSERT INTO accounts (id, name, username, must_change) SELECT ${sqlId('account', 'i')}, 'Person ' || i, 'user' || i, 0 FROM n`);
  await run(`${series(accounts)} INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
    SELECT ${sqlId('account', 'i')}, 'Person ' || i, 'user' || i || '@x.invalid', 1, ${now}, ${now}, 'user' || i FROM n`);
  await run(`${series(accounts)} INSERT INTO ba_session (id, expiresAt, token, createdAt, updatedAt, userId)
    SELECT ${sqlId('identity', 'i')}, ${later}, 'tok-' || i, ${now}, ${now}, ${sqlId('account', 'i')} FROM n`);
  await run(`${series(accounts)} INSERT INTO logins (id, account_id, expires_at, identity_session_id)
    SELECT ${sqlId('login', 'i')}, ${sqlId('account', 'i')}, unixepoch() + 86400, ${sqlId('identity', 'i')} FROM n`);
  await run(`${series(accounts)} INSERT INTO memberships (session_id, account_id, team_id, is_admin)
    SELECT ?, ${sqlId('account', 'i')}, CASE WHEN i IN (1, 2, 3) THEN NULL ELSE ${sqlId('team', `1 + i % ${teams}`)} END, i = 1 FROM n`, session);
  await run(`INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer'), (?, ?, 'jury')`,
    session, id('account', roles.volunteer), session, id('account', roles.jury));
  await run(`${series(issues)} INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at)
    SELECT ${sqlId('issue', 'i')}, ?, ${sqlId('team', `1 + i % ${teams}`)}, 'open', i, ${sqlId('account', `1 + i % ${accounts}`)},
      'Person', 'Devices', 'Fictional issue ' || i, ${now} FROM n`, session);
  await run(`${series(issues * historyPerIssue)} INSERT INTO history (id, issue_id, actor, at, text, visibility, actor_name)
    SELECT ${sqlId('history', 'i')}, ${sqlId('issue', `1 + i % ${issues}`)}, ?, ${now}, 'note ' || i,
      CASE WHEN (i / 100) % 2 THEN 'public' ELSE 'internal' END, 'Person 1' FROM n`, id('account', 1));
  await images(session, issues * 3, issues, 'image', 'issue');
  await run('INSERT INTO sessions (id, event_id, name) VALUES (?, ?, ?)', other, id('event', 1), 'Other session');
  await run("INSERT INTO teams (id, session_id, name, location) VALUES (?, ?, 'Other', 'x')", id('otherTeam', 1), other);
  await run(`${series(50)} INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at)
    SELECT ${sqlId('otherIssue', 'i')}, ?, ?, 'open', i, ?, 'Person', 'Devices', 'Other issue ' || i, ${now} FROM n`,
  other, id('otherTeam', 1), id('account', 2));
  await images(other, 1500, 50, 'otherImage', 'otherIssue');
  await run(`${series(accounts)} INSERT INTO account_avatars (id, account_id, request_id, byte_size, content_type, digest, state, ready_at)
    SELECT ${sqlId('avatar', 'i')}, ${sqlId('account', 'i')}, 'avatar-' || i, 1000, 'image/png', printf('%064d', i), 'ready', ${now} FROM n`);
  await run(`${series(20)} INSERT INTO announcements (id, session_id, title, details, author, author_name)
    SELECT ${sqlId('announcement', 'i')}, CASE WHEN i <= 10 THEN ? ELSE ? END, 'Notice ' || i, 'Details ' || i, ?, 'Person 1' FROM n`,
  session, other, id('account', 1));
  await run(`${series(20)} INSERT INTO announcement_images (id, session_id, announcement_id, uploader, uploader_name, request_id,
      request_command, name, declared_bytes, byte_size, content_type, digest, object_key, state, uploaded_at)
    SELECT ${sqlId('announcementImage', 'i')}, ?, ${sqlId('announcement', '1 + i % 10')}, ?, 'Person 1', 'notice-' || i,
      '{}', 'a.png', 1000, 1000, 'image/png', printf('%064d', i), 'notices/' || i, 'ready', ${now} FROM n`,
  session, id('account', 1));
  for (const n of Object.values(roles)) {
    await run(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (?, ?, 'credential', ?, ?, ${now}, ${now})`, id('credential', n), id('account', n), id('account', n), hash);
  }
}

function summary(entries) {
  const sum = (key) => entries.reduce((total, entry) => total + entry[key], 0);
  return { calls: new Set(entries.map((entry) => `${entry.source}:${entry.call}`)).size,
    statements: entries.length, rowsRead: sum('rowsRead'), rowsWritten: sum('rowsWritten') };
}

async function measureShape(name, shape) {
  const platform = await openStoreDatabase({ configPath, remoteBindings: false }, {});
  const raw = platform.db;
  try {
    await applyMigrations(raw);
    await seed(raw, shape, await lib.passwordHasher.hash(password));
    const log = [];
    const clock = { phase: 'request' };
    const metricLines = [];
    const metrics = lib.measureD1(raw, (line) => metricLines.push(line));
    const coordinators = new Map();
    const coordinatorDb = meter(raw, 'coordinator', log, clock);
    const coordinator = (sessionId) => {
      if (!coordinators.has(sessionId)) {
        const state = new FakeState();
        coordinators.set(sessionId, { state, object: new lib.SessionLiveCoordinator(state, { DB: coordinatorDb }) });
      }
      return coordinators.get(sessionId);
    };
    const env = {
      DB: meter(metrics.db, 'worker', log, clock), AUTH_ORIGIN: origin, AUTH_SECRET: 'r'.repeat(64),
      IMAGES: { get: async () => null, put: async () => null, delete: async () => {} },
      ASSETS: { fetch: async () => new NativeResponse(null, { status: 404 }) },
      LIVE_UPDATES: { idFromName: (value) => value, get: (value) => ({ fetch: (request) => coordinator(value).object.fetch(request) }) },
    };
    const session = id('session', 1);
    const records = [];
    const direct = {};
    /** The same snapshot statement read without the meter, for comparison with the measured request. */
    const directSnapshot = async (login) => {
      const current = await raw.prepare('SELECT id FROM logins WHERE account_id = ? ORDER BY rowid DESC LIMIT 1').bind(login.account).first();
      const caller = { accountId: login.account, loginId: current.id };
      const result = await raw.prepare(lib.snapshotSql).bind(caller.accountId, caller.loginId,
        ...lib.currentAccessBindings(caller, session), ...Array(9).fill(session)).all();
      return result.meta.rows_read;
    };
    const undelivered = async () => (await raw.prepare('SELECT count(*) AS n FROM notifications WHERE delivered = 0').first()).n;

    /** Measures the work until `operation` returns, then the waitUntil work after it. */
    async function measure(path, caller, operation) {
      const start = log.length;
      const pending = [];
      clock.phase = 'request';
      const value = await operation({ waitUntil: (promise) => pending.push(promise) });
      clock.phase = 'after';
      await Promise.all(pending);
      clock.phase = 'request';
      const entries = log.slice(start);
      if (entries.some((entry) => Number.isNaN(entry.rowsRead))) throw new Error(`${path}: a statement returned no meta.`);
      const later = (entry) => entry.phase === 'after' || entry.sql === lib.claimSql;
      const record = { path, caller, request: summary(entries.filter((entry) => !later(entry))),
        dispatch: summary(entries.filter(later)), statements: entries.map(({ source, sql, rowsRead, rowsWritten }) =>
          ({ source, label: label(sql), rowsRead, rowsWritten })) };
      record.total = summary(entries);
      records.push(record);
      entriesByRecord.set(record, entries);
      return value;
    }

    async function http(path, caller, { name = path, method = 'GET', login, body, upgrade } = {}) {
      const headers = new globalThis.Headers({ Origin: origin });
      if (login) headers.set('Cookie', login.cookie);
      if (upgrade) headers.set('Upgrade', 'websocket');
      if (method === 'POST') {
        headers.set('Content-Type', 'application/json');
        headers.set('X-Minsky-Request', '1');
        headers.set('CF-Connecting-IP', '192.0.2.7');
        if (login) headers.set('X-CSRF-Token', login.csrf);
      }
      return measure(name, caller, async (context) => {
        const response = await lib.worker.fetch(new globalThis.Request(`${origin}${path}`,
          { method, headers, body: body && JSON.stringify(body) }), env, context);
        const result = { response, body: response.webSocket ? null : await response.json() };
        // The Response stub reports an accepted WebSocket as 200.
        if (response.status !== 200) throw new Error(`${path} as ${caller}: HTTP ${response.status} ${JSON.stringify(result.body)}`);
        return result;
      });
    }

    const logins = {};
    for (const [caller, n] of Object.entries(roles)) {
      const { response } = await http('/api/auth/sign-in', `${caller}${Object.keys(logins).length ? '' : ' (cold)'}`, {
        method: 'POST', body: { username: `user${n}`, password } });
      logins[caller] = { cookie: response.headers.get('set-cookie').split(';')[0], account: id('account', n) };
    }
    const drained = await lib.dispatchNotifications({ DB: raw, LIVE_UPDATES: env.LIVE_UPDATES });
    if (drained.failed || await undelivered()) throw new Error('Seed notifications did not drain.');

    for (let repeat = 1; repeat <= options.repeats; repeat++) {
      for (const [caller, login] of Object.entries(logins)) {
        const current = await http('/api/auth/session', caller, { login });
        login.csrf = current.body.csrf;
        await http('/api/sessions', caller, { login });
        const snapshot = await http(`/api/snapshot?sessionId=${session}`, caller, { login });
        if (!snapshot.body.membership) throw new Error('The snapshot has no membership.');
        login.snapshot = snapshot.body;
        if (repeat === 1 && ['contestant', 'admin'].includes(caller)) direct[caller] = await directSnapshot(login);
        await http(`/api/announcements?sessionId=${session}`, caller, { login });
        const avatars = await http(`/api/avatars?sessionId=${session}`, caller, { login });
        if (!avatars.body.length) throw new Error('The avatar list is empty.');
        const socket = await http(`/api/updates?sessionId=${session}`, caller, { login, upgrade: true });
        if (!socket.response.webSocket) throw new Error('The live connection was not accepted.');
        // Keep one socket for each caller, so dispatch checks the same four grants in every run.
        if (repeat > 1) coordinator(session).state.sockets.at(-1).close();
      }
    }
    checkVisibility(logins, shape);

    const revision = async (issueId) => (await raw.prepare('SELECT public_revision AS r FROM issues WHERE id = ?').bind(issueId).first()).r;
    const command = async (name, caller, value) => {
      const result = await http('/api/workflow', caller, { name, method: 'POST', login: logins[caller],
        body: { sessionId: session, requestId: globalThis.crypto.randomUUID(), command: value } });
      if (result.body.outcome !== 'committed' || !result.body.snapshot) throw new Error(`${name}: ${JSON.stringify(result.body)}`);
      if (await undelivered()) throw new Error(`${name}: notifications stayed undelivered.`);
      return result.body.issueId;
    };
    const live = coordinator(session);
    const contestantSocket = live.state.getWebSockets().find((socket) => socket.deserializeAttachment().accountId === logins.contestant.account);
    const hints = () => contestantSocket.messages.filter((message) => JSON.parse(message).type === 'change').length;
    const issue = await command('workflow submit', 'contestant', { type: 'submit', category: 'Devices', description: 'Read volume probe' });
    await command('workflow claim', 'volunteer', { type: 'claim', issue_id: issue, revision: await revision(issue) });
    const beforeReply = hints();
    await command('workflow message public', 'volunteer', { type: 'message', issue_id: issue, revision: await revision(issue), text: 'Public reply', visibility: 'public' });
    const afterReply = hints();
    await command('workflow message internal', 'volunteer', { type: 'message', issue_id: issue, revision: await revision(issue), text: 'Internal note', visibility: 'internal' });
    // Did the dispatch happen, and to the right audience? The team hears the reply, not the note.
    if (afterReply !== beforeReply + 1 || hints() !== afterReply) throw new Error('The team socket received the wrong change hints.');
    await command('workflow resolve', 'volunteer', { type: 'resolve', issue_id: issue, revision: await revision(issue), summary: 'Fixed' });
    await command('workflow award', 'jury', { type: 'award', issue_id: issue, revision: await revision(issue), minutes: 5, explanation: 'Delay' });
    await measure('live alarm (4 sockets)', 'coordinator', () => live.object.alarm());
    await measure('cron tick', 'scheduler', () => lib.worker.scheduled({}, env));

    // Every seeded member also connected: the dispatch rechecks each socket's grant.
    for (let n = 1; n <= shape.accounts; n++) {
      if (Object.values(roles).includes(n)) continue;
      const socket = new FakeSocket();
      socket.serializeAttachment({ accountId: id('account', n), loginId: id('login', n), sessionId: session, expiresAt: Date.now() + 3_600_000 });
      live.state.acceptWebSocket(socket);
    }
    const open = id('issue', 1);
    await command('workflow message public (all members connected)', 'volunteer', { type: 'message', issue_id: open, revision: await revision(open), text: 'Reply', visibility: 'public' });
    await measure('live alarm (all members connected)', 'coordinator', () => live.object.alarm());
    if (live.state.getWebSockets().length !== shape.accounts) throw new Error('A connected socket lost its grant.');

    const validation = validate({ metrics, metricLines, log, records, direct });
    const plans = options.explain && name === 'base' ? await explainAll(raw, records) : [];
    return { records, validation, plans };
  } finally {
    await platform.dispose();
  }
}

const entriesByRecord = new WeakMap();

function checkVisibility(logins, shape) {
  const contestant = logins.contestant.snapshot;
  const teamIssues = Math.floor((shape.issues - ((roles.contestant % shape.teams) || shape.teams) + shape.teams) / shape.teams);
  if (contestant.members.length || contestant.history.some((row) => row.visibility === 'internal')) {
    throw new Error('The contestant snapshot shows staff data.');
  }
  if (contestant.issues.length !== teamIssues) throw new Error(`The contestant sees ${contestant.issues.length} issues, expected ${teamIssues}.`);
  if (logins.admin.snapshot.members.length !== shape.accounts || logins.volunteer.snapshot.issues.length !== shape.issues) {
    throw new Error('A staff snapshot is incomplete.');
  }
}

/** Cross-checks the meter against measureD1 and against a direct snapshot read. */
function validate({ metrics, metricLines, log, records, direct }) {
  metrics.flush();
  const reported = JSON.parse(metricLines.at(-1).slice('MINSKY_D1_METRICS '.length));
  const worker = summary(log.filter((entry) => entry.source === 'worker'));
  const snapshot = Object.fromEntries(Object.entries(direct).map(([caller, rows]) => [caller, { direct: rows,
    measured: records.find((record) => record.path.startsWith('/api/snapshot') && record.caller === caller)
      .statements.find((statement) => statement.label === 'application snapshotSql').rowsRead }]));
  const valid = reported.calls === worker.calls && reported.statements === worker.statements &&
    Object.values(snapshot).every((row) => row.direct === row.measured);
  if (!valid) throw new Error(`The meter disagrees with measureD1 or a direct read: ${JSON.stringify({ reported, worker, snapshot })}`);
  return { measureD1: { calls: reported.calls, statements: reported.statements }, meter: { calls: worker.calls, statements: worker.statements }, snapshot };
}

function label(sql) {
  const known = [[lib.snapshotSql, 'application snapshotSql'], [lib.announcementSnapshotSql, 'announcements snapshotSql'],
    [lib.sessionsListSql, 'sessionsListSql'], [lib.currentAccessSql, 'currentAccessSql'],
    [lib.currentAccessForLoginsSql, 'currentAccessForLoginsSql'], [lib.claimSql, 'claimSql']];
  return known.find(([text]) => text === sql)?.[1] ?? sql.replace(/\s+/g, ' ').trim().slice(0, 110);
}

/** EXPLAIN QUERY PLAN with the exact bound values, for the identity checks and each statement that reads 10 rows or more. */
async function explainAll(raw, records) {
  const heaviest = new Map();
  const identity = new Set(records.filter((record) => record.path === '/api/auth/session')
    .flatMap((record) => entriesByRecord.get(record).map((entry) => entry.sql)));
  for (const record of records) {
    for (const entry of entriesByRecord.get(record) ?? []) {
      const known = heaviest.get(entry.sql);
      if (!known || entry.rowsRead > known.entry.rowsRead) heaviest.set(entry.sql, { record, entry });
    }
  }
  const plans = [];
  for (const { record, entry } of [...heaviest.values()].sort((left, right) => right.entry.rowsRead - left.entry.rowsRead)) {
    if (entry.rowsRead < 10 && !identity.has(entry.sql)) continue;
    const plan = await raw.prepare(`EXPLAIN QUERY PLAN ${entry.sql}`).bind(...entry.values).all();
    plans.push({ path: record.path, caller: record.caller, label: label(entry.sql), rowsRead: entry.rowsRead,
      plan: plan.results.map((row) => row.detail).filter((detail) => /^(?:SCAN|SEARCH|USE TEMP|BLOOM)/.test(detail)) });
  }
  return plans;
}

const refreshReads = ['/api/sessions', '/api/snapshot', '/api/announcements', '/api/avatars'];
const refreshName = 'screen refresh after a change hint';

/** A live hint makes each screen read these four endpoints (useSessionSnapshot, useAnnouncements, Avatars). */
function addRefresh(records) {
  for (const caller of Object.keys(roles)) {
    const parts = refreshReads.map((path) => records.find((record) => record.path.replace(/\?.*/, '') === path && record.caller === caller));
    const add = (part) => parts.reduce((total, record) => ({ calls: total.calls + record[part].calls,
      statements: total.statements + record[part].statements, rowsRead: total.rowsRead + record[part].rowsRead,
      rowsWritten: total.rowsWritten + record[part].rowsWritten }), summary([]));
    records.push({ ...parts[0], path: refreshName, derived: true, request: add('request'), dispatch: add('dispatch'),
      total: add('total'), statements: parts.flatMap((record) => record.statements) });
  }
}

const base = { accounts: 1200, teams: 24, issues: 100, historyPerIssue: 5 };
const plan = [
  ['base', base], ['base, second seed', base],
  ['accounts 300', { ...base, accounts: 300 }], ['accounts 4800', { ...base, accounts: 4800 }],
  ['issues 25', { ...base, issues: 25 }], ['issues 400', { ...base, issues: 400 }],
  ['history 20 per issue', { ...base, historyPerIssue: 20 }], ['history 80 per issue', { ...base, historyPerIssue: 80 }],
  ['teams 6', { ...base, teams: 6 }], ['teams 96', { ...base, teams: 96 }], ['teams 480', { ...base, teams: 480 }],
  ['proportional 300', { accounts: 300, teams: 24, issues: 25, historyPerIssue: 5 }],
  ['proportional 4800', { accounts: 4800, teams: 24, issues: 400, historyPerIssue: 5 }],
  ['proportional 300, teams scaled', { accounts: 300, teams: 6, issues: 25, historyPerIssue: 5 }],
  ['proportional 4800, teams scaled', { accounts: 4800, teams: 96, issues: 400, historyPerIssue: 5 }],
];
// Units: one account; one issue with its 5 history rows and 3 images; one history row; one team.
const axes = [
  ['account', ['accounts 300', 'base', 'accounts 4800'], (shape) => shape.accounts],
  ['issue', ['issues 25', 'base', 'issues 400'], (shape) => shape.issues],
  ['history row', ['base', 'history 20 per issue', 'history 80 per issue'], (shape) => shape.issues * shape.historyPerIssue],
  ['team', ['teams 6', 'base', 'teams 96'], (shape) => shape.teams],
];
const series = [['proportional', ['proportional 300', 'base', 'proportional 4800']],
  ['proportional, teams scaled', ['proportional 300, teams scaled', 'base', 'proportional 4800, teams scaled']]];

const results = [];
for (const [name, shape] of options.plan === 'base' ? plan.slice(0, 2) : plan) {
  const started = Date.now();
  const result = await measureShape(name, shape);
  addRefresh(result.records);
  results.push({ name, shape, ...result });
  console.error(`${name}: measured in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

const key = (record) => `${record.path.replace(/\?.*/, '')} | ${record.caller}`;
const groups = new Map();
const grouped = (name) => {
  if (groups.has(name)) return groups.get(name);
  const map = new Map();
  groups.set(name, map);
  for (const record of results.find((result) => result.name === name).records) {
    map.set(key(record), [...(map.get(key(record)) ?? []), record]);
  }
  return map;
};
const rowsAt = (config, name) => grouped(config).get(name)?.[0].total.rowsRead;
const shapeOf = (config) => results.find((result) => result.name === config).shape;
const signature = (record) => JSON.stringify([record.request, record.dispatch, record.statements]);
const number = (value) => value.toLocaleString('en-US');

/** Rows read for each added unit between the end points. `bent` marks a middle point more than 5% off the line. */
function slope(name, configs, unit) {
  const [x0, x1, x2] = configs.map((config) => unit(shapeOf(config)));
  const [y0, y1, y2] = configs.map((config) => rowsAt(config, name));
  const rate = (y2 - y0) / (x2 - x0);
  const expected = y0 + rate * (x1 - x0);
  return { rate, bent: Math.abs(y1 - expected) > Math.max(5, 0.05 * expected) };
}

const baseRows = grouped('base');
const second = grouped('base, second seed');
const ranked = [...baseRows].sort(([, left], [, right]) => right[0].total.rowsRead - left[0].total.rowsRead);
console.log('## Rows at the base shape\n');
console.log('Base: 1,200 accounts, 24 teams, 100 issues, 500 history rows, 300 images. "Repeats" compares the in-run repeats and the second seed.');
console.log(`"${refreshName}" is the sum of ${refreshReads.join(', ')}.\n`);
console.log('| Endpoint | Caller | Calls | Statements | Rows read | Rows written | Dispatch calls | Dispatch rows read | Dispatch rows written | Repeats |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [name, [first, ...rest]] of ranked) {
  const others = [...rest, ...(second.get(name) ?? [])];
  const same = others.every((record) => signature(record) === signature(first));
  const { request: r, dispatch: d } = first;
  const repeats = first.derived ? 'derived' : `${others.length} ${same ? 'identical' : 'DIFFERENT'}`;
  console.log(`| ${name} | ${r.calls} | ${r.statements} | ${number(r.rowsRead)} | ${number(r.rowsWritten)} | ${d.calls} | ${number(d.rowsRead)} | ${number(d.rowsWritten)} | ${repeats} |`);
}

if (options.plan === 'full') {
  console.log('\n## Growth of rows read\n');
  console.log('Each "per" column is the added rows read, request and dispatch, for one added unit with the other sizes at the base shape.');
  console.log('An issue brings its 5 history rows and 3 images. A star marks a middle point more than 5% off a straight line.');
  console.log('The last columns hold total rows read at 300, 1,200 and 4,800 accounts with issues in proportion, and at 480 teams.\n');
  console.log(`| Endpoint | Caller | Base | ${axes.map(([unit]) => `Per ${unit}`).join(' | ')} | Verdict | ${series.map(([title]) => title).join(' | ')} | 480 teams |`);
  console.log(`| --- | --- | --- | ${axes.map(() => '---').join(' | ')} | --- | ${series.map(() => '---').join(' | ')} | --- |`);
  for (const [name, [first]] of ranked) {
    const slopes = axes.map(([unit, configs, measure]) => ({ unit, ...slope(name, configs, measure) }));
    const growing = slopes.filter(({ rate }) => Math.abs(rate) >= 0.05)
      .map(({ unit, rate }) => `${rate < 0 ? 'falls' : 'grows'} with ${unit}s`);
    const cells = slopes.map(({ rate, bent }) => `${rate.toFixed(2)}${bent ? '*' : ''}`);
    const curves = series.map(([, configs]) => configs.map((config) => number(rowsAt(config, name))).join(' / '));
    console.log(`| ${name} | ${number(first.total.rowsRead)} | ${cells.join(' | ')} | ${growing.join(', ') || 'flat'} | ${curves.join(' | ')} | ${number(rowsAt('teams 480', name))} |`);
  }
}

console.log('\n## Heaviest statements at the base shape\n');
for (const [name, [first]] of ranked.filter(([, [record]]) => !record.derived).slice(0, 14)) {
  console.log(`- ${name}`);
  const byLabel = new Map();
  for (const statement of first.statements) {
    const text = `${statement.source}: \`${statement.label}\``;
    const known = byLabel.get(text) ?? { count: 0, rowsRead: 0, rowsWritten: 0 };
    byLabel.set(text, { count: known.count + 1, rowsRead: known.rowsRead + statement.rowsRead,
      rowsWritten: known.rowsWritten + statement.rowsWritten });
  }
  for (const [text, value] of [...byLabel].sort(([, left], [, right]) => right.rowsRead - left.rowsRead).slice(0, 4)) {
    console.log(`  - ${number(value.rowsRead)} read, ${value.rowsWritten} written, ${value.count} statement${value.count > 1 ? 's' : ''}, ${text}`);
  }
}

const baseResult = results.find((result) => result.name === 'base');
console.log('\n## Meter checks\n');
console.log(`- measureD1 counted ${baseResult.validation.measureD1.calls} calls and ${baseResult.validation.measureD1.statements} statements in the Worker. This meter counted ${baseResult.validation.meter.calls} and ${baseResult.validation.meter.statements}.`);
for (const [caller, row] of Object.entries(baseResult.validation.snapshot)) {
  console.log(`- ${caller} snapshot: a direct all() read ${row.direct} rows. The meter recorded ${row.measured}.`);
}
if (options.explain) {
  console.log('\n## Query plans at the base shape\n');
  for (const entry of baseResult.plans) {
    console.log(`- ${entry.path.replace(/\?.*/, '')} | ${entry.caller}: \`${entry.label}\`, ${number(entry.rowsRead)} rows read`);
    for (const detail of entry.plan) console.log(`  - \`${detail}\``);
  }
}
if (options.out) {
  await writeFile(options.out, JSON.stringify(results.map(({ name, shape, records, validation, plans }) =>
    ({ name, shape, records, validation, plans })), null, 1));
  console.error(`Wrote ${options.out}`);
}
