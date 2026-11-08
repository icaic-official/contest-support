import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Caller } from '../../authentication';
import type { D1Connection, D1Statement } from '../d1/connection';
import { D1Fixture, applyMigrations } from '../d1/testFixture';
import { D1ApplicationService } from './application';
import { openLocalPlatform } from './tooling/store-database.mjs';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe('Cloudflare authorized application and administration', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  let fixture: D1Fixture;
  let service: D1ApplicationService;
  let created = false;
  let publicImage: string;
  let internalImage: string;
  let removal: string;
  let resolution: string;

  function statement(sql: string, ...values: Array<string | number | null>): D1Statement {
    return db.prepare(sql).bind(...values);
  }

  beforeAll(async () => {
    const platform = await openLocalPlatform<{ DB: D1Connection }>('wrangler.auth-ci.jsonc');
    db = platform.env.DB;
    dispose = platform.dispose;
    await applyMigrations(db);
  });

  afterAll(async () => { if (dispose) await dispose(); });

  beforeEach(async () => {
    created = false;
    fixture = new D1Fixture(db, 'wrangler.auth-ci.jsonc');
    await fixture.create();
    created = true;
    service = new D1ApplicationService(db);
    const now = new Date().toISOString();
    for (const [index, caller] of [fixture.staff, fixture.specialist, fixture.contestant, fixture.otherContestant].entries()) {
      const identityId = randomUUID();
      await db.batch([
        statement(`INSERT INTO ba_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
          caller.accountId, 'Fictional fixture', `${caller.accountId}@fixture.invalid`, now, now),
        statement(`INSERT INTO ba_session (id, userId, token, createdAt, updatedAt, expiresAt)
          VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'))`,
        identityId, caller.accountId, randomUUID(), now, now),
        statement('UPDATE logins SET identity_session_id = ? WHERE id = ?', identityId, caller.loginId),
        statement('UPDATE accounts SET username = ? WHERE id = ?', `fixture_${index}_${fixture.eventId.slice(0, 8)}`, caller.accountId),
      ]);
    }
    publicImage = randomUUID();
    internalImage = randomUUID();
    removal = randomUUID();
    resolution = randomUUID();
    await db.batch([
      statement('UPDATE events SET name = ? WHERE id = ?', 'Fictional event', fixture.eventId),
      statement('UPDATE sessions SET name = ? WHERE id = ?', 'Fictional session', fixture.sessionId),
      statement('UPDATE memberships SET is_admin = 1 WHERE session_id = ? AND account_id = ?', fixture.sessionId, fixture.staff.accountId),
      statement('UPDATE teams SET name = ?, location = ? WHERE id = ?', 'Fictional Alpha', 'Desk A', fixture.teamId),
      statement('UPDATE teams SET name = ?, location = ? WHERE id = ?', 'Fictional Beta', 'Desk B', fixture.otherTeamId),
      statement(`UPDATE issues SET number = CASE WHEN id = ? THEN 1 ELSE 2 END,
        reporter = ?, reporter_name = 'Fictional reporter', category = 'Other',
        description = 'Fictional report', created_at = ?, write_version = write_version + 1
        WHERE session_id = ?`, fixture.issueId, fixture.contestant.accountId, now, fixture.sessionId),
      statement(`UPDATE issues SET team_id = ?, write_version = write_version + 1 WHERE id = ?`, fixture.otherTeamId, fixture.otherIssueId),
      statement(`INSERT INTO history (id, issue_id, actor, actor_name, at, text, visibility)
        VALUES (?, ?, ?, 'Fictional staff', ?, 'Public reply', 'public'),
          (?, ?, ?, 'Fictional staff', ?, 'Private note', 'internal')`,
      randomUUID(), fixture.issueId, fixture.staff.accountId, now,
      randomUUID(), fixture.issueId, fixture.staff.accountId, now),
      statement(`INSERT INTO resolutions (id, session_id, issue_id, actor, actor_name, at, summary,
        reopened_at, reopened_by, reopened_name, reason)
        VALUES (?, ?, ?, ?, 'Fictional specialist', ?, 'First resolution retained', ?, ?, 'Fictional contestant', 'Fictional recurrence')`,
      resolution, fixture.sessionId, fixture.issueId, fixture.specialist.accountId, now, now, fixture.contestant.accountId),
      statement(`INSERT INTO awards (id, session_id, issue_id, resolution_id, minutes, explanation, actor, actor_name, at,
        applied_at, applied_by, applied_name) VALUES (?, ?, ?, ?, 5, 'Fictional award', ?, 'Fictional jury', ?, ?, ?, 'Fictional staff')`,
      randomUUID(), fixture.sessionId, fixture.issueId, resolution, fixture.staff.accountId, now, now, fixture.staff.accountId),
      statement(`INSERT INTO admin_audit (id, session_id, actor, action, target)
        VALUES (?, ?, ?, 'fixture_setup', ?)`, randomUUID(), fixture.sessionId, fixture.staff.accountId, fixture.contestant.accountId),
    ]);
    for (const [id, visibility, state] of [
      [publicImage, 'public', 'ready'], [internalImage, 'internal', 'ready'], [removal, 'internal', 'deleting'],
    ] as const) {
      await statement(`INSERT INTO issue_images (id, session_id, issue_id, uploader, request_id, uploader_name,
        uploaded_at, visibility, declared_bytes, byte_size, content_type, original_name, state,
        original_path, thumbnail_path, deleted_by, deleted_at)
        VALUES (?, ?, ?, ?, ?, 'Fictional staff', ?, ?, 20, 20, 'image/png', 'fixture.png', ?, ?, ?, ?, ?)`,
      id, fixture.sessionId, fixture.issueId, fixture.staff.accountId, randomUUID(), now, visibility,
      state, `${id}/original`, `${id}/thumbnail`, state === 'deleting' ? fixture.staff.accountId : null,
      state === 'deleting' ? now : null).run();
    }
  });

  afterEach(async () => {
    if (!created) return;
    await fixture.cleanup();
  });

  it('returns complete permitted timing, resolutions, awards, image metadata, and identity names', async () => {
    // A handle that differs from the login key. The member list shows the handle, and no response shows the key.
    const loginKey = (await fixture.rows('SELECT username FROM accounts WHERE id = ?', fixture.specialist.accountId))[0]!.username;
    await statement('UPDATE accounts SET handle = ? WHERE id = ?', 'shown-handle', fixture.specialist.accountId).run();
    const view = await service.snapshot(fixture.staff, fixture.sessionId);
    expect(view.members.find((member) => member.person.id === fixture.specialist.accountId)?.person.username).toBe('shown-handle');
    expect(JSON.stringify(view)).not.toContain(String(loginKey));
    expect(view.session).toMatchObject({ name: 'Fictional session', max_image_bytes: 10485760, max_images_per_issue: 12 });
    expect(view.event).toMatchObject({ name: 'Fictional event', archived: false });
    expect(view.membership).toMatchObject({ is_admin: true, roles: ['volunteer'] });
    expect(view.issues).toHaveLength(2);
    expect(view.issues.find((issue) => issue.id === fixture.issueId)).toMatchObject({ reporter_name: 'Fictional reporter', number: 1 });
    expect(view.resolutions).toEqual([expect.objectContaining({ id: resolution, reopened_by: fixture.contestant.accountId })]);
    expect(view.awards).toEqual([expect.objectContaining({ minutes: 5, applied_name: 'Fictional staff' })]);
    expect(view.history.map((entry) => entry.text).sort()).toEqual(['Private note', 'Public reply']);
    expect(view.attachments.map((image) => image.id).sort()).toEqual([publicImage, internalImage].sort());
    expect(view.pending_removals).toEqual([{ id: removal, issue_id: fixture.issueId, original_name: 'fixture.png' }]);
    expect(view.members).toHaveLength(4);
    expect(view.audit).toHaveLength(1);
  });

  it('omits other teams, staff notes, private images, membership lists, and audit from contestants', async () => {
    const view = await service.snapshot(fixture.contestant, fixture.sessionId);
    expect(view.teams.map((team) => team.id)).toEqual([fixture.teamId]);
    expect(view.issues.map((issue) => issue.id)).toEqual([fixture.issueId]);
    expect(view.history.map((entry) => entry.text)).toEqual(['Public reply']);
    expect(view.attachments.map((image) => image.id)).toEqual([publicImage]);
    expect(view.members).toEqual([]);
    expect(view.audit).toEqual([]);
    expect(view.pending_removals).toEqual([]);
    expect(view.resolutions).toHaveLength(1);
    expect(view.awards).toHaveLength(1);
    const other = await service.snapshot(fixture.otherContestant, fixture.sessionId);
    expect(other.history).toEqual([]);
    expect(other.resolutions).toEqual([]);
    expect(other.awards).toEqual([]);
    expect(other.attachments).toEqual([]);
  });

  it('does not expose an uploader cleanup task to a different staff account', async () => {
    const view = await service.snapshot(fixture.specialist, fixture.sessionId);
    expect(view.history).toHaveLength(2);
    expect(view.attachments).toHaveLength(2);
    expect(view.pending_removals).toEqual([]);
    expect(view.members).toEqual([]);
    expect(view.audit).toEqual([]);
  });

  it('lists only current account memberships, narrows the list to an event, and rejects cross-session snapshots', async () => {
    expect((await service.contests(fixture.contestant)).map((session) => session.id)).toEqual([fixture.sessionId]);
    expect((await service.contests(fixture.staff)).map((session) => session.id).sort())
      .toEqual([fixture.sessionId, fixture.secondSessionId].sort());
    expect(await service.contests(fixture.staff, { eventId: fixture.eventId })).toEqual(
      (await service.contests(fixture.staff)).filter((summary) => summary.eventId === fixture.eventId));
    expect(await service.contests(fixture.staff, { eventId: randomUUID() })).toEqual([]);
    expect((await service.contests(fixture.contestant))[0]).toMatchObject({ eventId: fixture.eventId, manage: 'none' });
    await expect(service.contests(fixture.staff, { eventId: 'not-an-event' })).rejects.toMatchObject({ status: 400 });
    expect(await service.snapshot(fixture.contestant, fixture.secondSessionId)).toMatchObject({
      session: null, event: null, membership: null, teams: [], issues: [], resolutions: [],
      history: [], awards: [], attachments: [], pending_removals: [], members: [], audit: [],
    });
  });

  it.each(['must_change', 'disabled', 'generation', 'pending', 'revoked', 'expired_login', 'expired_identity', 'missing_identity', 'membership'])(
    'rechecks %s restrictions for snapshots and session lists', async (restriction) => {
    const caller = fixture.contestant;
    const sql: Record<string, [string, string]> = {
      must_change: ['UPDATE accounts SET must_change = 1 WHERE id = ?', caller.accountId],
      disabled: ['UPDATE accounts SET disabled = 1 WHERE id = ?', caller.accountId],
      generation: ['UPDATE accounts SET credential_generation = credential_generation + 1 WHERE id = ?', caller.accountId],
      pending: ["UPDATE accounts SET credential_state = 'pending' WHERE id = ?", caller.accountId],
      revoked: ['UPDATE logins SET revoked = 1 WHERE id = ?', caller.loginId],
      expired_login: ['UPDATE logins SET expires_at = unixepoch() - 1 WHERE id = ?', caller.loginId],
      expired_identity: ["UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE userId = ?", caller.accountId],
      missing_identity: ['DELETE FROM ba_session WHERE userId = ?', caller.accountId],
      membership: ['DELETE FROM memberships WHERE account_id = ?', caller.accountId],
    };
    await statement(...sql[restriction]!).run();
    if (restriction === 'membership') expect((await service.snapshot(caller, fixture.sessionId)).membership).toBeNull();
    else await expect(service.snapshot(caller, fixture.sessionId)).rejects.toMatchObject({ status: 403 });
    expect(await service.contests(caller)).toEqual([]);
  });

  it('keeps archived reads', async () => {
    await statement('UPDATE events SET archived = 1 WHERE id = ?', fixture.eventId).run();
    expect((await service.snapshot(fixture.contestant, fixture.sessionId)).event?.archived).toBe(true);
  });

  it('uses the trusted login owner instead of a caller account claim', async () => {
    const forged: Caller = { accountId: fixture.staff.accountId, loginId: fixture.contestant.loginId };
    await expect(service.snapshot(forged, fixture.sessionId)).rejects.toMatchObject({ status: 403 });
    expect(await service.contests(forged)).toEqual([]);
  });
});
