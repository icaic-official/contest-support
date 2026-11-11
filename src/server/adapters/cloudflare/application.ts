import { z } from 'zod';
import type { ContestQuery, ContestSummary, ContestType, ManageLevel } from '../../../backend/contracts';
import { snapshotSchema, type Snapshot } from '../../../connected/model';
import type { Caller } from '../../authentication';
import { AuthenticationError } from '../../authentication';
import type { D1Connection, D1Statement, D1Value } from '../d1/connection';
import { calendarEventSql, calendarWebmasterSql, contestDataBindings, contestDataSql, contestListBindings, contestSeatsSql, notBeingDeletedSql } from './authority';
import { clockSql, intakeOpenSql, intakeStateSql, parseIntake, scheduleOf, viewerExtraSql, type ScheduleColumns } from './schedule';

/** Bind accountId, loginId. This check also works after an authorized self-removal. */
export const currentReadyLoginSql = `SELECT a.id FROM accounts a JOIN logins l ON l.account_id = a.id
  JOIN ba_session b ON b.id = l.identity_session_id AND b.userId = a.id
  WHERE a.id = ? AND l.id = ? AND a.disabled = 0 AND a.must_change = 0
    AND a.credential_state = 'ready' AND l.revoked = 0 AND l.expires_at > unixepoch()
    AND l.credential_generation = a.credential_generation
    AND b.expiresAt > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

export function currentReadyLoginBindings(caller: Caller): D1Value[] {
  return [caller.accountId, caller.loginId];
}

// D1 compiles every statement on every call, and SQLite compiles a CTE again at
// each place that names it. So the resolver is named once, as `c` in the FROM
// clause, and every section reads the caller's seat from `c`. Without a seat,
// `c` is NULL and every section is empty. A CTE that read `access` for the five
// issue sections made hosted D1 refuse the statement with "VIEWs and/or
// subqueries nested too deep", which local SQLite accepts. So those sections
// read `issues` directly, through readableIssue.
// The audit section takes its key from `c`, so a caller who is not an admin
// reads no audit row. A team member reads the own team by key. The memberships
// foreign key keeps that team in the same session.
// extra_minutes is the contestant's confirmed extra time. It is read once, and
// only for a contest with a schedule, because the clock and the intake state
// both use it. The contest keeps today's reads without a schedule.
const extra = 'x.minutes';
/**
 * The issues that seat `c` reads. A team member reads the own team's issues, and
 * staff read every issue of the contest. SQLite reads each side of the OR
 * through its own index on `issues`.
 */
const readableIssue = `((i.session_id = c.session_id AND i.team_id = c.team_id)
  OR (c.staff = 1 AND i.session_id = c.session_id))`;
export const snapshotSql = `WITH login AS (${currentReadyLoginSql}), access AS MATERIALIZED (${contestDataSql('caller')}),
  extra_minutes AS MATERIALIZED (SELECT ${viewerExtraSql('s', 'a.team_id')} AS minutes
    FROM access a JOIN sessions s ON s.id = a.session_id)
SELECT json_object(
  'session', (SELECT json_object('id', s.id, 'event_id', s.event_id, 'name', s.name,
    'intake_open', json(CASE WHEN ${intakeOpenSql('s', extra)} THEN 'true' ELSE 'false' END),
    'categories', json(s.categories), 'revision', s.version,
    'max_image_bytes', s.max_image_bytes, 'max_images_per_issue', s.max_images_per_issue,
    'max_image_bytes_per_issue', s.max_image_bytes_per_issue) FROM sessions s WHERE s.id = ? AND c.account_id IS NOT NULL),
  'event', (SELECT json_object('id', e.id, 'name', e.name,
    'archived', json(CASE WHEN e.archived THEN 'true' ELSE 'false' END))
    FROM events e JOIN sessions s ON s.event_id = e.id WHERE s.id = ? AND c.account_id IS NOT NULL),
  'clock', (SELECT ${clockSql('s', { timeZone: 'e.time_zone', entry: 'c.team_id', extra })}
    FROM sessions s JOIN events e ON e.id = s.event_id WHERE s.id = c.session_id),
  'contest_awards', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', k.id, 'minutes', k.minutes, 'explanation', k.explanation, 'actor_name', k.actor_name,
      'at', k.at, 'applied_at', k.applied_at, 'applied_name', k.applied_name,
      'withdrawn_at', k.withdrawn_at, 'withdrawn_name', k.withdrawn_name) AS row
    FROM contest_awards k WHERE k.session_id = c.session_id
      AND (c.staff = 1 OR (c.team_id IS NOT NULL AND k.applied_at IS NOT NULL)) ORDER BY k.at, k.id)), '[]')),
  'membership', (SELECT json_object('session_id', ?, 'user_id', c.account_id,
    'team_id', c.team_id, 'roles', json(c.roles), 'is_admin', json(CASE WHEN c.is_admin THEN 'true' ELSE 'false' END))
    WHERE c.account_id IS NOT NULL),
  'has_specialist', (SELECT json(CASE WHEN EXISTS (SELECT 1 FROM membership_roles r
      WHERE r.session_id = c.session_id AND r.role = 'specialist') THEN 'true' ELSE 'false' END) WHERE c.staff = 1),
  'teams', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', id, 'session_id', session_id, 'name', name, 'location', location, 'entrant_id', entrant_id) AS row FROM (
      SELECT t.* FROM teams t WHERE c.staff = 1 AND t.session_id = ?
      UNION ALL SELECT t.* FROM teams t WHERE t.id = c.team_id) ORDER BY name, id)), '[]')),
  'issues', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', i.id, 'number', i.number, 'session_id', i.session_id,
      'team_id', i.team_id, 'reporter', i.reporter, 'reporter_name', i.reporter_name,
      'category', i.category, 'description', i.description, 'status', i.status,
      'created_at', i.created_at, 'first_assigned_at', i.first_assigned_at,
      'owner', i.owner, 'owner_name', i.owner_name, 'resolved_at', i.resolved_at,
      'revision', i.public_revision) AS row FROM issues i WHERE ${readableIssue} ORDER BY i.number DESC, i.id)), '[]')),
  'resolutions', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', r.id, 'session_id', r.session_id, 'issue_id', r.issue_id,
      'actor', r.actor, 'actor_name', r.actor_name, 'at', r.at, 'summary', r.summary,
      'reopened_at', r.reopened_at, 'reopened_by', r.reopened_by,
      'reopened_name', r.reopened_name, 'reason', r.reason) AS row
    FROM resolutions r JOIN issues i ON i.id = r.issue_id WHERE ${readableIssue} ORDER BY r.at, r.id)), '[]')),
  'history', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', h.id, 'issue_id', h.issue_id, 'at', h.at,
      'actor', h.actor, 'actor_name', h.actor_name, 'text', h.text, 'visibility', h.visibility) AS row
    FROM history h JOIN issues i ON i.id = h.issue_id
    WHERE ${readableIssue} AND (h.visibility = 'public' OR c.staff = 1) ORDER BY h.at, h.id)), '[]')),
  'awards', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', w.id, 'issue_id', w.issue_id, 'resolution_id', w.resolution_id,
      'minutes', w.minutes, 'explanation', w.explanation, 'actor_name', w.actor_name,
      'at', w.at, 'applied_at', w.applied_at, 'applied_name', w.applied_name,
      'withdrawn_at', w.withdrawn_at, 'withdrawn_name', w.withdrawn_name) AS row
    FROM awards w JOIN issues i ON i.id = w.issue_id
    WHERE ${readableIssue} AND (w.withdrawn_at IS NULL OR c.staff = 1) ORDER BY w.at, w.id)), '[]')),
  'attachments', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', x.id, 'issue_id', x.issue_id, 'uploader', x.uploader,
      'uploader_name', x.uploader_name, 'uploaded_at', x.uploaded_at,
      'visibility', x.visibility, 'byte_size', x.byte_size, 'content_type', x.content_type,
      'original_name', x.original_name) AS row
    FROM issues i CROSS JOIN issue_images x
    WHERE ${readableIssue} AND x.issue_id = i.id AND x.state = 'ready' AND (x.visibility = 'public' OR c.staff = 1)
    ORDER BY x.uploaded_at, x.id)), '[]')),
  'pending_removals', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', x.id, 'issue_id', x.issue_id, 'original_name', x.original_name) AS row
    FROM issue_images x WHERE c.staff = 1 AND x.session_id = ?
      AND x.state IN ('deleting', 'deleted') AND x.files_removed_at IS NULL AND x.deleted_by = c.account_id
    ORDER BY x.deleted_at, x.id)), '[]')),
  'members', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('membership', json_object('session_id', m.session_id, 'user_id', m.account_id,
      'team_id', m.team_id, 'roles', json(m.roles),
      'is_admin', json(CASE WHEN m.is_admin THEN 'true' ELSE 'false' END)),
      'person', json_object('id', p.id, 'name', p.name, 'username', p.handle)) AS row
    FROM (${contestSeatsSql}) m JOIN accounts p ON p.id = m.account_id
    WHERE c.is_admin = 1 ORDER BY p.name, p.id)), '[]')),
  'audit', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', d.id, 'actor', d.actor, 'at', d.at, 'action', d.action, 'target', d.target) AS row
    FROM admin_audit d WHERE d.session_id = (SELECT ? WHERE c.is_admin = 1)
    ORDER BY d.at DESC, d.id DESC LIMIT 50)), '[]')),
  'server_time', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
) AS snapshot FROM login LEFT JOIN access c ON true LEFT JOIN extra_minutes x ON true`;

/** Appends opaque invalidations to the same transaction as the changed data. */
export function notificationStatements(db: D1Connection, sessionId: string, audiences: readonly string[]): D1Statement[] {
  return [...new Set(audiences)].flatMap((audience) => [
    db.prepare(`INSERT INTO audience_sequences (session_id, audience, sequence) VALUES (?, ?, 1)
      ON CONFLICT(session_id, audience) DO UPDATE SET sequence = sequence + 1`).bind(sessionId, audience),
    db.prepare(`INSERT INTO notifications (id, session_id, audience, sequence)
      SELECT ?, session_id, audience, sequence FROM audience_sequences WHERE session_id = ? AND audience = ?`)
      .bind(crypto.randomUUID(), sessionId, audience),
  ]);
}

const contestColumns = (extraSql: string, row = 'c') => `${row}.session_id AS id, ${row}.session_name AS name, ${row}.event_id, ${row}.manage, e.name AS event_name, e.time_zone,
  s.contest_type, s.starts_at, s.ends_at, s.grace_minutes, s.intake_follows_schedule, s.intake_open,
  ${intakeStateSql('s', extraSql)} AS intake`;

/**
 * Every contest that the caller can open, each with the caller's own intake: a
 * contestant's confirmed extra time keeps a contest open past its scheduled end,
 * as the contest's own clock says. `viewer` reads the minutes once for each
 * contest, because `intakeStateSql` uses them several times. Bind with contestListBindings.
 */
export const contestsListSql = `WITH viewer AS MATERIALIZED (SELECT c.session_id, c.session_name, c.event_id, c.manage,
    ${viewerExtraSql('s', 'c.team_id')} AS extra
    FROM (${contestDataSql('contests')}) c JOIN sessions s ON s.id = c.session_id)
  SELECT ${contestColumns('v.extra', 'v')}, 1 AS can_open FROM viewer v
  JOIN sessions s ON s.id = v.session_id JOIN events e ON e.id = s.event_id ORDER BY v.session_name, v.session_id`;

/**
 * The contests of one event that the caller can open, with the intake of the
 * contest alone, for the event console. Bind with contestListBindings, then the event ID.
 */
export const eventContestsSql = `SELECT ${contestColumns('0')}, 1 AS can_open FROM (${contestDataSql('contests')}) c
  JOIN sessions s ON s.id = c.session_id JOIN events e ON e.id = s.event_id WHERE c.event_id = ?
  ORDER BY c.session_name, c.session_id`;

/** The most contests that one calendar read returns. */
export const CALENDAR_LIMIT = 500;

/**
 * The scheduled contests that overlap a window: every contest of the caller's
 * own event, and every contest of the site for a webmaster. A contest that the
 * caller holds no seat in is listed with `can_open` 0. A member reads the event
 * index and a webmaster the end-time index, so a member's read does not grow
 * with the other events of the site. Bind accountId, loginId, then
 * contestListBindings, then the window start and end for each of the two scopes.
 */
const calendarRow = (from: string, scope: string) => `SELECT s.id, s.name, s.event_id, COALESCE(r.manage, 'none') AS manage,
    e.name AS event_name, e.time_zone, s.contest_type, s.starts_at, s.ends_at, s.grace_minutes, s.intake_follows_schedule,
    s.intake_open, ${intakeStateSql('s')} AS intake, r.session_id IS NOT NULL AS can_open
  FROM ${from} CROSS JOIN sessions s JOIN events e ON e.id = s.event_id LEFT JOIN reach r ON r.session_id = s.id
  WHERE ${scope} AND s.ends_at > ? AND s.starts_at < ?`;
export const calendarSql = `WITH login AS (${currentReadyLoginSql}), webmaster AS MATERIALIZED (${calendarWebmasterSql}),
  reach AS MATERIALIZED (SELECT c.session_id, c.manage FROM (${contestDataSql('contests')}) c)
SELECT * FROM (${calendarRow('login', calendarEventSql)} UNION ALL ${calendarRow('webmaster CROSS JOIN login', notBeingDeletedSql('s.event_id'))})
ORDER BY starts_at, id LIMIT ${CALENDAR_LIMIT}`;

interface ContestRow extends ScheduleColumns {
  id: string; name: string; event_id: string; manage: ManageLevel; event_name: string; time_zone: string;
  contest_type: ContestType; intake_follows_schedule: number; intake_open: number; intake: string; can_open: number;
}

/** D1 owns current access and consistent snapshots. */
export class D1ApplicationService {
  constructor(private readonly db: D1Connection) {}

  private statement(sql: string, ...values: D1Value[]): D1Statement {
    return this.db.prepare(sql).bind(...values);
  }

  /**
   * The contests that the caller can open, or with a window, the calendar of
   * the caller's event. The resolver already limits an account of an event to
   * that event, and lets a webmaster reach every contest, so an event ID only
   * narrows the answer.
   */
  async contests(caller: Caller, query: ContestQuery = {}): Promise<ContestSummary[]> {
    const { eventId, window } = query;
    if (eventId !== undefined && !z.uuid().safeParse(eventId).success) throw new AuthenticationError(400, 'Choose an event.');
    const result = window !== undefined
      ? await this.statement(calendarSql, ...currentReadyLoginBindings(caller), ...contestListBindings(caller), window.from, window.to, window.from, window.to)
        .all<ContestRow>()
      : eventId === undefined
        ? await this.statement(contestsListSql, ...contestListBindings(caller)).all<ContestRow>()
        : await this.statement(eventContestsSql, ...contestListBindings(caller), eventId).all<ContestRow>();
    return result.results.map((row) => ({
      id: row.id, name: row.name, eventId: row.event_id, eventName: row.event_name, timeZone: row.time_zone,
      contestType: row.contest_type, schedule: scheduleOf(row), intake: parseIntake(row.intake),
      canOpen: row.can_open === 1, manage: row.manage,
    }));
  }

  async snapshot(caller: Caller, sessionId: string): Promise<Snapshot> {
    if (!z.uuid().safeParse(sessionId).success) throw new AuthenticationError(400, 'Invalid session or account.');
    const row = await this.statement(snapshotSql, caller.accountId, caller.loginId, ...contestDataBindings(caller, sessionId),
      ...Array<string>(7).fill(sessionId)).first<{ snapshot: string }>();
    if (!row) throw new AuthenticationError(403, 'Sign in again or change your temporary password.');
    return snapshotSchema.parse(JSON.parse(row.snapshot));
  }
}
