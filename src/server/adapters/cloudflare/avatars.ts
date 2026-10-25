import { z } from 'zod';
import type { PersonAvatar } from '../../../backend/contracts';
import { ImageRequestError } from '../../../backend/errors';
import { AVATAR_MAX_BYTES, imageKind } from '../../../connected/imageFile';
import type { Caller } from '../../authentication';
import type { D1Connection, D1Statement } from '../d1/connection';
import { currentAccessBindings, currentAccessSql, currentReadyLoginBindings, currentReadyLoginSql } from './application';
import { putVerifiedImage, type PrivateBucket } from './images';

type Value = string | number | null;
type AvatarState = 'pending' | 'ready' | 'retired' | 'expired';
interface StoredAvatar { id: string; account_id: string }

const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const unsupported = `Choose a JPEG, PNG, or WebP picture of up to ${AVATAR_MAX_BYTES / 1024} KB.`;
const restart = 'The picture upload expired. Select the picture again.';

export function avatarKey(accountId: string, avatarId: string): string {
  return `accounts/${accountId}/avatars/${avatarId}`;
}

// Every account reads its own avatar. Staff of a session read the avatars of
// the session's other staff. Team accounts read no one else's avatar. The owner
// test repeats the staff test of currentAccessSql.
const visibleSql = `WITH login AS (${currentReadyLoginSql}), access AS (${currentAccessSql})
  SELECT v.account_id AS person_id, v.id AS avatar_id, v.content_type FROM account_avatars v CROSS JOIN login l
  WHERE v.state = 'ready' AND (v.account_id = l.id OR EXISTS (SELECT 1 FROM access a JOIN memberships m
    ON m.session_id = ? AND m.account_id = v.account_id AND m.team_id IS NULL AND (m.is_admin = 1 OR EXISTS (
      SELECT 1 FROM membership_roles r WHERE r.session_id = m.session_id AND r.account_id = m.account_id))
    WHERE a.staff = 1))`;

/** Profile pictures share the private image bucket under keys that start with the account ID. */
export class R2AvatarService {
  constructor(private readonly db: D1Connection, private readonly bucket: PrivateBucket) {}

  private statement(sql: string, ...values: Value[]): D1Statement { return this.db.prepare(sql).bind(...values); }

  private visible(caller: Caller, sessionId: string, avatarId?: string): D1Statement {
    const bindings = [...currentReadyLoginBindings(caller), ...currentAccessBindings(caller, sessionId), sessionId];
    return avatarId === undefined
      ? this.statement(`${visibleSql} ORDER BY v.account_id`, ...bindings)
      : this.statement(`${visibleSql} AND v.id = ?`, ...bindings, avatarId);
  }

  private assertion(id: string, sql: string, ...values: Value[]): D1Statement {
    return this.statement(`INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN EXISTS (${sql}) THEN 1 ELSE 0 END)`, id, ...values);
  }

  /** Time can pass between batch statements, so the login check follows the writes. */
  private async commit(caller: Caller, statements: (guard: string) => D1Statement[]): Promise<void> {
    const guard = crypto.randomUUID();
    try {
      await this.db.batch([...statements(guard),
        this.assertion(guard, currentReadyLoginSql, ...currentReadyLoginBindings(caller)),
        this.statement('DELETE FROM command_assertions WHERE id IN (?, ?)', guard, `${guard}:state`)]);
    } catch (error) {
      if (error instanceof Error && error.message.includes('CHECK constraint failed: valid = 1')) {
        throw new ImageRequestError('Your sign-in or this picture changed. Refresh and try again.', { validation: true });
      }
      throw new ImageRequestError('The picture request failed. Check your picture before retrying.');
    }
  }

  /** Selects the current avatar by state, so concurrent uploads still leave one ready avatar. */
  private retire(accountId: string): D1Statement {
    return this.statement(`UPDATE account_avatars SET state = 'retired', retired_at = ${now}
      WHERE account_id = ? AND state = 'ready'`, accountId);
  }

  private async prior(caller: Caller, requestId: string, digest: string): Promise<{ id: string; state: AvatarState } | undefined> {
    const row = await this.statement(`SELECT id, digest, state, expires_at <= unixepoch() AS expired
      FROM account_avatars WHERE account_id = ? AND request_id = ?`, caller.accountId, requestId)
      .first<{ id: string; digest: string; state: AvatarState; expired: number }>();
    if (!row) return undefined;
    if (row.digest !== digest) throw new ImageRequestError('This picture request ID has different content.', { validation: true });
    if (row.state === 'expired' || row.state === 'pending' && row.expired) throw new ImageRequestError(restart, { restart: true });
    return row;
  }

  async list(caller: Caller, sessionId: string): Promise<PersonAvatar[]> {
    const rows = await this.visible(caller, sessionId).all<PersonAvatar>();
    return rows.results.map(({ person_id, avatar_id }) => ({ person_id, avatar_id }));
  }

  /**
   * Store the bytes under a pending row, then make that row the account's avatar in one batch.
   * A repeated request ID returns its first result, even after a later avatar replaced it.
   */
  async upload(caller: Caller, input: { requestId: string; bytes: Uint8Array; digest: string }): Promise<PersonAvatar> {
    const { requestId, bytes, digest } = input;
    const kind = imageKind(bytes.subarray(0, 16));
    if (!z.uuid().safeParse(requestId).success || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new ImageRequestError('Invalid picture transfer.', { validation: true });
    }
    if (!kind || bytes.byteLength > AVATAR_MAX_BYTES) throw new ImageRequestError(unsupported, { validation: true });
    let row = await this.prior(caller, requestId, digest);
    if (!row) {
      const id = crypto.randomUUID();
      try {
        await this.commit(caller, () => [this.statement(`INSERT INTO account_avatars
          (id, account_id, request_id, byte_size, content_type, digest) VALUES (?, ?, ?, ?, ?, ?)`,
        id, caller.accountId, requestId, bytes.byteLength, kind, digest)]);
        row = { id, state: 'pending' };
      } catch (error) {
        row = await this.prior(caller, requestId, digest);
        if (!row) throw error;
      }
    }
    const avatar = { person_id: caller.accountId, avatar_id: row.id };
    if (row.state !== 'pending') return avatar;
    const key = avatarKey(caller.accountId, row.id);
    const id = row.id;
    try {
      await putVerifiedImage(this.bucket, key, bytes, { contentType: kind, digest, length: bytes.byteLength }, 'Select the picture again.');
      await this.commit(caller, (guard) => [
        this.assertion(`${guard}:state`, `SELECT 1 FROM account_avatars WHERE id = ? AND state = 'pending'
          AND expires_at > unixepoch()`, id),
        this.retire(caller.accountId),
        this.statement(`UPDATE account_avatars SET state = 'ready', ready_at = ${now} WHERE id = ?`, id),
      ]);
    } catch (error) {
      const current = await this.statement(`SELECT state, expires_at <= unixepoch() AS expired FROM account_avatars WHERE id = ?`, id)
        .first<{ state: AvatarState; expired: number }>();
      // A concurrent retry of this request ID can commit first.
      if (current?.state === 'ready' || current?.state === 'retired') return avatar;
      if (!current || current.state === 'expired' || current.expired) {
        // An expired row can never become ready, so a late transfer must not keep its file.
        await this.bucket.delete([key]);
        throw new ImageRequestError(restart, { restart: true });
      }
      throw error;
    }
    await this.deleteRetired(caller.accountId);
    return avatar;
  }

  /** Removing when no avatar exists succeeds. */
  async remove(caller: Caller): Promise<void> {
    await this.commit(caller, () => [this.retire(caller.accountId)]);
    await this.deleteRetired(caller.accountId);
  }

  /** The database checks access again after the storage read, so revoked access cannot reuse an earlier check. */
  async download(caller: Caller, sessionId: string, avatarId: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
    const row = await this.visible(caller, sessionId, avatarId).first<{ person_id: string; content_type: string }>();
    if (!row) throw new ImageRequestError('Picture unavailable.', { validation: true });
    const object = await this.bucket.get(avatarKey(row.person_id, avatarId));
    if (!object) throw new ImageRequestError('Picture unavailable.');
    try {
      if (!await this.visible(caller, sessionId, avatarId).first()) throw new ImageRequestError('Picture unavailable.', { validation: true });
    } catch (error) {
      await object.body.cancel();
      throw error;
    }
    return { body: object.body, contentType: row.content_type };
  }

  private async deleteObject(row: StoredAvatar): Promise<void> {
    // Count the attempt first so one failing key cannot starve other cleanup.
    await this.statement('UPDATE account_avatars SET cleanup_attempts = cleanup_attempts + 1 WHERE id = ?', row.id).run();
    await this.bucket.delete([avatarKey(row.account_id, row.id)]);
    await this.statement(`UPDATE account_avatars SET files_removed_at = ${now} WHERE id = ?`, row.id).run();
  }

  /** The avatar change has already committed. `recover()` retries a failed deletion. */
  private async deleteRetired(accountId: string): Promise<void> {
    const rows = await this.statement(`SELECT id, account_id FROM account_avatars
      WHERE account_id = ? AND state IN ('retired', 'expired') AND files_removed_at IS NULL`, accountId).all<StoredAvatar>();
    await Promise.allSettled(rows.results.map((row) => this.deleteObject(row)));
  }

  /** Expire abandoned uploads and repeat exact deletions, so an interrupted late transfer is found. */
  async recover(): Promise<void> {
    await this.statement(`UPDATE account_avatars SET state = 'expired' WHERE state = 'pending' AND expires_at <= unixepoch()`).run();
    const tasks = await this.statement(`SELECT id, account_id FROM account_avatars WHERE state IN ('retired', 'expired')
      ORDER BY cleanup_attempts, COALESCE(files_removed_at, ''), id LIMIT 100`).all<StoredAvatar>();
    const results = await Promise.allSettled(tasks.results.map((row) => this.deleteObject(row)));
    if (results.some((result) => result.status === 'rejected')) throw new Error('Stored avatar cleanup requires another attempt.');
  }
}
