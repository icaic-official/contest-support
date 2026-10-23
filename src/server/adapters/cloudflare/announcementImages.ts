import { z } from 'zod';
import { ANNOUNCEMENT_IMAGE_MAX_BYTES, ANNOUNCEMENT_IMAGE_MAX_COUNT } from '../../../connected/announcementModel';
import { ImageRequestError } from '../../../backend/errors';
import { imageKind } from '../../../connected/imageFile';
import type { Caller } from '../../authentication';
import { equalWorkflowJson } from '../../workflow';
import type { D1Connection, D1Statement } from '../d1/connection';
import {
  announcementAssertion, announcementManagerBindings, announcementManagerSql, announcementNow, sessionAudiences,
} from './announcements';
import { currentAccessBindings, currentAccessSql, currentReadyLoginBindings, currentReadyLoginSql, notificationStatements } from './application';
import type { PrivateBucket } from './images';

interface Image {
  id: string; session_id: string; announcement_id: string; uploader: string; uploader_name: string;
  name: string; declared_bytes: number; content_type: string | null; object_key: string; state: string;
  request_command: string; expired: number; archived: number; manager: number;
  announcement_removed: number; announcement_expired: number;
}

const beginSchema = z.strictObject({
  requestId: z.uuid(), sessionId: z.uuid(), announcementId: z.uuid(),
  name: z.string().min(1).max(200), bytes: z.number().int().min(1).max(ANNOUNCEMENT_IMAGE_MAX_BYTES),
});
const keySchema = z.tuple([z.uuid(), z.literal('announcements'), z.uuid(), z.uuid()]);
type Value = string | number | null;

export function announcementImageKey(sessionId: string, announcementId: string, imageId: string): string {
  return `${sessionId}/announcements/${announcementId}/${imageId}`;
}

const imageSql = `SELECT x.id, x.session_id, x.announcement_id, x.uploader, x.uploader_name, x.name,
  x.declared_bytes, x.content_type, x.object_key, x.state, x.request_command, (x.expires_at <= unixepoch()) AS expired,
  c.archived, (c.is_admin = 1 OR EXISTS (SELECT 1 FROM json_each(c.roles) WHERE value = 'jury')) AS manager,
  (a.removed_at IS NOT NULL) AS announcement_removed,
  (a.expires_at IS NOT NULL AND a.expires_at <= ${announcementNow}) AS announcement_expired
  FROM announcement_images x JOIN announcements a ON a.id = x.announcement_id
  JOIN (${currentAccessSql}) c WHERE x.session_id = ? AND x.id = ?`;

/** Private announcement files share the image bucket under keys that start with the session ID. */
export class R2AnnouncementImageService {
  constructor(private readonly db: D1Connection, private readonly bucket: PrivateBucket) {}

  private statement(sql: string, ...values: Value[]): D1Statement { return this.db.prepare(sql).bind(...values); }

  private async image(caller: Caller, sessionId: string, id: string): Promise<Image> {
    if (!z.uuid().safeParse(sessionId).success || !z.uuid().safeParse(id).success) {
      throw new ImageRequestError('Image unavailable.', { validation: true });
    }
    const row = await this.statement(imageSql, ...currentAccessBindings(caller, sessionId), sessionId, id).first<Image>();
    if (!row) throw new ImageRequestError('Image unavailable.', { validation: true });
    return row;
  }

  /** Managers change images while the event is active. */
  private manage(row: Image): void {
    if (!row.manager || row.archived) {
      throw new ImageRequestError('Only session admins and jury can manage announcements.', { validation: true });
    }
  }

  private async batch(id: string, caller: Caller, statements: D1Statement[]): Promise<void> {
    try {
      await this.db.batch([...statements,
        announcementAssertion(this.db, `${id}:access`, currentReadyLoginSql, ...currentReadyLoginBindings(caller)),
        this.statement('DELETE FROM command_assertions WHERE id IN (?, ?, ?)', id, `${id}:state`, `${id}:access`)]);
    } catch (error) {
      if (error instanceof Error && error.message.includes('CHECK constraint failed: valid = 1')) {
        throw new ImageRequestError('Announcement access or limits changed. Refresh and try again.', { validation: true });
      }
      throw new ImageRequestError('The image request failed. Check its state before retrying.');
    }
  }

  /** Reserve one image, or return the reservation for a repeated request ID. */
  async begin(caller: Caller, input: { sessionId: string; announcementId: string; requestId: string; name: string; bytes: number }):
  Promise<{ id: string; path: string }> {
    const parsed = beginSchema.safeParse(input);
    if (!parsed.success) throw new ImageRequestError('Choose an image of up to 10 MB.', { validation: true });
    const value = parsed.data;
    const cleanName = value.name.trim().replace(/\p{Cc}/gu, '').replace(/[/\\]/g, '-');
    if (!cleanName.trim()) throw new ImageRequestError('Choose an image with a file name.', { validation: true });
    const repeat = async (): Promise<{ id: string; path: string } | undefined> => {
      const prior = await this.statement(`SELECT x.id FROM announcement_images x JOIN (${currentAccessSql}) c
        WHERE x.uploader = ? AND x.request_id = ? AND x.session_id = ?`,
      ...currentAccessBindings(caller, value.sessionId), caller.accountId, value.requestId, value.sessionId).first<{ id: string }>();
      if (!prior) return undefined;
      const image = await this.image(caller, value.sessionId, prior.id);
      this.manage(image);
      if (!equalWorkflowJson(JSON.parse(image.request_command), value)) {
        throw new ImageRequestError('This image request ID has different content.', { validation: true });
      }
      if (image.state !== 'ready' && (image.state !== 'pending' || image.expired)) {
        throw new ImageRequestError('Upload reservation expired. Select the image again.', { restart: true });
      }
      return { id: image.id, path: image.object_key };
    };
    const repeated = await repeat();
    if (repeated) return repeated;
    const id = crypto.randomUUID();
    const guard = crypto.randomUUID();
    const key = announcementImageKey(value.sessionId, value.announcementId, id);
    try {
      await this.batch(guard, caller, [
        announcementAssertion(this.db, guard, announcementManagerSql, ...announcementManagerBindings(caller, value.sessionId)),
        announcementAssertion(this.db, `${guard}:state`, `SELECT 1 FROM announcements a WHERE a.id = ? AND a.session_id = ?
          AND a.removed_at IS NULL AND (SELECT count(*) FROM announcement_images x WHERE x.announcement_id = a.id
            AND (x.state = 'ready' OR x.state = 'pending' AND x.expires_at > unixepoch())) < ?`,
        value.announcementId, value.sessionId, ANNOUNCEMENT_IMAGE_MAX_COUNT),
        this.statement(`INSERT INTO announcement_images (id, session_id, announcement_id, uploader, uploader_name,
          request_id, request_command, name, declared_bytes, object_key)
          SELECT ?, ?, ?, id, name, ?, ?, ?, ?, ? FROM accounts WHERE id = ?`,
        id, value.sessionId, value.announcementId, value.requestId, JSON.stringify(value), cleanName, value.bytes, key, caller.accountId),
      ]);
    } catch (error) {
      const concurrent = await repeat();
      if (concurrent) return concurrent;
      throw error;
    }
    return { id, path: key };
  }

  /** The Worker forwards the HTTP body. R2 checks the exact length and SHA-256 digest. */
  async upload(caller: Caller, path: string, body: ReadableStream<Uint8Array> | null, contentType: string,
    digest: string, length: number): Promise<void> {
    const parts = keySchema.safeParse(path.split('/'));
    if (!parts.success || !body || !/^[a-f0-9]{64}$/.test(digest)) throw new ImageRequestError('Invalid image transfer.', { validation: true });
    const [sessionId, , , id] = parts.data;
    const row = await this.image(caller, sessionId, id);
    this.manage(row);
    if (row.uploader !== caller.accountId) throw new ImageRequestError('Only the person who added this image can upload it.', { validation: true });
    if (path !== row.object_key || row.announcement_removed || !['pending', 'ready'].includes(row.state) ||
        row.state === 'pending' && row.expired) {
      throw new ImageRequestError('Upload reservation expired. Select the image again.', { restart: true });
    }
    if (length !== row.declared_bytes || !['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
      throw new ImageRequestError('Choose a JPEG, PNG, or WebP image within the reserved size.', { validation: true });
    }
    try {
      const object = await this.bucket.put(path, body, {
        onlyIf: { etagDoesNotMatch: '*' }, sha256: digest,
        httpMetadata: { contentType, cacheControl: 'private, no-store' }, customMetadata: { digest },
      });
      const existing = await this.bucket.get(path, { range: { offset: 0, length: 16 } });
      const matches = existing?.customMetadata?.digest === digest && existing.size === length;
      if (existing) await existing.body.cancel();
      if (!matches) {
        // A conditional retry must never delete a different, earlier object.
        if (object !== null) await this.bucket.delete([path]);
        throw new ImageRequestError('The stored image does not match this transfer. Select the image again.', { restart: true });
      }
    } catch (error) {
      // Inspect the stored state independently so a late transfer cannot outlive its reservation.
      const current = await this.statement(`SELECT state, expires_at <= unixepoch() AS expired
        FROM announcement_images WHERE id = ? AND session_id = ? AND object_key = ?`, id, sessionId, path)
        .first<{ state: string; expired: number }>();
      if (!current || !['pending', 'ready'].includes(current.state) || current.state === 'pending' && current.expired) {
        await this.bucket.delete([path]);
      }
      throw error;
    }
  }

  private async stored(path: string): Promise<{ size: number; kind: string; digest: string }> {
    const object = await this.bucket.get(path, { range: { offset: 0, length: 16 } });
    if (!object) throw new ImageRequestError('Upload the image before finishing.', { incomplete: true });
    const kind = imageKind(new Uint8Array(await object.arrayBuffer()));
    if (!kind || !object.customMetadata?.digest) throw new ImageRequestError('Choose a JPEG, PNG, or WebP image.', { validation: true });
    return { size: object.size, kind, digest: object.customMetadata.digest };
  }

  private changed(row: Image, caller: Caller): D1Statement {
    return this.statement(`UPDATE announcements SET edited_at = ${announcementNow}, edited_by = ?,
      edited_name = (SELECT name FROM accounts WHERE id = ?), revision = revision + 1
      WHERE id = ? AND removed_at IS NULL`, caller.accountId, caller.accountId, row.announcement_id);
  }

  /**
   * Publish a fully stored image. A failed or uncertain completion never deletes the file.
   * A retry can finish it, and expired reservations are cleaned up by `recover()`.
   * Pending files stay unreadable until the database marks them ready.
   */
  async finish(caller: Caller, sessionId: string, id: string): Promise<void> {
    const row = await this.image(caller, sessionId, id);
    this.manage(row);
    if (row.uploader !== caller.accountId) throw new ImageRequestError('Image unavailable.', { validation: true });
    if (row.state === 'ready') return;
    if (row.state !== 'pending' || row.expired || row.announcement_removed) {
      throw new ImageRequestError('Upload reservation expired. Select the image again.', { restart: true });
    }
    const stored = await this.stored(row.object_key);
    if (stored.size !== row.declared_bytes) {
      throw new ImageRequestError('Choose a JPEG, PNG, or WebP image within the reserved size.', { validation: true });
    }
    const guard = crypto.randomUUID();
    try {
      await this.batch(guard, caller, [
        announcementAssertion(this.db, guard, announcementManagerSql, ...announcementManagerBindings(caller, sessionId)),
        announcementAssertion(this.db, `${guard}:state`, `SELECT 1 FROM announcement_images x JOIN announcements a ON a.id = x.announcement_id
          WHERE x.id = ? AND x.state = 'pending' AND x.uploader = ? AND x.expires_at > unixepoch() AND a.removed_at IS NULL
            AND (SELECT count(*) FROM announcement_images o WHERE o.announcement_id = x.announcement_id AND o.state = 'ready') < ?`,
        id, caller.accountId, ANNOUNCEMENT_IMAGE_MAX_COUNT),
        this.statement(`UPDATE announcement_images SET state = 'ready', byte_size = ?, content_type = ?, digest = ?,
          uploaded_at = ${announcementNow} WHERE id = ?`, stored.size, stored.kind, stored.digest, id),
        this.changed(row, caller),
        ...notificationStatements(this.db, sessionId, await sessionAudiences(this.db, sessionId)),
      ]);
    } catch (error) {
      if ((await this.image(caller, sessionId, id)).state === 'ready') return;
      throw error;
    }
  }

  /** Remove a ready image, or abandon the caller's unfinished upload. A repeat finishes file cleanup. */
  async remove(caller: Caller, sessionId: string, id: string, abandon = false): Promise<void> {
    const row = await this.image(caller, sessionId, id);
    this.manage(row);
    if (abandon && row.uploader !== caller.accountId) throw new ImageRequestError('Image unavailable.', { validation: true });
    const repeated = abandon ? ['abandoned', 'expired'].includes(row.state) : ['deleting', 'deleted'].includes(row.state);
    if (!repeated) {
      if (row.state !== (abandon ? 'pending' : 'ready')) throw new ImageRequestError('Image unavailable.', { validation: true });
      const guard = crypto.randomUUID();
      await this.batch(guard, caller, [
        announcementAssertion(this.db, guard, announcementManagerSql, ...announcementManagerBindings(caller, sessionId)),
        announcementAssertion(this.db, `${guard}:state`, 'SELECT 1 FROM announcement_images WHERE id = ? AND state = ?', id, abandon ? 'pending' : 'ready'),
        this.statement(`UPDATE announcement_images SET state = ?, deleted_by = ?, deleted_at = ${announcementNow} WHERE id = ?`,
          abandon ? 'abandoned' : 'deleting', caller.accountId, id),
        this.statement('INSERT INTO announcement_image_deletions (image_id) VALUES (?) ON CONFLICT DO NOTHING', id),
        ...(abandon ? [] : [this.changed(row, caller),
          ...notificationStatements(this.db, sessionId, await sessionAudiences(this.db, sessionId))]),
      ]);
    }
    await this.deleteObject(row);
  }

  private async deleteObject(row: Pick<Image, 'id' | 'object_key'>): Promise<void> {
    // Count the attempt first so one failing key cannot starve other cleanup.
    await this.statement('UPDATE announcement_image_deletions SET attempts = attempts + 1 WHERE image_id = ?', row.id).run();
    await this.bucket.delete([row.object_key]);
    await this.statement(`UPDATE announcement_images SET files_removed_at = ${announcementNow},
      state = CASE WHEN state = 'deleting' THEN 'deleted' ELSE state END WHERE id = ?`, row.id).run();
  }

  /** The database re-checks access after the storage read, so revoked access cannot reuse an earlier check. */
  async download(caller: Caller, path: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
    const parsed = keySchema.safeParse(path.split('/'));
    if (!parsed.success) throw new ImageRequestError('Image unavailable.', { validation: true });
    const [sessionId, , , id] = parsed.data;
    const allowed = (row: Image) => row.state === 'ready' && path === row.object_key && !!row.content_type &&
      (row.manager || !row.announcement_removed && !row.announcement_expired);
    const row = await this.image(caller, sessionId, id);
    if (!allowed(row)) throw new ImageRequestError('Image unavailable.', { validation: true });
    const object = await this.bucket.get(path);
    if (!object) throw new ImageRequestError('Image unavailable.');
    try {
      if (!allowed(await this.image(caller, sessionId, id))) throw new ImageRequestError('Image unavailable.', { validation: true });
    } catch (error) {
      await object.body.cancel();
      throw error;
    }
    return { body: object.body, contentType: row.content_type! };
  }

  /** Expire old reservations and retry exact object deletions. */
  async recover(sessionId?: string): Promise<void> {
    const scope = sessionId ? ' AND session_id = ?' : '';
    const bindings = sessionId ? [sessionId] : [];
    await this.db.batch([
      this.statement(`UPDATE announcement_images SET state = 'expired' WHERE state = 'pending' AND expires_at <= unixepoch()${scope}`, ...bindings),
      // Queue the persisted expired set so a second clock check cannot lose its keys.
      this.statement(`INSERT INTO announcement_image_deletions (image_id) SELECT id FROM announcement_images
        WHERE state = 'expired'${scope} ON CONFLICT DO NOTHING`, ...bindings),
    ]);
    const pending = await this.statement(`SELECT x.id, x.object_key FROM announcement_images x
      JOIN announcement_image_deletions d ON d.image_id = x.id WHERE x.state IN ('deleting', 'deleted', 'expired', 'abandoned')
      ${sessionId ? 'AND x.session_id = ?' : ''} ORDER BY d.attempts, COALESCE(x.files_removed_at, ''), x.id LIMIT 100`, ...bindings)
      .all<Pick<Image, 'id' | 'object_key'>>();
    const results = await Promise.allSettled(pending.results.map((row) => this.deleteObject(row)));
    if (results.some((result) => result.status === 'rejected')) throw new Error('Stored image cleanup requires another attempt.');
  }
}
