import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { contestRecordSchema } from '../../../connected/contestRecord';
import type { D1Connection, D1Statement } from '../d1/connection';
import { D1Fixture, applyMigrations } from '../d1/testFixture';
import { D1ContestRecordService, headerSql } from './contestRecord';
import { fenceFixtureEvent } from './eventDeletionFixture';
import { openLocalPlatform } from './tooling/store-database.mjs';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const configPath = 'wrangler.auth-ci.jsonc';
// More than two pages of rows. Few distinct times, so most rows tie on `at`.
const BULK = 2100;

const newIds = () => ({
  resolution: randomUUID(), otherResolution: randomUUID(), readyImage: randomUUID(), deletedImage: randomUUID(),
  announcement: randomUUID(), removedAnnouncement: randomUUID(), readyFile: randomUUID(), deletedFile: randomUUID(),
});

describe('the contest record read with local D1', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  let fixture: D1Fixture;
  let neighbor: D1Fixture;
  let service: D1ContestRecordService;
  let created: D1Fixture[];
  let ids: ReturnType<typeof newIds>;

  const statement = (sql: string, ...values: Array<string | number | null>): D1Statement => db.prepare(sql).bind(...values);
  const rows = (sql: string, ...values: Array<string | number | null>) => fixture.rows(sql, ...values);
  const at = (minute: number) => `2026-01-01T00:${String(minute).padStart(2, '0')}:00.000Z`;

  beforeAll(async () => {
    const platform = await openLocalPlatform<{ DB: D1Connection }>(configPath);
    db = platform.env.DB;
    dispose = platform.dispose;
    await applyMigrations(db);
  });
  afterAll(async () => { await dispose?.(); });

  /** Gives the fixture an admin, named seats, and one row of every kind in its first contest, and some noise in other contests. */
  async function seed(target: D1Fixture, marker: string): Promise<ReturnType<typeof newIds>> {
    const ids = newIds();
    const staff = target.staff.accountId;
    await db.batch([
      statement('UPDATE memberships SET is_admin = 1 WHERE session_id = ? AND account_id = ?', target.sessionId, staff),
      statement('UPDATE accounts SET handle = ?, username = ? WHERE id = ?', `${marker}-handle`, `${marker}-login-key`, staff),
      statement(`INSERT INTO history (id, issue_id, actor, actor_name, at, text, visibility) VALUES
        (?, ?, ?, 'Staff', ?, ?, 'public'), (?, ?, ?, 'Staff', ?, ?, 'internal'), (?, ?, ?, 'Staff', ?, ?, 'public')`,
      randomUUID(), target.issueId, staff, at(1), `${marker} public reply`,
      randomUUID(), target.issueId, staff, at(2), `${marker} internal note`,
      randomUUID(), target.secondSessionIssueId, staff, at(3), `${marker} history of the second contest`),
      statement(`INSERT INTO resolutions (id, session_id, issue_id, actor, actor_name, at, summary) VALUES
        (?, ?, ?, ?, 'Staff', ?, ?), (?, ?, ?, ?, 'Staff', ?, ?)`,
      ids.resolution, target.sessionId, target.issueId, staff, at(4), `${marker} resolved`,
      ids.otherResolution, target.sessionId, target.otherIssueId, staff, at(5), `${marker} also resolved`),
      statement(`INSERT INTO awards (id, session_id, issue_id, resolution_id, minutes, explanation, actor, actor_name, at,
          applied_at, applied_by, applied_name) VALUES (?, ?, ?, ?, 5, ?, ?, 'Staff', ?, ?, ?, 'Staff')`,
      randomUUID(), target.sessionId, target.issueId, ids.resolution, `${marker} confirmed award`, staff, at(6), at(7), staff),
      statement(`INSERT INTO awards (id, session_id, issue_id, resolution_id, minutes, explanation, actor, actor_name, at,
          withdrawn_at, withdrawn_by, withdrawn_name) VALUES (?, ?, ?, ?, 7, ?, ?, 'Staff', ?, ?, ?, 'Staff')`,
      randomUUID(), target.sessionId, target.otherIssueId, ids.otherResolution, `${marker} withdrawn award`, staff, at(6), at(8), staff),
      statement(`INSERT INTO contest_awards (id, session_id, request_id, minutes, explanation, actor, actor_name, at,
          withdrawn_at, withdrawn_by, withdrawn_name, withdrawn_request) VALUES (?, ?, ?, 10, ?, ?, 'Staff', ?, ?, ?, 'Staff', ?)`,
      randomUUID(), target.sessionId, randomUUID(), `${marker} withdrawn contest award`, staff, at(9), at(10), staff, randomUUID()),
      statement(`INSERT INTO contest_awards (id, session_id, request_id, minutes, explanation, actor, actor_name, at)
          VALUES (?, ?, ?, 10, ?, ?, 'Staff', ?)`, randomUUID(), target.sessionId, randomUUID(), `${marker} waiting contest award`, staff, at(11)),
      statement(`INSERT INTO announcements (id, session_id, title, details, author, author_name, published_at) VALUES
        (?, ?, ?, 'Details', ?, 'Staff', ?)`, ids.announcement, target.sessionId, `${marker} live announcement`, staff, at(12)),
      statement(`INSERT INTO announcements (id, session_id, title, details, author, author_name, published_at, removed_at, removed_by, removed_name)
        VALUES (?, ?, ?, 'Details', ?, 'Staff', ?, ?, ?, 'Staff')`,
      ids.removedAnnouncement, target.sessionId, `${marker} removed announcement`, staff, at(13), at(14), staff),
      statement(`INSERT INTO announcement_images (id, session_id, announcement_id, uploader, uploader_name, request_id, request_command,
          name, declared_bytes, byte_size, content_type, digest, object_key, state, uploaded_at)
          VALUES (?, ?, ?, ?, 'Staff', ?, '{}', 'ready.png', 20, 20, 'image/png', ?, ?, 'ready', ?)`,
      ids.readyFile, target.sessionId, ids.removedAnnouncement, staff, randomUUID(), 'a'.repeat(64), `${marker}/ready-file`, at(15)),
      statement(`INSERT INTO announcement_images (id, session_id, announcement_id, uploader, uploader_name, request_id, request_command,
          name, declared_bytes, byte_size, content_type, digest, object_key, state, uploaded_at, deleted_by, deleted_at)
          VALUES (?, ?, ?, ?, 'Staff', ?, '{}', 'gone.png', 20, 20, 'image/png', ?, ?, 'deleted', ?, ?, ?)`,
      ids.deletedFile, target.sessionId, ids.announcement, staff, randomUUID(), 'b'.repeat(64), `${marker}/deleted-file`, at(15), staff, at(16)),
      ...([[ids.readyImage, 'ready', null], [ids.deletedImage, 'deleted', staff]] as const).map(([id, state, deletedBy]) => statement(
        `INSERT INTO issue_images (id, session_id, issue_id, uploader, request_id, uploader_name, uploaded_at, visibility,
            declared_bytes, byte_size, content_type, original_name, state, original_path, thumbnail_path, original_digest, deleted_by, deleted_at)
          VALUES (?, ?, ?, ?, ?, 'Staff', ?, 'internal', 20, 20, 'image/png', ?, ?, ?, ?, ?, ?, ?)`,
        id, target.sessionId, target.issueId, staff, randomUUID(), at(17), `${marker}-${state}.png`, state,
        `${target.sessionId}/${target.issueId}/${id}/original`, `${target.sessionId}/${target.issueId}/${id}/thumbnail`, 'c'.repeat(64),
        deletedBy, deletedBy ? at(18) : null)),
      statement(`INSERT INTO admin_audit (id, session_id, actor, at, action, target, detail) VALUES
        (?, ?, ?, ?, ?, ?, json_object('marker', ?))`, randomUUID(), target.secondSessionId, staff, at(19), 'audit of the second contest', null, marker),
    ]);
    // Rows tie on `at`, so a page boundary falls inside a tie. Two issues share the history, and one contest all the audit.
    const series = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${BULK})`;
    await statement(`${series} INSERT INTO admin_audit (id, session_id, actor, at, action, target, detail)
      SELECT printf('%08d-0000-4000-8000-', i) || ?, ?, ?, printf('2026-01-02T00:00:%02d.000Z', i % 3), 'bulk', NULL,
        json_object('n', i, 'marker', ?) FROM n`, target.sessionId.slice(-12), target.sessionId, staff, marker).run();
    await statement(`${series} INSERT INTO history (id, issue_id, actor, actor_name, at, text, visibility)
      SELECT printf('%08d-0001-4000-8000-', i) || ?, CASE i % 2 WHEN 0 THEN ? ELSE ? END, ?, 'Staff',
        printf('2026-01-02T00:00:%02d.000Z', i % 5), ? || i, CASE i % 3 WHEN 0 THEN 'internal' ELSE 'public' END FROM n`,
    target.sessionId.slice(-12), target.issueId, target.otherIssueId, staff, `${marker} bulk `).run();
    return ids;
  }

  beforeEach(async () => {
    created = [];
    fixture = new D1Fixture(db, configPath, true);
    neighbor = new D1Fixture(db, configPath, true);
    for (const item of [fixture, neighbor]) {
      await item.create();
      created.push(item);
    }
    ids = await seed(fixture, 'alpha');
    await seed(neighbor, 'omega');
    service = new D1ContestRecordService(db);
  });

  afterEach(async () => {
    for (const item of created) await item.cleanup();
  });

  const read = async (target = fixture) => {
    const text = await service.read(target.staff, target.sessionId);
    return { text, record: contestRecordSchema.parse(JSON.parse(text)) };
  };

  it('returns a record that parses, with internal notes and withdrawn awards kept', async () => {
    const { record } = await read();
    expect(record).toMatchObject({
      format: 'minsky-contest-record', version: 1,
      exported_by: { id: fixture.staff.accountId, name: `d1-proof:${fixture.eventId}:0` },
      event: { id: fixture.eventId, archived: false }, contest: { id: fixture.sessionId, kind: 'practice', intake_follows_schedule: false },
    });
    const history = Object.fromEntries(record.history.map((entry) => [entry.text, entry.visibility]));
    expect(history).toMatchObject({ 'alpha public reply': 'public', 'alpha internal note': 'internal' });
    expect(record.awards.map((award) => [award.explanation, award.withdrawn_at !== null, award.applied_at !== null]).sort())
      .toEqual([['alpha confirmed award', false, true], ['alpha withdrawn award', true, false]]);
    expect(record.contest_awards.map((award) => [award.explanation, award.withdrawn_name]).sort())
      .toEqual([['alpha waiting contest award', null], ['alpha withdrawn contest award', 'Staff']]);
    expect(record.resolutions.map((resolution) => resolution.summary)).toEqual(['alpha resolved', 'alpha also resolved']);
  });

  it('names members by handle, never by login key, and flags admins', async () => {
    const { text, record } = await read();
    expect(record.members.find((member) => member.account_id === fixture.staff.accountId))
      .toMatchObject({ name: `d1-proof:${fixture.eventId}:0`, handle: 'alpha-handle', is_admin: true, team_id: null });
    expect(record.members.find((member) => member.account_id === fixture.contestant.accountId)?.team_id).toBe(fixture.teamId);
    expect(text).not.toContain('alpha-login-key');
    expect(record.teams.map((team) => team.id).sort()).toEqual([fixture.teamId, fixture.otherTeamId].sort());
  });

  it('keeps removed announcements and every image row, with a path only for a ready file', async () => {
    const { record } = await read();
    expect(record.announcements.find((announcement) => announcement.id === ids.removedAnnouncement))
      .toMatchObject({ title: 'alpha removed announcement', removed_name: 'Staff', removed_by: fixture.staff.accountId });
    expect(record.issue_images.map((image) => [image.state, image.original_path]).sort()).toEqual([
      ['deleted', null], ['ready', `${fixture.sessionId}/${fixture.issueId}/${ids.readyImage}/original`],
    ]);
    expect(record.announcement_images.map((image) => [image.state, image.object_key]).sort()).toEqual([
      ['deleted', null], ['ready', 'alpha/ready-file'],
    ]);
  });

  it('keeps every audit and history row across pages, in key order, with parsed detail', async () => {
    const { record } = await read();
    const audit = await rows('SELECT id FROM admin_audit WHERE session_id = ? ORDER BY at, id', fixture.sessionId);
    expect(audit.length).toBeGreaterThan(2 * 1000);
    expect(record.audit.length).toBe(audit.length);
    expect(record.audit.map((entry) => entry.id)).toEqual(audit.map((entry) => entry.id));
    expect(record.audit.find((entry) => entry.action === 'bulk')?.detail).toMatchObject({ marker: 'alpha' });
    expect(record.audit.find((entry) => entry.action === 'bulk')?.actor_name).toBe(`d1-proof:${fixture.eventId}:0`);
    const history = await rows(`SELECT h.id FROM history h JOIN issues i ON i.id = h.issue_id WHERE i.session_id = ?
      ORDER BY i.number, h.at, h.id`, fixture.sessionId);
    expect(history.length).toBeGreaterThan(2 * 1000);
    expect(record.history.length).toBe(history.length);
    expect(record.history.map((entry) => entry.id)).toEqual(history.map((entry) => entry.id));
  });

  it('holds nothing of another contest or another event', async () => {
    const { text, record } = await read();
    expect(text).not.toContain('omega');
    expect(text).not.toContain('history of the second contest');
    expect(text).not.toContain('audit of the second contest');
    expect(new Set(record.issues.map((issue) => issue.session_id))).toEqual(new Set([fixture.sessionId]));
    expect(record.issues.map((issue) => issue.number)).toEqual([1, 2]);
    expect(record.audit.every((entry) => !entry.action.includes('second'))).toBe(true);
  });

  it('reads the neighbor contest as its own record', async () => {
    const { text, record } = await read(neighbor);
    expect(text).not.toContain('alpha');
    expect(record.contest.id).toBe(neighbor.sessionId);
  });

  it('refuses every seat that is not a contest admin, and a bad ID', async () => {
    for (const caller of [fixture.specialist, fixture.contestant, fixture.otherContestant, neighbor.staff]) {
      await expect(service.read(caller, fixture.sessionId)).rejects.toMatchObject({ status: 403 });
    }
    // The fixture's staff is a volunteer, not an admin, in the second contest.
    await expect(service.read(fixture.staff, fixture.secondSessionId)).rejects.toMatchObject({ status: 403 });
    await expect(service.read(fixture.staff, 'not-an-id')).rejects.toMatchObject({ status: 400 });
  });

  it('returns nothing when access ends during the read', async () => {
    const revoking: D1Connection = {
      batch: (statements) => db.batch(statements),
      prepare(sql) {
        const inner = db.prepare(sql);
        if (sql !== headerSql) return inner;
        const revoke = () => statement('UPDATE logins SET revoked = 1 WHERE id = ?', fixture.staff.loginId).run();
        const guarded = (target: D1Statement): D1Statement => ({
          bind: (...values) => guarded(target.bind(...values)),
          first: async <T>() => { await revoke(); return target.first<T>(); },
          all: target.all.bind(target), run: target.run.bind(target),
        });
        return guarded(inner);
      },
    };
    await expect(new D1ContestRecordService(revoking).read(fixture.staff, fixture.sessionId)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a contest whose event is fenced for deletion', async () => {
    await fenceFixtureEvent(db, fixture.eventId);
    await expect(service.read(fixture.staff, fixture.sessionId)).rejects.toMatchObject({ status: 403 });
  });
});
