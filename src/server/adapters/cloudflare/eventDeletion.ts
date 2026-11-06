import type { DeletionStep } from '../../../backend/contracts';
import { bound, isAssertionFailure } from '../d1/assertions';
import type { D1Connection, D1Statement } from '../d1/connection';

/** Issues per statement and accounts per batch in the rows step. */
export const DELETE_CHUNK = 100;

/** A blocked deletion looks again after this time, because another event's deletion can clear it. */
export const BLOCKED_RETRY_SECONDS = 3600;

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** A stale runner whose lease expired must not change a later step's state. Bind the event ID. */
const inStep = (step: DeletionStep) => `EXISTS (SELECT 1 FROM event_deletions WHERE event_id = ? AND step = '${step}')`;

const UUID_SQL = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2)
  || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

/** Who asked for a deletion. The journal keeps the name, because the account can go later. */
export interface DeletionActor {
  readonly id: string;
  readonly name: string;
}

/**
 * The statements that fence one event, in one batch. From this batch on, the
 * resolvers, sign-in, the calendar, and the site list refuse the event. The
 * assertion fails the batch when the event is gone, when the name differs, or
 * when a journal row already exists, so a repeated fence changes nothing.
 * Revoking logins stops the account surfaces that read outside the resolver:
 * avatars, the password change, and the member calendar. A login revocation and
 * the staff row of each contest both reach `grants()`, which closes every socket
 * that lost its access, including those of webmasters.
 * The caller writes the site audit row, as `commit` in manage.ts does.
 */
export function fenceStatements(db: D1Connection, actor: DeletionActor, eventId: string, confirmName: string, assertionId: string): D1Statement[] {
  return [
    bound(db, `INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN
      EXISTS (SELECT 1 FROM events WHERE id = ? AND name = ?)
      AND NOT EXISTS (SELECT 1 FROM event_deletions WHERE event_id = ?) THEN 1 ELSE 0 END)`,
    assertionId, eventId, confirmName, eventId),
    bound(db, `INSERT INTO event_deletions (event_id, event_name, event_code, requested_by, requested_by_name)
      SELECT id, name, COALESCE(code, ''), ?, ? FROM events WHERE id = ?`, actor.id, actor.name, eventId),
    bound(db, `INSERT INTO event_deletion_targets (event_id, kind, id)
      SELECT event_id, 'contest', id FROM sessions WHERE event_id = ?`, eventId),
    // Never a NULL-event account: webmasters and orphans are outside every event.
    bound(db, `INSERT INTO event_deletion_targets (event_id, kind, id)
      SELECT event_id, 'account', id FROM accounts WHERE event_id = ?`, eventId),
    bound(db, `INSERT INTO event_deletion_targets (event_id, kind, id)
      SELECT DISTINCT a.event_id, 'avatar_owner', v.account_id FROM accounts a
      JOIN account_avatars v ON v.account_id = a.id WHERE a.event_id = ?`, eventId),
    bound(db, 'UPDATE events SET archived = 1 WHERE id = ?', eventId),
    bound(db, 'DELETE FROM installation WHERE event_id = ?', eventId),
    bound(db, `UPDATE logins SET revoked = 1 WHERE revoked = 0
      AND account_id IN (SELECT id FROM accounts WHERE event_id = ?)`, eventId),
    bound(db, `INSERT INTO audience_sequences (session_id, audience, sequence)
      SELECT id, 'staff', 1 FROM sessions WHERE event_id = ?
      ON CONFLICT (session_id, audience) DO UPDATE SET sequence = sequence + 1`, eventId),
    bound(db, `INSERT INTO notifications (id, session_id, audience, sequence)
      SELECT ${UUID_SQL}, q.session_id, q.audience, q.sequence FROM sessions s
      JOIN audience_sequences q ON q.session_id = s.id AND q.audience = 'staff' WHERE s.event_id = ?`, eventId),
    bound(db, 'DELETE FROM command_assertions WHERE id = ?', assertionId),
  ];
}

export type RowsProgress = 'more' | 'blocked' | 'rows_done';

/** D1's foreign key error names no row, so the caller retries one account at a time to find it. */
function isBlockingFailure(error: unknown): boolean {
  return isAssertionFailure(error) || (error instanceof Error && error.message.includes('FOREIGN KEY constraint failed'));
}

function accountStatements(db: D1Connection, eventId: string, ids: readonly string[]): D1Statement[] {
  const chunk = JSON.stringify(ids);
  const inChunk = 'IN (SELECT value FROM json_each(?))';
  const assertionId = crypto.randomUUID();
  return [
    // The contests of this event are gone, so a remaining seat is in another event.
    // The account's delete would cascade into that seat, and no foreign key refuses it.
    bound(db, `INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN
      EXISTS (SELECT 1 FROM memberships WHERE account_id ${inChunk}) THEN 0 ELSE 1 END)`, assertionId, chunk),
    // Without this, an admin in this chunk who reset a contestant in a later chunk fails its
    // key and looks blocked. An operation on an account outside the targets still blocks.
    bound(db, `DELETE FROM account_operations WHERE actor ${inChunk}
      AND account_id IN (SELECT id FROM event_deletion_targets WHERE event_id = ? AND kind = 'account')`, chunk, eventId),
    // A sign-in that read the account before the fence can reserve an avatar after it.
    bound(db, `INSERT INTO event_deletion_targets (event_id, kind, id)
      SELECT DISTINCT ?, 'avatar_owner', account_id FROM account_avatars WHERE account_id ${inChunk}
      ON CONFLICT (event_id, kind, id) DO NOTHING`, eventId, chunk),
    bound(db, `DELETE FROM account_avatars WHERE account_id ${inChunk}`, chunk),
    bound(db, `DELETE FROM ba_user WHERE id ${inChunk}`, chunk),
    bound(db, `DELETE FROM accounts WHERE id ${inChunk} AND event_id = ?`, chunk, eventId),
    bound(db, `DELETE FROM authentication_limits WHERE key IN (SELECT 'change:' || value FROM json_each(?))`, chunk),
    bound(db, `UPDATE event_deletion_targets SET done = 1 WHERE event_id = ? AND kind = 'account' AND id ${inChunk}
      AND ${inStep('rows')}`, eventId, chunk, eventId),
    bound(db, 'UPDATE event_deletions SET blocked = NULL WHERE event_id = ? AND blocked IS NOT NULL', eventId),
    bound(db, 'DELETE FROM command_assertions WHERE id = ?', assertionId),
  ];
}

/** True when the batch committed. False when a key or a seat in another event refused it. */
async function tryDeleteAccounts(db: D1Connection, eventId: string, ids: readonly string[]): Promise<boolean> {
  try {
    await db.batch(accountStatements(db, eventId, ids));
    return true;
  } catch (error) {
    if (isBlockingFailure(error)) return false;
    throw error;
  }
}

/** Earlier accounts commit one at a time, and the first that fails is the one to name. */
async function deleteAccounts(db: D1Connection, eventId: string, ids: readonly string[]): Promise<RowsProgress> {
  if (await tryDeleteAccounts(db, eventId, ids)) return 'more';
  for (const id of ids) {
    if (!await tryDeleteAccounts(db, eventId, [id])) {
      await bound(db, `UPDATE event_deletions SET blocked = ?, lease_until = unixepoch() + ${BLOCKED_RETRY_SECONDS}
        WHERE event_id = ? AND step = 'rows'`, id, eventId).run();
      return 'blocked';
    }
  }
  return 'more';
}

/**
 * One bounded, idempotent unit of the rows step. The caller repeats it until it
 * returns 'rows_done' or 'blocked'. It works from the journal and the targets,
 * so a repeat after a crash finds nothing left of what committed.
 *   contests: at most `limit` issues per statement, then the contest row, whose cascade removes
 *             its entries, seats, audit, outbox, announcements, and image rows.
 *   accounts: at most `limit` per batch. A key or seat in another event blocks the deletion,
 *             and nothing outside the targets is deleted.
 *   event:    the events row, whose cascade removes its entrants, event grants, and event audit.
 */
export async function advanceRows(db: D1Connection, eventId: string, limit: number = DELETE_CHUNK): Promise<RowsProgress> {
  const state = await bound(db, `SELECT d.step, (SELECT t.id FROM event_deletion_targets t
    WHERE t.event_id = d.event_id AND t.kind = 'contest' AND t.done = 0 ORDER BY t.id LIMIT 1) AS contest
    FROM event_deletions d WHERE d.event_id = ?`, eventId).first<{ step: DeletionStep; contest: string | null }>();
  if (state?.step !== 'rows') return 'rows_done';
  if (state.contest) {
    if (await bound(db, 'SELECT 1 FROM issues WHERE session_id = ? LIMIT 1', state.contest).first()) {
      await bound(db, 'DELETE FROM issues WHERE id IN (SELECT id FROM issues WHERE session_id = ? LIMIT ?)', state.contest, limit).run();
      return 'more';
    }
    await db.batch([
      bound(db, 'DELETE FROM sessions WHERE id = ? AND event_id = ?', state.contest, eventId),
      bound(db, `UPDATE event_deletion_targets SET done = 1 WHERE event_id = ? AND kind = 'contest' AND id = ? AND ${inStep('rows')}`,
        eventId, state.contest, eventId),
    ]);
    return 'more';
  }
  const accounts = await bound(db, `SELECT id FROM event_deletion_targets
    WHERE event_id = ? AND kind = 'account' AND done = 0 ORDER BY id LIMIT ?`, eventId, limit).all<{ id: string }>();
  if (accounts.results.length > 0) return deleteAccounts(db, eventId, accounts.results.map(({ id }) => id));
  await db.batch([
    bound(db, `DELETE FROM events WHERE id = ? AND ${inStep('rows')}`, eventId, eventId),
    bound(db, 'DELETE FROM authentication_limits WHERE key >= ? AND key < ?', `handle:${eventId}:`, `handle:${eventId};`),
    ...nextStepStatements(db, eventId, 'rows', 'live', `rows_done_at = ${NOW_SQL}, blocked = NULL`),
  ]);
  return 'rows_done';
}

/** The target flags mean "done in the current step". The contests visit the next step again. */
function nextStepStatements(db: D1Connection, eventId: string, from: DeletionStep, to: DeletionStep, set?: string): D1Statement[] {
  return [
    bound(db, `UPDATE event_deletion_targets SET done = 0 WHERE event_id = ? AND kind = 'contest' AND ${inStep(from)}`, eventId, eventId),
    bound(db, `UPDATE event_deletions SET step = '${to}'${set ? `, ${set}` : ''} WHERE event_id = ? AND step = '${from}'`, eventId),
  ];
}

/** The last step: the targets go, and the journal row stays as the site record. */
export function finishStatements(db: D1Connection, eventId: string): D1Statement[] {
  return [
    bound(db, `DELETE FROM event_deletion_targets WHERE event_id = ? AND ${inStep('files')}`, eventId, eventId),
    bound(db, `UPDATE event_deletions SET step = 'done', finished_at = ${NOW_SQL} WHERE event_id = ? AND step = 'files'`, eventId),
  ];
}
