import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Command, Snapshot } from '../../../connected/model';
import { decideWorkflow } from '../../workflow';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import { D1ApplicationService, contestsListSql, currentReadyLoginSql, eventContestsSql, snapshotSql } from '../cloudflare/application';
import { currentAccountSql } from '../cloudflare/authentication';
import { D1ContestAwardService } from '../cloudflare/contestAwards';
import { D1ManageService } from '../cloudflare/manage';
import { clockSql, extraMinutesSql, intakeOpenSql } from '../cloudflare/schedule';
import type { ManageCommand } from '../../../backend/contracts';
import { contestDataBindings, contestDataSql, contestListBindings } from '../cloudflare/authority';
import { R2AvatarService } from '../cloudflare/avatars';
import type { PrivateBucket } from '../cloudflare/images';
import type { D1Connection, D1Statement } from './connection';
import { D1ApplicationStore } from './store';
import { applyMigrations } from './testFixture';

const testSchedule = { startsAt: '2030-01-01T09:00:00.000Z', endsAt: '2030-01-01T11:00:00.000Z', graceMinutes: 0 };
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
 * Account 1204 is an event admin and 1205 a webmaster. Neither holds a membership.
 */
const callers = {
  admin: 1, volunteer: 2, jury: 3, contestant: 7, teammate: 31,
  revokedLogin: 9, plainMember: 1201, outsider: 1202, otherSessionStaff: 1203,
  eventAdmin: 1204, webmaster: 1205,
};

/**
 * One session with 1,200 members, 100 issues, 300 images and 1,200 audit
 * rows, plus a second session with 1,500 images. Every account has a ready
 * avatar. Every id is fictional.
 */
async function seed(db: D1Connection, teamCount: number): Promise<void> {
  const people = accounts + 5;
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
  await run(`${series(teamCount)} INSERT INTO teams (id, session_id, name, location) SELECT 'team-' || i, 'sess-1', 'Team ' || i, 'Table ' || i FROM n`);
  await run("INSERT INTO teams (id, session_id, name, location) VALUES ('team-o', 'sess-2', 'Other', 'x')");
  await run(`${series(people)} INSERT INTO accounts (id, name, username, must_change) SELECT 'acc-' || i, 'Person ' || i, 'user' || i, 0 FROM n`);
  await run(`${series(people)} INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
    SELECT 'acc-' || i, 'Person ' || i, 'user' || i || '@x.invalid', 1, ${now}, ${now}, 'user' || i FROM n`);
  await run(`${series(people)} INSERT INTO ba_session (id, expiresAt, token, createdAt, updatedAt, userId)
    SELECT 'ids-' || i, ${later}, 'tok-' || i, ${now}, ${now}, 'acc-' || i FROM n`);
  await run(`${series(people)} INSERT INTO logins (id, account_id, expires_at, identity_session_id, revoked)
    SELECT 'login-' || i, 'acc-' || i, unixepoch() + 86400, 'ids-' || i, i = ${callers.revokedLogin} FROM n`);
  await run(`${series(accounts)} INSERT INTO memberships (session_id, account_id, team_id, is_admin)
    SELECT 'sess-1', 'acc-' || i, CASE WHEN i IN (1, 2, 3) THEN NULL ELSE 'team-' || (1 + i % ${teamCount}) END, i = 1 FROM n`);
  await run(`INSERT INTO memberships (session_id, account_id, team_id) VALUES
    ('sess-1', 'acc-${callers.plainMember}', NULL), ('sess-2', 'acc-${callers.otherSessionStaff}', NULL)`);
  await run(`INSERT INTO membership_roles (session_id, account_id, role) VALUES ('sess-1', 'acc-2', 'volunteer'),
    ('sess-1', 'acc-3', 'jury'), ('sess-2', 'acc-${callers.otherSessionStaff}', 'volunteer')`);
  await run(`UPDATE accounts SET event_id = 'ev-1' WHERE id = 'acc-${callers.eventAdmin}'`);
  await run(`INSERT INTO grants (account_id, scope, event_id, granted_by) VALUES ('acc-${callers.eventAdmin}', 'event', 'ev-1', 'acc-1')`);
  await run(`INSERT INTO grants (account_id, scope, granted_by) VALUES ('acc-${callers.webmaster}', 'site', 'acc-1')`);
  await run(`${series(issues)} INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at)
    SELECT 'issue-' || i, 'sess-1', 'team-' || (1 + i % ${teamCount}), 'open', i, 'acc-' || (1 + i), 'Person', 'Devices', 'Fictional issue ' || i, ${now} FROM n`);
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
  await run(`${series(people)} INSERT INTO account_avatars (id, account_id, request_id, byte_size, content_type, digest, state, ready_at)
    SELECT 'avatar-' || i, 'acc-' || i, 'avatar-' || i, 1000, 'image/png', printf('%064d', i), 'ready', ${now} FROM n`);
}

/**
 * The snapshot statement before 2026-10-26, when each section read `access`
 * once for every row. It is the reference for the permission filters.
 * Replace it when the snapshot gains or loses a field.
 */
// The reference computes the contestant's extra minutes where it uses them, as
// the snapshot did before extra_minutes was read once.
const referenceExtra = `(CASE WHEN s.ends_at IS NULL THEN 0 ELSE ${extraMinutesSql('s', '(SELECT team_id FROM access)')} END)`;
const referenceSnapshotSql = `WITH login AS (${currentReadyLoginSql}), access AS MATERIALIZED (${contestDataSql('caller')}),
  visible_issues AS MATERIALIZED (
    SELECT i.* FROM access a CROSS JOIN issues i WHERE i.session_id = ? AND i.team_id = a.team_id
    UNION ALL SELECT i.* FROM access a CROSS JOIN issues i WHERE a.staff = 1 AND i.session_id = ?)
SELECT json_object(
  'session', (SELECT json_object('id', s.id, 'event_id', s.event_id, 'name', s.name,
    'intake_open', json(CASE WHEN ${intakeOpenSql('s', referenceExtra)} THEN 'true' ELSE 'false' END),
    'categories', json(s.categories), 'revision', s.version,
    'max_image_bytes', s.max_image_bytes, 'max_images_per_issue', s.max_images_per_issue,
    'max_image_bytes_per_issue', s.max_image_bytes_per_issue) FROM sessions s WHERE s.id = ? AND EXISTS (SELECT 1 FROM access)),
  'event', (SELECT json_object('id', e.id, 'name', e.name,
    'archived', json(CASE WHEN e.archived THEN 'true' ELSE 'false' END))
    FROM events e JOIN sessions s ON s.event_id = e.id WHERE s.id = ? AND EXISTS (SELECT 1 FROM access)),
  'clock', (SELECT ${clockSql('s', { timeZone: 'e.time_zone', entry: '(SELECT team_id FROM access)', extra: referenceExtra })}
    FROM sessions s JOIN events e ON e.id = s.event_id WHERE s.id = (SELECT session_id FROM access)),
  'contest_awards', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', k.id, 'minutes', k.minutes, 'explanation', k.explanation, 'actor_name', k.actor_name,
      'at', k.at, 'applied_at', k.applied_at, 'applied_name', k.applied_name,
      'withdrawn_at', k.withdrawn_at, 'withdrawn_name', k.withdrawn_name) AS row
    FROM contest_awards k CROSS JOIN access a WHERE k.session_id = a.session_id
      AND (a.staff = 1 OR (a.team_id IS NOT NULL AND k.applied_at IS NOT NULL)) ORDER BY k.at, k.id)), '[]')),
  'membership', (SELECT json_object('session_id', ?, 'user_id', account_id,
    'team_id', team_id, 'roles', json(roles), 'is_admin', json(CASE WHEN is_admin THEN 'true' ELSE 'false' END)) FROM access),
  'teams', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', t.id, 'session_id', t.session_id, 'name', t.name, 'location', t.location, 'entrant_id', t.entrant_id) AS row
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
      'person', json_object('id', p.id, 'name', p.name, 'username', p.handle)) AS row
    FROM access a CROSS JOIN memberships m JOIN accounts p ON p.id = m.account_id
    WHERE a.is_admin = 1 AND m.session_id = ? ORDER BY p.name, p.id)), '[]')),
  'audit', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', d.id, 'actor', d.actor, 'at', d.at, 'action', d.action, 'target', d.target) AS row
    FROM admin_audit d CROSS JOIN access a WHERE d.session_id = ? AND a.is_admin = 1
    ORDER BY d.at DESC, d.id DESC LIMIT 50)), '[]')),
  'server_time', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
) AS snapshot WHERE EXISTS (SELECT 1 FROM login)`;

async function open(teamCount: number) {
  const platform = await openStoreDatabase({ configPath, remoteBindings: false });
  await applyMigrations(platform.db);
  await seed(platform.db, teamCount);
  return platform;
}

/** A snapshot read by `snapshot()`. `server_time` is deleted before the tests compare it. */
type ReadBody = Omit<Snapshot, 'server_time'> & { server_time?: string };

async function snapshot(db: D1Connection, n: number, sql = snapshotSql) {
  const caller = { accountId: `acc-${n}`, loginId: `login-${n}` };
  const result = await db.prepare(sql)
    .bind(caller.accountId, caller.loginId, ...contestDataBindings(caller, 'sess-1'), ...Array<string>(9).fill('sess-1'))
    .all<{ snapshot: string }>();
  const row = result.results[0];
  const body = row ? (JSON.parse(row.snapshot) as ReadBody) : null;
  if (body) delete body.server_time;
  return { rowsRead: result.meta?.rows_read ?? Infinity, body };
}

/**
 * Sums `meta.rows_read` over every statement. `first()` runs as `all()`,
 * because only `all()` returns `meta`. Local D1 reads the same rows for both.
 */
function metered(db: D1Connection) {
  const usage = { rowsRead: 0 };
  const originals = new WeakMap<D1Statement, D1Statement>();
  const count = (result: unknown) => {
    usage.rowsRead += (result as { meta?: { rows_read?: number } }).meta?.rows_read ?? Infinity;
  };
  const wrap = (statement: D1Statement): D1Statement => {
    const wrapped: D1Statement = {
      bind: (...values) => wrap(statement.bind(...values)),
      first: async <T>() => {
        const result = await statement.all<T>();
        count(result);
        return result.results[0] ?? null;
      },
      all: async <T>() => {
        const result = await statement.all<T>();
        count(result);
        return result;
      },
      run: async () => {
        const result = await statement.run();
        count(result);
        return result;
      },
    };
    originals.set(wrapped, statement);
    return wrapped;
  };
  const connection: D1Connection = {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: async (statements) => {
      const results = await db.batch(statements.map((statement) => originals.get(statement) ?? statement));
      results.forEach(count);
      return results;
    },
  };
  return { connection, usage };
}

async function expectReferenceSnapshots(db: D1Connection) {
  for (const [name, n] of Object.entries(callers)) {
    expect((await snapshot(db, n)).body, name).toEqual((await snapshot(db, n, referenceSnapshotSql)).body);
  }
}

// Measured on this seed on 2026-10-26. While each section read `access` again
// for every row, a snapshot read 7,377 rows for the admin, 4,841 for the
// volunteer and 1,442 for a contestant, who also read all 1,200 audit rows.
// After that change, and with a contestant's own team read by key, it read
// 6,487, 2,801 and 122. Each ceiling sits about 5% above the later read.
describe('rows read for a session with 1,200 accounts and 100 issues', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db, dispose } = await open(teams));
  });
  afterAll(async () => { await dispose?.(); });

  it('returns the reference snapshot to every caller', async () => {
    await expectReferenceSnapshots(db);
    expect((await snapshot(db, callers.revokedLogin)).body).toBeNull();
    for (const n of [callers.outsider, callers.otherSessionStaff]) {
      expect((await snapshot(db, n)).body).toMatchObject({ session: null, membership: null, teams: [], issues: [] });
    }
    expect((await snapshot(db, callers.plainMember)).body).toMatchObject({
      membership: { team_id: null, roles: [], is_admin: false }, teams: [], issues: [], history: [], audit: [],
    });
  });

  it('reads only the contestant team rows for a contestant snapshot', async () => {
    const { rowsRead, body } = await snapshot(db, callers.contestant);
    expect(body!.teams.map((team: { id: string }) => team.id)).toEqual(['team-8']);
    expect(body!.issues).toHaveLength(4);
    expect(body!.history.length).toBeGreaterThan(0);
    expect(body!.history.filter((entry: { visibility: string }) => entry.visibility !== 'public')).toEqual([]);
    expect(body!.attachments).toHaveLength(8);
    expect(body!.attachments.filter((image: { visibility: string }) => image.visibility !== 'public')).toEqual([]);
    expect(body!.pending_removals).toEqual([]);
    expect(body!.members).toEqual([]);
    expect(body!.audit).toEqual([]);
    expect(rowsRead).toBeLessThan(130);
  });

  // A contestant of a scheduled contest reads its own issues' awards for the personal end. Team 8 owns 4 issues,
  // and the seed resolved issues 1 to 40, so issues 7 and 31 hold resolutions. Measured on 2026-11-04.
  it('reads a bounded number of rows for a contestant of a scheduled contest with confirmed awards', async () => {
    const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
    await db.prepare(`UPDATE sessions SET starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'),
      ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'), intake_follows_schedule = 1 WHERE id = 'sess-1'`).run();
    await db.prepare(`UPDATE awards SET applied_at = ${now}, applied_by = 'acc-2', applied_name = 'Person 2' WHERE id = 'award-7'`).run();
    const { rowsRead, body } = await snapshot(db, callers.contestant);
    expect(body!.clock).toMatchObject({ extra_minutes: 5, intake: { reason: 'running' } });
    // Measured 126 on 2026-11-04, 14 rows more than the 112 of an unscheduled contest, because it reads the
    // contestant's issue awards. It stays under the ceiling of the unscheduled contestant snapshot.
    expect(rowsRead).toBeLessThan(130);
    await db.prepare("UPDATE sessions SET intake_follows_schedule = 0, starts_at = NULL, ends_at = NULL WHERE id = 'sess-1'").run();
    await db.prepare('UPDATE awards SET applied_at = NULL, applied_by = NULL, applied_name = NULL WHERE id = ?').bind('award-7').run();
  });

  it('returns staff notes and only their own removals to a volunteer within a bounded read', async () => {
    const { rowsRead, body } = await snapshot(db, callers.volunteer);
    expect(body!.teams).toHaveLength(teams);
    expect(body!.issues).toHaveLength(issues);
    expect(body!.history).toHaveLength(issues * 5);
    expect(body!.attachments).toHaveLength(300);
    expect(body!.pending_removals).toHaveLength(20);
    expect(body!.members).toEqual([]);
    expect(body!.audit).toEqual([]);
    expect(rowsRead).toBeLessThan(2_950);
  });

  it('returns every issue, member, image, and the latest audit to the admin within a bounded read', async () => {
    const { rowsRead, body } = await snapshot(db, callers.admin);
    expect(body!.issues).toHaveLength(issues);
    expect(body!.members).toHaveLength(accounts + 1);
    expect(body!.attachments).toHaveLength(300);
    expect(body!.pending_removals).toEqual([]);
    expect(body!.audit).toHaveLength(50);
    expect(rowsRead).toBeLessThan(6_800);
  });

  it('reads the admin snapshot for an event admin and a webmaster within the admin ceiling', async () => {
    const admin = (await snapshot(db, callers.admin)).body!;
    for (const n of [callers.eventAdmin, callers.webmaster]) {
      const { rowsRead, body } = await snapshot(db, n);
      expect(body!.membership).toMatchObject({ team_id: null, roles: [], is_admin: true });
      expect({ ...body!, membership: admin.membership }, `account ${n}`).toEqual(admin);
      expect(rowsRead, `account ${n}`).toBeLessThan(6_800);
    }
  });

  // Measured on 2026-10-26. While the list checked every ready avatar of the
  // installation, it read 6,015 rows for a contestant, 8,430 for the volunteer
  // and 7,229 for the admin. From the caller and the session staff, it read 12,
  // 1,224 and 1,223. Migration 0016 adds memberships_staff, so staff read the staff
  // memberships of the session and not every member: about 28 rows. The two
  // checks of one download read 24 rows before and 32 after.
  it('lists avatars from the caller and the session staff, not from every avatar', async () => {
    const bucket: PrivateBucket = {
      get: async () => ({ size: 1, body: new Response('x').body!, arrayBuffer: async () => new ArrayBuffer(1) }),
      put: async () => null,
      delete: async () => {},
    };
    const staff = ['acc-1', 'acc-2', 'acc-3'];
    for (const [n, owners, ceiling] of [
      [callers.contestant, [`acc-${callers.contestant}`], 15],
      [callers.volunteer, staff, 100],
      [callers.admin, staff, 100],
    ] as const) {
      const { connection, usage } = metered(db);
      const avatars = new R2AvatarService(connection, bucket);
      const list = await avatars.list({ accountId: `acc-${n}`, loginId: `login-${n}` }, 'sess-1');
      expect(list.map((avatar) => avatar.person_id).sort()).toEqual([...owners].sort());
      expect(usage.rowsRead, `account ${n}`).toBeLessThan(ceiling);
    }
    const { connection, usage } = metered(db);
    const download = await new R2AvatarService(connection, bucket)
      .download({ accountId: 'acc-2', loginId: 'login-2' }, 'sess-1', 'avatar-1');
    await download.body.cancel();
    expect(usage.rowsRead).toBeLessThan(36);
  });

  it('reads a handful of rows for the contests list', async () => {
    const list = async (n: number, eventId?: string) => {
      const caller = { accountId: `acc-${n}`, loginId: `login-${n}` };
      return eventId === undefined
        ? db.prepare(contestsListSql).bind(...contestListBindings(caller)).all<{ id: string }>()
        : db.prepare(eventContestsSql).bind(...contestListBindings(caller), eventId).all<{ id: string }>();
    };
    const result = await list(callers.contestant);
    expect(result.results).toEqual([expect.objectContaining({ id: 'sess-1', name: 'Scale session', event_id: 'ev-1', manage: 'none' })]);
    expect(result.meta?.rows_read ?? Infinity).toBeLessThan(30);
    for (const n of [callers.eventAdmin, callers.webmaster]) {
      expect((await list(n)).results.map((row) => row.id), `account ${n}`).toEqual(['sess-2', 'sess-1']);
    }
    const narrowed = await list(callers.contestant, 'ev-1');
    expect(narrowed.results.map((row) => row.id)).toEqual(['sess-1']);
    expect(narrowed.meta?.rows_read ?? Infinity).toBeLessThan(30);
    expect((await list(callers.contestant, 'ev-2')).results).toEqual([]);
  });

  // Every request reads the signed-in account before it does anything else.
  // Measured on 2026-11-04 it reads 4 to 5 rows, because ownHandleSql looks for a contestant
  // seat of the account through the memberships index and not through every member.
  it('reads a handful of rows for the account status of every request', async () => {
    for (const n of [callers.admin, callers.contestant, callers.eventAdmin, callers.webmaster]) {
      const result = await db.prepare(currentAccountSql).bind(`ids-${n}`, `acc-${n}`).all<{ id: string }>();
      expect(result.results.map((row) => row.id), `account ${n}`).toEqual([`acc-${n}`]);
      expect(result.meta?.rows_read ?? Infinity, `account ${n}`).toBeLessThan(10);
    }
  });
});

/**
 * The management commands refuse an ID that is not a UUID, so this world has UUID IDs:
 * one event and one contest with 24 teams, 1,200 accounts with logins, and 100 issues.
 * Account 1 is a contest admin, 1201 an event admin, and 1202 a staff member with no role.
 * Accounts 1203 to 1252 are 50 entrants of the event that no contest holds yet.
 */
const uuid = (group: number, index: string) => `printf('00000000-0000-4000-80${String(group).padStart(2, '0')}-%012d', ${index})`;
const world = {
  event: '00000000-0000-4000-8000-00000000e001', contest: '00000000-0000-4000-8000-00000000c001',
  bulk: '00000000-0000-4000-8000-00000000c002', account: (n: number) => `00000000-0000-4000-8001-${String(n).padStart(12, '0')}`,
  team: (n: number) => `00000000-0000-4000-8002-${String(n).padStart(12, '0')}`,
};

async function seedWorld(db: D1Connection): Promise<void> {
  const series = (count: number) => `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})`;
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const later = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day')";
  const run = (sql: string) => db.prepare(sql).run();
  const people = accounts + 3;
  await run(`INSERT INTO events (id, name) VALUES ('${world.event}', 'Scale event')`);
  await run(`INSERT INTO sessions (id, event_id, name) VALUES ('${world.contest}', '${world.event}', 'Scale session'), ('${world.bulk}', '${world.event}', 'Bulk session')`);
  await run(`${series(teams)} INSERT INTO teams (id, session_id, name, location)
    SELECT ${uuid(2, 'i')}, '${world.contest}', 'Team ' || i, 'Table ' || i FROM n`);
  await run(`${series(people)} INSERT INTO accounts (id, name, username, handle, must_change)
    SELECT ${uuid(1, 'i')}, 'Person ' || i, 'user' || i, 'user' || i, 0 FROM n`);
  await run(`${series(people)} INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
    SELECT ${uuid(1, 'i')}, 'Person ' || i, 'user' || i || '@x.invalid', 1, ${now}, ${now}, 'user' || i FROM n`);
  await run(`${series(people)} INSERT INTO ba_session (id, expiresAt, token, createdAt, updatedAt, userId)
    SELECT ${uuid(3, 'i')}, ${later}, 'tok-' || i, ${now}, ${now}, ${uuid(1, 'i')} FROM n`);
  await run(`${series(people)} INSERT INTO logins (id, account_id, expires_at, identity_session_id)
    SELECT ${uuid(4, 'i')}, ${uuid(1, 'i')}, unixepoch() + 86400, ${uuid(3, 'i')} FROM n`);
  await run(`${series(accounts)} INSERT INTO memberships (session_id, account_id, team_id, is_admin)
    SELECT '${world.contest}', ${uuid(1, 'i')}, CASE WHEN i = 1 THEN NULL ELSE ${uuid(2, `(1 + i % ${teams})`)} END, i = 1 FROM n`);
  await run(`INSERT INTO memberships (session_id, account_id, team_id) VALUES ('${world.contest}', '${world.account(1202)}', NULL)`);
  await run(`UPDATE accounts SET event_id = '${world.event}' WHERE id = '${world.account(1201)}'`);
  await run(`INSERT INTO grants (account_id, scope, event_id, granted_by) VALUES ('${world.account(1201)}', 'event', '${world.event}', 'fixture')`);
  await run(`${series(issues)} INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at)
    SELECT ${uuid(5, 'i')}, '${world.contest}', ${uuid(2, `(1 + i % ${teams})`)}, 'open', i, ${uuid(1, '2')}, 'Person', 'Devices', 'Fictional issue ' || i, ${now} FROM n`);
  // 50 entrants of the event that no contest holds, each with its own sign-in.
  await run(`${series(50)} INSERT INTO entrants (id, event_id, kind, name)
    SELECT ${uuid(6, 'i')}, '${world.event}', 'team', 'Waiting team ' || i FROM n`);
  await run(`${series(50)} INSERT INTO accounts (id, name, username, handle, event_id, entrant_id, must_change)
    SELECT ${uuid(7, 'i')}, 'Waiting team ' || i, 'waiting' || i, 'waiting' || i, '${world.event}', ${uuid(6, 'i')}, 0 FROM n`);
}

describe('rows read by live passwords with 800 seats', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  const hasher = { hash: async () => 'fictional-hash', verify: async () => false };
  const admin = { accountId: world.account(1201), loginId: '00000000-0000-4000-8004-000000001201' };
  const live = '00000000-0000-4000-8009-000000000001';
  const seat = (i: string) => uuid(8, i);

  beforeAll(async () => {
    const platform = await openStoreDatabase({ configPath, remoteBindings: false });
    await applyMigrations(platform.db);
    await seedWorld(platform.db);
    ({ db, dispose } = platform);
    const series = 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 800)';
    const run = (sql: string) => db.prepare(sql).run();
    await run(`INSERT INTO sessions (id, event_id, name, kind, starts_at, ends_at, intake_follows_schedule)
      VALUES ('${live}', '${world.event}', 'Live', 'live', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+2 hours'), 1)`);
    await run(`${series} INSERT INTO entrants (id, event_id, kind, name) SELECT ${seat('i')}, '${world.event}', 'team', 'Seat ' || i FROM n`);
    await run(`${series} INSERT INTO accounts (id, name, username, handle, event_id, entrant_id, must_change)
      SELECT ${seat('i')}, 'Seat ' || i, 'seat' || i, 'seat' || i, '${world.event}', ${seat('i')}, 0 FROM n`);
    await run(`${series} INSERT INTO teams (id, session_id, entrant_id, name) SELECT ${seat('i')}, '${live}', ${seat('i')}, 'Seat ' || i FROM n`);
  });
  afterAll(async () => { await dispose?.(); });

  // Measured on 2026-11-06: 509 rows for a batch, and 9,620 rows for the console. Each ceiling sits about 20% above.
  it('issues one batch of eight and reads the console within the ceilings', async () => {
    expect((await db.prepare('SELECT unready_seats FROM sessions WHERE id = ?').bind(live).first<{ unready_seats: number }>())!.unready_seats).toBe(800);
    const issuing = metered(db);
    const accountIds = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8008-${String(i + 1).padStart(12, '0')}`);
    const issued = await new D1ManageService(issuing.connection, hasher).issueCredentials(admin, randomUUID(), { eventId: world.event, accountIds, contestId: live });
    expect(issued.every((row) => row.temporaryPassword)).toBe(true);
    const reading = metered(db);
    const console_ = await new D1ManageService(reading.connection, hasher).event(admin, world.event);
    expect(console_.contests.find((contest) => contest.id === live)!.waiting).toHaveLength(792);
    expect(issuing.usage.rowsRead).toBeLessThan(620);
    expect(reading.usage.rowsRead).toBeLessThan(11_500);
  });
});

describe('rows read by management commands in a session with 1,200 accounts', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  const hasher = { hash: async () => 'fictional-hash', verify: async () => false };
  const as = (n: number) => ({ accountId: world.account(n), loginId: `00000000-0000-4000-8004-${String(n).padStart(12, '0')}` });

  beforeAll(async () => {
    const platform = await openStoreDatabase({ configPath, remoteBindings: false });
    await applyMigrations(platform.db);
    await seedWorld(platform.db);
    ({ db, dispose } = platform);
  });
  afterAll(async () => { await dispose?.(); });

  async function measure(n: number, command: ManageCommand) {
    const { connection, usage } = metered(db);
    const receipt = await new D1ManageService(connection, hasher).execute(as(n), randomUUID(), command);
    return { receipt, rowsRead: usage.rowsRead };
  }

  // Each command is its parse, reads, authority check, and one batch. Measured on 2026-11-04.
  // A command that tells the whole contest (the first two below, and update_contest) reads
  // the contest's 24 teams once for its audiences, then writes two audience rows for each.
  // The others read 23 to 47 rows. Each ceiling sits about 20% above the measure.
  it('reads a bounded number of rows for each command that changes one thing', async () => {
    const [fresh] = (await measure(1201, { type: 'create_entrants', eventId: world.event, entrants: [{ kind: 'team', name: 'Fresh team', handle: 'fresh-team' }] })).receipt.entrantIds!;
    const commands: Array<[ManageCommand, number, number]> = [
      [{ type: 'set_intake', contestId: world.contest, mode: 'open' }, 1, 90],
      [{ type: 'set_image_limits', contestId: world.contest, fileMegabytes: 10, count: 12, totalMegabytes: 100 }, 1, 120],
      [{ type: 'set_location', contestId: world.contest, entrantId: world.team(3), location: 'Hall 2' }, 1, 40],
      [{ type: 'assign_staff', contestId: world.contest, accountId: world.account(1202), roles: ['jury'], admin: false }, 1201, 60],
      [{ type: 'unassign_staff', contestId: world.contest, accountId: world.account(1202) }, 1201, 50],
      [{ type: 'assign_entrants', contestId: world.contest, entries: [{ entrantId: fresh!, location: 'Hall 9' }] }, 1201, 150],
      [{ type: 'update_contest', contestId: world.contest, name: 'Scale session', contestType: 'teams', schedule: testSchedule }, 1201, 135],
      [{ type: 'create_contest', kind: 'practice', eventId: world.event, name: 'Another', contestType: 'mixed', schedule: testSchedule, categories: ['Other'] }, 1201, 30],
      [{ type: 'create_people', eventId: world.event, people: [{ handle: 'fresh-person', name: 'Fresh person' }] }, 1201, 40],
    ];
    for (const [command, n, ceiling] of commands) {
      expect((await measure(n, command)).rowsRead, command.type).toBeLessThan(ceiling);
    }
  });

  // Removing an entry deletes its seats (the entry_seats_removed trigger), and the memberships
  // foreign key finds the seats of the deleted team. Before the index in migration 0019 each read scanned
  // the contest's memberships: 2,443 rows for 1,200 members, measured on 2026-11-04.
  // With memberships_team they read only the entry's seat: 43 rows.
  it('reads only the seats of the entry when an entry is removed', async () => {
    const [fresh] = (await measure(1201, { type: 'create_entrants', eventId: world.event, entrants: [{ kind: 'team', name: 'Leaving team', handle: 'leaving-team' }] })).receipt.entrantIds!;
    await measure(1201, { type: 'assign_entrants', contestId: world.contest, entries: [{ entrantId: fresh!, location: '' }] });
    expect((await measure(1201, { type: 'unassign_entrant', contestId: world.contest, entrantId: fresh! })).rowsRead).toBeLessThan(55);
  });

  // Fifty entrants with their sign-ins enter one contest in one command. Measured 1,107 rows on 2026-11-05,
  // about 22 for each entry: its seat, its triggers, its name, and its sign-in lookup.
  it('reads a bounded number of rows to assign 50 entrants at once', async () => {
    const entries = Array.from({ length: 50 }, (_, index) => ({ entrantId: `00000000-0000-4000-8006-${String(index + 1).padStart(12, '0')}`, location: `Table ${index + 1}` }));
    const { receipt, rowsRead } = await measure(1201, { type: 'assign_entrants', contestId: world.bulk, entries });
    expect(receipt.entrantIds).toHaveLength(50);
    expect((await db.prepare('SELECT count(*) AS n FROM memberships WHERE session_id = ?').bind(world.bulk).all<{ n: number }>()).results).toEqual([{ n: 50 }]);
    expect(rowsRead).toBeLessThan(1_200);
  });

  // A contest-wide award tells the staff and every team of the contest, like set_intake. The contest has 24 teams,
  // so each command reads the team list once and writes two audience rows for each. Measured on 2026-11-04:
  // 101 rows to grant and 105 to confirm after the tests above (72 and 101 when run alone), all above the
  // 60-row target of the workflow commands. A contest of 800 teams reads about 800 more rows for the list.
  it('reads a bounded number of rows to grant and to confirm a contest-wide award', async () => {
    await db.prepare("INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'jury')").bind(world.contest, world.account(1)).run();
    const read = async (command: Parameters<D1ContestAwardService['execute']>[3]) => {
      const { connection, usage } = metered(db);
      const id = await new D1ContestAwardService(connection).execute(as(1), world.contest, randomUUID(), command);
      return { id, rowsRead: usage.rowsRead };
    };
    const granted = await read({ type: 'grant', minutes: 15, explanation: 'Fictional outage' });
    expect(granted.rowsRead, 'grant').toBeLessThan(125);
    expect((await read({ type: 'apply', awardId: granted.id })).rowsRead, 'apply').toBeLessThan(130);
  });

  // The calendar of a member reads the member's own event through sessions_event_schedule. Other events add no rows.
  // Measured on 2026-11-04: 29 rows for a contestant with 3 scheduled contests of its event and 60 of another event.
  // Before the webmaster branch read its grant once, the grant check ran for each of the 60 and the read took 152 rows.
  it('reads only the member\'s own event for a calendar window', async () => {
    const other = '00000000-0000-4000-8000-00000000e002';
    const series = (count: number) => `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})`;
    await db.prepare(`UPDATE sessions SET starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'),
      intake_follows_schedule = 1 WHERE event_id = ?`).bind(world.event).run();
    await db.prepare("INSERT INTO events (id, name) VALUES (?, 'Other event')").bind(other).run();
    await db.prepare(`${series(60)} INSERT INTO sessions (id, event_id, name, starts_at, ends_at, intake_follows_schedule)
      SELECT ${uuid(9, 'i')}, '${other}', 'Elsewhere ' || i, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || i || ' hours'), 1 FROM n`).run();
    const window = { from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 86_400_000).toISOString() };
    for (const [name, n, ceiling] of [['a contestant', 7, 40], ['a contest admin', 1, 40]] as const) {
      const { connection, usage } = metered(db);
      const contests = await new D1ApplicationService(connection).contests(as(n), { window });
      expect(contests.map((contest) => contest.eventId), name).toEqual(Array(contests.length).fill(world.event));
      expect(contests.length, name).toBeGreaterThanOrEqual(2);
      expect(usage.rowsRead, name).toBeLessThan(ceiling);
    }
  });
});

// Measured on 2026-10-26, a contestant snapshot in a session of 480 teams read
// 1,014 rows while it read every team of the session, and 56 rows after.
describe('rows read in a session of 480 teams', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db, dispose } = await open(480));
  });
  afterAll(async () => { await dispose?.(); });

  it('returns the reference snapshot to every caller and reads no other team', async () => {
    await expectReferenceSnapshots(db);
    const { rowsRead, body } = await snapshot(db, callers.contestant);
    expect(body!.teams.map((team: { id: string }) => team.id)).toEqual(['team-8']);
    expect((await snapshot(db, callers.volunteer)).body!.teams).toHaveLength(480);
    expect(rowsRead).toBeLessThan(60);
  });

  // Each command is the store's read and its commit batch. Measured on
  // 2026-10-26, while every command built the session's team list four times,
  // a claim read 1,494 rows. With only the named team, the four commands read
  // 49 to 55 rows. By 2026-11-02 they read 52 to 58 rows. Deleting a batch's
  // assertion rows by key range lowered that to 47 to 53 rows.
  it('reads no team list for a workflow command, and only the named team for a submit', async () => {
    await db.prepare("UPDATE sessions SET intake_open = 1 WHERE id = 'sess-1'").run();
    const commands: Array<[number, Command]> = [
      [callers.volunteer, { type: 'claim', issue_id: 'issue-1', revision: 1 }],
      [callers.contestant, { type: 'message', issue_id: 'issue-7', revision: 1, text: 'Fictional reply', visibility: 'public' }],
      [callers.volunteer, { type: 'submit', category: 'Devices', description: 'Fictional report', team_id: 'team-9' }],
      [callers.contestant, { type: 'submit', category: 'Devices', description: 'Fictional report' }],
    ];
    for (const [n, command] of commands) {
      const caller = { accountId: `acc-${n}`, loginId: `login-${n}` };
      const requestId = randomUUID();
      const { connection, usage } = metered(db);
      const store = new D1ApplicationStore(connection);
      const read = await store.read(caller, 'sess-1', requestId, command);
      const decision = read && decideWorkflow(read.state, command);
      if (!read || !decision || 'outcome' in decision) throw new Error(`${command.type} by account ${n} was not accepted.`);
      expect(await store.commit(caller, 'sess-1', requestId, command, read, decision)).toMatchObject({ outcome: 'committed' });
      expect(usage.rowsRead, `${command.type} by account ${n}`).toBeLessThan(60);
    }
  });

  // A contest that follows its schedule reads the contestant's confirmed awards to find the personal end.
  // The seed's contest has no schedule, so the two tests above read none. Here team 8's one issue carries
  // a confirmed award, and the contest holds a confirmed contest-wide award.
  it('reads a bounded number of rows for a scheduled contest with confirmed awards', async () => {
    const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
    const run = (sql: string) => db.prepare(sql).run();
    // The contest ended 5 minutes ago. Only the confirmed 15 minutes keep this contestant open, so every read pays for them.
    await run(`UPDATE sessions SET starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'),
      ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'), grace_minutes = 0, intake_follows_schedule = 1 WHERE id = 'sess-1'`);
    // The seed resolved issues 1 to 40 and decided awards for 1 to 20. Team 8 owns issue 7, so its award gets confirmed.
    await run(`UPDATE awards SET applied_at = ${now}, applied_by = 'acc-2', applied_name = 'Person 2' WHERE id = 'award-7'`);
    await run(`INSERT INTO contest_awards (id, session_id, request_id, minutes, explanation, actor, actor_name, at, applied_at, applied_by, applied_name, applied_request)
      VALUES ('wide-1', 'sess-1', 'req-wide', 10, 'Fictional outage', 'acc-3', 'Person 3', ${now}, ${now}, 'acc-2', 'Person 2', 'req-apply')`);
    const { rowsRead, body } = await snapshot(db, callers.contestant);
    expect(body!.clock).toMatchObject({ extra_minutes: 15, follows_schedule: true, intake: { open: true, reason: 'running' } });
    expect(body!.contest_awards).toHaveLength(1);
    // Measured 78 rows on 2026-11-04, after the commands above gave the team a second issue. The same contest without a schedule reads fewer.
    expect(rowsRead).toBeLessThan(90);
    const command: Command = { type: 'submit', category: 'Devices', description: 'Fictional report' };
    const caller = { accountId: `acc-${callers.contestant}`, loginId: `login-${callers.contestant}` };
    const requestId = randomUUID();
    const { connection, usage } = metered(db);
    const store = new D1ApplicationStore(connection);
    const read = await store.read(caller, 'sess-1', requestId, command);
    const decision = read && decideWorkflow(read.state, command);
    if (!read || !decision || 'outcome' in decision) throw new Error('The scheduled submit was not accepted.');
    expect(await store.commit(caller, 'sess-1', requestId, command, read, decision)).toMatchObject({ outcome: 'committed' });
    // Measured 57 rows on 2026-11-04, the worst case: the contestant has three issues and holds only through confirmed extra time.
    expect(usage.rowsRead, 'scheduled submit by a contestant with awards').toBeLessThan(60);
    const volunteer = await snapshot(db, callers.volunteer);
    expect(volunteer.body!.clock).toMatchObject({ extra_minutes: 0, personal_end_at: null });
    expect(volunteer.body!.contest_awards).toHaveLength(1);
  });
});
