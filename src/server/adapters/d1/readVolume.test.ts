import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import { currentAccessBindings, sessionsListSql, snapshotSql } from '../cloudflare/application';
import type { D1Connection } from './connection';
import { applyMigrations } from './testFixture';

const configPath = 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';
const accounts = 1200;
const teams = 24;
const issues = 100;
const contestant = 7;

/**
 * One session with 1,200 members and 100 issues, plus a second session with
 * 1,500 images. Account 1 is the admin. Account 7 is a contestant on team 8,
 * which owns 4 issues. Every id is fictional.
 */
async function seed(db: D1Connection): Promise<void> {
  const series = (count: number) => `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})`;
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const later = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day')";
  const run = (sql: string) => db.prepare(sql).run();
  const images = (session: string, count: number, issueCount: number, prefix: string) => run(`${series(count)}
    INSERT INTO issue_images (id, session_id, issue_id, uploader, request_id, uploader_name, uploaded_at, visibility,
      declared_bytes, byte_size, content_type, original_name, state, original_path, thumbnail_path)
    SELECT '${prefix}img-' || i, '${session}', '${prefix}issue-' || (1 + i % ${issueCount}), 'acc-1', '${prefix}req-' || i,
      'Person 1', ${now}, 'public', 1000, 1000, 'image/png', 'a.png', 'ready', '${prefix}o-' || i, '${prefix}t-' || i FROM n`);
  await run("INSERT INTO events (id, name) VALUES ('ev-1', 'Scale event')");
  await run("INSERT INTO sessions (id, event_id, name) VALUES ('sess-1', 'ev-1', 'Scale session')");
  await run(`${series(teams)} INSERT INTO teams (id, session_id, name, location) SELECT 'team-' || i, 'sess-1', 'Team ' || i, 'Table ' || i FROM n`);
  await run(`${series(accounts)} INSERT INTO accounts (id, name, username, must_change) SELECT 'acc-' || i, 'Person ' || i, 'user' || i, 0 FROM n`);
  await run(`${series(accounts)} INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
    SELECT 'acc-' || i, 'Person ' || i, 'user' || i || '@x.invalid', 1, ${now}, ${now}, 'user' || i FROM n`);
  await run(`${series(accounts)} INSERT INTO ba_session (id, expiresAt, token, createdAt, updatedAt, userId)
    SELECT 'ids-' || i, ${later}, 'tok-' || i, ${now}, ${now}, 'acc-' || i FROM n`);
  await run(`${series(accounts)} INSERT INTO logins (id, account_id, expires_at, identity_session_id)
    SELECT 'login-' || i, 'acc-' || i, unixepoch() + 86400, 'ids-' || i FROM n`);
  await run(`${series(accounts)} INSERT INTO memberships (session_id, account_id, team_id, is_admin)
    SELECT 'sess-1', 'acc-' || i, CASE WHEN i = 1 THEN NULL ELSE 'team-' || (1 + i % ${teams}) END, i = 1 FROM n`);
  await run(`${series(issues)} INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at)
    SELECT 'issue-' || i, 'sess-1', 'team-' || (1 + i % ${teams}), 'open', i, 'acc-' || (1 + i), 'Person', 'Devices', 'Fictional issue ' || i, ${now} FROM n`);
  await run(`${series(issues * 5)} INSERT INTO history (id, issue_id, actor, at, text, visibility, actor_name)
    SELECT 'hist-' || i, 'issue-' || (1 + i % ${issues}), 'acc-1', ${now}, 'note ' || i,
      CASE WHEN (i / 100) % 2 THEN 'public' ELSE 'internal' END, 'Person 1' FROM n`);
  await images('sess-1', 300, issues, '');
  await run("INSERT INTO sessions (id, event_id, name) VALUES ('sess-2', 'ev-1', 'Other session')");
  await run("INSERT INTO teams (id, session_id, name, location) VALUES ('team-o', 'sess-2', 'Other', 'x')");
  await run(`${series(50)} INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at)
    SELECT 'o-issue-' || i, 'sess-2', 'team-o', 'open', i, 'acc-2', 'Person', 'Devices', 'Other issue ' || i, ${now} FROM n`);
  await images('sess-2', 1500, 50, 'o-');
}

// A reference run on the same data, before the snapshot evaluated access once,
// read 9,712 rows for the contestant, 23,626 for the admin, and 1,205 for the
// sessions list. The ceilings sit above today's reads and far below those.
describe('rows read for a session with 1,200 accounts and 100 issues', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    const platform = await openStoreDatabase({ configPath, remoteBindings: false });
    db = platform.db;
    dispose = platform.dispose;
    await applyMigrations(db);
    await seed(db);
  });
  afterAll(async () => { await dispose?.(); });

  async function snapshot(n: number) {
    const caller = { accountId: `acc-${n}`, loginId: `login-${n}` };
    const result = await db.prepare(snapshotSql)
      .bind(caller.accountId, caller.loginId, ...currentAccessBindings(caller, 'sess-1'), ...Array<string>(9).fill('sess-1'))
      .all<{ snapshot: string }>();
    return { rowsRead: result.meta?.rows_read ?? Infinity, snapshot: JSON.parse(result.results[0].snapshot) };
  }

  it('reads only the contestant team rows for a contestant snapshot', async () => {
    const { rowsRead, snapshot: body } = await snapshot(contestant);
    expect(body.issues).toHaveLength(4);
    expect(body.members).toEqual([]);
    expect(body.attachments).toHaveLength(12);
    expect(body.history.length).toBeGreaterThan(0);
    expect(rowsRead).toBeLessThan(400);
  });

  it('returns every issue, member, and image to the admin within a bounded read', async () => {
    const { rowsRead, snapshot: body } = await snapshot(1);
    expect(body.issues).toHaveLength(issues);
    expect(body.members).toHaveLength(accounts);
    expect(body.attachments).toHaveLength(300);
    expect(rowsRead).toBeLessThan(10_000);
  });

  it('reads a handful of rows for the sessions list', async () => {
    const result = await db.prepare(sessionsListSql).bind(`acc-${contestant}`, `login-${contestant}`)
      .all<{ id: string }>();
    expect(result.results).toEqual([{ id: 'sess-1', name: 'Scale session' }]);
    expect(result.meta?.rows_read ?? Infinity).toBeLessThan(30);
  });
});
