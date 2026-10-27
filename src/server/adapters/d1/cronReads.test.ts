import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import applicationWorker, { type ApplicationEnvironment } from '../cloudflare/applicationWorker';
import type { D1Binding, D1Connection, D1Statement } from './connection';
import { applyMigrations } from './testFixture';

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }));

const configPath = 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';

type Value = string | number | null;
interface Recorded { sql: string; values: Value[]; rowsRead: number }

/** Runs each statement on the real database and records its SQL, bound values, and rows read. */
function recordStatements(db: D1Binding): { db: D1Binding; log: Recorded[] } {
  const log: Recorded[] = [];
  const parts = new WeakMap<D1Statement, { inner: D1Statement; sql: string; values: Value[] }>();
  const rowsRead = (result: unknown) => (result as { meta?: { rows_read?: number } }).meta?.rows_read ?? 0;
  function wrap(inner: D1Statement, sql: string, values: Value[]): D1Statement {
    const record = async <T>(execute: () => Promise<T>): Promise<T> => {
      const result = await execute();
      log.push({ sql, values, rowsRead: rowsRead(result) });
      return result;
    };
    const wrapped: D1Statement = {
      bind: (...next) => wrap(inner.bind(...next), sql, next),
      // first() returns no metadata, so run it as all().
      first: async <T>() => (await record(() => inner.all<T>())).results[0] ?? null,
      all: <T>() => record(() => inner.all<T>()),
      run: () => record(() => inner.run()),
    };
    parts.set(wrapped, { inner, sql, values });
    return wrapped;
  }
  return {
    log,
    db: {
      prepare: (sql) => wrap(db.prepare(sql), sql, []),
      exec: (query) => db.exec(query),
      batch: async (statements) => {
        const items = statements.map((statement) => {
          const item = parts.get(statement);
          if (!item) throw new Error('A batch statement came from another connection.');
          return item;
        });
        const results = await db.batch(items.map(({ inner }) => inner));
        items.forEach(({ sql, values }, index) => log.push({ sql, values, rowsRead: rowsRead(results[index]) }));
        return results;
      },
    },
  };
}

const liveAccounts = 500;
const readyImages = 1000;
const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * A session with 500 signed-in accounts, 1,000 ready images, and a few rows in
 * each cleanup state. Accounts 501 to 503 signed out more than a day ago.
 * Accounts 504 and 505 expired an hour ago, so the cron keeps them.
 */
async function seed(db: D1Connection): Promise<void> {
  const series = (count: number) => `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})`;
  const run = (sql: string) => db.prepare(sql).run();
  const expiry = (live: string, old: string, recent: string) =>
    `CASE WHEN i <= ${liveAccounts} THEN ${live} WHEN i <= ${liveAccounts + 3} THEN ${old} ELSE ${recent} END`;
  const accounts = liveAccounts + 5;
  await run("INSERT INTO events (id, name) VALUES ('ev-1', 'Cron event')");
  await run("INSERT INTO sessions (id, event_id, name) VALUES ('sess-1', 'ev-1', 'Cron session')");
  await run("INSERT INTO teams (id, session_id, name, location) VALUES ('team-1', 'sess-1', 'Team', 'Table')");
  await run(`${series(accounts)} INSERT INTO accounts (id, name, username, must_change) SELECT 'acc-' || i, 'Person ' || i, 'user' || i, 0 FROM n`);
  await run(`${series(accounts)} INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
    SELECT 'acc-' || i, 'Person ' || i, 'user' || i || '@x.invalid', 1, ${now}, ${now}, 'user' || i FROM n`);
  await run(`${series(accounts)} INSERT INTO ba_session (id, expiresAt, token, createdAt, updatedAt, userId)
    SELECT 'ids-' || i, ${expiry("strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day')", "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')",
    "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')")}, 'tok-' || i, ${now}, ${now}, 'acc-' || i FROM n`);
  await run(`${series(accounts)} INSERT INTO logins (id, account_id, expires_at, identity_session_id)
    SELECT 'login-' || i, 'acc-' || i, ${expiry('unixepoch() + 86400', 'unixepoch() - 172800', 'unixepoch() - 3600')}, 'ids-' || i FROM n`);
  await run(`${series(20)} INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at)
    SELECT 'issue-' || i, 'sess-1', 'team-1', 'open', i, 'acc-1', 'Person 1', 'Devices', 'Fictional issue ' || i, ${now} FROM n`);

  const issueImage = (name: string, state: string, expires: string) =>
    `('img-${name}', 'sess-1', 'issue-1', 'acc-1', 'req-${name}', 'Person 1', 'public', 1000, 'a.png', '${state}', ${expires}, 'o-${name}', 't-${name}')`;
  await run(`${series(readyImages)} INSERT INTO issue_images (id, session_id, issue_id, uploader, request_id, uploader_name, uploaded_at,
      visibility, declared_bytes, byte_size, content_type, original_name, state, original_path, thumbnail_path)
    SELECT 'img-ready-' || i, 'sess-1', 'issue-' || (1 + i % 20), 'acc-1', 'req-ready-' || i, 'Person 1', ${now},
      'public', 1000, 1000, 'image/png', 'a.png', 'ready', 'o-ready-' || i, 't-ready-' || i FROM n`);
  await run(`INSERT INTO issue_images (id, session_id, issue_id, uploader, request_id, uploader_name, visibility, declared_bytes,
      original_name, state, expires_at, original_path, thumbnail_path) VALUES
    ${[issueImage('late-1', 'pending', 'unixepoch() - 60'), issueImage('late-2', 'pending', 'unixepoch() - 60'),
      issueImage('new-1', 'pending', 'unixepoch() + 3000'), issueImage('new-2', 'pending', 'unixepoch() + 3000'),
      issueImage('removing-1', 'deleting', 'unixepoch() + 3000'), issueImage('removed-1', 'deleted', 'unixepoch() + 3000'),
      issueImage('expired-1', 'expired', 'unixepoch() - 600'), issueImage('abandoned-1', 'abandoned', 'unixepoch() + 3000')].join(', ')}`);
  await run(`INSERT INTO image_deletions (attachment_id) VALUES ('img-removing-1'), ('img-removed-1'), ('img-expired-1'), ('img-abandoned-1')`);

  await run("INSERT INTO announcements (id, session_id, title, details, author, author_name) VALUES ('ann-1', 'sess-1', 'Notice', 'Details', 'acc-1', 'Person 1')");
  const announcementImage = (name: string, state: string, expires: string) =>
    `('ann-img-${name}', 'sess-1', 'ann-1', 'acc-1', 'Person 1', 'req-${name}', '{}', 'a.png', 1000, '${state}', ${expires}, 'notices/${name}')`;
  await run(`${series(20)} INSERT INTO announcement_images (id, session_id, announcement_id, uploader, uploader_name, request_id,
      request_command, name, declared_bytes, byte_size, content_type, digest, object_key, state, uploaded_at)
    SELECT 'ann-img-ready-' || i, 'sess-1', 'ann-1', 'acc-1', 'Person 1', 'req-ready-' || i, '{}', 'a.png', 1000, 1000, 'image/png',
      printf('%064d', i), 'notices/ready-' || i, 'ready', ${now} FROM n`);
  await run(`INSERT INTO announcement_images (id, session_id, announcement_id, uploader, uploader_name, request_id, request_command,
      name, declared_bytes, state, expires_at, object_key) VALUES
    ${[announcementImage('late-1', 'pending', 'unixepoch() - 60'), announcementImage('new-1', 'pending', 'unixepoch() + 600'),
      announcementImage('expired-1', 'expired', 'unixepoch() - 600'), announcementImage('removed-1', 'deleted', 'unixepoch() + 600')].join(', ')}`);
  await run("INSERT INTO announcement_image_deletions (image_id) VALUES ('ann-img-expired-1'), ('ann-img-removed-1')");

  await run(`${series(100)} INSERT INTO account_avatars (id, account_id, request_id, byte_size, content_type, digest, state, ready_at)
    SELECT 'avatar-' || i, 'acc-' || i, 'avatar-req-' || i, 1000, 'image/png', printf('%064d', i), 'ready', ${now} FROM n`);
  await run(`INSERT INTO account_avatars (id, account_id, request_id, byte_size, content_type, digest, state, expires_at, retired_at) VALUES
    ('avatar-late', 'acc-200', 'avatar-req-late', 1000, 'image/png', printf('%064d', 200), 'pending', unixepoch() - 60, NULL),
    ('avatar-retired', 'acc-201', 'avatar-req-retired', 1000, 'image/png', printf('%064d', 201), 'retired', unixepoch() + 600, ${now})`);

  await run(`${series(20)} INSERT INTO authentication_limits (key, window_start, attempts) SELECT 'username:user' || i, unixepoch(), 1 FROM n`);
  await run("INSERT INTO authentication_limits (key, window_start, attempts) VALUES ('ip:old-1', unixepoch() - 172800, 1), ('ip:old-2', unixepoch() - 172800, 1)");
  // The seed writes notifications through triggers. The cron under test finds none to deliver.
  await run('UPDATE notifications SET delivered = 1');
}

describe('the minute cron on an installation with 1,000 images and 500 signed-in accounts', () => {
  let db: D1Binding;
  let dispose: () => Promise<void>;
  const removedKeys: string[] = [];
  const ticks: Recorded[][] = [];

  async function tick(): Promise<Recorded[]> {
    const recording = recordStatements(db);
    const env: ApplicationEnvironment = {
      DB: recording.db, AUTH_ORIGIN: 'https://cron.example.invalid', AUTH_SECRET: 'c'.repeat(64),
      ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
      IMAGES: { get: async () => null, put: async () => null, delete: async (keys) => { removedKeys.push(...keys); } },
      LIVE_UPDATES: { idFromName: (name) => name, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) },
    };
    await applicationWorker.scheduled({}, env);
    return recording.log;
  }

  beforeAll(async () => {
    const platform = await openStoreDatabase({ configPath, remoteBindings: false });
    db = platform.db;
    dispose = platform.dispose;
    await applyMigrations(db);
    await seed(db);
    ticks.push(await tick());
    ticks.push(await tick());
  });
  afterAll(async () => { await dispose?.(); });

  const column = async (sql: string) => (await db.prepare(sql).all<{ id: string }>()).results.map((row) => row.id);

  it('expires only the reservations that ran out and queues their files for removal', async () => {
    const states = await db.prepare("SELECT id, state FROM issue_images WHERE id NOT LIKE 'img-ready-%' ORDER BY id").all<{ id: string; state: string }>();
    expect(states.results.map((row) => `${row.id} ${row.state}`)).toEqual([
      'img-abandoned-1 abandoned', 'img-expired-1 expired', 'img-late-1 expired', 'img-late-2 expired',
      'img-new-1 pending', 'img-new-2 pending', 'img-removed-1 deleted', 'img-removing-1 deleted']);
    expect((await db.prepare("SELECT count(*) AS n FROM issue_images WHERE state = 'ready'").first<{ n: number }>())?.n).toBe(readyImages);
    expect((await column('SELECT attachment_id AS id FROM image_deletions ORDER BY attachment_id'))).toEqual([
      'img-abandoned-1', 'img-expired-1', 'img-late-1', 'img-late-2', 'img-removed-1', 'img-removing-1']);
    expect(removedKeys).toEqual(expect.arrayContaining(['o-late-1', 't-late-1', 'o-late-2', 't-late-2']));
    expect(removedKeys.filter((key) => /new-|ready-/.test(key))).toEqual([]);
  });

  it('expires only the announcement reservations and avatar uploads that ran out', async () => {
    const announcement = await db.prepare("SELECT id, state FROM announcement_images WHERE id NOT LIKE 'ann-img-ready-%' ORDER BY id").all<{ id: string; state: string }>();
    expect(announcement.results.map((row) => `${row.id} ${row.state}`)).toEqual([
      'ann-img-expired-1 expired', 'ann-img-late-1 expired', 'ann-img-new-1 pending', 'ann-img-removed-1 deleted']);
    expect(await column("SELECT image_id AS id FROM announcement_image_deletions ORDER BY image_id")).toEqual([
      'ann-img-expired-1', 'ann-img-late-1', 'ann-img-removed-1']);
    const avatars = await db.prepare("SELECT id, state FROM account_avatars WHERE state <> 'ready' ORDER BY id").all<{ id: string; state: string }>();
    expect(avatars.results.map((row) => `${row.id} ${row.state}`)).toEqual(['avatar-late expired', 'avatar-retired retired']);
    expect(removedKeys).toEqual(expect.arrayContaining(['notices/late-1', 'accounts/acc-200/avatars/avatar-late', 'accounts/acc-201/avatars/avatar-retired']));
  });

  it('deletes sign-ins and limit counters that expired more than a day ago and keeps the rest', async () => {
    const logins = await column('SELECT id FROM logins');
    const identities = await column('SELECT id FROM ba_session');
    expect(logins).toHaveLength(liveAccounts + 2);
    expect(identities).toHaveLength(liveAccounts + 2);
    for (const gone of ['login-501', 'login-502', 'login-503']) expect(logins).not.toContain(gone);
    for (const kept of ['login-1', 'login-500', 'login-504', 'login-505']) expect(logins).toContain(kept);
    for (const gone of ['ids-501', 'ids-502', 'ids-503']) expect(identities).not.toContain(gone);
    for (const kept of ['ids-1', 'ids-500', 'ids-504', 'ids-505']) expect(identities).toContain(kept);
    expect(await column('SELECT key AS id FROM authentication_limits WHERE key LIKE \'ip:%\'')).toEqual([]);
    expect(await column('SELECT key AS id FROM authentication_limits')).toHaveLength(20);
  });

  // SQLite reports a scan of a real table as `SCAN <table or alias>`. Scans of constant rows,
  // subquery results, and json_each stay in memory. authentication_limits holds one row for each
  // failed sign-in key of the last day, so the scan stays small and an index would add two writes
  // to every failed attempt. Add the index if that table grows.
  it('searches every cleanup statement through an index', async () => {
    const statements = new Map(ticks[0]!.map((entry) => [`${entry.sql}\n${JSON.stringify(entry.values)}`, entry]));
    expect(statements.size).toBeGreaterThan(10);
    const scans: string[] = [];
    for (const { sql, values } of statements.values()) {
      const plan = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...values).all<{ detail: string }>();
      for (const { detail } of plan.results) {
        if (detail.startsWith('SCAN ') && !/^SCAN (?:CONSTANT ROW|\(subquery-\d+\)|json_each)/.test(detail)) {
          scans.push(`${detail}: ${sql.replace(/\s+/g, ' ').slice(0, 70)}`);
        }
      }
    }
    expect(scans.filter((scan) => !scan.startsWith('SCAN authentication_limits:'))).toEqual([]);
  });

  // Before the cleanup indexes, one tick scanned every image and sign-in: about
  // 3 reads for each image and 2 for each account in this seed.
  it('reads rows in proportion to the work, not to the images and accounts', () => {
    for (const log of ticks) {
      expect(log.reduce((sum, entry) => sum + entry.rowsRead, 0)).toBeLessThan(300);
    }
  });
});
