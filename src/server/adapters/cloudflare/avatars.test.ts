import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { AVATAR_MAX_BYTES } from '../../../connected/imageFile';
import type { Caller } from '../../authentication';
import type { D1Connection } from '../d1/connection';
import { D1Fixture, applyMigrations } from '../d1/testFixture';
import { R2AvatarService, avatarKey } from './avatars';
import type { PrivateBucket } from './images';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

interface TestBucket extends PrivateBucket {
  list(options: { prefix: string }): Promise<{ objects: Array<{ key: string }> }>;
}

describe('Cloudflare avatars with local D1 and R2 bindings', () => {
  let directory: string;
  let db: D1Connection;
  let bucket: TestBucket;
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
    const platform = await getPlatformProxy<{ DB: D1Connection; IMAGES: TestBucket }>({
      configPath, persist: false, remoteBindings: false, envFiles: [],
    });
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
    const [pending] = await fixture.rows('SELECT id, state FROM account_avatars WHERE account_id = ?', staff.accountId);
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
    const [{ id: abandoned }] = await fixture.rows('SELECT id FROM account_avatars WHERE account_id = ?', staff.accountId) as Array<{ id: string }>;
    const abandonedKey = avatarKey(staff.accountId, abandoned);
    await db.prepare('UPDATE account_avatars SET expires_at = unixepoch() - 1 WHERE id = ?').bind(abandoned).run();

    const stuck = new R2AvatarService(db, { get: bucket.get.bind(bucket), put: bucket.put.bind(bucket),
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
