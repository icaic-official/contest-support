import { z } from 'zod';
import {
  ANNOUNCEMENT_DETAILS_MAX, ANNOUNCEMENT_TITLE_MAX,
  announcementSnapshotSchema, type AnnouncementSnapshot,
} from '../../../connected/announcementModel';
import { can } from '../../../connected/capabilities';
import type { Caller } from '../../authentication';
import { AuthenticationError } from '../../authentication';
import { equalWorkflowJson } from '../../workflow';
import type { D1Connection, D1Statement, D1Value } from '../d1/connection';
import { currentReadyLoginBindings, currentReadyLoginSql, notificationStatements } from './application';
import { type ContestAuthorityRow, contestDataBindings, contestDataSql, seatFromRow } from './authority';

export const announcementNow = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** `conflict` means the announcement changed after the caller read it. */
export class AnnouncementCommandError extends Error {
  constructor(readonly reason: 'input' | 'access' | 'state' | 'conflict' | 'request_id', message: string) {
    super(message);
    this.name = 'AnnouncementCommandError';
  }
}

const uuid = z.uuid();
const expiry = z.iso.datetime({ offset: true }).nullable();
// SQLite length() stops at U+0000, so the length CHECK on stored text would fail with the wrong error.
const noNul = (value: string) => !value.includes('\u0000');
const title = z.string().trim().min(1).max(ANNOUNCEMENT_TITLE_MAX).refine(noNul);
const details = z.string().trim().min(1).max(ANNOUNCEMENT_DETAILS_MAX).refine(noNul);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('publish'), title, details, expires_at: expiry }),
  z.strictObject({ type: z.literal('edit'), id: uuid, revision, title, details, expires_at: expiry }),
  z.strictObject({ type: z.literal('remove'), id: uuid, revision }),
]);

/**
 * Session admins and jury manage announcements. `row` names a resolver row.
 * This is capabilityRule.announce in SQL, for reads and guards inside D1.
 */
export function announcementManager(row: string): string {
  return `(${row}.staff = 1 AND (${row}.is_admin = 1 OR EXISTS (SELECT 1 FROM json_each(${row}.roles) WHERE value = 'jury')))`;
}

export function announcementAssertion(db: D1Connection, id: string, sql: string, ...values: D1Value[]): D1Statement {
  return db.prepare(`INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN EXISTS (${sql}) THEN 1 ELSE 0 END)`)
    .bind(id, ...values);
}

/**
 * Check first that the caller manages announcements in an active event.
 * Time can pass between batch statements, so recheck the credential after the writes.
 * `statements` can add a `${guard}:state` assertion.
 */
export function guardedAnnouncementBatch(db: D1Connection, guard: string, caller: Caller, sessionId: string,
  statements: D1Statement[]): D1Statement[] {
  return [
    announcementAssertion(db, guard, `SELECT 1 FROM (${contestDataSql('caller')}) c WHERE c.archived = 0 AND ${announcementManager('c')}`,
      ...contestDataBindings(caller, sessionId)),
    ...statements,
    announcementAssertion(db, `${guard}:access`, currentReadyLoginSql, ...currentReadyLoginBindings(caller)),
    db.prepare('DELETE FROM command_assertions WHERE id IN (?, ?, ?)').bind(guard, `${guard}:state`, `${guard}:access`),
  ];
}

/** Every member reads announcements, so every live audience of the session changes. */
export async function sessionAudiences(db: D1Connection, sessionId: string): Promise<string[]> {
  const teams = await db.prepare('SELECT id FROM teams WHERE session_id = ?').bind(sessionId).all<{ id: string }>();
  return ['staff', ...teams.results.map((team) => `team:${team.id}`)];
}

export function isGuardFailure(error: unknown): boolean {
  return error instanceof Error && /(?:CHECK|UNIQUE|FOREIGN KEY|NOT NULL) constraint failed|Announcement/.test(error.message);
}

interface ReceiptRow { session_id: string; command: string; announcement_id: string }
interface AnnouncementRow { revision: number; removed_at: string | null }

// SQLite compiles a CTE again at each place that names it, and D1 compiles every
// statement on every call. So `visible` names the resolver once, as `c`, and
// MATERIALIZED generates the resolver's code once for the three places.
export const snapshotSql = `WITH access AS MATERIALIZED (${contestDataSql('caller')}),
  visible AS (SELECT a.* FROM access c CROSS JOIN announcements a WHERE a.session_id = ? AND a.removed_at IS NULL
    AND (${announcementManager('c')} OR a.expires_at IS NULL OR a.expires_at > ${announcementNow}))
SELECT json_object(
  'announcements', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', a.id, 'session_id', a.session_id, 'title', a.title, 'details', a.details,
      'author', a.author, 'author_name', a.author_name, 'published_at', a.published_at,
      'expires_at', a.expires_at, 'edited_at', a.edited_at, 'edited_by', a.edited_by,
      'edited_name', a.edited_name, 'removed_at', a.removed_at, 'removed_by', a.removed_by,
      'removed_name', a.removed_name, 'revision', a.revision) AS row
    FROM visible a ORDER BY a.published_at DESC, a.id)), '[]')),
  'images', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', x.id, 'session_id', x.session_id, 'announcement_id', x.announcement_id,
      'uploader', x.uploader, 'uploader_name', x.uploader_name, 'name', x.name, 'bytes', x.byte_size,
      'content_type', x.content_type, 'uploaded_at', x.uploaded_at) AS row
    FROM visible a CROSS JOIN announcement_images x
    WHERE x.announcement_id = a.id AND x.state = 'ready' ORDER BY x.uploaded_at, x.id)), '[]')),
  'server_time', ${announcementNow}) AS snapshot
FROM access`;

/** D1 owns announcement access, expiry, revisions, and atomic publication. */
export class D1AnnouncementService {
  constructor(private readonly db: D1Connection) {}

  private statement(sql: string, ...values: D1Value[]): D1Statement { return this.db.prepare(sql).bind(...values); }

  /**
   * Readers see active records. Managers also see expired records. Nobody sees
   * removed records here. Their rows stay for the contest log.
   */
  async snapshot(caller: Caller, sessionId: string): Promise<AnnouncementSnapshot> {
    if (!uuid.safeParse(sessionId).success) throw new AuthenticationError(400, 'Invalid session.');
    const row = await this.statement(snapshotSql, ...contestDataBindings(caller, sessionId), sessionId)
      .first<{ snapshot: string }>();
    if (!row) throw new AuthenticationError(403, 'Sign in again or change your temporary password.');
    return announcementSnapshotSchema.parse(JSON.parse(row.snapshot));
  }

  private async receipt(caller: Caller, requestId: string): Promise<ReceiptRow | null> {
    return this.statement(`SELECT session_id, command, announcement_id FROM announcement_receipts
      WHERE actor = ? AND request_id = ?`, caller.accountId, requestId).first<ReceiptRow>();
  }

  private replay(receipt: ReceiptRow, sessionId: string, command: unknown): string {
    if (receipt.session_id !== sessionId || !equalWorkflowJson(JSON.parse(receipt.command), command)) {
      throw new AnnouncementCommandError('request_id', 'This request ID has different content.');
    }
    return receipt.announcement_id;
  }

  /** Publish, edit, or remove one announcement. A repeated request ID never repeats the write. */
  async execute(caller: Caller, sessionId: string, requestId: string, input: unknown): Promise<string> {
    const parsed = commandSchema.safeParse(input);
    if (!uuid.safeParse(sessionId).success || !uuid.safeParse(requestId).success || !parsed.success) {
      throw new AnnouncementCommandError('input', 'Check the announcement title, details, and expiry.');
    }
    const command = parsed.data.type === 'remove' ? parsed.data
      : { ...parsed.data, expires_at: parsed.data.expires_at === null ? null : new Date(parsed.data.expires_at).toISOString() };
    const current = await this.statement(contestDataSql('caller'), ...contestDataBindings(caller, sessionId)).first<ContestAuthorityRow>();
    if (!current || !can(seatFromRow(current), 'announce')) {
      throw new AnnouncementCommandError('access', 'Only session admins and jury can manage announcements.');
    }
    if (current.archived) throw new AnnouncementCommandError('state', 'This event is archived.');
    const prior = await this.receipt(caller, requestId);
    if (prior) return this.replay(prior, sessionId, command);
    // Only a new command needs a future expiry. A committed command can replay after its expiry passes.
    if ('expires_at' in command && command.expires_at !== null && Date.parse(command.expires_at) <= Date.now()) {
      throw new AnnouncementCommandError('input', 'Choose a future expiry time or no expiry.');
    }

    const id = command.type === 'publish' ? crypto.randomUUID() : command.id;
    const guardId = crypto.randomUUID();
    const statements: D1Statement[] = [];
    if (command.type === 'publish') {
      statements.push(this.statement(`INSERT INTO announcements (id, session_id, title, details, author, author_name, expires_at)
        SELECT ?, ?, ?, ?, id, name, ? FROM accounts WHERE id = ?`,
      id, sessionId, command.title, command.details, command.expires_at, caller.accountId));
    } else {
      statements.push(announcementAssertion(this.db, `${guardId}:state`, `SELECT 1 FROM announcements WHERE id = ? AND session_id = ?
        AND removed_at IS NULL AND revision = ?`, id, sessionId, command.revision));
      statements.push(command.type === 'edit'
        ? this.statement(`UPDATE announcements SET title = ?, details = ?, expires_at = ?, edited_at = ${announcementNow},
            edited_by = ?, edited_name = (SELECT name FROM accounts WHERE id = ?), revision = revision + 1
            WHERE id = ? AND session_id = ? AND revision = ? AND removed_at IS NULL`,
        command.title, command.details, command.expires_at, caller.accountId, caller.accountId, id, sessionId, command.revision)
        : this.statement(`UPDATE announcements SET removed_at = ${announcementNow}, removed_by = ?,
            removed_name = (SELECT name FROM accounts WHERE id = ?), revision = revision + 1
            WHERE id = ? AND session_id = ? AND revision = ? AND removed_at IS NULL`,
        caller.accountId, caller.accountId, id, sessionId, command.revision));
    }
    statements.push(
      this.statement(`INSERT INTO announcement_receipts (actor, request_id, session_id, command, announcement_id)
        VALUES (?, ?, ?, ?, ?)`, caller.accountId, requestId, sessionId, JSON.stringify(command), id),
      ...notificationStatements(this.db, sessionId, await sessionAudiences(this.db, sessionId)),
    );
    try {
      await this.db.batch(guardedAnnouncementBatch(this.db, guardId, caller, sessionId, statements));
    } catch (error) {
      // A concurrent retry of this request can commit first. A lost response can hide a commit.
      const committed = await this.receipt(caller, requestId);
      if (committed) return this.replay(committed, sessionId, command);
      if (!isGuardFailure(error)) throw error;
      if (command.type !== 'publish') {
        const latest = await this.statement('SELECT revision, removed_at FROM announcements WHERE id = ? AND session_id = ?',
          id, sessionId).first<AnnouncementRow>();
        if (!latest || latest.removed_at !== null) throw new AnnouncementCommandError('state', 'Announcement unavailable.');
        if (latest.revision !== command.revision) {
          throw new AnnouncementCommandError('conflict', 'Announcement changed. Review the latest version and try again.');
        }
      }
      throw new AnnouncementCommandError('access', 'Announcement access or the event changed. Refresh and try again.');
    }
    return id;
  }
}
