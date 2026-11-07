import type { DeletionStep, EventDeletion } from '../../../backend/contracts';
import { bound, isAssertionFailure } from '../d1/assertions';
import type { D1Connection, D1Statement } from '../d1/connection';
import type { PrivateBucket } from './images';
import { eraseLiveContest, type LiveNamespace } from './live';
import { logEvent } from './log';

/** Issues per statement and accounts per batch in the rows step. An issue takes its history with it. */
const DELETE_CHUNK = 100;

/** Rows per statement for a table without activity under it. D1 advises chunks of about 1,000. */
const FLAT_CHUNK = 1000;

/**
 * The tables under a contest that grow with activity and not with the roster, in delete order.
 * Each goes in chunks, so the contest row's own cascade removes only roster-sized rows.
 * D1 runs one query at a time, so one long statement here would make every other event wait.
 */
export const CONTEST_ACTIVITY = [
  { table: 'issues', chunk: DELETE_CHUNK },
  { table: 'notifications', chunk: FLAT_CHUNK },
  { table: 'admin_audit', chunk: FLAT_CHUNK },
  { table: 'announcement_receipts', chunk: FLAT_CHUNK },
  { table: 'announcements', chunk: DELETE_CHUNK },
  { table: 'contest_awards', chunk: FLAT_CHUNK },
  { table: 'account_operations', chunk: FLAT_CHUNK },
] as const;

type ActivityTable = (typeof CONTEST_ACTIVITY)[number]['table'];

/** The first activity table that still holds a row of one contest. Bind the contest ID. */
const NEXT_ACTIVITY_SQL = `SELECT CASE ${CONTEST_ACTIVITY.map(({ table }) =>
  `WHEN EXISTS (SELECT 1 FROM ${table} WHERE session_id = ?1) THEN '${table}'`).join(' ')} END AS activity`;

/** A blocked deletion looks again after this time, because another event's deletion can clear it. */
const BLOCKED_RETRY_SECONDS = 3600;

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
 *   contests: a chunk of one activity table per unit, then the contest row, whose cascade removes
 *             its entries, seats, and other roster-sized rows.
 *   accounts: a chunk per batch. A key or seat in another event blocks the deletion, and nothing
 *             outside the targets is deleted.
 *   event:    the events row, whose cascade removes its entrants, event grants, and event audit.
 * `limit` replaces every chunk size, so a test can stop between any two rows.
 */
export async function advanceRows(db: D1Connection, eventId: string, limit?: number): Promise<RowsProgress> {
  const state = await bound(db, `SELECT d.step, (SELECT t.id FROM event_deletion_targets t
    WHERE t.event_id = d.event_id AND t.kind = 'contest' AND t.done = 0 ORDER BY t.id LIMIT 1) AS contest
    FROM event_deletions d WHERE d.event_id = ?`, eventId).first<{ step: DeletionStep; contest: string | null }>();
  if (state?.step !== 'rows') return 'rows_done';
  if (state.contest) {
    const next = await bound(db, NEXT_ACTIVITY_SQL, state.contest).first<{ activity: ActivityTable | null }>();
    const activity = CONTEST_ACTIVITY.find(({ table }) => table === next?.activity);
    if (activity) {
      await bound(db, `DELETE FROM ${activity.table} WHERE rowid IN (SELECT rowid FROM ${activity.table} WHERE session_id = ? LIMIT ?)`,
        state.contest, limit ?? activity.chunk).run();
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
    WHERE event_id = ? AND kind = 'account' AND done = 0 ORDER BY id LIMIT ?`, eventId, limit ?? DELETE_CHUNK).all<{ id: string }>();
  if (accounts.results.length > 0) return deleteAccounts(db, eventId, accounts.results.map(({ id }) => id));
  await db.batch([
    bound(db, `DELETE FROM events WHERE id = ? AND ${inStep('rows')}`, eventId, eventId),
    bound(db, `DELETE FROM authentication_limits WHERE key >= ? AND key < ? AND ${inStep('rows')}`, `handle:${eventId}:`, `handle:${eventId};`, eventId),
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

/**
 * One run stops at this time, below the 30 seconds of `waitUntil`, and at this
 * count of D1, R2, and Durable Object calls, below the Workers subrequest limit,
 * because the cron shares that limit with its other tasks.
 */
export const DELETION_BUDGET = { milliseconds: 20_000, calls: 400 } as const;

// Longer than a run's budget, so two runners rarely share a deletion. Shorter than the
// minute between cron ticks, so the next tick always finds the lease of a budget stop expired.
const LEASE_SECONDS = 55;
// An issue image reservation lives 3,600 seconds. A later upload's Worker has died by then.
const FILES_WAIT_SECONDS = 3900;
const DELETIONS_SHOWN = 50;
const TARGET_PAGE = 50;
const LIST_LIMIT = 1000;

class Budget {
  private calls = 0;
  private readonly startedAt = Date.now();

  constructor(private readonly limits: { readonly milliseconds: number; readonly calls: number }) {}

  spend(calls = 1): void {
    this.calls += calls;
  }

  exhausted(): boolean {
    return this.calls >= this.limits.calls || Date.now() - this.startedAt >= this.limits.milliseconds;
  }
}

export interface DeletionEnvironment {
  readonly DB: D1Connection;
  readonly IMAGES: Pick<PrivateBucket, 'list' | 'delete'>;
  readonly LIVE_UPDATES: LiveNamespace;
}

interface StepRun {
  readonly env: DeletionEnvironment;
  readonly eventId: string;
  readonly budget: Budget;
}

/** Reads the current state, does the difference, and names the step to run next, or null to stop for now. */
type StepHandler = (run: StepRun) => Promise<DeletionStep | null>;

async function markDone(db: D1Connection, eventId: string, kind: 'contest' | 'avatar_owner', step: DeletionStep, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await bound(db, `UPDATE event_deletion_targets SET done = 1 WHERE event_id = ? AND kind = ?
    AND id IN (SELECT value FROM json_each(?)) AND ${inStep(step)}`, eventId, kind, JSON.stringify(ids), eventId).run();
}

/** advanceRows makes at most this many calls, except for a blocked chunk, which ends this run's work on the deletion. */
export const ROWS_UNIT_CALLS = 3;

const deleteRows: StepHandler = async ({ env, eventId, budget }) => {
  while (!budget.exhausted()) {
    budget.spend(ROWS_UNIT_CALLS);
    const progress = await advanceRows(env.DB, eventId);
    if (progress === 'rows_done') return 'live';
    if (progress === 'blocked') return null;
  }
  return null;
};

const eraseLiveState: StepHandler = async ({ env, eventId, budget }) => {
  for (;;) {
    budget.spend();
    // A runner whose lease expired finds nothing here once the step has moved, and it stops erasing.
    const { results } = await bound(env.DB, `SELECT id FROM event_deletion_targets
      WHERE event_id = ? AND kind = 'contest' AND done = 0 AND ${inStep('live')} ORDER BY id LIMIT ?`, eventId, eventId, TARGET_PAGE).all<{ id: string }>();
    if (results.length === 0) break;
    const erased: string[] = [];
    for (const { id } of results) {
      if (budget.exhausted()) break;
      budget.spend();
      await eraseLiveContest(env, eventId, id);
      erased.push(id);
    }
    budget.spend();
    await markDone(env.DB, eventId, 'contest', 'live', erased);
    if (budget.exhausted()) return null;
  }
  budget.spend();
  await env.DB.batch(nextStepStatements(env.DB, eventId, 'live', 'files'));
  return 'files';
};

/** True only when a complete listing from the start found no object. */
async function clearPrefix(bucket: DeletionEnvironment['IMAGES'], prefix: string, budget: Budget): Promise<boolean> {
  let found = false;
  let cursor: string | undefined;
  for (;;) {
    budget.spend();
    const page = await bucket.list({ prefix, limit: LIST_LIMIT, ...(cursor ? { cursor } : {}) });
    if (page.objects.length > 0) {
      found = true;
      budget.spend();
      await bucket.delete(page.objects.map((object) => object.key));
    }
    if (!page.truncated) return !found;
    cursor = page.cursor;
    if (!cursor || budget.exhausted()) return false;
  }
}

const removeFiles: StepHandler = async ({ env, eventId, budget }) => {
  // Without this wait, a one-minute cron would list every prefix for 65 minutes.
  budget.spend();
  const waiting = await bound(env.DB, `UPDATE event_deletions SET lease_until = unixepoch(rows_done_at) + ${FILES_WAIT_SECONDS}
    WHERE event_id = ? AND step = 'files' AND unixepoch() < unixepoch(rows_done_at) + ${FILES_WAIT_SECONDS}
    RETURNING event_id`, eventId).first();
  if (waiting) return null;
  for (;;) {
    budget.spend();
    const { results } = await bound(env.DB, `SELECT kind, id FROM event_deletion_targets
      WHERE event_id = ? AND kind IN ('avatar_owner', 'contest') AND done = 0 ORDER BY kind, id LIMIT ?`, eventId, TARGET_PAGE)
      .all<{ kind: 'contest' | 'avatar_owner'; id: string }>();
    if (results.length === 0) break;
    const empty = { contest: [] as string[], avatar_owner: [] as string[] };
    for (const { kind, id } of results) {
      if (budget.exhausted()) break;
      if (await clearPrefix(env.IMAGES, kind === 'contest' ? `${id}/` : `accounts/${id}/`, budget)) empty[kind].push(id);
    }
    budget.spend(2);
    await markDone(env.DB, eventId, 'contest', 'files', empty.contest);
    await markDone(env.DB, eventId, 'avatar_owner', 'files', empty.avatar_owner);
    if (budget.exhausted()) return null;
  }
  budget.spend();
  await env.DB.batch(finishStatements(env.DB, eventId));
  return 'done';
};

const stepHandlers: Record<DeletionStep, StepHandler> = {
  rows: deleteRows,
  live: eraseLiveState,
  files: removeFiles,
  done: async () => null,
};

/** Claims one open deletion whose lease has expired. With none open, it reads no row. Bind the lease seconds. */
export const CLAIM_DELETION_SQL = `UPDATE event_deletions SET lease_until = unixepoch() + ?
  WHERE event_id = (SELECT event_id FROM event_deletions WHERE finished_at IS NULL AND lease_until <= unixepoch()
    ORDER BY lease_until LIMIT 1)
  RETURNING event_id, step`;

/**
 * Advances the open deletions within one budget. It runs from the minute cron and
 * after a management command. When the budget ends, the lease expires and a later
 * tick continues. A deletion that fails does not stop the others. It stays leased,
 * so this run does not claim it again, and the run throws at the end.
 */
export async function advanceDeletions(env: DeletionEnvironment, limits: { readonly milliseconds: number; readonly calls: number } = DELETION_BUDGET): Promise<void> {
  const budget = new Budget(limits);
  let failed = 0;
  while (!budget.exhausted()) {
    budget.spend();
    const claimed = await bound(env.DB, CLAIM_DELETION_SQL, LEASE_SECONDS).first<{ event_id: string; step: DeletionStep }>();
    if (!claimed) break;
    try {
      let step: DeletionStep | null = claimed.step;
      while (step) step = await stepHandlers[step]({ env, eventId: claimed.event_id, budget });
    } catch (error) {
      failed += 1;
      logEvent('error', 'deletion.advance_failed', { task: 'advance-deletions', eventId: claimed.event_id, error });
    }
  }
  if (failed > 0) throw new Error('An event deletion requires another attempt.');
}

const DELETION_COLUMNS = `d.event_id, d.event_name, d.event_code, d.step, d.requested_at, d.requested_by_name, d.finished_at,
  b.name AS blocked_name, b.handle AS blocked_handle, d.blocked,
  strftime('%Y-%m-%dT%H:%M:%fZ', unixepoch(d.rows_done_at) + ${FILES_WAIT_SECONDS}, 'unixepoch') AS files_due_at,
  (SELECT count(*) FROM event_deletion_targets t WHERE t.event_id = d.event_id AND t.done = 0
    AND (t.kind <> 'avatar_owner' OR d.step = 'files')) AS remaining`;

/** The open deletions, then the latest finished ones. A step's own targets are what remain in it. */
export const DELETIONS_SQL = `SELECT * FROM (SELECT ${DELETION_COLUMNS} FROM event_deletions d LEFT JOIN accounts b ON b.id = d.blocked
    WHERE d.finished_at IS NULL ORDER BY d.lease_until LIMIT ${DELETIONS_SHOWN})
  UNION ALL SELECT * FROM (SELECT ${DELETION_COLUMNS} FROM event_deletions d LEFT JOIN accounts b ON b.id = d.blocked
    WHERE d.finished_at IS NOT NULL ORDER BY d.finished_at DESC LIMIT ${DELETIONS_SHOWN})`;

export interface DeletionRow {
  event_id: string;
  event_name: string;
  event_code: string;
  step: DeletionStep;
  requested_at: string;
  requested_by_name: string;
  finished_at: string | null;
  blocked: string | null;
  blocked_name: string | null;
  blocked_handle: string | null;
  files_due_at: string | null;
  remaining: number;
}

export function deletionFromRow(row: DeletionRow): EventDeletion {
  return {
    eventId: row.event_id, eventName: row.event_name, eventCode: row.event_code, step: row.step,
    requestedAt: row.requested_at, requestedByName: row.requested_by_name, finishedAt: row.finished_at,
    blockedBy: row.blocked !== null && row.blocked_name !== null ? { name: row.blocked_name, handle: row.blocked_handle } : null,
    filesDueAt: row.files_due_at, remaining: row.remaining,
  };
}
