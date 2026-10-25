import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Caller } from '../../authentication';
import type { D1Connection, D1Statement } from '../d1/connection';
import { D1Fixture, applyMigrations } from '../d1/testFixture';
import { D1ApplicationService } from './application';

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
    const platform = await getPlatformProxy<{ DB: D1Connection }>({
      configPath: 'wrangler.auth-ci.jsonc', persist: false, remoteBindings: false, envFiles: [],
    });
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
    ]) {
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
    await db.batch([fixture.staff, fixture.specialist, fixture.contestant, fixture.otherContestant]
      .map((caller) => statement('DELETE FROM ba_user WHERE id = ?', caller.accountId)));
    await fixture.cleanup();
  });

  function competing(action: () => Promise<unknown>): D1ApplicationService {
    let first = true;
    return new D1ApplicationService({ prepare: (sql) => db.prepare(sql), batch: async (statements) => {
      if (first) { first = false; await action(); }
      return db.batch(statements);
    } });
  }

  async function adminEffects() {
    return Promise.all([
      fixture.rows('SELECT intake_open, max_image_bytes, max_images_per_issue, max_image_bytes_per_issue FROM sessions WHERE id = ?', fixture.sessionId),
      fixture.rows('SELECT * FROM admin_audit WHERE session_id = ? ORDER BY id', fixture.sessionId),
      fixture.rows("SELECT * FROM notifications WHERE session_id = ? AND audience NOT LIKE 'account:%' ORDER BY id", fixture.sessionId),
    ]);
  }

  async function guardedEffects() {
    return Promise.all([
      adminEffects(), fixture.durableState(),
      fixture.rows('SELECT * FROM memberships WHERE session_id = ? ORDER BY account_id', fixture.sessionId),
      fixture.rows('SELECT * FROM membership_roles WHERE session_id = ? ORDER BY account_id, role', fixture.sessionId),
      fixture.rows('SELECT * FROM accounts WHERE id = ?', fixture.staff.accountId),
      fixture.rows('SELECT * FROM logins WHERE id = ?', fixture.staff.loginId),
      fixture.rows('SELECT * FROM ba_session WHERE userId = ?', fixture.staff.accountId),
    ]);
  }

  function changeAtFinalGuard(sql: string, value: string): D1ApplicationService {
    return new D1ApplicationService({ prepare: (query) => db.prepare(query), batch: (statements) => {
      // Execute the competing credential change inside the real SQLite batch,
      // after the application effects and immediately before its final guard.
      const finalGuard = statements.length - 2;
      return db.batch([...statements.slice(0, finalGuard), statement(sql, value), ...statements.slice(finalGuard)]);
    } });
  }

  it('returns complete permitted timing, resolutions, awards, image metadata, and identity names', async () => {
    const view = await service.snapshot(fixture.staff, fixture.sessionId);
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

  it('lists only current account memberships and rejects cross-session snapshots', async () => {
    expect((await service.sessions(fixture.contestant)).map((session) => session.id)).toEqual([fixture.sessionId]);
    expect((await service.sessions(fixture.staff)).map((session) => session.id).sort())
      .toEqual([fixture.sessionId, fixture.secondSessionId].sort());
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
    await statement(...sql[restriction]).run();
    if (restriction === 'membership') expect((await service.snapshot(caller, fixture.sessionId)).membership).toBeNull();
    else await expect(service.snapshot(caller, fixture.sessionId)).rejects.toMatchObject({ status: 403 });
    expect(await service.sessions(caller)).toEqual([]);
  });

  it('atomically records intake, valid limits, audit entries, and audience invalidations', async () => {
    await service.setIntake(fixture.staff, fixture.sessionId, true);
    await service.setImageLimits(fixture.staff, fixture.sessionId, { fileMegabytes: 20, count: 8, totalMegabytes: 40 });
    const view = await service.snapshot(fixture.staff, fixture.sessionId);
    expect(view.session).toMatchObject({ intake_open: true, max_image_bytes: 20 * 1048576,
      max_images_per_issue: 8, max_image_bytes_per_issue: 40 * 1048576 });
    expect(view.audit.map((entry) => entry.action).sort()).toEqual(['fixture_setup', 'set_image_limits', 'set_intake']);
    const notifications = await fixture.rows('SELECT audience, sequence FROM notifications WHERE session_id = ? ORDER BY audience, sequence', fixture.sessionId);
    expect(notifications).toHaveLength(6);
    expect(notifications.map((entry) => entry.sequence)).toEqual([1, 2, 1, 2, 1, 2]);
    expect(await fixture.rows('SELECT * FROM command_assertions')).toEqual([]);
  });

  it.each([
    { fileMegabytes: 0, count: 1, totalMegabytes: 1 },
    { fileMegabytes: 51, count: 1, totalMegabytes: 100 },
    { fileMegabytes: 1, count: 25, totalMegabytes: 1 },
    { fileMegabytes: 1.5, count: 1, totalMegabytes: 2 },
    { fileMegabytes: 2, count: 1, totalMegabytes: 1 },
  ])('rejects invalid image limits without audit or notification effects', async (limits) => {
    const before = await adminEffects();
    await expect(service.setImageLimits(fixture.staff, fixture.sessionId, limits)).rejects.toMatchObject({ status: 400 });
    expect(await adminEffects()).toEqual(before);
  });

  it.each(['admin', 'generation', 'must_change', 'disabled', 'pending', 'expired_identity', 'missing_identity', 'expired_login', 'revoked', 'archived'])(
    'rolls back all administration effects when %s changes before commit', async (restriction) => {
    const before = await adminEffects();
    const sql: Record<string, [string, string]> = {
      admin: ['UPDATE memberships SET is_admin = 0 WHERE account_id = ?', fixture.staff.accountId],
      generation: ['UPDATE accounts SET credential_generation = credential_generation + 1 WHERE id = ?', fixture.staff.accountId],
      must_change: ['UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.staff.accountId],
      disabled: ['UPDATE accounts SET disabled = 1 WHERE id = ?', fixture.staff.accountId],
      pending: ["UPDATE accounts SET credential_state = 'pending' WHERE id = ?", fixture.staff.accountId],
      expired_identity: ["UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE userId = ?", fixture.staff.accountId],
      missing_identity: ['DELETE FROM ba_session WHERE userId = ?', fixture.staff.accountId],
      expired_login: ['UPDATE logins SET expires_at = unixepoch() - 1 WHERE id = ?', fixture.staff.loginId],
      revoked: ['UPDATE logins SET revoked = 1 WHERE id = ?', fixture.staff.loginId],
      archived: ['UPDATE events SET archived = 1 WHERE id = ?', fixture.eventId],
    };
    const racing = competing(() => statement(...sql[restriction]).run());
    await expect(racing.setIntake(fixture.staff, fixture.sessionId, true)).rejects.toMatchObject({ status: 409 });
    expect(await adminEffects()).toEqual(before);
    const invalidations = await fixture.rows("SELECT audience FROM notifications WHERE session_id = ? AND audience LIKE 'account:%'", fixture.sessionId);
    if (['generation', 'must_change', 'disabled', 'pending', 'expired_identity', 'missing_identity', 'expired_login', 'revoked'].includes(restriction)) {
      expect(invalidations).toEqual([{ audience: `account:${fixture.staff.accountId}` }]);
    } else {
      expect(invalidations).toEqual([]);
    }
    expect(await fixture.rows('SELECT * FROM command_assertions')).toEqual([]);
  });

  it('rolls back a membership change when the acting admin loses access before commit', async () => {
    const before = await adminEffects();
    const racing = competing(() => statement('DELETE FROM memberships WHERE session_id = ? AND account_id = ?',
      fixture.sessionId, fixture.staff.accountId).run());
    await expect(racing.saveMember(fixture.staff, fixture.sessionId, fixture.specialist.accountId,
      { teamId: fixture.teamId, roles: [], isAdmin: false })).rejects.toMatchObject({ status: 409 });
    expect(await adminEffects()).toEqual(before);
    expect((await service.snapshot(fixture.specialist, fixture.sessionId)).membership)
      .toMatchObject({ team_id: null, roles: ['specialist'] });
  });

  for (const operation of ['intake', 'limits', 'save_member', 'remove_member'] as const) {
    it.each(['expired_login', 'expired_identity', 'revoked', 'generation', 'must_change'])(
      `rolls back ${operation} when %s changes immediately before the final guard`, async (restriction) => {
        const changes: Record<string, [string, string]> = {
          expired_login: ['UPDATE logins SET expires_at = unixepoch() - 1 WHERE id = ?', fixture.staff.loginId],
          expired_identity: ["UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE userId = ?", fixture.staff.accountId],
          revoked: ['UPDATE logins SET revoked = 1 WHERE id = ?', fixture.staff.loginId],
          generation: ['UPDATE accounts SET credential_generation = credential_generation + 1 WHERE id = ?', fixture.staff.accountId],
          must_change: ['UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.staff.accountId],
        };
        const racing = changeAtFinalGuard(...changes[restriction]);
        const before = await guardedEffects();
        const result = operation === 'intake' ? racing.setIntake(fixture.staff, fixture.sessionId, true)
          : operation === 'limits' ? racing.setImageLimits(fixture.staff, fixture.sessionId, { fileMegabytes: 20, count: 8, totalMegabytes: 40 })
          : operation === 'save_member' ? racing.saveMember(fixture.staff, fixture.sessionId, fixture.specialist.accountId,
            { teamId: fixture.teamId, roles: [], isAdmin: false })
          : racing.removeMember(fixture.staff, fixture.sessionId, fixture.specialist.accountId);
        await expect(result).rejects.toMatchObject({ status: 409 });
        expect(await guardedEffects()).toEqual(before);
        expect(await fixture.rows('SELECT * FROM command_assertions')).toEqual([]);
      });
  }

  it('combines every assigned staff capability and limits the admin audit to the newest 50 entries', async () => {
    await service.saveMember(fixture.staff, fixture.sessionId, fixture.specialist.accountId,
      { teamId: null, roles: ['volunteer', 'specialist', 'jury'], isAdmin: false });
    expect((await service.snapshot(fixture.specialist, fixture.sessionId)).membership?.roles)
      .toEqual(['jury', 'specialist', 'volunteer']);
    await db.batch(Array.from({ length: 55 }, (_, index) => statement(
      'INSERT INTO admin_audit (id, session_id, actor, at, action) VALUES (?, ?, ?, ?, ?)',
      randomUUID(), fixture.sessionId, fixture.staff.accountId,
      new Date(Date.now() + (index + 1) * 1000).toISOString(), `fictional_action_${index}`)));
    const audit = (await service.snapshot(fixture.staff, fixture.sessionId)).audit;
    expect(audit).toHaveLength(50);
    expect(audit[0].action).toBe('fictional_action_54');
    expect(audit[49].action).toBe('fictional_action_5');
  });

  it('applies staff capability changes immediately and commits membership audit plus refresh invalidations', async () => {
    await service.saveMember(fixture.staff, fixture.sessionId, fixture.specialist.accountId,
      { teamId: fixture.teamId, roles: [], isAdmin: false });
    const view = await service.snapshot(fixture.specialist, fixture.sessionId);
    expect(view.membership).toMatchObject({ team_id: fixture.teamId, roles: [] });
    expect(view.history.map((entry) => entry.text)).toEqual(['Public reply']);
    expect(view.attachments.map((image) => image.id)).toEqual([publicImage]);
    expect((await fixture.rows('SELECT audience FROM notifications WHERE session_id = ? ORDER BY audience', fixture.sessionId))
      .map((row) => row.audience).sort()).toEqual([`account:${fixture.specialist.accountId}`, 'staff', `team:${fixture.teamId}`].sort());
    await service.removeMember(fixture.staff, fixture.sessionId, fixture.specialist.accountId);
    expect((await service.snapshot(fixture.specialist, fixture.sessionId)).membership).toBeNull();
  });

  it('rejects removal or demotion of the final admin without durable effects', async () => {
    const before = await adminEffects();
    await expect(service.removeMember(fixture.staff, fixture.sessionId, fixture.staff.accountId)).rejects.toMatchObject({ status: 409 });
    await expect(service.saveMember(fixture.staff, fixture.sessionId, fixture.staff.accountId,
      { teamId: null, roles: ['volunteer'], isAdmin: false })).rejects.toMatchObject({ status: 409 });
    expect(await adminEffects()).toEqual(before);
    expect((await service.snapshot(fixture.staff, fixture.sessionId)).membership?.is_admin).toBe(true);
  });

  it('lets the only admin give themselves staff roles while staying admin', async () => {
    await service.saveMember(fixture.staff, fixture.sessionId, fixture.staff.accountId,
      { teamId: null, roles: ['volunteer', 'jury'], isAdmin: true });
    expect((await service.snapshot(fixture.staff, fixture.sessionId)).membership)
      .toMatchObject({ roles: ['jury', 'volunteer'], is_admin: true });
  });

  it('permits an admin to remove their own membership when another admin remains', async () => {
    await service.saveMember(fixture.staff, fixture.sessionId, fixture.specialist.accountId,
      { teamId: null, roles: ['specialist'], isAdmin: true });
    await service.removeMember(fixture.staff, fixture.sessionId, fixture.staff.accountId);
    expect((await service.snapshot(fixture.staff, fixture.sessionId)).membership).toBeNull();
    const remaining = await service.snapshot(fixture.specialist, fixture.sessionId);
    expect(remaining.membership?.is_admin).toBe(true);
    expect(remaining.audit.map((entry) => entry.action)).toContain('revoke_membership');
  });

  it('rejects invalid membership shapes, teams from other sessions, and accounts without admin rights', async () => {
    const before = await adminEffects();
    await expect(service.saveMember(fixture.staff, fixture.sessionId, fixture.specialist.accountId,
      { teamId: fixture.teamId, roles: ['specialist'], isAdmin: false })).rejects.toMatchObject({ status: 400 });
    await expect(service.saveMember(fixture.staff, fixture.sessionId, fixture.specialist.accountId,
      { teamId: fixture.secondSessionTeamId, roles: [], isAdmin: false })).rejects.toMatchObject({ status: 409 });
    await expect(service.setIntake(fixture.specialist, fixture.sessionId, true)).rejects.toMatchObject({ status: 403 });
    expect(await adminEffects()).toEqual(before);
  });

  it('retains archived reads and rejects all archived writes', async () => {
    await statement('UPDATE events SET archived = 1 WHERE id = ?', fixture.eventId).run();
    expect((await service.snapshot(fixture.contestant, fixture.sessionId)).event?.archived).toBe(true);
    const operations: Array<() => Promise<void>> = [
      () => service.setIntake(fixture.staff, fixture.sessionId, true),
      () => service.setImageLimits(fixture.staff, fixture.sessionId, { fileMegabytes: 1, count: 1, totalMegabytes: 1 }),
      () => service.saveMember(fixture.staff, fixture.sessionId, fixture.specialist.accountId, { teamId: null, roles: ['jury'], isAdmin: false }),
      () => service.removeMember(fixture.staff, fixture.sessionId, fixture.specialist.accountId),
      () => service.editRoster(fixture.staff, fixture.sessionId, { type: 'add_teams', teams: [{ id: randomUUID(), name: 'Late team', location: '' }] }),
      () => service.editRoster(fixture.staff, fixture.sessionId, { type: 'update_team', teamId: fixture.teamId, name: 'Renamed', location: '' }),
      () => service.editRoster(fixture.staff, fixture.sessionId, { type: 'delete_team', teamId: fixture.teamId }),
      () => service.editRoster(fixture.staff, fixture.sessionId, { type: 'set_categories', categories: ['Only'] }),
    ];
    for (const operation of operations) await expect(operation()).rejects.toMatchObject({ status: 403 });
  });

  describe('roster editors', () => {
    const teamRows = () => fixture.rows('SELECT id, name, location FROM teams WHERE session_id = ? ORDER BY id', fixture.sessionId);
    const categories = async () => JSON.parse((await fixture.rows('SELECT categories FROM sessions WHERE id = ?', fixture.sessionId))[0].categories as string) as string[];
    const rosterEffects = async () => [await teamRows(), await categories(), ...await adminEffects()];
    const add = (name: string, location = '', id: string = randomUUID()) => ({ id, name, location });

    it('adds teams in one batch, and a repeated request adds no second team', async () => {
      const teams = [add('Zeta', 'Hall 1'), add('Eta', 'Hall 2')];
      await service.editRoster(fixture.staff, fixture.sessionId, { type: 'add_teams', teams });
      await service.editRoster(fixture.staff, fixture.sessionId, { type: 'add_teams', teams });
      const view = await service.snapshot(fixture.staff, fixture.sessionId);
      expect(view.teams.map((team) => [team.name, team.location])).toEqual([
        ['Eta', 'Hall 2'], ['Fictional Alpha', 'Desk A'], ['Fictional Beta', 'Desk B'], ['Zeta', 'Hall 1']]);
      expect(view.audit.filter((entry) => entry.action === 'add_teams')).toHaveLength(2);
      const audiences = await fixture.rows(`SELECT DISTINCT audience FROM notifications WHERE session_id = ? AND audience NOT LIKE 'account:%'`, fixture.sessionId);
      expect(audiences).toEqual([{ audience: 'staff' }]);
      expect(await fixture.rows('SELECT * FROM command_assertions')).toEqual([]);
    });

    it('adds 300 teams in one command', async () => {
      const teams = Array.from({ length: 300 }, (_, index) => add(`Team ${String(index + 1).padStart(3, '0')}`, `Table ${index + 1}`));
      await service.editRoster(fixture.staff, fixture.sessionId, { type: 'add_teams', teams });
      expect((await service.snapshot(fixture.staff, fixture.sessionId)).teams).toHaveLength(302);
    });

    it.each([
      ['an existing name in another case', [{ name: '  fictional ALPHA ' }], 409],
      ['a name twice in one request', [{ name: 'Same' }, { name: 'same' }], 400],
    ])('rejects %s without effects', async (_label, names, status) => {
      const before = await rosterEffects();
      const teams = names.map(({ name }) => add(name));
      await expect(service.editRoster(fixture.staff, fixture.sessionId, { type: 'add_teams', teams }))
        .rejects.toMatchObject({ status });
      expect(await rosterEffects()).toEqual(before);
    });

    it('rejects a duplicate that lands between the read and the commit', async () => {
      const before = await teamRows();
      const racing = competing(() => statement('INSERT INTO teams (id, session_id, name, location) VALUES (?, ?, ?, ?)',
        randomUUID(), fixture.sessionId, 'Gamma', '').run());
      await expect(racing.editRoster(fixture.staff, fixture.sessionId, { type: 'add_teams', teams: [add('gamma')] }))
        .rejects.toMatchObject({ status: 409 });
      expect((await teamRows()).length).toBe(before.length + 1);
      expect(await fixture.rows("SELECT 1 FROM teams WHERE session_id = ? AND lower(name) = 'gamma'", fixture.sessionId)).toHaveLength(1);
      expect(await fixture.rows('SELECT * FROM command_assertions')).toEqual([]);
    });

    it('rejects a team ID that belongs to another session', async () => {
      const before = await rosterEffects();
      await expect(service.editRoster(fixture.staff, fixture.sessionId,
        { type: 'add_teams', teams: [add('Borrowed', '', fixture.secondSessionTeamId)] })).rejects.toMatchObject({ status: 409 });
      expect(await rosterEffects()).toEqual(before);
    });

    it('renames a team and notifies its own contestants', async () => {
      await service.editRoster(fixture.staff, fixture.sessionId,
        { type: 'update_team', teamId: fixture.teamId, name: ' Alpha Prime ', location: 'Desk 9' });
      expect((await service.snapshot(fixture.contestant, fixture.sessionId)).teams)
        .toEqual([expect.objectContaining({ id: fixture.teamId, name: 'Alpha Prime', location: 'Desk 9' })]);
      expect((await fixture.rows(`SELECT DISTINCT audience FROM notifications WHERE session_id = ? AND audience NOT LIKE 'account:%' ORDER BY audience`, fixture.sessionId))
        .map((row) => row.audience)).toEqual(['staff', `team:${fixture.teamId}`].sort());
      expect((await service.snapshot(fixture.staff, fixture.sessionId)).issues.every((issue) => issue.team_id)).toBe(true);
    });

    it('keeps a name when only its location changes, and rejects another team\'s name', async () => {
      await service.editRoster(fixture.staff, fixture.sessionId,
        { type: 'update_team', teamId: fixture.teamId, name: 'fictional alpha', location: 'Moved' });
      const before = await rosterEffects();
      await expect(service.editRoster(fixture.staff, fixture.sessionId,
        { type: 'update_team', teamId: fixture.teamId, name: 'Fictional BETA', location: '' })).rejects.toMatchObject({ status: 409 });
      await expect(service.editRoster(fixture.staff, fixture.sessionId,
        { type: 'update_team', teamId: fixture.secondSessionTeamId, name: 'Elsewhere', location: '' })).rejects.toMatchObject({ status: 409 });
      expect(await rosterEffects()).toEqual(before);
    });

    it('deletes a team that has no issue and no account', async () => {
      const id = randomUUID();
      await service.editRoster(fixture.staff, fixture.sessionId, { type: 'add_teams', teams: [add('Spare', '', id)] });
      await service.editRoster(fixture.staff, fixture.sessionId, { type: 'delete_team', teamId: id });
      expect((await service.snapshot(fixture.staff, fixture.sessionId)).teams.map((team) => team.id)).not.toContain(id);
      expect(await fixture.rows('SELECT * FROM command_assertions')).toEqual([]);
    });

    it('keeps a team that has an issue or an account, and says why', async () => {
      const before = await rosterEffects();
      await expect(service.editRoster(fixture.staff, fixture.sessionId, { type: 'delete_team', teamId: fixture.teamId }))
        .rejects.toMatchObject({ status: 409, message: 'Fictional Alpha has 1 issue and stays in the roster.' });
      const quiet = randomUUID();
      await service.editRoster(fixture.staff, fixture.sessionId, { type: 'add_teams', teams: [add('Quiet', '', quiet)] });
      await service.saveMember(fixture.staff, fixture.sessionId, fixture.specialist.accountId, { teamId: quiet, roles: [], isAdmin: false });
      await expect(service.editRoster(fixture.staff, fixture.sessionId, { type: 'delete_team', teamId: quiet }))
        .rejects.toMatchObject({ status: 409, message: '1 account belongs to Quiet. Move or remove it first.' });
      expect(await fixture.rows('SELECT 1 FROM teams WHERE id IN (?, ?)', fixture.teamId, quiet)).toHaveLength(2);
      expect((await teamRows()).length).toBe(before[0].length + 1);
    });

    it('keeps a team that receives an issue between the read and the commit', async () => {
      const id = randomUUID();
      await service.editRoster(fixture.staff, fixture.sessionId, { type: 'add_teams', teams: [add('Racing', '', id)] });
      const racing = competing(() => statement(`INSERT INTO issues (id, session_id, team_id, status) VALUES (?, ?, ?, 'open')`,
        randomUUID(), fixture.sessionId, id).run());
      await expect(racing.editRoster(fixture.staff, fixture.sessionId, { type: 'delete_team', teamId: id }))
        .rejects.toMatchObject({ status: 409 });
      expect(await fixture.rows('SELECT 1 FROM teams WHERE id = ?', id)).toHaveLength(1);
      expect(await fixture.rows('SELECT 1 FROM issues WHERE team_id = ?', id)).toHaveLength(1);
      expect(await fixture.rows('SELECT * FROM command_assertions')).toEqual([]);
    });

    it('replaces the category list, and every contestant is notified', async () => {
      await service.editRoster(fixture.staff, fixture.sessionId,
        { type: 'set_categories', categories: ['Other', ' Network ', 'Power'] });
      expect(await categories()).toEqual(['Other', 'Network', 'Power']);
      const view = await service.snapshot(fixture.contestant, fixture.sessionId);
      expect(view.session?.categories).toEqual(['Other', 'Network', 'Power']);
      expect(view.session?.revision).toBeGreaterThan(1);
      expect((await fixture.rows(`SELECT DISTINCT audience FROM notifications WHERE session_id = ? AND audience NOT LIKE 'account:%'`, fixture.sessionId))
        .map((row) => row.audience).sort()).toEqual(['staff', `team:${fixture.teamId}`, `team:${fixture.otherTeamId}`].sort());
    });

    it('keeps a category that an issue uses, and says why', async () => {
      const before = await rosterEffects();
      await expect(service.editRoster(fixture.staff, fixture.sessionId, { type: 'set_categories', categories: ['Devices', 'Backend'] }))
        .rejects.toMatchObject({ status: 409, message: 'Other has 2 issues and stays in the list.' });
      expect(await rosterEffects()).toEqual(before);
    });

    it('does not let a category-less legacy issue block an edit', async () => {
      await statement("UPDATE issues SET category = '', write_version = write_version + 1 WHERE session_id = ?", fixture.sessionId).run();
      await service.editRoster(fixture.staff, fixture.sessionId, { type: 'set_categories', categories: ['Only'] });
      expect(await categories()).toEqual(['Only']);
    });

    it('keeps a category that an issue starts using between the read and the commit', async () => {
      const before = await rosterEffects();
      const racing = competing(() => statement("UPDATE issues SET category = 'Backend', write_version = write_version + 1 WHERE id = ?", fixture.issueId).run());
      await expect(racing.editRoster(fixture.staff, fixture.sessionId, { type: 'set_categories', categories: ['Other', 'Devices'] }))
        .rejects.toMatchObject({ status: 409 });
      expect(await categories()).toEqual(before[1]);
      expect(await fixture.rows("SELECT 1 FROM issues WHERE id = ? AND category = 'Backend'", fixture.issueId)).toHaveLength(1);
      expect(await fixture.rows('SELECT * FROM command_assertions')).toEqual([]);
    });

    it.each([
      ['an empty team name', { type: 'add_teams', teams: [{ id: randomUUID(), name: '   ', location: '' }] }],
      ['a team name of 201 characters', { type: 'add_teams', teams: [{ id: randomUUID(), name: 'x'.repeat(201), location: '' }] }],
      ['a control character', { type: 'add_teams', teams: [{ id: randomUUID(), name: 'Bad\u0000name', location: '' }] }],
      ['no teams', { type: 'add_teams', teams: [] }],
      ['301 teams', { type: 'add_teams', teams: Array.from({ length: 301 }, (_, index) => ({ id: randomUUID(), name: `T${index}`, location: '' })) }],
      ['a team ID that is not a UUID', { type: 'add_teams', teams: [{ id: 'one', name: 'Ok', location: '' }] }],
      ['an unknown field', { type: 'update_team', teamId: randomUUID(), name: 'Ok', location: '', extra: 1 }],
      ['an unknown command', { type: 'drop_teams' }],
      ['an empty category list', { type: 'set_categories', categories: [] }],
      ['a blank category', { type: 'set_categories', categories: ['Ok', ' '] }],
      ['categories that differ only by case', { type: 'set_categories', categories: ['Ok', 'ok'] }],
      ['51 categories', { type: 'set_categories', categories: Array.from({ length: 51 }, (_, index) => `C${index}`) }],
    ])('rejects %s without effects', async (_label, command) => {
      const before = await rosterEffects();
      await expect(service.editRoster(fixture.staff, fixture.sessionId, command)).rejects.toMatchObject({ status: 400 });
      expect(await rosterEffects()).toEqual(before);
    });

    it('allows only an admin of this session', async () => {
      const before = await rosterEffects();
      const command = { type: 'set_categories', categories: ['Only'] } as const;
      await expect(service.editRoster(fixture.specialist, fixture.sessionId, command)).rejects.toMatchObject({ status: 403 });
      await expect(service.editRoster(fixture.contestant, fixture.sessionId, command)).rejects.toMatchObject({ status: 403 });
      await expect(service.editRoster(fixture.staff, fixture.secondSessionId, command)).rejects.toMatchObject({ status: 403 });
      expect(await rosterEffects()).toEqual(before);
    });

    it('rolls back when the admin loses access before the commit', async () => {
      const before = await rosterEffects();
      const racing = competing(() => statement('UPDATE memberships SET is_admin = 0 WHERE account_id = ?', fixture.staff.accountId).run());
      await expect(racing.editRoster(fixture.staff, fixture.sessionId, { type: 'add_teams', teams: [add('Late')] }))
        .rejects.toMatchObject({ status: 409 });
      expect(await rosterEffects()).toEqual(before);
    });
  });

  it('uses the trusted login owner instead of a caller account claim', async () => {
    const forged: Caller = { accountId: fixture.staff.accountId, loginId: fixture.contestant.loginId };
    await expect(service.snapshot(forged, fixture.sessionId)).rejects.toMatchObject({ status: 403 });
    expect(await service.sessions(forged)).toEqual([]);
  });
});
