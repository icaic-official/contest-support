import { z } from 'zod';
import type { ImageTransport, StartedImage } from '../../../backend/contracts';
import { ImageRequestError } from '../../../backend/errors';
import { attachmentPath, imageKind, THUMBNAIL_BYTES } from '../../../connected/imageFile';
import type { Caller } from '../../authentication';
import { equalWorkflowJson } from '../../workflow';
import type { D1Connection, D1Statement } from '../d1/connection';
import { currentAccessBindings, currentAccessSql, currentReadyLoginBindings, currentReadyLoginSql, notificationStatements } from './application';

export interface PrivateObject {
  size: number;
  body: ReadableStream<Uint8Array>;
  customMetadata?: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The private R2 binding stays inside the Cloudflare implementation. */
export interface PrivateBucket {
  get(key: string, options?: { range: { offset: number; length: number } }): Promise<PrivateObject | null>;
  put(key: string, body: ReadableStream<Uint8Array>, options: {
    onlyIf: { etagDoesNotMatch: string };
    sha256: string;
    httpMetadata: { contentType: string; cacheControl: string };
    customMetadata: Record<string, string>;
  }): Promise<unknown | null>;
  delete(keys: string[]): Promise<void>;
}

interface Image {
  id: string; session_id: string; issue_id: string; uploader: string;
  original_path: string; thumbnail_path: string; state: string;
  visibility: 'public' | 'internal'; declared_bytes: number;
  original_name: string; uploader_name: string; team_id: string;
  max_image_bytes: number; max_images_per_issue: number; max_image_bytes_per_issue: number;
  expired: number; archived: number; staff: number; request_command: string;
  content_type: string | null; thumbnail_content_type: string | null;
  original_digest: string | null; thumbnail_digest: string | null;
}

const beginSchema = z.strictObject({
  requestId: z.uuid(), sessionId: z.uuid(), issueId: z.uuid(),
  visibility: z.enum(['public', 'internal']), name: z.string().min(1).max(200),
  bytes: z.number().int().positive().max(52_428_800),
});
const pathSchema = z.tuple([z.uuid(), z.uuid(), z.uuid(), z.enum(['original', 'thumbnail'])]);
type Value = string | number | null;
const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const imageSql = `SELECT x.*, i.team_id, s.max_image_bytes, s.max_images_per_issue,
  s.max_image_bytes_per_issue, e.archived, c.staff, (x.expires_at <= unixepoch()) AS expired
  FROM issue_images x JOIN issues i ON i.id = x.issue_id
  JOIN sessions s ON s.id = x.session_id JOIN events e ON e.id = s.event_id
  JOIN (${currentAccessSql}) c ON c.staff = 1 OR c.team_id = i.team_id OR (? = 1 AND x.uploader = c.account_id)
  WHERE x.session_id = ? AND x.id = ?`;

/** Remove control characters and path separators from an uploaded file name. */
export function cleanImageName(name: string): string {
  return name.trim().replace(/\p{Cc}/gu, '').replace(/[/\\]/g, '-');
}

/**
 * Store a transfer at most once and confirm that the stored object is this transfer.
 * R2 verifies SHA-256. A conditional retry never deletes a different, earlier object.
 */
export async function putVerifiedImage(bucket: PrivateBucket, path: string, body: ReadableStream<Uint8Array>,
  file: { contentType: string; digest: string; length: number }, restart: string): Promise<void> {
  const object = await bucket.put(path, body, {
    onlyIf: { etagDoesNotMatch: '*' }, sha256: file.digest,
    httpMetadata: { contentType: file.contentType, cacheControl: 'private, no-store' }, customMetadata: { digest: file.digest },
  });
  const existing = await bucket.get(path, { range: { offset: 0, length: 16 } });
  const matches = existing?.customMetadata?.digest === file.digest && existing.size === file.length;
  if (existing) await existing.body.cancel();
  if (!matches) {
    if (object !== null) await bucket.delete([path]);
    throw new ImageRequestError(`The stored image does not match this transfer. ${restart}`, { restart: true });
  }
}

/** Read a stored image's size, signature, and digest without downloading it. */
export async function storedImage(bucket: PrivateBucket, path: string): Promise<{ size: number; kind: string; digest: string }> {
  const object = await bucket.get(path, { range: { offset: 0, length: 16 } });
  if (!object) throw new ImageRequestError('Upload the image before finishing.', { incomplete: true });
  const kind = imageKind(new Uint8Array(await object.arrayBuffer()));
  if (!kind || !object.customMetadata?.digest) throw new ImageRequestError('Choose a JPEG, PNG, or WebP image.', { validation: true });
  return { size: object.size, kind, digest: object.customMetadata.digest };
}

export class R2ImageService {
  constructor(private readonly db: D1Connection, private readonly bucket: PrivateBucket) {}

  private statement(sql: string, ...values: Value[]): D1Statement { return this.db.prepare(sql).bind(...values); }

  private async image(caller: Caller, sessionId: string, id: string, write = false, ownedCleanup = false): Promise<Image> {
    if (!z.uuid().safeParse(sessionId).success || !z.uuid().safeParse(id).success) {
      throw new ImageRequestError('Image unavailable.', { validation: true });
    }
    const row = await this.statement(imageSql, ...currentAccessBindings(caller, sessionId), Number(ownedCleanup), sessionId, id).first<Image>();
    if (!row || write && (!row.staff || row.uploader !== caller.accountId || row.archived)) {
      throw new ImageRequestError('You do not have permission to change this image.', { validation: true });
    }
    return row;
  }

  private assertion(id: string, sql: string, ...values: Value[]): D1Statement {
    return this.statement(`INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN EXISTS (${sql}) THEN 1 ELSE 0 END)`, id, ...values);
  }

  private guard(id: string, caller: Caller, sessionId: string): D1Statement {
    return this.assertion(id, `SELECT 1 FROM (${currentAccessSql}) c JOIN sessions s ON s.id = ?
      JOIN events e ON e.id = s.event_id WHERE c.staff = 1 AND e.archived = 0`,
    ...currentAccessBindings(caller, sessionId), sessionId);
  }

  private async batch(id: string, caller: Caller, statements: D1Statement[]): Promise<void> {
    try {
      await this.db.batch([...statements,
        this.assertion(`${id}:access`, currentReadyLoginSql, ...currentReadyLoginBindings(caller)),
        this.statement('DELETE FROM command_assertions WHERE id IN (?, ?, ?)', id, `${id}:state`, `${id}:access`)]);
    } catch (error) {
      if (error instanceof Error && error.message.includes('CHECK constraint failed: valid = 1')) {
        throw new ImageRequestError('Image access or limits changed. Refresh and try again.', { validation: true });
      }
      throw new ImageRequestError('The image request failed. Check its state before retrying.');
    }
  }

  private paths(image: Image): StartedImage {
    return { id: image.id, original_path: image.original_path, thumbnail_path: image.thumbnail_path };
  }

  async begin(caller: Caller, input: Parameters<ImageTransport['begin']>[0]): Promise<StartedImage> {
    const parsed = beginSchema.safeParse(input);
    if (!parsed.success) throw new ImageRequestError('Choose valid image details.', { validation: true });
    const value = parsed.data;
    const cleanName = cleanImageName(value.name);
    if (!cleanName.trim()) throw new ImageRequestError('Choose a JPEG, PNG, or WebP image.', { validation: true });
    const repeat = async (): Promise<StartedImage | undefined> => {
      const prior = await this.statement(`SELECT x.id FROM issue_images x JOIN (${currentAccessSql}) c ON c.staff = 1
        WHERE x.uploader = ? AND x.request_id = ?`, ...currentAccessBindings(caller, value.sessionId), caller.accountId, value.requestId).first<{ id: string }>();
      if (!prior) return undefined;
      const image = await this.image(caller, value.sessionId, prior.id, true);
      if (!equalWorkflowJson(JSON.parse(image.request_command), value)) throw new ImageRequestError('This image request ID has different content.', { validation: true });
      if (image.state !== 'ready' && (image.state !== 'pending' || image.expired)) {
        throw new ImageRequestError('Start a new image upload.', { restart: true });
      }
      return this.paths(image);
    };
    const repeated = await repeat();
    if (repeated) return repeated;
    const id = crypto.randomUUID();
    const assertion = crypto.randomUUID();
    const original = attachmentPath(value.sessionId, value.issueId, id, 'original');
    const thumbnail = attachmentPath(value.sessionId, value.issueId, id, 'thumbnail');
    try {
      await this.batch(assertion, caller, [
        this.guard(assertion, caller, value.sessionId),
        this.assertion(`${assertion}:state`, `SELECT 1 FROM sessions s JOIN issues i ON i.session_id = s.id
          WHERE s.id = ? AND i.id = ? AND ? <= s.max_image_bytes
            AND (SELECT count(*) FROM issue_images x WHERE x.issue_id = i.id
              AND (x.state = 'ready' OR x.state = 'pending' AND x.expires_at > unixepoch())) < s.max_images_per_issue
            AND ? + COALESCE((SELECT sum(CASE WHEN x.state = 'ready' THEN x.byte_size ELSE x.declared_bytes END)
              FROM issue_images x WHERE x.issue_id = i.id AND (x.state = 'ready' OR x.state = 'pending'
                AND x.expires_at > unixepoch())), 0) <= s.max_image_bytes_per_issue`,
        value.sessionId, value.issueId, value.bytes, value.bytes),
        this.statement(`INSERT INTO issue_images (id, session_id, issue_id, uploader, uploader_name, request_id,
          visibility, declared_bytes, original_name, original_path, thumbnail_path, request_command)
          SELECT ?, ?, ?, id, name, ?, ?, ?, ?, ?, ?, ? FROM accounts WHERE id = ?`,
        id, value.sessionId, value.issueId, value.requestId, value.visibility, value.bytes, cleanName,
        original, thumbnail, JSON.stringify(value), caller.accountId),
      ]);
    } catch (error) {
      const concurrent = await repeat();
      if (concurrent) return concurrent;
      throw error;
    }
    return { id, original_path: original, thumbnail_path: thumbnail };
  }

  async upload(caller: Caller, path: string, body: ReadableStream<Uint8Array> | null, contentType: string, digest: string, length: number): Promise<void> {
    const parts = pathSchema.safeParse(path.split('/'));
    if (!parts.success || !body || !/^[a-f0-9]{64}$/.test(digest)) throw new ImageRequestError('Invalid image transfer.', { validation: true });
    const [sessionId, , id, kind] = parts.data;
    const row = await this.image(caller, sessionId, id, true);
    if (path !== (kind === 'original' ? row.original_path : row.thumbnail_path) ||
        !['pending', 'ready'].includes(row.state) || row.state === 'pending' && row.expired) {
      throw new ImageRequestError('Start a new image upload.', { restart: true });
    }
    const maximum = kind === 'thumbnail' ? THUMBNAIL_BYTES : Math.min(row.declared_bytes, row.max_image_bytes);
    if (!Number.isSafeInteger(length) || length < 1 || length > maximum ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
      throw new ImageRequestError('Choose a JPEG, PNG, or WebP image within the reserved size.', { validation: true });
    }
    if (row.state === 'ready' && digest !== (kind === 'original' ? row.original_digest : row.thumbnail_digest)) {
      throw new ImageRequestError('A published image cannot be replaced.', { validation: true });
    }
    // Forward the original HTTP body. R2 requires a stream with a known length.
    // The HTTP boundary requires Content-Length, and R2 verifies SHA-256 itself.
    try {
      await putVerifiedImage(this.bucket, path, body, { contentType, digest, length }, 'Start a new image upload.');
      const after = await this.image(caller, sessionId, id, true);
      if (!['pending', 'ready'].includes(after.state) || after.state === 'pending' && after.expired) {
        throw new ImageRequestError('Start a new image upload.', { restart: true });
      }
    } catch (error) {
      // Authorization can fail before image() returns the tombstone. Inspect
      // metadata independently so a late PUT cannot survive scoped deletion.
      // Revocation alone must not delete an image still published for others.
      const current = await this.statement(`SELECT state, expires_at <= unixepoch() AS expired
        FROM issue_images WHERE id = ? AND session_id = ? AND (original_path = ? OR thumbnail_path = ?)`,
      id, sessionId, path, path).first<{ state: string; expired: number }>();
      if (!current || !['pending', 'ready'].includes(current.state) || current.state === 'pending' && current.expired) {
        await this.bucket.delete([path]);
      }
      // A process loss can bypass this cleanup. Production tombstones remain
      // discoverable by scheduled recovery after that interruption.
      throw error;
    }
  }

  private activity(row: Image, caller: Caller, text: string): D1Statement[] {
    const visible = row.visibility === 'public';
    return [
      this.statement(`UPDATE issues SET public_revision = public_revision + ?, write_version = write_version + 1 WHERE id = ?`, Number(visible), row.issue_id),
      this.statement(`INSERT INTO history (id, issue_id, actor, actor_name, at, text, visibility) VALUES (?, ?, ?, ?, ${now}, ?, ?)`,
        crypto.randomUUID(), row.issue_id, caller.accountId, row.uploader_name, text, row.visibility),
      ...notificationStatements(this.db, row.session_id, visible ? ['staff', `team:${row.team_id}`] : ['staff']),
    ];
  }

  async finish(caller: Caller, sessionId: string, id: string): Promise<void> {
    const row = await this.image(caller, sessionId, id, true);
    if (row.state === 'ready') return;
    if (row.state !== 'pending' || row.expired) throw new ImageRequestError('Start a new image upload.', { restart: true });
    const [original, thumb] = await Promise.all([storedImage(this.bucket, row.original_path), storedImage(this.bucket, row.thumbnail_path)]);
    if (!original.size || original.size > row.declared_bytes || thumb.size < 1 || thumb.size > THUMBNAIL_BYTES) {
      throw new ImageRequestError('Choose a JPEG, PNG, or WebP image within the reserved size.', { validation: true });
    }
    const assertion = crypto.randomUUID();
    try {
      await this.batch(assertion, caller, [
        this.guard(assertion, caller, sessionId),
        this.assertion(`${assertion}:state`, `SELECT 1 FROM issue_images x JOIN sessions s ON s.id = x.session_id
          WHERE x.id = ? AND x.state = 'pending' AND x.uploader = ? AND x.expires_at > unixepoch()
            AND ? <= s.max_image_bytes
            AND (SELECT count(*) FROM issue_images o WHERE o.issue_id = x.issue_id AND o.state = 'ready') < s.max_images_per_issue
            AND ? + COALESCE((SELECT sum(CASE WHEN o.state = 'ready' THEN o.byte_size ELSE o.declared_bytes END)
              FROM issue_images o WHERE o.issue_id = x.issue_id AND o.id <> x.id AND
                (o.state = 'ready' OR o.state = 'pending' AND o.expires_at > unixepoch())), 0) <= s.max_image_bytes_per_issue`,
        id, caller.accountId, original.size, original.size),
        this.statement(`UPDATE issue_images SET state = 'ready', byte_size = ?, content_type = ?,
          original_digest = ?, thumbnail_digest = ?, thumbnail_content_type = ?, uploaded_at = ${now} WHERE id = ?`,
        original.size, original.kind, original.digest, thumb.digest, thumb.kind, id),
        ...this.activity(row, caller, 'Image added.'),
      ]);
    } catch (error) {
      if ((await this.image(caller, sessionId, id, true)).state === 'ready') return;
      throw error;
    }
  }

  async remove(caller: Caller, sessionId: string, id: string, abandon = false): Promise<void> {
    const row = await this.image(caller, sessionId, id, false, true);
    if (row.uploader !== caller.accountId) throw new ImageRequestError('Only the person who added this image can remove it.', { validation: true });
    const repeated = abandon ? ['abandoned', 'expired'].includes(row.state) : ['deleting', 'deleted'].includes(row.state);
    if (!repeated) {
      if (!abandon && (!row.staff || row.archived)) {
        throw new ImageRequestError('You do not have permission to change this image.', { validation: true });
      }
      if (row.state !== (abandon ? 'pending' : 'ready')) throw new ImageRequestError('Image unavailable.', { validation: true });
      const assertion = crypto.randomUUID();
      await this.batch(assertion, caller, [
        abandon ? this.assertion(assertion, currentAccessSql, ...currentAccessBindings(caller, sessionId)) : this.guard(assertion, caller, sessionId),
        this.assertion(`${assertion}:state`, 'SELECT 1 FROM issue_images WHERE id = ? AND state = ?', id, abandon ? 'pending' : 'ready'),
        this.statement(`UPDATE issue_images SET state = ?, deleted_by = ?, deleted_at = ${now} WHERE id = ?`, abandon ? 'abandoned' : 'deleting', caller.accountId, id),
        this.statement('INSERT INTO image_deletions (attachment_id) VALUES (?) ON CONFLICT DO NOTHING', id),
        ...(abandon ? [] : this.activity(row, caller, 'Image removed.')),
      ]);
    }
    await this.deleteObjects(row);
  }

  private async deleteObjects(row: Pick<Image, 'id' | 'original_path' | 'thumbnail_path'>): Promise<void> {
    // Count an attempt before R2 can fail. Failed keys must not permanently
    // occupy the first recovery batch and starve other cleanup tasks.
    await this.statement('UPDATE image_deletions SET attempts = attempts + 1 WHERE attachment_id = ?', row.id).run();
    await this.bucket.delete([row.original_path, row.thumbnail_path]);
    await this.statement(`UPDATE issue_images SET files_removed_at = ${now}, state = CASE WHEN state = 'deleting' THEN 'deleted' ELSE state END WHERE id = ?`, row.id).run();
  }

  async download(caller: Caller, path: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
    const parsed = pathSchema.safeParse(path.split('/'));
    if (!parsed.success) throw new ImageRequestError('Image unavailable.', { validation: true });
    const [sessionId, , id, kind] = parsed.data;
    const allowed = (row: Image) => row.state === 'ready' && (row.staff || row.visibility === 'public') &&
      path === (kind === 'original' ? row.original_path : row.thumbnail_path);
    const row = await this.image(caller, sessionId, id);
    if (!allowed(row)) throw new ImageRequestError('Image unavailable.', { validation: true });
    const object = await this.bucket.get(path);
    if (!object) throw new ImageRequestError('Image unavailable.');
    // R2 awaits cannot carry an earlier database authorization into a response.
    try {
      const current = await this.image(caller, sessionId, id);
      if (!allowed(current)) throw new ImageRequestError('Image unavailable.', { validation: true });
    } catch (error) {
      await object.body.cancel();
      throw error;
    }
    return { body: object.body, contentType: kind === 'original' ? row.content_type! : row.thumbnail_content_type! };
  }

  /** Retry exact tombstone keys. Retain tasks so an interrupted late PUT is found. */
  async recover(sessionId?: string): Promise<void> {
    const scope = sessionId ? ' AND session_id = ?' : '';
    const bindings = sessionId ? [sessionId] : [];
    await this.db.batch([
      this.statement(`UPDATE issue_images SET state = 'expired' WHERE state = 'pending' AND expires_at <= unixepoch()${scope}`, ...bindings),
      // Queue the persisted expired set. A second clock check could otherwise
      // expire a reservation without retaining the keys needed for cleanup.
      this.statement(`INSERT INTO image_deletions (attachment_id) SELECT id FROM issue_images
        WHERE state = 'expired'${scope} ON CONFLICT DO NOTHING`, ...bindings),
    ]);
    const pending = await this.statement(`SELECT x.id, x.original_path, x.thumbnail_path FROM issue_images x
      JOIN image_deletions d ON d.attachment_id = x.id WHERE x.state IN ('deleting', 'deleted', 'expired', 'abandoned')
      ${sessionId ? 'AND x.session_id = ?' : ''} ORDER BY d.attempts, COALESCE(x.files_removed_at, ''), x.id LIMIT 100`, ...bindings).all<Image>();
    const results = await Promise.allSettled(pending.results.map((row) => this.deleteObjects(row)));
    if (results.some((result) => result.status === 'rejected')) throw new Error('Stored image cleanup requires another attempt.');
  }
}
