import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import { currentAccessBindings, currentAccessSql, currentReadyLoginSql, sessionsListSql, snapshotSql } from '../cloudflare/application';
import type { D1Connection } from './connection';
import { applyMigrations } from './testFixture';

const configPath = 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';
const accounts = 1200;
const teams = 24;
const issues = 100;
const audits = 1200;
/**
 * Account 1 is the admin, 2 a volunteer and 3 a jury member. Accounts 7 and
 * 31 are contestants on team 8, which owns 4 issues. The login of account 9
 * is revoked. Account 1201 is a session member with no team, role or admin
 * flag, 1202 belongs to no session, and 1203 is staff of the second session only.
 */
const callers = {
  admin: 1, volunteer: 2, jury: 3, contestant: 7, teammate: 31,
  revokedLogin: 9, plainMember: 1201, outsider: 1202, otherSessionStaff: 1203,
};

/**
 * One session with 1,200 members, 100 issues, 300 images and 1,200 audit
 * rows, plus a second session with 1,500 images. Every id is fictional.
 */
async function seed(db: D1Connection): Promise<void> {
  const people = accounts + 3;
  const series = (count: number) => `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})`;
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const later = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day')";
  const run = (sql: string) => db.prepare(sql).run();
  const images = (session: string, count: number, issue: string, prefix: string, state: string, removal: string) => run(`${series(count)}
    INSERT INTO issue_images (id, session_id, issue_id, uploader, request_id, uploader_name, uploaded_at, visibility,
      declared_bytes, byte_size, content_type, original_name, state, original_path, thumbnail_path,
      deleted_by, deleted_at, files_removed_at)
    SELECT '${prefix}img-' || i, '${session}', ${issue}, 'acc-1', '${prefix}req-' || i,
      'Person 1', ${now}, CASE WHEN i % 3 = 0 THEN 'internal' ELSE 'public' END, 1000, 1000, 'image/png', 'a.png',
      '${state}', '${prefix}o-' || i, '${prefix}t-' || i, ${removal} FROM n`);
  await run("INSERT INTO events (id, name) VALUES ('ev-1', 'Scale event')");
  await run("INSERT INTO sessions (id, event_id, name) VALUES ('sess-1', 'ev-1', 'Scale session'), ('sess-2', 'ev-1', 'Other session')");
  await run(`${series(teams)} INSERT INTO teams (id, session_id, name, location) SELECT 'team-' || i, 'sess-1', 'Team ' || i, 'Table ' || i FROM n`);
  await run("INSERT INTO teams (id, session_id, name, location) VALUES ('team-o', 'sess-2', 'Other', 'x')");
  await run(`${series(people)} INSERT INTO accounts (id, name, username, must_change) SELECT 'acc-' || i, 'Person ' || i, 'user' || i, 0 FROM n`);
  await run(`${series(people)} INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
    SELECT 'acc-' || i, 'Person ' || i, 'user' || i || '@x.invalid', 1, ${now}, ${now}, 'user' || i FROM n`);
  await run(`${series(people)} INSERT INTO ba_session (id, expiresAt, token, createdAt, updatedAt, userId)
    SELECT 'ids-' || i, ${later}, 'tok-' || i, ${now}, ${now}, 'acc-' || i FROM n`);
  await run(`${series(people)} INSERT INTO logins (id, account_id, expires_at, identity_session_id, revoked)
    SELECT 'login-' || i, 'acc-' || i, unixepoch() + 86400, 'ids-' || i, i = ${callers.revokedLogin} FROM n`);
  await run(`${series(accounts)} INSERT INTO memberships (session_id, account_id, team_id, is_admin)
    SELECT 'sess-1', 'acc-' || i, CASE WHEN i IN (1, 2, 3) THEN NULL ELSE 'team-' || (1 + i % ${teams}) END, i = 1 FROM n`);
  await run(`INSERT INTO memberships (session_id, account_id, team_id) VALUES
    ('sess-1', 'acc-${callers.plainMember}', NULL), ('sess-2', 'acc-${callers.otherSessionStaff}', NULL)`);
  await run(`INSERT INTO membership_roles (session_id, account_id, role) VALUES ('sess-1', 'acc-2', 'volunteer'),
    ('sess-1', 'acc-3', 'jury'), ('sess-2', 'acc-${callers.otherSessionStaff}', 'volunteer')`);
  await run(`${series(issues)} INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at)
    SELECT 'issue-' || i, 'sess-1', 'team-' || (1 + i % ${teams}), 'open', i, 'acc-' || (1 + i), 'Person', 'Devices', 'Fictional issue ' || i, ${now} FROM n`);
  await run(`${series(issues * 5)} INSERT INTO history (id, issue_id, actor, at, text, visibility, actor_name)
    SELECT 'hist-' || i, 'issue-' || (1 + i % ${issues}), 'acc-1', ${now}, 'note ' || i,
      CASE WHEN (i / 100) % 2 THEN 'public' ELSE 'internal' END, 'Person 1' FROM n`);
  await run(`${series(40)} INSERT INTO resolutions (id, session_id, issue_id, actor, actor_name, at, summary)
    SELECT 'res-' || i, 'sess-1', 'issue-' || i, 'acc-2', 'Person 2', ${now}, 'Fixed ' || i FROM n`);
  await run(`${series(20)} INSERT INTO awards (id, session_id, issue_id, resolution_id, minutes, explanation, actor, actor_name, at)
    SELECT 'award-' || i, 'sess-1', 'issue-' || i, 'res-' || i, 5, 'Delay ' || i, 'acc-3', 'Person 3', ${now} FROM n`);
  await images('sess-1', issues * 3, `'issue-' || (1 + i % ${issues})`, '', 'ready', 'NULL, NULL, NULL');
  // The volunteer removed 40 images. The files of 20 of them are still due.
  await images('sess-1', 20, `'issue-' || i`, 'due-', 'deleting', `'acc-2', ${now}, NULL`);
  await images('sess-1', 20, `'issue-' || i`, 'gone-', 'deleted', `'acc-2', ${now}, ${now}`);
  await run(`${series(audits)} INSERT INTO admin_audit (id, session_id, actor, at, action, target)
    SELECT 'audit-' || i, 'sess-1', 'acc-1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || i || ' seconds'),
      'assign_membership', 'acc-' || i FROM n`);
  await run(`${series(50)} INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at)
    SELECT 'o-issue-' || i, 'sess-2', 'team-o', 'open', i, 'acc-2', 'Person', 'Devices', 'Other issue ' || i, ${now} FROM n`);
  await images('sess-2', 1500, `'o-issue-' || (1 + i % 50)`, 'o-', 'ready', 'NULL, NULL, NULL');
}

/**
 * The snapshot statement before 2026-10-26, when each section read `access`
 * once for every row. It is the reference for the permission filters.
 * Replace it when the snapshot gains or loses a field.
 */
const referenceSnapshotSql = `WITH login AS (${currentReadyLoginSql}), access AS MATERIALIZED (${currentAccessSql}),
  visible_issues AS MATERIALIZED (
    SELECT i.* FROM access a CROSS JOIN issues i WHERE i.session_id = ? AND i.team_id = a.team_id
    UNION ALL SELECT i.* FROM access a CROSS JOIN issues i WHERE a.staff = 1 AND i.session_id = ?)
SELECT json_object(
  'session', (SELECT json_object('id', s.id, 'event_id', s.event_id, 'name', s.name,
    'intake_open', json(CASE WHEN s.intake_open THEN 'true' ELSE 'false' END),
    'categories', json(s.categories), 'revision', s.version,
    'max_image_bytes', s.max_image_bytes, 'max_images_per_issue', s.max_images_per_issue,
    'max_image_bytes_per_issue', s.max_image_bytes_per_issue) FROM sessions s WHERE s.id = ? AND EXISTS (SELECT 1 FROM access)),
  'event', (SELECT json_object('id', e.id, 'name', e.name,
    'archived', json(CASE WHEN e.archived THEN 'true' ELSE 'false' END))
    FROM events e JOIN sessions s ON s.event_id = e.id WHERE s.id = ? AND EXISTS (SELECT 1 FROM access)),
  'membership', (SELECT json_object('session_id', ?, 'user_id', account_id,
    'team_id', team_id, 'roles', json(roles), 'is_admin', json(CASE WHEN is_admin THEN 'true' ELSE 'false' END)) FROM access),
  'teams', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', t.id, 'session_id', t.session_id, 'name', t.name, 'location', t.location) AS row
    FROM teams t CROSS JOIN access a WHERE t.session_id = ? AND (a.staff = 1 OR t.id = a.team_id) ORDER BY t.name, t.id)), '[]')),
  'issues', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', i.id, 'number', i.number, 'session_id', i.session_id,
      'team_id', i.team_id, 'reporter', i.reporter, 'reporter_name', i.reporter_name,
      'category', i.category, 'description', i.description, 'status', i.status,
      'created_at', i.created_at, 'first_assigned_at', i.first_assigned_at,
      'owner', i.owner, 'owner_name', i.owner_name, 'resolved_at', i.resolved_at,
      'revision', i.public_revision) AS row FROM visible_issues i ORDER BY i.number DESC, i.id)), '[]')),
  'resolutions', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', r.id, 'session_id', r.session_id, 'issue_id', r.issue_id,
      'actor', r.actor, 'actor_name', r.actor_name, 'at', r.at, 'summary', r.summary,
      'reopened_at', r.reopened_at, 'reopened_by', r.reopened_by,
      'reopened_name', r.reopened_name, 'reason', r.reason) AS row
    FROM resolutions r JOIN visible_issues i ON i.id = r.issue_id ORDER BY r.at, r.id)), '[]')),
  'history', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', h.id, 'issue_id', h.issue_id, 'at', h.at,
      'actor', h.actor, 'actor_name', h.actor_name, 'text', h.text, 'visibility', h.visibility) AS row
    FROM history h JOIN visible_issues i ON i.id = h.issue_id CROSS JOIN access a
    WHERE h.visibility = 'public' OR a.staff = 1 ORDER BY h.at, h.id)), '[]')),
  'awards', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', w.id, 'issue_id', w.issue_id, 'resolution_id', w.resolution_id,
      'minutes', w.minutes, 'explanation', w.explanation, 'actor_name', w.actor_name,
      'at', w.at, 'applied_at', w.applied_at, 'applied_name', w.applied_name) AS row
    FROM awards w JOIN visible_issues i ON i.id = w.issue_id ORDER BY w.at, w.id)), '[]')),
  'attachments', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', x.id, 'issue_id', x.issue_id, 'uploader', x.uploader,
      'uploader_name', x.uploader_name, 'uploaded_at', x.uploaded_at,
      'visibility', x.visibility, 'byte_size', x.byte_size, 'content_type', x.content_type,
      'original_name', x.original_name) AS row
    FROM visible_issues i CROSS JOIN issue_images x CROSS JOIN access a
    WHERE x.issue_id = i.id AND x.state = 'ready' AND (x.visibility = 'public' OR a.staff = 1)
    ORDER BY x.uploaded_at, x.id)), '[]')),
  'pending_removals', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', x.id, 'issue_id', x.issue_id, 'original_name', x.original_name) AS row
    FROM issue_images x CROSS JOIN access a WHERE x.session_id = ? AND a.staff = 1
      AND x.state IN ('deleting', 'deleted') AND x.files_removed_at IS NULL AND x.deleted_by = a.account_id
    ORDER BY x.deleted_at, x.id)), '[]')),
  'members', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('membership', json_object('session_id', m.session_id, 'user_id', m.account_id,
      'team_id', m.team_id, 'roles', json((SELECT json_group_array(role) FROM (SELECT role
        FROM membership_roles mr WHERE mr.session_id = m.session_id AND mr.account_id = m.account_id ORDER BY role))),
      'is_admin', json(CASE WHEN m.is_admin THEN 'true' ELSE 'false' END)),
      'person', json_object('id', p.id, 'name', p.name, 'username', p.username)) AS row
    FROM access a CROSS JOIN memberships m JOIN accounts p ON p.id = m.account_id
    WHERE a.is_admin = 1 AND m.session_id = ? ORDER BY p.name, p.id)), '[]')),
  'audit', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', d.id, 'actor', d.actor, 'at', d.at, 'action', d.action, 'target', d.target) AS row
    FROM admin_audit d CROSS JOIN access a WHERE d.session_id = ? AND a.is_admin = 1
    ORDER BY d.at DESC, d.id DESC LIMIT 50)), '[]')),
  'server_time', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
) AS snapshot WHERE EXISTS (SELECT 1 FROM login)`;

// Measured on this seed on 2026-10-26. While each section read `access` again
// for every row, a snapshot read 7,377 rows for the admin, 4,841 for the
// volunteer and 1,442 for a contestant, who also read all 1,200 audit rows.
// After the change it read 6,509, 2,823 and 168. Each ceiling sits about 5%
// above the later read.
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

  async function snapshot(n: number, sql = snapshotSql) {
    const caller = { accountId: `acc-${n}`, loginId: `login-${n}` };
    const result = await db.prepare(sql)
      .bind(caller.accountId, caller.loginId, ...currentAccessBindings(caller, 'sess-1'), ...Array<string>(9).fill('sess-1'))
      .all<{ snapshot: string }>();
    const row = result.results[0];
    const body = row ? JSON.parse(row.snapshot) : null;
    if (body) delete body.server_time;
    return { rowsRead: result.meta?.rows_read ?? Infinity, body };
  }

  it('returns the reference snapshot to every caller', async () => {
    for (const [name, n] of Object.entries(callers)) {
      expect((await snapshot(n)).body, name).toEqual((await snapshot(n, referenceSnapshotSql)).body);
    }
    expect((await snapshot(callers.revokedLogin)).body).toBeNull();
    for (const n of [callers.outsider, callers.otherSessionStaff]) {
      expect((await snapshot(n)).body).toMatchObject({ session: null, membership: null, teams: [], issues: [] });
    }
    expect((await snapshot(callers.plainMember)).body).toMatchObject({
      membership: { team_id: null, roles: [], is_admin: false }, teams: [], issues: [], history: [], audit: [],
    });
  });

  it('reads only the contestant team rows for a contestant snapshot', async () => {
    const { rowsRead, body } = await snapshot(callers.contestant);
    expect(body.teams.map((team: { id: string }) => team.id)).toEqual(['team-8']);
    expect(body.issues).toHaveLength(4);
    expect(body.history.length).toBeGreaterThan(0);
    expect(body.history.filter((entry: { visibility: string }) => entry.visibility !== 'public')).toEqual([]);
    expect(body.attachments).toHaveLength(8);
    expect(body.attachments.filter((image: { visibility: string }) => image.visibility !== 'public')).toEqual([]);
    expect(body.pending_removals).toEqual([]);
    expect(body.members).toEqual([]);
    expect(body.audit).toEqual([]);
    expect(rowsRead).toBeLessThan(175);
  });

  it('returns staff notes and only their own removals to a volunteer within a bounded read', async () => {
    const { rowsRead, body } = await snapshot(callers.volunteer);
    expect(body.teams).toHaveLength(teams);
    expect(body.issues).toHaveLength(issues);
    expect(body.history).toHaveLength(issues * 5);
    expect(body.attachments).toHaveLength(300);
    expect(body.pending_removals).toHaveLength(20);
    expect(body.members).toEqual([]);
    expect(body.audit).toEqual([]);
    expect(rowsRead).toBeLessThan(2_950);
  });

  it('returns every issue, member, image, and the latest audit to the admin within a bounded read', async () => {
    const { rowsRead, body } = await snapshot(callers.admin);
    expect(body.issues).toHaveLength(issues);
    expect(body.members).toHaveLength(accounts + 1);
    expect(body.attachments).toHaveLength(300);
    expect(body.pending_removals).toEqual([]);
    expect(body.audit).toHaveLength(50);
    expect(rowsRead).toBeLessThan(6_800);
  });

  it('reads a handful of rows for the sessions list', async () => {
    const result = await db.prepare(sessionsListSql).bind(`acc-${callers.contestant}`, `login-${callers.contestant}`)
      .all<{ id: string }>();
    expect(result.results).toEqual([{ id: 'sess-1', name: 'Scale session' }]);
    expect(result.meta?.rows_read ?? Infinity).toBeLessThan(30);
  });
});
