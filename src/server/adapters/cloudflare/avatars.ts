import { z } from 'zod';
import type { PersonAvatar } from '../../../backend/contracts';
import { ImageRequestError } from '../../../backend/errors';
import { AVATAR_MAX_BYTES, imageKind } from '../../../connected/imageFile';
import type { Caller } from '../../authentication';
import { assertion, bound, deleteAssertions, isAssertionFailure } from '../d1/assertions';
import type { D1Connection, D1Statement } from '../d1/connection';
import { currentReadyLoginBindings, currentReadyLoginSql } from './application';
import { contestDataBindings, contestDataSql, contestStaffSql } from './authority';
import { putVerifiedImage, type PrivateBucket } from './images';

type AvatarState = 'pending' | 'ready' | 'retired' | 'expired';
interface StoredAvatar { id: string; account_id: string }

const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const unsupported = `Choose a JPEG, PNG, or WebP picture of up to ${AVATAR_MAX_BYTES / 1024} KB.`;
const restart = 'The picture upload expired. Select the picture again.';

export function avatarKey(accountId: string, avatarId: string): string {
  return `accounts/${accountId}/avatars/${avatarId}`;
}

// Every account reads its own avatar. Staff of a session read the avatars of
// the session's assigned staff. Team accounts read no one else's avatar. Both
// branches start from the caller, so the read does not grow with the avatars of
// other sessions. The CROSS JOIN keeps SQLite from reading the staff memberships
// before it knows that the caller is staff.
const visibleSql = `WITH login AS (${currentReadyLoginSql}), access AS (${contestDataSql('caller')}),
  visible AS (
    SELECT v.account_id AS person_id, v.id AS avatar_id, v.content_type FROM login l
      JOIN account_avatars v ON v.account_id = l.id AND v.state = 'ready'
    UNION
    SELECT v.account_id, v.id, v.content_type FROM access a CROSS JOIN (${contestStaffSql}) m
      JOIN account_avatars v ON v.account_id = m.account_id AND v.state = 'ready'
      WHERE a.staff = 1 AND EXISTS (SELECT 1 FROM login))
  SELECT person_id, avatar_id, content_type FROM visible`;

/** Profile pictures share the private image bucket under keys that start with the account ID. */
export class R2AvatarService {
  constructor(private readonly db: D1Connection, private readonly bucket: PrivateBucket) {}

  private visible(caller: Caller, sessionId: string, avatarId?: string): D1Statement {
    const bindings = [...currentReadyLoginBindings(caller), ...contestDataBindings(caller, sessionId), sessionId];
    return avatarId === undefined
      ? bound(this.db, `${visibleSql} ORDER BY person_id`, ...bindings)
      : bound(this.db, `${visibleSql} WHERE avatar_id = ?`, ...bindings, avatarId);
  }

  /** Time can pass between batch statements, so the login check follows the writes. */
  private async commit(caller: Caller, statements: (guard: string) => D1Statement[]): Promise<void> {
    const guard = crypto.randomUUID();
    try {
      await this.db.batch([...statements(guard),
        assertion(this.db, guard, currentReadyLoginSql, ...currentReadyLoginBindings(caller)),
        deleteAssertions(this.db, guard)]);
    } catch (error) {
      if (isAssertionFailure(error)) {
        throw new ImageRequestError('Your sign-in or this picture changed. Refresh and try again.', { validation: true });
      }
      throw new ImageRequestError('The picture request failed. Check your picture before retrying.');
    }
  }

  /** Selects the current avatar by state, so concurrent uploads still leave one ready avatar. */
  private retire(accountId: string): D1Statement {
    return bound(this.db, `UPDATE account_avatars SET state = 'retired', retired_at = ${now}
      WHERE account_id = ? AND state = 'ready'`, accountId);
  }

  private async prior(caller: Caller, requestId: string, digest: string): Promise<{ id: string; state: AvatarState } | undefined> {
    const row = await bound(this.db, `SELECT id, digest, state, expires_at <= unixepoch() AS expired
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
        await this.commit(caller, () => [bound(this.db, `INSERT INTO account_avatars
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
        assertion(this.db, `${guard}:state`, `SELECT 1 FROM account_avatars WHERE id = ? AND state = 'pending'
          AND expires_at > unixepoch()`, id),
        this.retire(caller.accountId),
        bound(this.db, `UPDATE account_avatars SET state = 'ready', ready_at = ${now} WHERE id = ?`, id),
      ]);
    } catch (error) {
      const current = await bound(this.db, `SELECT state, expires_at <= unixepoch() AS expired FROM account_avatars WHERE id = ?`, id)
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
    await bound(this.db, 'UPDATE account_avatars SET cleanup_attempts = cleanup_attempts + 1 WHERE id = ?', row.id).run();
    await this.bucket.delete([avatarKey(row.account_id, row.id)]);
    await bound(this.db, `UPDATE account_avatars SET files_removed_at = ${now} WHERE id = ?`, row.id).run();
  }

  /** The avatar change has already committed. `recover()` retries a failed deletion. */
  private async deleteRetired(accountId: string): Promise<void> {
    const rows = await bound(this.db, `SELECT id, account_id FROM account_avatars
      WHERE account_id = ? AND state IN ('retired', 'expired') AND files_removed_at IS NULL`, accountId).all<StoredAvatar>();
    await Promise.allSettled(rows.results.map((row) => this.deleteObject(row)));
  }

  /** Expire abandoned uploads and repeat exact deletions, so an interrupted late transfer is found. */
  async recover(): Promise<void> {
    await bound(this.db, `UPDATE account_avatars SET state = 'expired' WHERE state = 'pending' AND expires_at <= unixepoch()`).run();
    const tasks = await bound(this.db, `SELECT id, account_id FROM account_avatars WHERE state IN ('retired', 'expired')
      ORDER BY cleanup_attempts, COALESCE(files_removed_at, ''), id LIMIT 100`).all<StoredAvatar>();
    const results = await Promise.allSettled(tasks.results.map((row) => this.deleteObject(row)));
    if (results.some((result) => result.status === 'rejected')) throw new Error('Stored avatar cleanup requires another attempt.');
  }
}
