import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AVATAR_MAX_BYTES } from '../../../connected/imageFile';
import type { Caller } from '../../authentication';
import type { D1Connection, D1Statement } from '../d1/connection';
import { D1Fixture, applyMigrations } from '../d1/testFixture';
import { currentReadyLoginBindings, currentReadyLoginSql } from './application';
import { contestDataBindings, contestDataSql } from './authority';
import { R2AvatarService, avatarKey } from './avatars';
import type { PrivateBucket } from './images';
import { openLocalPlatform, openStoreDatabase } from './tooling/store-database.mjs';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');


describe('Cloudflare avatars with local D1 and R2 bindings', () => {
  let directory: string;
  let db: D1Connection;
  let bucket: PrivateBucket;
  let dispose: () => Promise<void>;
  let fixture: D1Fixture;
  let avatars: R2AvatarService;
  let created = false;
  // Staff in both sessions. The specialist is staff in the first session only.
  let staff: Caller;
  let specialist: Caller;
  let contestant: Caller;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'minsky-avatar-tests-'));
    const entry = join(directory, 'worker.js');
    writeFileSync(entry, 'export default { fetch() { return new Response("Isolated avatar test binding"); } };');
    const configPath = join(directory, 'wrangler.json');
    writeFileSync(configPath, JSON.stringify({
      name: 'minsky-avatar-tests', main: entry, compatibility_date: '2026-10-13',
      account_id: '458ad6a930b0fb717796dfa19ca6a2b1',
      d1_databases: [{ binding: 'DB', database_name: 'minsky-avatar-tests', database_id: randomUUID() }],
      r2_buckets: [{ binding: 'IMAGES', bucket_name: 'minsky-avatar-tests' }],
    }));
    const platform = await openLocalPlatform<{ DB: D1Connection; IMAGES: PrivateBucket }>(configPath);
    db = platform.env.DB;
    bucket = platform.env.IMAGES;
    dispose = platform.dispose;
    await applyMigrations(db);
  });

  afterAll(async () => {
    if (dispose) await dispose();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fixture = new D1Fixture(db, join(directory, 'wrangler.json'), true);
    await fixture.create();
    created = true;
    staff = fixture.staff;
    specialist = fixture.specialist;
    contestant = fixture.contestant;
    avatars = new R2AvatarService(db, bucket);
  });

  afterEach(async () => {
    if (!created) return;
    created = false;
    const owners = [staff, specialist, contestant, fixture.otherContestant].map((caller) => caller.accountId);
    for (const owner of owners) {
      const keys = (await bucket.list({ prefix: `accounts/${owner}/` })).objects.map((object) => object.key);
      if (keys.length) await bucket.delete(keys);
      expect((await bucket.list({ prefix: `accounts/${owner}/` })).objects).toEqual([]);
    }
    await db.prepare(`DELETE FROM account_avatars WHERE account_id IN (?, ?, ?, ?)`).bind(...owners).run();
    await fixture.cleanup();
  });

  function upload(caller: Caller, bytes: Uint8Array = png, requestId = randomUUID(), service = avatars) {
    return service.upload(caller, { requestId, bytes, digest: sha256(bytes) });
  }

  async function bytesOf(caller: Caller, avatarId: string, sessionId = fixture.sessionId) {
    const result = await avatars.download(caller, sessionId, avatarId);
    return { type: result.contentType, bytes: new Uint8Array(await new Response(result.body).arrayBuffer()) };
  }

  async function state(avatarId: string) {
    return db.prepare('SELECT state, files_removed_at IS NOT NULL AS removed FROM account_avatars WHERE id = ?')
      .bind(avatarId).first<{ state: string; removed: number }>();
  }

  it('replaces the avatar, retires the previous one, and deletes its file', async () => {
    const first = await upload(staff, png);
    expect(first.person_id).toBe(staff.accountId);
    expect(await avatars.list(staff, fixture.sessionId)).toEqual([first]);
    expect(await bytesOf(staff, first.avatar_id)).toEqual({ type: 'image/png', bytes: png });
    const second = await upload(staff, jpeg);
    expect(second.avatar_id).not.toBe(first.avatar_id);
    expect(await avatars.list(staff, fixture.sessionId)).toEqual([second]);
    expect(await bytesOf(staff, second.avatar_id)).toEqual({ type: 'image/jpeg', bytes: jpeg });
    expect(await state(first.avatar_id)).toEqual({ state: 'retired', removed: 1 });
    expect(await bucket.get(avatarKey(staff.accountId, first.avatar_id))).toBeNull();
    await expect(avatars.download(staff, fixture.sessionId, first.avatar_id)).rejects.toMatchObject({ validation: true });
  });

  it('removes the avatar and its file, and succeeds again when none exists', async () => {
    const avatar = await upload(staff);
    await avatars.remove(staff);
    await avatars.remove(staff);
    await avatars.remove(specialist);
    expect(await avatars.list(staff, fixture.sessionId)).toEqual([]);
    expect(await state(avatar.avatar_id)).toEqual({ state: 'retired', removed: 1 });
    expect(await bucket.get(avatarKey(staff.accountId, avatar.avatar_id))).toBeNull();
  });

  it('stores one avatar for a repeated request ID and rejects different content for it', async () => {
    const requestId = randomUUID();
    const first = await upload(staff, png, requestId);
    expect(await upload(staff, png, requestId)).toEqual(first);
    await expect(upload(staff, jpeg, requestId)).rejects.toMatchObject({ validation: true });
    const concurrent = randomUUID();
    const [one, two] = await Promise.all([upload(staff, jpeg, concurrent), upload(staff, jpeg, concurrent)]);
    expect(one).toEqual(two);
    const rows = await fixture.rows('SELECT id, state FROM account_avatars WHERE account_id = ? ORDER BY state', staff.accountId);
    expect(rows).toEqual([{ id: one.avatar_id, state: 'ready' }, { id: first.avatar_id, state: 'retired' }]);
    // A late retry returns its first result without restoring the replaced avatar.
    expect(await upload(staff, png, requestId)).toEqual(first);
    expect(await avatars.list(staff, fixture.sessionId)).toEqual([one]);
  });

  it('rejects a body that is not JPEG, PNG, or WebP, or that is larger than 256 KiB', async () => {
    const text = new TextEncoder().encode('Fictional text, not a picture.');
    const large = new Uint8Array(AVATAR_MAX_BYTES + 1);
    large.set(jpeg);
    await expect(upload(staff, text)).rejects.toMatchObject({ validation: true });
    await expect(upload(staff, large)).rejects.toMatchObject({ validation: true });
    await expect(avatars.upload(staff, { requestId: randomUUID(), bytes: png, digest: 'f'.repeat(64) })).rejects.toBeDefined();
    const exact = new Uint8Array(AVATAR_MAX_BYTES);
    exact.set(jpeg);
    const accepted = await upload(staff, exact);
    const rows = await fixture.rows('SELECT id, state FROM account_avatars WHERE account_id = ? AND state <> ?', staff.accountId, 'pending');
    expect(rows).toEqual([{ id: accepted.avatar_id, state: 'ready' }]);
  });

  it('shows staff avatars to staff of the same session', async () => {
    const staffAvatar = await upload(staff, png);
    const specialistAvatar = await upload(specialist, jpeg);
    const sorted = (list: Array<{ person_id: string }>) => [...list].sort((a, b) => a.person_id.localeCompare(b.person_id));
    expect(await avatars.list(specialist, fixture.sessionId)).toEqual(sorted([staffAvatar, specialistAvatar]));
    expect(await avatars.list(staff, fixture.sessionId)).toEqual(sorted([staffAvatar, specialistAvatar]));
    expect(await bytesOf(specialist, staffAvatar.avatar_id)).toEqual({ type: 'image/png', bytes: png });
  });

  it('shows a team account only its own avatar and hides team avatars from staff', async () => {
    const staffAvatar = await upload(staff, png);
    const teamAvatar = await upload(contestant, jpeg);
    expect(await avatars.list(contestant, fixture.sessionId)).toEqual([teamAvatar]);
    await expect(avatars.download(contestant, fixture.sessionId, staffAvatar.avatar_id)).rejects.toMatchObject({ validation: true });
    expect(await bytesOf(contestant, teamAvatar.avatar_id)).toEqual({ type: 'image/jpeg', bytes: jpeg });
    expect(await avatars.list(staff, fixture.sessionId)).toEqual([staffAvatar]);
    await expect(avatars.download(staff, fixture.sessionId, teamAvatar.avatar_id)).rejects.toMatchObject({ validation: true });
  });

  it('hides the avatar of a member who has no staff role or admin flag', async () => {
    const staffAvatar = await upload(staff, png);
    const specialistAvatar = await upload(specialist, jpeg);
    await db.prepare('DELETE FROM membership_roles WHERE session_id = ? AND account_id = ?')
      .bind(fixture.sessionId, specialist.accountId).run();
    expect(await avatars.list(staff, fixture.sessionId)).toEqual([staffAvatar]);
    await expect(avatars.download(staff, fixture.sessionId, specialistAvatar.avatar_id)).rejects.toMatchObject({ validation: true });
    expect(await avatars.list(specialist, fixture.sessionId)).toEqual([specialistAvatar]);
  });

  it('hides avatars from a person outside the session and after revoked access', async () => {
    const staffAvatar = await upload(staff, png);
    const specialistAvatar = await upload(specialist, jpeg);
    // The specialist is not a member of the second session, and the staff account is.
    expect(await avatars.list(specialist, fixture.secondSessionId)).toEqual([specialistAvatar]);
    await expect(avatars.download(specialist, fixture.secondSessionId, staffAvatar.avatar_id)).rejects.toMatchObject({ validation: true });
    expect(await avatars.list(staff, fixture.secondSessionId)).toEqual([staffAvatar]);
    await expect(avatars.download(staff, fixture.secondSessionId, specialistAvatar.avatar_id)).rejects.toMatchObject({ validation: true });
    await db.prepare('UPDATE logins SET revoked = 1 WHERE id = ?').bind(specialist.loginId).run();
    expect(await avatars.list(specialist, fixture.sessionId)).toEqual([]);
    await expect(avatars.download(specialist, fixture.sessionId, specialistAvatar.avatar_id)).rejects.toMatchObject({ validation: true });
    await expect(avatars.remove(specialist)).rejects.toMatchObject({ validation: true });
    expect(await state(specialistAvatar.avatar_id)).toEqual({ state: 'ready', removed: 0 });
  });

  it('keeps a stored file after a lost commit so the same request can finish it', async () => {
    const requestId = randomUUID();
    let failed = false;
    const lossy = new R2AvatarService({ prepare: (sql) => db.prepare(sql), batch: async (statements) => {
      // The reservation commits. The response for the batch that publishes the avatar is lost.
      if (statements.length > 3 && !failed) { failed = true; throw new Error('Connection lost before the response.'); }
      return db.batch(statements);
    } }, bucket);
    await expect(upload(staff, png, requestId, lossy)).rejects.toBeDefined();
    const pending = (await fixture.rows('SELECT id, state FROM account_avatars WHERE account_id = ?', staff.accountId))[0]!;
    expect(pending.state).toBe('pending');
    expect(await bucket.get(avatarKey(staff.accountId, pending.id as string))).not.toBeNull();
    expect(await avatars.list(staff, fixture.sessionId)).toEqual([]);
    expect(await upload(staff, png, requestId)).toEqual({ person_id: staff.accountId, avatar_id: pending.id });
    expect(await bytesOf(staff, pending.id as string)).toEqual({ type: 'image/png', bytes: png });
  });

  it('recovers by expiring abandoned uploads and deleting files that a request left behind', async () => {
    let lose = true;
    const lossy = new R2AvatarService({ prepare: (sql) => db.prepare(sql), batch: async (statements) => {
      if (statements.length > 3 && lose) throw new Error('Connection lost before the response.');
      return db.batch(statements);
    } }, bucket);
    await expect(upload(staff, png, randomUUID(), lossy)).rejects.toBeDefined();
    lose = false;
    const { id: abandoned } = (await fixture.rows('SELECT id FROM account_avatars WHERE account_id = ?', staff.accountId) as Array<{ id: string }>)[0]!;
    const abandonedKey = avatarKey(staff.accountId, abandoned);
    await db.prepare('UPDATE account_avatars SET expires_at = unixepoch() - 1 WHERE id = ?').bind(abandoned).run();

    const stuck = new R2AvatarService(db, { get: bucket.get.bind(bucket), put: bucket.put.bind(bucket), list: bucket.list.bind(bucket),
      delete: async () => { throw new Error('Storage unavailable.'); } });
    const replaced = await upload(specialist, png, randomUUID(), stuck);
    const current = await upload(specialist, jpeg, randomUUID(), stuck);
    expect(await state(replaced.avatar_id)).toEqual({ state: 'retired', removed: 0 });
    expect(await bucket.get(avatarKey(specialist.accountId, replaced.avatar_id))).not.toBeNull();

    await avatars.recover();
    expect(await state(abandoned)).toEqual({ state: 'expired', removed: 1 });
    expect(await bucket.get(abandonedKey)).toBeNull();
    expect(await state(replaced.avatar_id)).toEqual({ state: 'retired', removed: 1 });
    expect(await bucket.get(avatarKey(specialist.accountId, replaced.avatar_id))).toBeNull();
    expect(await bytesOf(specialist, current.avatar_id)).toEqual({ type: 'image/jpeg', bytes: jpeg });
  });
});

/**
 * The avatar statement before 2026-10-26. It checks every ready avatar of the
 * installation, and it is the reference for who can read whose avatar.
 */
const referenceVisibleSql = `WITH login AS (${currentReadyLoginSql}), access AS (${contestDataSql('caller')})
  SELECT v.account_id AS person_id, v.id AS avatar_id, v.content_type FROM account_avatars v CROSS JOIN login l
  WHERE v.state = 'ready' AND (v.account_id = l.id OR EXISTS (SELECT 1 FROM access a JOIN memberships m
    ON m.session_id = ? AND m.account_id = v.account_id AND m.team_id IS NULL AND (m.is_admin = 1 OR EXISTS (
      SELECT 1 FROM membership_roles r WHERE r.session_id = m.session_id AND r.account_id = m.account_id))
    WHERE a.staff = 1))`;

describe('avatar reads match the reference rule for every caller, session, and avatar state', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  const person = () => ({ accountId: randomUUID(), loginId: randomUUID() });
  const people = {
    admin: person(), volunteer: person(), jury: person(), contestant: person(), teammate: person(),
    otherTeam: person(), plainMember: person(), staffAndContestant: person(), otherSessionStaff: person(),
    archivedStaff: person(), archivedJury: person(), noAvatar: person(), disabled: person(), mustChange: person(),
    revokedLogin: person(), removedMember: person(),
  };
  const sessions = { main: randomUUID(), second: randomUUID(), archived: randomUUID(), unknown: randomUUID() };
  const avatarIds: string[] = [];
  const bucket: PrivateBucket = {
    get: async () => ({ size: 1, body: new Response('x').body!, arrayBuffer: async () => new ArrayBuffer(1) }),
    put: async () => null,
    delete: async () => {},
    list: async () => ({ objects: [], truncated: false }),
  };

  beforeAll(async () => {
    ({ db, dispose } = await openStoreDatabase({ configPath: 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc', remoteBindings: false }));
    await applyMigrations(db);
    // One batch applies the writes in this order. Writes that start together reach the database in any order.
    const writes: D1Statement[] = [];
    const write = (sql: string, ...values: Array<string | number | null>) => { writes.push(db.prepare(sql).bind(...values)); };
    const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
    const [event, archivedEvent, mainTeam, otherTeam, secondTeam] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    write('INSERT INTO events (id, archived) VALUES (?, 0), (?, 1)', event, archivedEvent);
    write('INSERT INTO sessions (id, event_id) VALUES (?, ?), (?, ?), (?, ?)',
      sessions.main, event, sessions.second, event, sessions.archived, archivedEvent);
    write('INSERT INTO teams (id, session_id) VALUES (?, ?), (?, ?), (?, ?)',
      mainTeam, sessions.main, otherTeam, sessions.main, secondTeam, sessions.second);
    for (const [name, caller] of Object.entries(people)) {
      write('INSERT INTO accounts (id, name, must_change, disabled) VALUES (?, ?, ?, ?)', caller.accountId,
        `Fictional ${name}`, Number(caller === people.mustChange), Number(caller === people.disabled));
      write(`INSERT INTO ba_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ${now}, ${now})`,
        caller.accountId, name, `${caller.accountId}@avatars.minsky.invalid`);
      write(`INSERT INTO ba_session (id, userId, token, expiresAt, createdAt, updatedAt)
        VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'), ${now}, ${now})`, caller.loginId, caller.accountId, randomUUID());
      write('INSERT INTO logins (id, account_id, expires_at, identity_session_id, revoked) VALUES (?, ?, unixepoch() + 3600, ?, ?)',
        caller.loginId, caller.accountId, caller.loginId, Number(caller === people.revokedLogin));
    }
    const staff = (caller: Caller, session: string, role: string | null, isAdmin = 0) => {
      write('INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, NULL, ?)', session, caller.accountId, isAdmin);
      if (role) write('INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, ?)', session, caller.accountId, role);
    };
    const contestant = (caller: Caller, session: string, team: string) =>
      write('INSERT INTO memberships (session_id, account_id, team_id) VALUES (?, ?, ?)', session, caller.accountId, team);
    staff(people.admin, sessions.main, null, 1); staff(people.volunteer, sessions.main, 'volunteer');
    staff(people.jury, sessions.main, 'jury'); contestant(people.contestant, sessions.main, mainTeam);
    contestant(people.teammate, sessions.main, mainTeam); contestant(people.otherTeam, sessions.main, otherTeam);
    staff(people.plainMember, sessions.main, null); staff(people.staffAndContestant, sessions.main, 'volunteer');
    contestant(people.staffAndContestant, sessions.second, secondTeam); staff(people.noAvatar, sessions.main, 'specialist');
    staff(people.disabled, sessions.main, 'volunteer'); staff(people.mustChange, sessions.main, 'volunteer');
    staff(people.revokedLogin, sessions.main, 'volunteer'); staff(people.removedMember, sessions.main, 'volunteer');
    staff(people.admin, sessions.second, null, 1); staff(people.otherSessionStaff, sessions.second, 'volunteer');
    staff(people.archivedStaff, sessions.archived, 'volunteer'); staff(people.archivedJury, sessions.archived, 'jury');
    write('DELETE FROM memberships WHERE session_id = ? AND account_id = ?', sessions.main, people.removedMember.accountId);
    const avatar = (caller: Caller, state: string) => {
      const id = randomUUID();
      avatarIds.push(id);
      write(`INSERT INTO account_avatars (id, account_id, request_id, byte_size, content_type, digest, state, ready_at, retired_at)
        VALUES (?, ?, ?, 1, 'image/png', ?, ?, ${now}, CASE WHEN ? = 'retired' THEN ${now} END)`,
      id, caller.accountId, randomUUID(), 'a'.repeat(64), state, state);
    };
    for (const caller of Object.values(people)) if (caller !== people.noAvatar) avatar(caller, 'ready');
    avatar(people.volunteer, 'retired');
    avatar(people.jury, 'pending');
    avatar(people.contestant, 'expired');
    await db.batch(writes);
  });
  afterAll(async () => { await dispose?.(); });

  async function reference(caller: Caller, sessionId: string) {
    const bindings = [...currentReadyLoginBindings(caller), ...contestDataBindings(caller, sessionId), sessionId];
    const statement = db.prepare(`${referenceVisibleSql} ORDER BY v.account_id`).bind(...bindings);
    return (await statement.all<{ person_id: string; avatar_id: string; content_type: string }>()).results;
  }

  it('lists the same avatars as the reference for every caller and session', async () => {
    const avatars = new R2AvatarService(db, bucket);
    for (const [name, caller] of Object.entries(people)) {
      for (const [session, sessionId] of Object.entries(sessions)) {
        const expected = (await reference(caller, sessionId)).map(({ person_id, avatar_id }) => ({ person_id, avatar_id }));
        expect(await avatars.list(caller, sessionId), `${name} in the ${session} session`).toEqual(expected);
      }
    }
    const owners = async (caller: Caller, sessionId: string) =>
      (await avatars.list(caller, sessionId)).map((avatar) => avatar.person_id).sort();
    const mainStaff = [people.admin, people.volunteer, people.jury, people.staffAndContestant,
      people.disabled, people.mustChange, people.revokedLogin].map((caller) => caller.accountId).sort();
    expect(await owners(people.volunteer, sessions.main)).toEqual(mainStaff);
    expect(await owners(people.contestant, sessions.main)).toEqual([people.contestant.accountId]);
    expect(await owners(people.staffAndContestant, sessions.second)).toEqual([people.staffAndContestant.accountId]);
    expect(await owners(people.archivedStaff, sessions.archived))
      .toEqual([people.archivedStaff.accountId, people.archivedJury.accountId].sort());
    expect(await owners(people.disabled, sessions.main)).toEqual([]);
  });

  it('downloads exactly the avatars that the reference permits, in every avatar state', async () => {
    const avatars = new R2AvatarService(db, bucket);
    for (const [name, caller] of Object.entries(people)) {
      for (const [session, sessionId] of Object.entries(sessions)) {
        // The reference asks for one avatar with one more AND, so its list for the caller holds the answer for each avatar.
        const visible = new Map((await reference(caller, sessionId)).map((row) => [row.avatar_id, row.content_type]));
        await Promise.all(avatarIds.map(async (avatarId) => {
          const actual = await avatars.download(caller, sessionId, avatarId).then(
            async (result) => { await result.body.cancel(); return result.contentType; },
            (error: unknown) => { expect(error).toMatchObject({ validation: true }); return undefined; });
          expect(actual, `${name} reads ${avatarId} in the ${session} session`).toBe(visible.get(avatarId));
        }));
      }
    }
  });
});
