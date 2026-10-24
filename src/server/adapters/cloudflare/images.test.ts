import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { StartedImage } from '../../../backend/contracts';
import { MIB, THUMBNAIL_BYTES } from '../../../connected/imageFile';
import type { Caller } from '../../authentication';
import type { D1Connection, D1Statement } from '../d1/connection';
import { D1Fixture, applyMigrations } from '../d1/testFixture';
import { D1ApplicationService } from './application';
import { R2ImageService, type PrivateBucket } from './images';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

interface TestBucket extends Omit<PrivateBucket, 'put'> {
  put(key: string, body: Uint8Array | ReadableStream<Uint8Array>, options?: Parameters<PrivateBucket['put']>[2]): Promise<unknown | null>;
  list(options: { prefix: string }): Promise<{ objects: Array<{ key: string }> }>;
}

describe('Cloudflare private images with local D1 and R2 bindings', () => {
  let directory: string;
  let db: D1Connection;
  let bucket: TestBucket;
  let dispose: () => Promise<void>;
  let fixture: D1Fixture;
  let service: R2ImageService;
  let created: boolean;
  let ownedKeys: Set<string>;

  function statement(sql: string, ...values: Array<string | number | null>): D1Statement {
    return db.prepare(sql).bind(...values);
  }

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'minsky-r2-tests-'));
    const entry = join(directory, 'worker.js');
    writeFileSync(entry, 'export default { fetch() { return new Response("Isolated image test binding"); } };');
    const configPath = join(directory, 'wrangler.json');
    writeFileSync(configPath, JSON.stringify({
      name: 'minsky-image-tests', main: entry, compatibility_date: '2026-10-13',
      account_id: '458ad6a930b0fb717796dfa19ca6a2b1',
      d1_databases: [{ binding: 'DB', database_name: 'minsky-image-tests', database_id: randomUUID() }],
      r2_buckets: [{ binding: 'IMAGES', bucket_name: 'minsky-image-tests' }],
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
    service = new R2ImageService(db, bucket);
  });

  afterEach(async () => {
    if (!created) return;
    const rows = await fixture.rows('SELECT original_path, thumbnail_path FROM issue_images WHERE session_id IN (?, ?)',
      fixture.sessionId, fixture.secondSessionId);
    for (const row of rows) {
      ownedKeys.add(row.original_path as string);
      ownedKeys.add(row.thumbnail_path as string);
    }
    if (ownedKeys.size) await bucket.delete([...ownedKeys]);
    for (const prefix of [fixture.sessionId, fixture.secondSessionId, `source:${fixture.eventId}:`]) {
      expect((await bucket.list({ prefix })).objects).toEqual([]);
    }
    await fixture.cleanup();
  });

  async function reserve(options: Partial<Parameters<R2ImageService['begin']>[1]> = {}, instance = service, caller = fixture.staff) {
    return instance.begin(caller, {
      requestId: randomUUID(), sessionId: fixture.sessionId, issueId: fixture.issueId,
      visibility: 'public', name: 'fictional.png', bytes: png.byteLength, ...options,
    });
  }

  // A binding-provided body retains its known length through the R2 proxy.
  // This exercises the actual SHA-256 and conditional-create R2 implementation.
  async function transfer(image: StartedImage, kind: 'original' | 'thumbnail', options: {
    bytes?: Uint8Array; contentType?: string; digest?: string; length?: number;
    caller?: Caller; instance?: R2ImageService;
  } = {}) {
    const bytes = options.bytes ?? png;
    const sourceKey = `source:${fixture.eventId}:${randomUUID()}`;
    ownedKeys.add(sourceKey);
    await bucket.put(sourceKey, bytes);
    const source = await bucket.get(sourceKey);
    if (!source) throw new Error('The test source object is missing.');
    const body = source.body;
    try {
      await (options.instance ?? service).upload(options.caller ?? fixture.staff,
        kind === 'original' ? image.original_path : image.thumbnail_path, body,
        options.contentType ?? 'image/png', options.digest ?? sha256(bytes), options.length ?? bytes.byteLength);
    } finally {
      if (!body.locked) await body.cancel();
    }
  }

  async function stored(image: StartedImage, instance = service) {
    await Promise.all([transfer(image, 'original', { instance }), transfer(image, 'thumbnail', { instance })]);
  }

  async function published(visibility: 'public' | 'internal' = 'public') {
    const image = await reserve({ visibility });
    await stored(image);
    await service.finish(fixture.staff, fixture.sessionId, image.id);
    return image;
  }

  async function record(id: string) {
    return statement('SELECT * FROM issue_images WHERE id = ?', id).first<Record<string, unknown>>();
  }

  async function bytes(path: string, caller = fixture.staff, instance = service) {
    const result = await instance.download(caller, path);
    return { bytes: new Uint8Array(await new Response(result.body).arrayBuffer()), contentType: result.contentType };
  }

  function wrappedBucket(overrides: Partial<PrivateBucket>): PrivateBucket {
    return {
      get: (key, options) => bucket.get(key, options),
      put: (key, body, options) => bucket.put(key, body, options),
      delete: (keys) => bucket.delete(keys), ...overrides,
    };
  }

  function beforeBatch(action: () => Promise<unknown>): R2ImageService {
    let first = true;
    return new R2ImageService({ prepare: (sql) => db.prepare(sql), batch: async (statements) => {
      if (first) { first = false; await action(); }
      return db.batch(statements);
    } }, bucket);
  }

  function changeAtFinalGuard(sql: string, value: string): R2ImageService {
    return new R2ImageService({ prepare: (query) => db.prepare(query), batch: (statements) => {
      const finalGuard = statements.length - 2;
      return db.batch([...statements.slice(0, finalGuard), statement(sql, value), ...statements.slice(finalGuard)]);
    } }, bucket);
  }

  async function guardedEffects() {
    return Promise.all([
      fixture.durableState(),
      fixture.rows('SELECT * FROM issue_images WHERE session_id = ? ORDER BY id', fixture.sessionId),
      fixture.rows('SELECT d.* FROM image_deletions d JOIN issue_images x ON x.id = d.attachment_id WHERE x.session_id = ? ORDER BY d.attachment_id', fixture.sessionId),
      fixture.rows('SELECT * FROM accounts WHERE id = ?', fixture.staff.accountId),
      fixture.rows('SELECT * FROM logins WHERE id = ?', fixture.staff.loginId),
      fixture.rows('SELECT * FROM ba_session WHERE userId = ?', fixture.staff.accountId),
    ]);
  }

  it('publishes real R2 bytes once, preserves digest metadata, and reuses matching reservations', async () => {
    const input = { requestId: randomUUID() };
    const image = await reserve(input);
    expect(await reserve(input)).toEqual(image);
    await expect(service.finish(fixture.staff, fixture.sessionId, image.id)).rejects.toMatchObject({ incomplete: true });
    await stored(image);
    await Promise.all([service.finish(fixture.staff, fixture.sessionId, image.id), service.finish(fixture.staff, fixture.sessionId, image.id)]);
    await service.finish(fixture.staff, fixture.sessionId, image.id);
    expect(await bytes(image.original_path)).toEqual({ bytes: png, contentType: 'image/png' });
    expect(await record(image.id)).toMatchObject({ state: 'ready', byte_size: png.byteLength,
      original_digest: sha256(png), thumbnail_digest: sha256(png) });
    expect(await fixture.rows('SELECT text FROM history WHERE issue_id = ?', fixture.issueId)).toEqual([{ text: 'Image added.' }]);
    expect(await fixture.rows('SELECT id FROM notifications WHERE session_id = ?', fixture.sessionId)).toHaveLength(2);
  });

  it('rejects conflicting request IDs and sanitizes display filenames', async () => {
    const requestId = randomUUID();
    const image = await reserve({ requestId, name: ' folder/fictional\\photo\u0000.png ' });
    expect((await record(image.id))?.original_name).toBe('folder-fictional-photo.png');
    await expect(reserve({ requestId, name: 'other.png' })).rejects.toMatchObject({ validation: true });
    await expect(reserve({ name: '\u0000\n' })).rejects.toMatchObject({ validation: true });
    expect(await fixture.rows('SELECT id FROM issue_images WHERE session_id = ?', fixture.sessionId)).toHaveLength(1);
  });

  it('serializes concurrent reservations for the same request ID', async () => {
    const requestId = randomUUID();
    const images = await Promise.all([reserve({ requestId }), reserve({ requestId })]);
    expect(images[0]).toEqual(images[1]);
    expect(await fixture.rows('SELECT id FROM issue_images WHERE session_id = ?', fixture.sessionId)).toHaveLength(1);
  });

  it('serializes concurrent count limits and rejects oversized file reservations', async () => {
    await statement('UPDATE sessions SET max_images_per_issue = 1 WHERE id = ?', fixture.sessionId).run();
    const results = await Promise.allSettled([reserve(), reserve()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected?.status === 'rejected') expect(rejected.reason).toMatchObject({ validation: true });
    expect(await fixture.rows('SELECT id FROM issue_images WHERE session_id = ?', fixture.sessionId)).toHaveLength(1);
    await expect(reserve({ bytes: 11 * MIB })).rejects.toMatchObject({ validation: true });
    expect(await fixture.rows('SELECT id FROM command_assertions')).toEqual([]);
  });

  it('serializes concurrent combined byte limits while counting pending reservations', async () => {
    await statement('UPDATE sessions SET max_image_bytes = ?, max_image_bytes_per_issue = ? WHERE id = ?', MIB, MIB, fixture.sessionId).run();
    const results = await Promise.allSettled([reserve({ bytes: 600_000 }), reserve({ bytes: 600_000 })]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await fixture.rows('SELECT sum(declared_bytes) AS bytes FROM issue_images WHERE session_id = ?', fixture.sessionId))
      .toEqual([{ bytes: 600_000 }]);
  });

  it('verifies checksums and prevents replacement with different bytes before and after publication', async () => {
    const image = await reserve();
    await expect(transfer(image, 'original', { digest: '0'.repeat(64) })).rejects.toThrow();
    expect(await bucket.get(image.original_path)).toBeNull();
    await transfer(image, 'original');
    await transfer(image, 'original');
    await expect(transfer(image, 'original', { bytes: jpeg, contentType: 'image/jpeg' })).rejects.toMatchObject({ restart: true });
    await transfer(image, 'thumbnail');
    await service.finish(fixture.staff, fixture.sessionId, image.id);
    await transfer(image, 'original');
    await expect(transfer(image, 'original', { bytes: jpeg, contentType: 'image/jpeg' })).rejects.toMatchObject({ validation: true });
    expect((await bytes(image.original_path)).bytes).toEqual(png);
  });

  it('validates transfer lengths, MIME types, and stored image headers', async () => {
    const image = await reserve();
    await expect(transfer(image, 'original', { length: 0 })).rejects.toMatchObject({ validation: true });
    await expect(transfer(image, 'original', { length: png.byteLength + 1 })).rejects.toMatchObject({ validation: true });
    await expect(transfer(image, 'original', { contentType: 'text/html' })).rejects.toMatchObject({ validation: true });
    await expect(transfer(image, 'thumbnail', { length: THUMBNAIL_BYTES + 1 })).rejects.toMatchObject({ validation: true });
    await transfer(image, 'original', { bytes: new Uint8Array(png.byteLength) });
    await transfer(image, 'thumbnail');
    await expect(service.finish(fixture.staff, fixture.sessionId, image.id)).rejects.toMatchObject({ validation: true });
    expect((await record(image.id))?.state).toBe('pending');
  });

  it('rejects an actual object length that differs from the supplied transfer length', async () => {
    const image = await reserve();
    await expect(transfer(image, 'original', { length: 8 })).rejects.toMatchObject({ restart: true });
    expect(await bucket.get(image.original_path)).toBeNull();
    await transfer(image, 'original');
  });

  it('recovers a transfer whose R2 write succeeded before the response failed', async () => {
    const image = await reserve();
    const interrupted = new R2ImageService(db, wrappedBucket({ put: async (key, body, options) => {
      await bucket.put(key, body, options);
      throw new Error('Injected loss after R2 committed');
    } }));
    await expect(transfer(image, 'original', { instance: interrupted })).rejects.toThrow('Injected loss after R2 committed');
    await transfer(image, 'original');
    await transfer(image, 'thumbnail');
    await service.finish(fixture.staff, fixture.sessionId, image.id);
    expect((await bytes(image.original_path)).bytes).toEqual(png);
  });

  it('rechecks lowered limits at finish and leaves metadata unpublished on rejection', async () => {
    const image = await reserve({ bytes: 2 * MIB });
    const large = new Uint8Array(MIB + 1);
    large.set(png);
    await transfer(image, 'original', { bytes: large });
    await transfer(image, 'thumbnail');
    await statement('UPDATE sessions SET max_image_bytes = ? WHERE id = ?', MIB, fixture.sessionId).run();
    await expect(service.finish(fixture.staff, fixture.sessionId, image.id)).rejects.toMatchObject({ validation: true });
    expect((await record(image.id))?.state).toBe('pending');
    expect(await fixture.rows('SELECT id FROM history WHERE issue_id = ?', fixture.issueId)).toEqual([]);
  });

  it('preserves public and staff-only visibility for snapshots and every download', async () => {
    const publicImage = await published();
    const internalImage = await published('internal');
    expect((await bytes(publicImage.original_path, fixture.contestant)).bytes).toEqual(png);
    await expect(bytes(internalImage.original_path, fixture.contestant)).rejects.toThrow();
    await expect(bytes(publicImage.original_path, fixture.otherContestant)).rejects.toThrow();
    expect((await bytes(internalImage.original_path, fixture.specialist)).bytes).toEqual(png);
    const app = new D1ApplicationService(db);
    expect((await app.snapshot(fixture.contestant, fixture.sessionId)).attachments.map((row) => row.id)).toEqual([publicImage.id]);
    expect((await app.snapshot(fixture.specialist, fixture.sessionId)).attachments).toHaveLength(2);
    expect(await fixture.rows('SELECT audience FROM notifications WHERE session_id = ?', fixture.sessionId)).toHaveLength(3);
  });

  it('rechecks membership after awaiting an R2 download', async () => {
    const image = await published();
    const racing = new R2ImageService(db, wrappedBucket({ get: async (key, options) => {
      const object = await bucket.get(key, options);
      await statement('DELETE FROM memberships WHERE session_id = ? AND account_id = ?', fixture.sessionId, fixture.contestant.accountId).run();
      return object;
    } }));
    await expect(bytes(image.original_path, fixture.contestant, racing)).rejects.toThrow();
  });

  it.each(['revoked', 'expired_identity', 'generation', 'membership', 'staff'])(
    'rechecks %s on an already published image read', async (change) => {
      const image = await published('internal');
      const sql: Record<string, [string, string]> = {
        revoked: ['UPDATE logins SET revoked = 1 WHERE id = ?', fixture.staff.loginId],
        expired_identity: ["UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE userId = ?", fixture.staff.accountId],
        generation: ['UPDATE accounts SET credential_generation = credential_generation + 1 WHERE id = ?', fixture.staff.accountId],
        membership: ['DELETE FROM memberships WHERE account_id = ?', fixture.staff.accountId],
        staff: ['DELETE FROM membership_roles WHERE account_id = ?', fixture.staff.accountId],
      };
      await statement(...sql[change]).run();
      await expect(bytes(image.original_path)).rejects.toThrow();
      await expect(bytes(image.thumbnail_path)).rejects.toThrow();
    });

  it('checks current permissions inside an image reservation commit', async () => {
    const racing = beforeBatch(() => statement('DELETE FROM membership_roles WHERE account_id = ?', fixture.staff.accountId).run());
    await expect(reserve({}, racing)).rejects.toThrow();
    expect(await fixture.rows('SELECT id FROM issue_images WHERE session_id = ?', fixture.sessionId)).toEqual([]);
    expect(await fixture.rows('SELECT id FROM command_assertions')).toEqual([]);
  });

  it.each(['staff', 'generation', 'revoked', 'expired_identity', 'missing_identity', 'expired_login', 'archived'])(
    'rechecks %s before an image publication commits', async (change) => {
      const image = await reserve();
      await stored(image);
      const sql: Record<string, [string, string]> = {
        staff: ['DELETE FROM membership_roles WHERE account_id = ?', fixture.staff.accountId],
        generation: ['UPDATE accounts SET credential_generation = credential_generation + 1 WHERE id = ?', fixture.staff.accountId],
        revoked: ['UPDATE logins SET revoked = 1 WHERE id = ?', fixture.staff.loginId],
        expired_identity: ["UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE userId = ?", fixture.staff.accountId],
        missing_identity: ['DELETE FROM ba_session WHERE userId = ?', fixture.staff.accountId],
        expired_login: ['UPDATE logins SET expires_at = unixepoch() - 1 WHERE id = ?', fixture.staff.loginId],
        archived: ['UPDATE events SET archived = 1 WHERE id = ?', fixture.eventId],
      };
      const racing = beforeBatch(() => statement(...sql[change]).run());
      await expect(racing.finish(fixture.staff, fixture.sessionId, image.id)).rejects.toThrow();
      expect((await record(image.id))?.state).toBe('pending');
      expect(await fixture.rows('SELECT id FROM history WHERE issue_id = ?', fixture.issueId)).toEqual([]);
      expect(await fixture.rows("SELECT id FROM notifications WHERE session_id = ? AND audience NOT LIKE 'account:%'", fixture.sessionId)).toEqual([]);
      expect(await fixture.rows('SELECT id FROM command_assertions')).toEqual([]);
    });

  for (const operation of ['begin', 'finish', 'remove', 'abandon'] as const) {
    it.each(['expired_login', 'expired_identity', 'revoked', 'generation', 'must_change'])(
      `rolls back image ${operation} when %s changes at the final guard`, async (restriction) => {
        const image = operation === 'begin' ? undefined : operation === 'remove' ? await published() : await reserve();
        if (image && operation === 'finish') await stored(image);
        if (image && operation === 'abandon') await transfer(image, 'original');
        const changes: Record<string, [string, string]> = {
          expired_login: ['UPDATE logins SET expires_at = unixepoch() - 1 WHERE id = ?', fixture.staff.loginId],
          expired_identity: ["UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE userId = ?", fixture.staff.accountId],
          revoked: ['UPDATE logins SET revoked = 1 WHERE id = ?', fixture.staff.loginId],
          generation: ['UPDATE accounts SET credential_generation = credential_generation + 1 WHERE id = ?', fixture.staff.accountId],
          must_change: ['UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.staff.accountId],
        };
        const racing = changeAtFinalGuard(...changes[restriction]);
        const before = await guardedEffects();
        const result = operation === 'begin' ? reserve({}, racing)
          : operation === 'finish' ? racing.finish(fixture.staff, fixture.sessionId, image!.id)
          : racing.remove(fixture.staff, fixture.sessionId, image!.id, operation === 'abandon');
        await expect(result).rejects.toMatchObject({ validation: true });
        expect(await guardedEffects()).toEqual(before);
        expect(await fixture.rows('SELECT * FROM command_assertions')).toEqual([]);
      });
  }

  it('restricts removal to the uploader and blocks new changes in archived events', async () => {
    const image = await published();
    await expect(service.remove(fixture.specialist, fixture.sessionId, image.id)).rejects.toThrow();
    await statement('UPDATE events SET archived = 1 WHERE id = ?', fixture.eventId).run();
    await expect(service.remove(fixture.staff, fixture.sessionId, image.id)).rejects.toThrow();
    await expect(reserve()).rejects.toThrow();
    await expect(transfer(image, 'original')).rejects.toThrow();
    expect((await bytes(image.original_path, fixture.contestant)).bytes).toEqual(png);
  });

  it.each(['archived', 'revoked', 'expired_identity'])(
    'rechecks %s inside an image removal commit', async (change) => {
      const image = await published();
      const sql: Record<string, [string, string]> = {
        archived: ['UPDATE events SET archived = 1 WHERE id = ?', fixture.eventId],
        revoked: ['UPDATE logins SET revoked = 1 WHERE id = ?', fixture.staff.loginId],
        expired_identity: ["UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE userId = ?", fixture.staff.accountId],
      };
      const racing = beforeBatch(() => statement(...sql[change]).run());
      await expect(racing.remove(fixture.staff, fixture.sessionId, image.id)).rejects.toThrow();
      expect((await record(image.id))?.state).toBe('ready');
      expect(await fixture.rows('SELECT text FROM history WHERE issue_id = ?', fixture.issueId)).toEqual([{ text: 'Image added.' }]);
      expect(await fixture.rows('SELECT attachment_id FROM image_deletions WHERE attachment_id = ?', image.id)).toEqual([]);
      const object = await bucket.get(image.original_path);
      expect(object).not.toBeNull();
      await object?.body.cancel();
    });

  it('retains failed deletion tasks and permits exact-key cleanup retries after archival', async () => {
    const image = await published();
    const failing = new R2ImageService(db, wrappedBucket({ delete: async () => { throw new Error('Injected R2 deletion failure'); } }));
    await expect(failing.remove(fixture.staff, fixture.sessionId, image.id)).rejects.toThrow('Injected R2 deletion failure');
    expect((await record(image.id))?.state).toBe('deleting');
    expect(await fixture.rows('SELECT attachment_id FROM image_deletions WHERE attachment_id = ?', image.id)).toEqual([{ attachment_id: image.id }]);
    expect((await new D1ApplicationService(db).snapshot(fixture.staff, fixture.sessionId)).pending_removals.map((row) => row.id)).toEqual([image.id]);
    await expect(bytes(image.original_path)).rejects.toThrow();
    await statement('UPDATE events SET archived = 1 WHERE id = ?', fixture.eventId).run();
    await service.remove(fixture.staff, fixture.sessionId, image.id);
    expect((await record(image.id))?.state).toBe('deleted');
    expect(await bucket.get(image.original_path)).toBeNull();
    expect(await fixture.rows('SELECT text FROM history WHERE issue_id = ? ORDER BY text', fixture.issueId))
      .toEqual([{ text: 'Image added.' }, { text: 'Image removed.' }]);
  });

  it('allows current members to abandon their own pending files after a team change', async () => {
    const image = await reserve();
    await transfer(image, 'original');
    await db.batch([
      statement('DELETE FROM membership_roles WHERE session_id = ? AND account_id = ?', fixture.sessionId, fixture.staff.accountId),
      statement('UPDATE memberships SET team_id = ? WHERE session_id = ? AND account_id = ?', fixture.otherTeamId, fixture.sessionId, fixture.staff.accountId),
    ]);
    await service.remove(fixture.staff, fixture.sessionId, image.id, true);
    expect((await record(image.id))?.state).toBe('abandoned');
    expect(await bucket.get(image.original_path)).toBeNull();
    expect(await fixture.rows('SELECT id FROM history WHERE issue_id = ?', fixture.issueId)).toEqual([]);
  });

  it('expires only scoped pending uploads and retries abandoned cleanup without deleting unrelated objects', async () => {
    const expired = await reserve();
    const abandoned = await reserve();
    const otherSession = await reserve({ sessionId: fixture.secondSessionId, issueId: fixture.secondSessionIssueId });
    await stored(expired);
    await stored(abandoned);
    await transfer(otherSession, 'original');
    await statement('UPDATE issue_images SET expires_at = unixepoch() - 1 WHERE id IN (?, ?)', expired.id, otherSession.id).run();
    const failing = new R2ImageService(db, wrappedBucket({ delete: async () => { throw new Error('Injected cleanup failure'); } }));
    await expect(failing.remove(fixture.staff, fixture.sessionId, abandoned.id, true)).rejects.toThrow();
    await service.recover(fixture.sessionId);
    expect((await record(expired.id))?.state).toBe('expired');
    expect((await record(otherSession.id))?.state).toBe('pending');
    expect(await bucket.get(expired.original_path)).toBeNull();
    expect(await bucket.get(abandoned.original_path)).toBeNull();
    const untouched = await bucket.get(otherSession.original_path);
    expect(untouched).not.toBeNull();
    await untouched?.body.cancel();
  });

  it('recovers an upload whose deadline passes between recovery statements', async () => {
    const image = await reserve();
    await transfer(image, 'original');
    const racing = new R2ImageService({
      prepare: (sql) => db.prepare(sql),
      batch: (statements) => db.batch([
        statements[0],
        // Advance this reservation's deadline between the two SQL statements.
        // This models database time crossing expiry without a wall-clock delay.
        statement('UPDATE issue_images SET expires_at = unixepoch() - 1 WHERE id = ?', image.id),
        ...statements.slice(1),
      ]),
    }, bucket);
    await racing.recover(fixture.sessionId);
    const first = await record(image.id);
    const tasks = await fixture.rows('SELECT attachment_id FROM image_deletions WHERE attachment_id = ?', image.id);
    expect(first?.state === 'pending' || tasks.length === 1).toBe(true);
    await service.recover(fixture.sessionId);
    expect(await record(image.id)).toMatchObject({ state: 'expired', files_removed_at: expect.any(String) });
    expect(await bucket.get(image.original_path)).toBeNull();
  });

  it('removes a late transfer after deletion and revocation commit during R2 transfer', async () => {
    const image = await published();
    const racing = new R2ImageService(db, wrappedBucket({ put: async (key, body, options) => {
      await service.remove(fixture.staff, fixture.sessionId, image.id);
      const result = await bucket.put(key, body, options);
      await statement('UPDATE logins SET revoked = 1 WHERE id = ?', fixture.staff.loginId).run();
      return result;
    } }));
    await expect(transfer(image, 'original', { instance: racing })).rejects.toThrow();
    expect(await bucket.get(image.original_path)).toBeNull();
    expect((await record(image.id))?.state).toBe('deleted');
    expect((await record(image.id))?.files_removed_at).not.toBeNull();
  });

  it('retains tombstones so recovery removes late bytes after the transfer process stops', async () => {
    const image = await published();
    await service.remove(fixture.staff, fixture.sessionId, image.id);
    await bucket.put(image.original_path, png);
    await service.recover(fixture.sessionId);
    expect(await bucket.get(image.original_path)).toBeNull();
    expect(await fixture.rows('SELECT attachment_id FROM image_deletions WHERE attachment_id = ?', image.id)).toHaveLength(1);
  });

  it('cleans a later image when the first 100 deletion tasks keep failing', async () => {
    const failures = Array.from({ length: 100 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    await db.batch(failures.flatMap((id) => [
      statement(`INSERT INTO issue_images (id, session_id, issue_id, uploader, uploader_name, request_id,
        visibility, declared_bytes, original_name, original_path, thumbnail_path, state)
        VALUES (?, ?, ?, ?, 'Fictional uploader', ?, 'internal', 1, 'fictional.png', ?, ?, 'expired')`,
      id, fixture.sessionId, fixture.issueId, fixture.staff.accountId, randomUUID(),
      `${fixture.sessionId}/${fixture.issueId}/${id}/original`, `${fixture.sessionId}/${fixture.issueId}/${id}/thumbnail`),
      statement('INSERT INTO image_deletions (attachment_id) VALUES (?)', id),
    ]));
    const image = await reserve();
    await transfer(image, 'original');
    await statement('UPDATE issue_images SET expires_at = unixepoch() - 1 WHERE id = ?', image.id).run();
    const recovering = new R2ImageService(db, wrappedBucket({ delete: async (keys) => {
      if (keys.includes(image.original_path)) await bucket.delete(keys);
      else throw new Error('Injected persistent deletion failure');
    } }));
    await expect(recovering.recover(fixture.sessionId)).rejects.toThrow('requires another attempt');
    const waiting = await bucket.get(image.original_path);
    expect(waiting).not.toBeNull();
    await waiting?.body.cancel();
    await expect(recovering.recover(fixture.sessionId)).rejects.toThrow('requires another attempt');
    expect(await bucket.get(image.original_path)).toBeNull();
    expect((await record(image.id))?.files_removed_at).not.toBeNull();
    expect(await fixture.rows('SELECT attempts FROM image_deletions WHERE attachment_id = ?', image.id)).toEqual([{ attempts: 1 }]);
  });

  it.each([false, true])('removes a late object after fixture metadata deletion, including response loss %s', async (lostResponse) => {
    const image = await reserve();
    ownedKeys.add(image.original_path);
    const racing = new R2ImageService(db, wrappedBucket({ put: async (key, body, options) => {
      await statement('DELETE FROM issue_images WHERE id = ?', image.id).run();
      const result = await bucket.put(key, body, options);
      if (lostResponse) throw new Error('Injected loss after late R2 write');
      return result;
    } }));
    await expect(transfer(image, 'original', { instance: racing })).rejects.toThrow();
    expect(await bucket.get(image.original_path)).toBeNull();
  });

  it('preserves a published image when its uploader loses access during a matching transfer retry', async () => {
    const image = await published();
    const racing = new R2ImageService(db, wrappedBucket({ put: async (key, body, options) => {
      const result = await bucket.put(key, body, options);
      await statement('UPDATE logins SET revoked = 1 WHERE id = ?', fixture.staff.loginId).run();
      return result;
    } }));
    await expect(transfer(image, 'original', { instance: racing })).rejects.toThrow();
    expect((await bytes(image.original_path, fixture.contestant)).bytes).toEqual(png);
    expect((await record(image.id))?.state).toBe('ready');
  });

  it('enforces immutable image identities and allowed lifecycle transitions in D1', async () => {
    const image = await reserve();
    await expect(statement("UPDATE issue_images SET visibility = 'internal' WHERE id = ?", image.id).run()).rejects.toThrow();
    await expect(statement("UPDATE issue_images SET original_path = 'foreign/key' WHERE id = ?", image.id).run()).rejects.toThrow();
    await service.remove(fixture.staff, fixture.sessionId, image.id, true);
    await expect(statement("UPDATE issue_images SET state = 'pending' WHERE id = ?", image.id).run()).rejects.toThrow();
  });
});
