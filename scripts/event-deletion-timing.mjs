import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from '../src/server/adapters/cloudflare/tooling/configuration.mjs';
import { enforceWranglerEnvironment, safeWranglerEnvironment } from '../src/server/adapters/cloudflare/tooling/safe-environment.mjs';

const usage = `Usage: node scripts/event-deletion-timing.mjs [--issues=2000] [--history=80000] [--remote --database=<name>]

Seeds event A and an equally large neighbor event B. It then runs the real fence
and rows step on A through an instrumented connection. It prints the wall time,
the server-side duration, rows read and written, the statement count, and the
slowest statement and the largest write, for each part of the deletion. It checks that A is gone and
that B is intact, and it removes its own data at the end.

The neighbor matters. Without B, a missing index costs nothing, because nothing
else remains to scan. It runs on a temporary local database by default. With
--remote, it uses Wrangler's credentials and refuses any database whose name does
not start with minsky-preview.`;

const options = { issues: 2000, history: 80_000, remote: false, database: '' };
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const argument = argv[index] ?? '';
  // Both `--database=<name>` and `--database <name>` name the database.
  if (argument === '--database' && argv[index + 1]) {
    options.database = argv[index + 1] ?? '';
    index += 1;
    continue;
  }
  const [key, value] = argument.replace(/^--/, '').split('=');
  if (key === 'issues' && /^[1-9]\d*$/.test(value ?? '')) options.issues = Number(value);
  else if (key === 'history' && /^\d+$/.test(value ?? '')) options.history = Number(value);
  else if (key === 'remote' && value === undefined) options.remote = true;
  else if (key === 'database' && value) options.database = value;
  else { console.error(usage); process.exit(1); }
}
if (options.remote && !options.database.startsWith('minsky-preview')) {
  console.error('A hosted run needs --database=<name>, and the name must start with minsky-preview.');
  process.exit(1);
}
if (!options.remote) {
  // Local D1 only. A credential in the shell must not reach Wrangler.
  for (const key of Object.keys(process.env)) {
    if (/^(?:CLOUDFLARE_|MINSKY_CONNECTOR_|MINSKY_AUTH_REMOTE)/.test(key)) delete process.env[key];
  }
}
enforceWranglerEnvironment();
const { openStoreDatabase } = await import('../src/server/adapters/cloudflare/tooling/store-database.mjs');
const { getPlatformProxy, unstable_splitSqlQuery: splitSqlQuery } = await import('wrangler');

async function loadDeletion() {
  const { build } = await import('esbuild');
  const scratch = resolve(repositoryRoot, '.wrangler');
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(scratch, 'deletion-timing-'));
  const outfile = join(directory, 'module.mjs');
  try {
    await build({
      stdin: { resolveDir: repositoryRoot, loader: 'ts', contents: `
        export { advanceRows, fenceStatements } from './src/server/adapters/cloudflare/eventDeletion.ts';
        export { forgetFixtureEvent, removeFixtureEvent } from './src/server/adapters/cloudflare/eventDeletionFixture.ts';` },
      outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const deletion = await loadDeletion();

/** The same steps as applyMigrations in testFixture.ts, whose folder lookup does not survive bundling. */
async function applyMigrations(db) {
  const folder = resolve(repositoryRoot, 'src/server/adapters/d1/migrations');
  for (const name of (await readdir(folder)).filter((file) => file.endsWith('.sql')).sort()) {
    await db.batch(splitSqlQuery(await readFile(join(folder, name), 'utf8')).map((sql) => db.prepare(sql)));
  }
}

/** Runs each call on the real database and records what the server reports for each statement. */
function metered(db, log) {
  const parts = new WeakMap();
  const note = (sql, meta, calls) => {
    log.statements.push({ sql, duration: meta?.duration ?? 0, rowsRead: meta?.rows_read ?? 0, rowsWritten: meta?.rows_written ?? 0 });
    log.calls += calls;
  };
  const wrap = (inner, sql) => {
    const once = async (execute) => {
      const started = performance.now();
      try {
        const result = await execute();
        log.wall += performance.now() - started;
        note(sql, result.meta, 1);
        return result;
      } catch (error) {
        log.errors += 1;
        throw error;
      }
    };
    const wrapped = {
      bind: (...values) => wrap(inner.bind(...values), sql),
      // first() returns no metadata, so run it as all().
      first: async () => (await once(() => inner.all())).results?.[0] ?? null,
      all: () => once(() => inner.all()),
      run: () => once(() => inner.run()),
    };
    parts.set(wrapped, { inner, sql });
    return wrapped;
  };
  return {
    prepare: (sql) => wrap(db.prepare(sql), sql),
    batch: async (statements) => {
      const items = statements.map((statement) => parts.get(statement));
      const started = performance.now();
      try {
        const results = await db.batch(items.map(({ inner }) => inner));
        log.wall += performance.now() - started;
        results.forEach((result, index) => note(items[index].sql, result.meta, index === 0 ? 1 : 0));
        return results;
      } catch (error) {
        log.errors += 1;
        throw error;
      }
    },
  };
}

const newLog = () => ({ statements: [], calls: 0, wall: 0, errors: 0 });

const STAFF = 100;
const CONTESTANTS = 300;
const CONTESTS = 4;
const CHUNK = 5000;
const AUDIT_PER_ACCOUNT = 5;
const RECEIPTS_OF_THE_NEIGHBOR = 20_000;
const RECEIPTS_OF_THE_EVENT = 1000;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Writes one event with `WITH RECURSIVE`, one bounded statement at a time. */
async function seedEvent(db, run, tag) {
  const event = `${run}-${tag}`;
  const series = (from, to) => `WITH RECURSIVE n(i) AS (SELECT ${from} UNION ALL SELECT i + 1 FROM n WHERE i < ${to})`;
  const exec = (sql, ...values) => db.prepare(sql).bind(...values).run();
  const accounts = STAFF + CONTESTANTS;
  const id = (kind, width = 5) => `printf('%s-${kind}-%0${width}d', '${event}', i)`;
  const handle = `printf('t${run.slice(-6)}${tag}%05d', i)`;
  await exec('INSERT INTO events (id, name, code) VALUES (?, ?, ?)', event, `Timing ${event}`, `t-${run.slice(-8)}-${tag}`);
  await exec(`${series(1, CONTESTS)} INSERT INTO sessions (id, event_id, name) SELECT ${id('contest')}, ?, 'Contest ' || i FROM n`, event);
  await exec(`${series(1, CONTESTANTS)} INSERT INTO entrants (id, event_id, kind, name) SELECT ${id('entrant')}, ?, 'team', 'Team ' || i FROM n`, event);
  await exec(`${series(1, accounts)} INSERT INTO accounts (id, name, username, handle, event_id, must_change, entrant_id)
    SELECT ${id('account')}, 'Person ' || i, ${handle}, ${handle}, ?, 0,
      CASE WHEN i > ${STAFF} THEN printf('%s-entrant-%05d', '${event}', i - ${STAFF}) END FROM n`, event);
  await exec(`${series(1, accounts)} INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
    SELECT ${id('account')}, 'Person ' || i, ${id('account')} || '@timing.invalid', 1, ${NOW}, ${NOW}, ${handle} FROM n`);
  await exec(`${series(1, accounts)} INSERT INTO ba_session (id, expiresAt, token, createdAt, updatedAt, userId)
    SELECT ${id('login')}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day'), ${id('login')}, ${NOW}, ${NOW}, ${id('account')} FROM n`);
  await exec(`${series(1, accounts)} INSERT INTO logins (id, account_id, expires_at, identity_session_id)
    SELECT ${id('login')}, ${id('account')}, unixepoch() + 86400, ${id('login')} FROM n`);
  // Each entry seats its entrant's sign-in through a trigger, as the Worker's assignment does.
  for (let contest = 1; contest <= CONTESTS; contest += 1) {
    const session = `${event}-contest-${String(contest).padStart(5, '0')}`;
    await exec(`${series(1, CONTESTANTS)} INSERT INTO teams (id, session_id, name, location, entrant_id)
      SELECT printf('%s-team-%d-%05d', '${event}', ${contest}, i), ?, 'Team ' || i, 'Desk ' || i, ${id('entrant')} FROM n`, session);
    await exec(`${series(1, STAFF)} INSERT INTO memberships (session_id, account_id, is_admin) SELECT ?, ${id('account')}, i % 20 = 0 FROM n`, session);
    await exec(`${series(1, STAFF)} INSERT INTO membership_roles (session_id, account_id, role)
      SELECT ?, ${id('account')}, CASE i % 3 WHEN 0 THEN 'volunteer' WHEN 1 THEN 'jury' ELSE 'specialist' END FROM n`, session);
  }
  const issues = options.issues;
  const contestOf = (i) => `printf('%s-contest-%05d', '${event}', 1 + (${i}) % ${CONTESTS})`;
  const teamOf = (i) => `printf('%s-team-%d-%05d', '${event}', 1 + (${i}) % ${CONTESTS}, 1 + (${i}) % ${CONTESTANTS})`;
  const reporter = (i) => `printf('%s-account-%05d', '${event}', ${STAFF} + 1 + (${i}) % ${CONTESTANTS})`;
  const staff = (i) => `printf('%s-account-%05d', '${event}', 1 + (${i}) % ${STAFF})`;
  for (let from = 1; from <= issues; from += CHUNK) {
    const to = Math.min(issues, from + CHUNK - 1);
    await exec(`${series(from, to)} INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at, owner, owner_name)
      SELECT ${id('issue')}, ${contestOf('i')}, ${teamOf('i')}, CASE WHEN i % 2 = 0 THEN 'claimed' ELSE 'open' END, i, ${reporter('i')}, 'Team', 'Devices', 'Timing issue ' || i, ${NOW},
        CASE WHEN i % 2 = 0 THEN ${staff('i')} END, CASE WHEN i % 2 = 0 THEN 'Staff' END FROM n`);
    await exec(`${series(from, to)} INSERT INTO command_receipts (actor, request_id, session_id, command, issue_id)
      SELECT ${reporter('i')}, ${id('receipt')}, ${contestOf('i')}, '{}', ${id('issue')} FROM n`);
  }
  for (let from = 1; from <= options.history; from += CHUNK) {
    const to = Math.min(options.history, from + CHUNK - 1);
    await exec(`${series(from, to)} INSERT INTO history (id, issue_id, actor, actor_name, at, text, visibility)
      SELECT ${id('history', 6)}, printf('%s-issue-%05d', '${event}', 1 + i % ${issues}), ${staff('i')}, 'Staff', ${NOW}, 'Timing history ' || i,
        CASE WHEN i % 4 = 0 THEN 'internal' ELSE 'public' END FROM n`);
  }
  // store.ts queues one staff row for each action, and one more for the team when the action is public.
  // Delivery keeps each row, and nothing deletes it, so 80,000 history rows imply 140,000 outbox rows.
  const historyIssue = `(1 + i % ${issues})`;
  for (let contest = 1; contest <= CONTESTS; contest += 1) {
    const session = `${event}-contest-${String(contest).padStart(5, '0')}`;
    await exec(`INSERT INTO audience_sequences (session_id, audience, sequence) VALUES (?, 'staff', ?)`, session, options.history);
    await exec(`${series(1, CONTESTANTS)} INSERT INTO audience_sequences (session_id, audience, sequence)
      SELECT ?, printf('team:%s-team-%d-%05d', '${event}', ${contest}, i), ? FROM n`, session, options.history);
  }
  for (let from = 1; from <= options.history; from += CHUNK) {
    const to = Math.min(options.history, from + CHUNK - 1);
    await exec(`${series(from, to)} INSERT INTO notifications (id, session_id, audience, sequence, delivered)
      SELECT ${id('outbox-staff', 6)}, ${contestOf(historyIssue)}, 'staff', i, 1 FROM n`);
    await exec(`${series(from, to)} INSERT INTO notifications (id, session_id, audience, sequence, delivered)
      SELECT ${id('outbox-team', 6)}, ${contestOf(historyIssue)}, 'team:' || ${teamOf(historyIssue)}, i, 1 FROM n WHERE i % 4 <> 0`);
  }
  // Each contest admin action and each credential operation in a contest writes one audit row, and nothing deletes it.
  const audit = accounts * AUDIT_PER_ACCOUNT;
  for (let from = 1; from <= audit; from += CHUNK) {
    const to = Math.min(audit, from + CHUNK - 1);
    await exec(`${series(from, to)} INSERT INTO admin_audit (id, session_id, actor, action, target)
      SELECT ${id('audit', 6)}, ${contestOf('i')}, ${staff('i')}, 'save_member', ${staff('i + 1')} FROM n`);
  }
  const resolved = Math.floor(issues / 2);
  const awarded = Math.floor(issues / 10);
  for (let from = 1; from <= resolved; from += CHUNK) {
    const to = Math.min(resolved, from + CHUNK - 1);
    await exec(`${series(from, to)} INSERT INTO resolutions (id, session_id, issue_id, actor, actor_name, at, summary)
      SELECT ${id('resolution')}, ${contestOf('i')}, ${id('issue')}, ${staff('i')}, 'Staff', ${NOW}, 'Resolved' FROM n`);
  }
  for (let from = 1; from <= awarded; from += CHUNK) {
    const to = Math.min(awarded, from + CHUNK - 1);
    await exec(`${series(from, to)} INSERT INTO awards (id, session_id, issue_id, resolution_id, minutes, explanation, actor, actor_name, at)
      SELECT ${id('award')}, ${contestOf('i')}, ${id('issue')}, ${id('resolution')}, 5, 'Lost time', ${staff('i')}, 'Staff', ${NOW} FROM n`);
  }
  return event;
}

/**
 * The rows step reads every site receipt once. So B holds receipts of its own, and receipts that name A,
 * as a webmaster's would. An account of B writes those, so that removing B also removes them.
 */
async function seedReceipts(db, run, eventA, eventB) {
  const actor = `${eventB}-account-00001`;
  const write = (count, tag, event) => db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})
    INSERT INTO manage_receipts (actor, request_id, command, result)
    SELECT ?, printf('${run}-${tag}-%05d', i), json_object('type', 'create_people', 'eventId', ?, 'people',
      json_array(json_object('handle', printf('p%05d', i), 'name', printf('Fictional person %05d', i)))), '{}' FROM n`).bind(actor, event).run();
  await write(RECEIPTS_OF_THE_NEIGHBOR, 'neighbor', eventB);
  await write(RECEIPTS_OF_THE_EVENT, 'event', eventA);
}

/** Rows of one event, per table. Each query starts from the event, so it never reads the neighbor, except for the receipts. */
function countQueries(event) {
  const contests = `(SELECT id FROM sessions WHERE event_id = '${event}')`;
  const logged = `(SELECT id FROM accounts WHERE event_id = '${event}')`;
  const issues = `(SELECT id FROM issues WHERE session_id IN ${contests})`;
  return {
    events: `SELECT count(*) AS n FROM events WHERE id = '${event}'`,
    sessions: `SELECT count(*) AS n FROM sessions WHERE event_id = '${event}'`,
    entrants: `SELECT count(*) AS n FROM entrants WHERE event_id = '${event}'`,
    accounts: `SELECT count(*) AS n FROM accounts WHERE event_id = '${event}'`,
    logins: `SELECT count(*) AS n FROM logins WHERE account_id IN ${logged}`,
    ba_user: `SELECT count(*) AS n FROM ba_user WHERE id LIKE '${event}-%'`,
    teams: `SELECT count(*) AS n FROM teams WHERE session_id IN ${contests}`,
    memberships: `SELECT count(*) AS n FROM memberships WHERE session_id IN ${contests}`,
    issues: `SELECT count(*) AS n FROM issues WHERE session_id IN ${contests}`,
    history: `SELECT count(*) AS n, total(length(text)) AS size FROM history WHERE issue_id IN ${issues}`,
    resolutions: `SELECT count(*) AS n FROM resolutions WHERE session_id IN ${contests}`,
    awards: `SELECT count(*) AS n FROM awards WHERE session_id IN ${contests}`,
    command_receipts: `SELECT count(*) AS n FROM command_receipts WHERE session_id IN ${contests}`,
    notifications: `SELECT count(*) AS n FROM notifications WHERE session_id IN ${contests}`,
    admin_audit: `SELECT count(*) AS n FROM admin_audit WHERE session_id IN ${contests}`,
    manage_receipts: `SELECT count(*) AS n FROM manage_receipts WHERE instr(command, '${event}') > 0`,
  };
}

async function counts(db, event) {
  const queries = countQueries(event);
  const results = await db.batch(Object.values(queries).map((sql) => db.prepare(sql)));
  return Object.fromEntries(Object.keys(queries).map((table, index) => [table, results[index].results[0]]));
}

function summary(name, log) {
  const sum = (field) => log.statements.reduce((total, entry) => total + entry[field], 0);
  const largest = log.statements.reduce((top, entry) => (entry.duration > (top?.duration ?? -1) ? entry : top), undefined);
  const heaviest = log.statements.reduce((top, entry) => (entry.rowsWritten > (top?.rowsWritten ?? -1) ? entry : top), undefined);
  return {
    part: name, calls: log.calls, statements: log.statements.length, wallMs: Math.round(log.wall),
    serverMsSum: Math.round(sum('duration')), serverMsMax: Math.round((largest?.duration ?? 0) * 10) / 10,
    rowsRead: sum('rowsRead'), rowsWritten: sum('rowsWritten'), writtenMax: heaviest?.rowsWritten ?? 0, errors: log.errors,
    heaviest: (heaviest?.sql ?? '').replace(/\s+/g, ' ').slice(0, 40),
    largest: (largest?.sql ?? '').replace(/\s+/g, ' ').slice(0, 40),
  };
}

async function openDatabase() {
  if (!options.remote) {
    const configPath = 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';
    const platform = await openStoreDatabase({ configPath, remoteBindings: false }, {});
    await applyMigrations(platform.db);
    return platform;
  }
  const info = spawnSync(process.execPath, [resolve(repositoryRoot, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'info', options.database, '--json'],
    { encoding: 'utf8', env: safeWranglerEnvironment(), maxBuffer: 1024 * 1024 });
  const databaseId = info.status === 0 ? JSON.parse(info.stdout).uuid : undefined;
  if (!databaseId) throw new Error(`Wrangler could not read the database ${options.database}.`);
  const directory = await mkdtemp(join(tmpdir(), 'minsky-deletion-timing-'));
  const configPath = join(directory, 'wrangler.json');
  await writeFile(configPath, JSON.stringify({
    name: 'minsky-deletion-timing', compatibility_date: '2026-10-13',
    d1_databases: [{ binding: 'DB', database_name: options.database, database_id: databaseId, remote: true }],
  }), { mode: 0o600 });
  const platform = await getPlatformProxy({ configPath, remoteBindings: true, persist: false, envFiles: [] });
  return { db: platform.env.DB, dispose: async () => { await platform.dispose(); await rm(directory, { recursive: true, force: true }); } };
}

const platform = await openDatabase();
const { db } = platform;
const run = `tm${randomUUID().slice(0, 12)}`;
let failed = false;
try {
  const seedStart = performance.now();
  const seeding = newLog();
  const seedDb = metered(db, seeding);
  const eventA = await seedEvent(seedDb, run, 'a');
  const eventB = await seedEvent(seedDb, run, 'b');
  await seedReceipts(seedDb, run, eventA, eventB);
  console.log(`Seeded two events: ${options.issues} issues and ${options.history} history rows each, in ${Math.round(performance.now() - seedStart)} ms.`);

  const beforeB = await counts(db, eventB);
  const beforeA = await counts(db, eventA);
  console.log(`Event A before: ${JSON.stringify(beforeA)}`);

  const parts = [];
  const fenceLog = newLog();
  const started = performance.now();
  const fenceDb = metered(db, fenceLog);
  await fenceDb.batch(deletion.fenceStatements(fenceDb, { id: 'timing', name: 'Deletion timing' }, eventA, `Timing ${eventA}`, randomUUID()));
  parts.push(summary('fence', fenceLog));
  const contestLog = newLog();
  const accountLog = newLog();
  const eventLog = newLog();
  let work = 0;
  const stage = async () => {
    const row = await db.prepare(`SELECT
      (SELECT count(*) FROM event_deletion_targets WHERE event_id = ?1 AND kind = 'contest' AND done = 0) AS contests,
      (SELECT count(*) FROM event_deletion_targets WHERE event_id = ?1 AND kind = 'account' AND done = 0) AS accounts`).bind(eventA).first();
    if (row.contests > 0) return contestLog;
    return row.accounts > 0 ? accountLog : eventLog;
  };
  for (;;) {
    const progress = await deletion.advanceRows(metered(db, await stage()), eventA);
    work += 1;
    if (progress === 'rows_done') break;
    if (progress === 'blocked') throw new Error('Event A is blocked.');
  }
  const total = Math.round(performance.now() - started);
  parts.push(summary('contests', contestLog), summary('accounts', accountLog), summary('event row', eventLog));
  const all = newLog();
  for (const log of [fenceLog, contestLog, accountLog, eventLog]) {
    all.statements.push(...log.statements);
    all.calls += log.calls;
    all.wall += log.wall;
    all.errors += log.errors;
  }
  parts.push(summary('total', all));
  console.table(parts);
  console.log(`Wall time including progress reads: ${total} ms. Work units: ${work}.`);

  const afterA = await counts(db, eventA);
  const afterB = await counts(db, eventB);
  const left = Object.entries(afterA).filter(([, row]) => row.n !== 0).map(([table]) => table);
  const changed = Object.keys(afterB).filter((table) => JSON.stringify(afterB[table]) !== JSON.stringify(beforeB[table]));
  console.log(`Event A rows left: ${left.length ? left.join(', ') : 'none'}. Event B tables changed: ${changed.length ? changed.join(', ') : 'none'}.`);
  console.log(`Errors: ${all.errors}. Work count: ${work}.`);
  if (left.length || changed.length || all.errors) failed = true;
  await deletion.forgetFixtureEvent(db, eventA);
  await deletion.removeFixtureEvent(db, eventB);
  const removed = await counts(db, eventB);
  if (Object.values(removed).some((row) => row.n !== 0)) { failed = true; console.log('Event B was not removed.'); }
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : 'The timing run failed.');
} finally {
  await platform.dispose();
}
process.exit(failed ? 1 : 0);
