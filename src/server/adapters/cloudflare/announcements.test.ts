import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { Caller } from '../../authentication';
import type { D1Connection, D1Statement } from '../d1/connection';
import { D1Fixture, applyMigrations } from '../d1/testFixture';
import { D1AnnouncementService } from './announcements';
import { R2AnnouncementImageService } from './announcementImages';
import { fenceFixtureEvent } from './eventDeletionFixture';
import type { PrivateBucket } from './images';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

interface TestBucket extends Omit<PrivateBucket, 'put'> {
  put(key: string, body: Uint8Array | ReadableStream<Uint8Array>, options?: Parameters<PrivateBucket['put']>[2]): Promise<unknown | null>;
}

describe('Cloudflare session announcements with local D1 and R2 bindings', () => {
  let directory: string;
  let db: D1Connection;
  let bucket: TestBucket;
  let dispose: () => Promise<void>;
  let fixture: D1Fixture;
  let service: D1AnnouncementService;
  let images: R2AnnouncementImageService;
  let created: boolean;
  let ownedKeys: Set<string>;
  // The fixture's staff account is the admin. The specialist also holds the jury role.
  let admin: Caller;
  let jury: Caller;
  let contestant: Caller;
  // Staff in a second session where this account is only a volunteer.
  let volunteer: Caller;

  function statement(sql: string, ...values: Array<string | number | null>): D1Statement {
    return db.prepare(sql).bind(...values);
  }

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'minsky-announcement-tests-'));
    const entry = join(directory, 'worker.js');
    writeFileSync(entry, 'export default { fetch() { return new Response("Isolated announcement test binding"); } };');
    const configPath = join(directory, 'wrangler.json');
    writeFileSync(configPath, JSON.stringify({
      name: 'minsky-announcement-tests', main: entry, compatibility_date: '2026-10-13',
      account_id: '458ad6a930b0fb717796dfa19ca6a2b1',
      d1_databases: [{ binding: 'DB', database_name: 'minsky-announcement-tests', database_id: randomUUID() }],
      r2_buckets: [{ binding: 'IMAGES', bucket_name: 'minsky-announcement-tests' }],
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
    created = false;
    ownedKeys = new Set();
    fixture = new D1Fixture(db, join(directory, 'wrangler.json'), true);
    await fixture.create();
    created = true;
    await db.batch([
      statement('UPDATE memberships SET is_admin = 1 WHERE session_id = ? AND account_id = ?', fixture.sessionId, fixture.staff.accountId),
      statement("INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'jury')", fixture.sessionId, fixture.specialist.accountId),
    ]);
    admin = fixture.staff;
    jury = fixture.specialist;
    contestant = fixture.contestant;
    volunteer = fixture.staff;
    service = new D1AnnouncementService(db);
    images = new R2AnnouncementImageService(db, bucket);
  });

  afterEach(async () => {
    if (!created) return;
    const rows = await fixture.rows('SELECT object_key FROM announcement_images WHERE session_id IN (?, ?)',
      fixture.sessionId, fixture.secondSessionId);
    for (const row of rows) ownedKeys.add(row.object_key as string);
    if (ownedKeys.size) await bucket.delete([...ownedKeys]);
    for (const prefix of [fixture.sessionId, fixture.secondSessionId, `source:${fixture.eventId}:`]) {
      expect((await bucket.list({ prefix })).objects).toEqual([]);
    }
    await fixture.cleanup();
    expect(await fixture.rows('SELECT id FROM announcements WHERE session_id IN (?, ?)', fixture.sessionId, fixture.secondSessionId)).toEqual([]);
  });

  const publishCommand = (overrides: Record<string, unknown> = {}) => ({
    type: 'publish', title: ' Fictional title ', details: ' Fictional plain details. ', expires_at: null, ...overrides,
  });

  async function publish(caller = admin, overrides: Record<string, unknown> = {}, sessionId = fixture.sessionId) {
    return service.execute(caller, sessionId, randomUUID(), publishCommand(overrides));
  }

  async function read(caller: Caller, sessionId = fixture.sessionId) {
    return service.snapshot(caller, sessionId);
  }

  async function reserve(announcementId: string, caller = admin, requestId = randomUUID(), bytes = png.byteLength) {
    return images.begin(caller, { sessionId: fixture.sessionId, announcementId, requestId, name: 'fictional.png', bytes });
  }

  // A binding-provided body retains its known length through the R2 proxy.
  async function transfer(path: string, options: {
    bytes?: Uint8Array; digest?: string; length?: number; caller?: Caller; instance?: R2AnnouncementImageService;
  } = {}) {
    const bytes = options.bytes ?? png;
    const sourceKey = `source:${fixture.eventId}:${randomUUID()}`;
    ownedKeys.add(sourceKey);
    await bucket.put(sourceKey, bytes);
    const source = await bucket.get(sourceKey);
    if (!source) throw new Error('The test source object is missing.');
    try {
      await (options.instance ?? images).upload(options.caller ?? admin, path, source.body, 'image/png',
        options.digest ?? sha256(bytes), options.length ?? bytes.byteLength);
    } finally {
      if (!source.body.locked) await source.body.cancel();
    }
  }

  async function publishedImage(announcementId: string) {
    const image = await reserve(announcementId);
    await transfer(image.path);
    await images.finish(admin, fixture.sessionId, image.id);
    return image;
  }

  async function bytesOf(path: string, caller: Caller) {
    const result = await images.download(caller, path);
    return new Uint8Array(await new Response(result.body).arrayBuffer());
  }

  it('publishes trimmed text with server attribution and shows it to every current member', async () => {
    const id = await publish();
    const manager = (await read(admin)).announcements;
    expect(manager).toHaveLength(1);
    expect(manager[0]).toMatchObject({ id, title: 'Fictional title', details: 'Fictional plain details.',
      author: admin.accountId, revision: 0, expires_at: null, edited_at: null, removed_at: null });
    for (const caller of [jury, contestant, fixture.otherContestant]) {
      expect((await read(caller)).announcements.map((announcement) => announcement.id)).toEqual([id]);
    }
    const audiences = await fixture.rows("SELECT audience FROM audience_sequences WHERE session_id = ? AND audience NOT LIKE 'account:%' ORDER BY audience", fixture.sessionId);
    expect(audiences.map((row) => row.audience)).toEqual(['staff', `team:${fixture.teamId}`, `team:${fixture.otherTeamId}`].sort());
  });

  it('limits management to admins and jury in an active event and isolates sessions', async () => {
    await expect(publish(contestant)).rejects.toMatchObject({ reason: 'access' });
    await expect(publish(volunteer, {}, fixture.secondSessionId)).rejects.toMatchObject({ reason: 'access' });
    const id = await publish(jury);
    await expect(read(volunteer, fixture.secondSessionId)).resolves.toMatchObject({ announcements: [] });
    await expect(read(contestant, fixture.secondSessionId)).rejects.toMatchObject({ status: 403 });
    await expect(service.execute(contestant, fixture.sessionId, randomUUID(), { type: 'remove', id, revision: 0 }))
      .rejects.toMatchObject({ reason: 'access' });
    await statement('UPDATE events SET archived = 1 WHERE id = ?', fixture.eventId).run();
    await expect(publish()).rejects.toMatchObject({ reason: 'state' });
    expect((await read(contestant)).announcements).toHaveLength(1);
  });

  it('rejects invalid input before writing and ignores forged attribution', async () => {
    for (const overrides of [{ title: ' ' }, { title: 'x'.repeat(161) }, { details: '' }, { details: 'x'.repeat(10_001) },
      { expires_at: new Date(Date.now() - 1000).toISOString() }, { expires_at: 'tomorrow' }, { author: contestant.accountId }]) {
      await expect(publish(admin, overrides)).rejects.toMatchObject({ reason: 'input' });
    }
    await expect(service.execute(admin, fixture.sessionId, 'not-a-uuid', publishCommand())).rejects.toMatchObject({ reason: 'input' });
    expect((await read(admin)).announcements).toEqual([]);
  });

  it('rejects a NUL character in a title or details as input, so no database check fails later', async () => {
    const id = await publish();
    const edit = { type: 'edit', id, revision: 0, title: 'Edited', details: 'Edited details.', expires_at: null };
    for (const text of ['\u0000Fixture', 'Fix\u0000ture', 'Fixture\u0000']) {
      for (const field of ['title', 'details']) {
        await expect(publish(admin, { [field]: text })).rejects.toMatchObject({
          reason: 'input', message: 'Check the announcement title, details, and expiry.',
        });
        await expect(service.execute(admin, fixture.sessionId, randomUUID(), { ...edit, [field]: text }))
          .rejects.toMatchObject({ reason: 'input' });
      }
    }
    expect((await read(admin)).announcements).toMatchObject([{ id, title: 'Fictional title', revision: 0 }]);
  });

  it('repeats a request ID without a second write and rejects a different command', async () => {
    const requestId = randomUUID();
    const first = await service.execute(admin, fixture.sessionId, requestId, publishCommand());
    expect(await service.execute(admin, fixture.sessionId, requestId, publishCommand())).toBe(first);
    await expect(service.execute(admin, fixture.sessionId, requestId, publishCommand({ title: 'Another' }))).rejects.toMatchObject({ reason: 'request_id' });
    const [one, two] = await Promise.all([randomUUID(), randomUUID()].map((request) => service.execute(admin, fixture.sessionId, request, publishCommand())));
    expect(one).not.toBe(two);
    const concurrent = randomUUID();
    const results = await Promise.all([1, 2].map(() => service.execute(admin, fixture.sessionId, concurrent, publishCommand({ title: 'Once' }))));
    expect(results[0]).toBe(results[1]);
    expect((await read(admin)).announcements.filter((announcement) => announcement.title === 'Once')).toHaveLength(1);
  });

  const untilPassed = (iso: string) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(iso) - Date.now()) + 25));

  it('replays a committed publish whose expiry passed before the retry, without a second announcement', async () => {
    const requestId = randomUUID();
    const expiresAt = new Date(Date.now() + 1500).toISOString();
    const command = publishCommand({ title: 'Short notice', expires_at: expiresAt });
    const id = await service.execute(admin, fixture.sessionId, requestId, command);
    await untilPassed(expiresAt);
    await expect(service.execute(admin, fixture.sessionId, requestId, command)).resolves.toBe(id);
    expect((await read(admin)).announcements.filter((announcement) => announcement.title === 'Short notice')).toHaveLength(1);
    await expect(service.execute(admin, fixture.sessionId, randomUUID(), command)).rejects.toMatchObject({ reason: 'input' });
  });

  it('replays a committed edit whose expiry passed before the retry, without a second revision', async () => {
    const id = await publish();
    const requestId = randomUUID();
    const expiresAt = new Date(Date.now() + 1500).toISOString();
    const edit = { type: 'edit', id, revision: 0, title: 'Short notice', details: 'Edited details.', expires_at: expiresAt };
    await expect(service.execute(admin, fixture.sessionId, requestId, edit)).resolves.toBe(id);
    await untilPassed(expiresAt);
    await expect(service.execute(admin, fixture.sessionId, requestId, edit)).resolves.toBe(id);
    expect((await read(admin)).announcements).toMatchObject([{ id, title: 'Short notice', revision: 1 }]);
  });

  it('edits with revisions, keeps publication attribution, and reports a competing edit as a conflict', async () => {
    const id = await publish(admin);
    const edit = { type: 'edit', id, revision: 0, title: 'Edited', details: 'Edited details.', expires_at: null };
    await service.execute(jury, fixture.sessionId, randomUUID(), edit);
    const [announcement] = (await read(admin)).announcements;
    expect(announcement).toMatchObject({ title: 'Edited', revision: 1, author: admin.accountId, edited_by: jury.accountId });
    await expect(service.execute(admin, fixture.sessionId, randomUUID(), { ...edit, title: 'Stale' }))
      .rejects.toMatchObject({ reason: 'conflict' });
    const racing = await Promise.allSettled([admin, jury].map((caller, index) =>
      service.execute(caller, fixture.sessionId, randomUUID(), { ...edit, revision: 1, title: `Race ${index}` })));
    expect(racing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(racing.find((result) => result.status === 'rejected')).toMatchObject({ reason: { reason: 'conflict' } });
    expect((await read(admin)).announcements[0]!.revision).toBe(2);
  });

  it('hides removed announcements from everyone, keeps their records, and keeps expired ones for managers', async () => {
    const expiring = await publish(admin, { expires_at: new Date(Date.now() + 60_000).toISOString() });
    const removed = await publish();
    const active = await publish();
    const remove = { type: 'remove', id: removed, revision: 0 };
    await expect(service.execute(jury, fixture.sessionId, randomUUID(), { ...remove, revision: 1 })).rejects.toMatchObject({ reason: 'conflict' });
    const request = randomUUID();
    expect(await service.execute(jury, fixture.sessionId, request, remove)).toBe(removed);
    expect(await service.execute(jury, fixture.sessionId, request, remove)).toBe(removed);
    await statement(`UPDATE announcements SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', published_at, '+0.001 seconds') WHERE id = ?`, expiring).run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await read(contestant)).announcements.map((announcement) => announcement.id)).toEqual([active]);
    for (const manager of [jury, admin]) {
      expect((await read(manager)).announcements.map((announcement) => announcement.id).sort()).toEqual([active, expiring].sort());
    }
    expect(await statement(`SELECT title, details, author, revision, removed_by, removed_name, removed_at IS NOT NULL AS stamped
      FROM announcements WHERE id = ?`, removed).first()).toEqual({ title: 'Fictional title', details: 'Fictional plain details.',
      author: admin.accountId, revision: 1, removed_by: jury.accountId, removed_name: `d1-proof:${fixture.eventId}:1`, stamped: 1 });
    await expect(service.execute(admin, fixture.sessionId, randomUUID(), { type: 'edit', id: removed, revision: 1, title: 'x', details: 'y', expires_at: null }))
      .rejects.toMatchObject({ reason: 'state' });
    // An expired announcement can return by clearing its expiry.
    await service.execute(admin, fixture.sessionId, randomUUID(), { type: 'edit', id: expiring, revision: 0, title: 'Back', details: 'Active again.', expires_at: null });
    expect((await read(contestant)).announcements.map((announcement) => announcement.id).sort()).toEqual([active, expiring].sort());
  });

  it('revokes announcement reads with membership and login state', async () => {
    await publish();
    await statement('UPDATE logins SET revoked = 1 WHERE id = ?', contestant.loginId).run();
    await expect(read(contestant)).rejects.toMatchObject({ status: 403 });
    await expect(publish(contestant)).rejects.toMatchObject({ reason: 'access' });
  });

  it('publishes an image once through R2, checks its bytes, and limits an announcement to four', async () => {
    const id = await publish();
    const input = randomUUID();
    const image = await reserve(id, admin, input);
    expect(await reserve(id, admin, input)).toEqual(image);
    await expect(images.finish(admin, fixture.sessionId, image.id)).rejects.toMatchObject({ incomplete: true });
    await transfer(image.path);
    await Promise.all([images.finish(admin, fixture.sessionId, image.id), images.finish(admin, fixture.sessionId, image.id)]);
    const [announcement] = (await read(contestant)).announcements;
    expect(announcement!.revision).toBe(1);
    const snapshot = await read(contestant);
    expect(snapshot.images).toMatchObject([{ id: image.id, announcement_id: id, uploader: admin.accountId, bytes: png.byteLength, content_type: 'image/png' }]);
    expect(await bytesOf(image.path, contestant)).toEqual(png);
    for (let index = 0; index < 3; index += 1) await publishedImage(id);
    await expect(reserve(id)).rejects.toMatchObject({ validation: true });
    await expect(reserve(id, contestant)).rejects.toMatchObject({ validation: true });
  });

  it('rejects mismatched transfers and keeps pending files unreadable', async () => {
    const id = await publish();
    const image = await reserve(id);
    await expect(transfer(image.path, { length: png.byteLength - 1 })).rejects.toMatchObject({ validation: true });
    await expect(transfer(image.path, { caller: jury })).rejects.toMatchObject({ validation: true });
    await expect(transfer(image.path, { digest: 'f'.repeat(64) })).rejects.toBeDefined();
    await transfer(image.path);
    await expect(images.download(contestant, image.path)).rejects.toMatchObject({ validation: true });
    await expect(images.download(admin, image.path)).rejects.toMatchObject({ validation: true });
    const text = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    const bad = await reserve(id, admin, randomUUID(), text.byteLength);
    await transfer(bad.path, { bytes: text });
    await expect(images.finish(admin, fixture.sessionId, bad.id)).rejects.toMatchObject({ validation: true });
  });

  it('keeps the stored file when completion fails so a retry can publish it', async () => {
    const id = await publish();
    const image = await reserve(id);
    await transfer(image.path);
    let failed = false;
    const failing = new R2AnnouncementImageService({ prepare: (sql) => db.prepare(sql), batch: async (statements) => {
      if (!failed) { failed = true; throw new Error('Connection lost before the response.'); }
      return db.batch(statements);
    } }, bucket);
    await expect(failing.finish(admin, fixture.sessionId, image.id)).rejects.toBeDefined();
    expect(await bucket.get(image.path)).not.toBeNull();
    expect(await statement('SELECT state FROM announcement_images WHERE id = ?', image.id).first()).toEqual({ state: 'pending' });
    await images.finish(admin, fixture.sessionId, image.id);
    expect(await bytesOf(image.path, contestant)).toEqual(png);
  });

  it('does not delete a file that another request published after a failed late transfer', async () => {
    const id = await publish();
    const image = await reserve(id);
    await transfer(image.path);
    await images.finish(admin, fixture.sessionId, image.id);
    await expect(transfer(image.path, { digest: 'e'.repeat(64) })).rejects.toBeDefined();
    expect(await bytesOf(image.path, admin)).toEqual(png);
  });

  it('removes its own file when the event is fenced and the rows step removes the image during the transfer', async () => {
    const id = await publish();
    const image = await reserve(id);
    const late = new R2AnnouncementImageService(db, {
      get: (key, options) => bucket.get(key, options), delete: (keys) => bucket.delete(keys), list: (options) => bucket.list(options),
      put: async (key, body, options) => {
        // The file pass of the deletion can also be over by now, so no later step removes this file.
        await fenceFixtureEvent(db, fixture.eventId);
        await statement('DELETE FROM announcement_images WHERE id = ?', image.id).run();
        return bucket.put(key, body, options);
      },
    });
    await expect(transfer(image.path, { instance: late })).rejects.toMatchObject({ validation: true });
    expect((await bucket.list({ prefix: `${fixture.sessionId}/` })).objects).toEqual([]);
  });

  it('removes a ready image for any manager, keeps its record, and deletes its file', async () => {
    const id = await publish();
    const image = await publishedImage(id);
    await expect(images.remove(contestant, fixture.sessionId, image.id)).rejects.toMatchObject({ validation: true });
    await images.remove(jury, fixture.sessionId, image.id);
    await images.remove(jury, fixture.sessionId, image.id);
    expect(await bucket.get(image.path)).toBeNull();
    expect(await statement('SELECT state, deleted_by FROM announcement_images WHERE id = ?', image.id).first())
      .toEqual({ state: 'deleted', deleted_by: jury.accountId });
    expect((await read(contestant)).images).toEqual([]);
    expect((await read(admin)).announcements[0]!.revision).toBe(2);
  });

  it('says that the event is archived for a manager, and keeps the permission message for others', async () => {
    const id = await publish();
    const ready = await publishedImage(id);
    const pending = await reserve(id);
    await statement('UPDATE events SET archived = 1 WHERE id = ?', fixture.eventId).run();
    const archived = { message: 'This event is archived.', validation: true };
    await expect(images.remove(admin, fixture.sessionId, ready.id)).rejects.toMatchObject(archived);
    await expect(images.finish(jury, fixture.sessionId, pending.id)).rejects.toMatchObject(archived);
    await expect(transfer(pending.path)).rejects.toMatchObject(archived);
    const denied = { message: 'Only session admins and jury can manage announcements.', validation: true };
    await expect(images.remove(contestant, fixture.sessionId, ready.id)).rejects.toMatchObject(denied);
    await expect(images.finish(contestant, fixture.sessionId, pending.id)).rejects.toMatchObject(denied);
  });

  it('keeps the images and files of a removed announcement and hides them from everyone', async () => {
    const id = await publish();
    const image = await publishedImage(id);
    const unfinished = await reserve(id);
    await transfer(unfinished.path);
    await service.execute(admin, fixture.sessionId, randomUUID(), { type: 'remove', id, revision: 1 });
    await images.remove(admin, fixture.sessionId, unfinished.id, true);
    expect(await bucket.get(unfinished.path)).toBeNull();
    for (const caller of [contestant, jury, admin]) {
      await expect(images.download(caller, image.path)).rejects.toMatchObject({ validation: true });
      expect((await read(caller)).images).toEqual([]);
    }
    await expect(reserve(id)).rejects.toMatchObject({ validation: true });
    await expect(images.remove(admin, fixture.sessionId, image.id)).rejects.toMatchObject({ validation: true });
    expect(await statement('SELECT state FROM announcement_images WHERE id = ?', image.id).first()).toEqual({ state: 'ready' });
    expect(await bucket.get(image.path)).not.toBeNull();
  });

  it('shortens a long file name instead of rejecting the image', async () => {
    const id = await publish();
    const image = await images.begin(admin, { sessionId: fixture.sessionId, announcementId: id, requestId: randomUUID(),
      name: `${'a'.repeat(300)}.png`, bytes: png.byteLength });
    expect(await statement('SELECT name FROM announcement_images WHERE id = ?', image.id).first()).toEqual({ name: 'a'.repeat(200) });
  });

  it('abandons unfinished uploads and cleans expired reservations', async () => {
    const id = await publish();
    const abandoned = await reserve(id);
    await transfer(abandoned.path);
    await images.remove(admin, fixture.sessionId, abandoned.id, true);
    expect(await bucket.get(abandoned.path)).toBeNull();
    const stale = await reserve(id);
    await transfer(stale.path);
    await statement('UPDATE announcement_images SET expires_at = unixepoch() - 1 WHERE id = ?', stale.id).run();
    await expect(images.finish(admin, fixture.sessionId, stale.id)).rejects.toMatchObject({ restart: true });
    await images.recover(fixture.sessionId);
    expect(await bucket.get(stale.path)).toBeNull();
    expect(await statement('SELECT state FROM announcement_images WHERE id = ?', stale.id).first()).toEqual({ state: 'expired' });
    // Expired reservations do not count toward the limit.
    for (let index = 0; index < 4; index += 1) await reserve(id);
  });
});
