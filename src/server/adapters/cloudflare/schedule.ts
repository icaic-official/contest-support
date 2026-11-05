/**
 * SQL fragments that D1 evaluates with its own clock, in reads and again inside
 * write batches. The server stores instants only. The browser converts them to
 * the event's time zone. Alias `s` names a `sessions` row. `extra` is a SQL
 * number: the minutes to add to the scheduled end. Callers that use it more than
 * once compute it once (`extraMinutesSql`) and pass that value, because it reads
 * the entry's awards.
 */

import type { IntakeMode, IntakeState, Schedule } from '../../../backend/contracts';

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** The most extra minutes that one entry can hold. It keeps the date arithmetic in range. */
export const EXTRA_MINUTES_MAX = 525_600;

/**
 * SQL number: the extra minutes that staff confirmed as applied to the entry.
 * It sums the entry's issue awards and the contest-wide awards. An award that
 * staff did not confirm adds nothing. Staff have no entry, so they get 0.
 * Index paths: `issues_session_team`, `awards.issue_id`, `contest_awards_session`.
 */
export function extraMinutesSql(s: string, entry: string): string {
  return `CASE WHEN ${entry} IS NULL THEN 0 ELSE MIN(${EXTRA_MINUTES_MAX},
    COALESCE((SELECT sum(w.minutes) FROM issues i JOIN awards w ON w.issue_id = i.id
      WHERE i.session_id = ${s}.id AND i.team_id = ${entry} AND w.applied_at IS NOT NULL), 0)
    + COALESCE((SELECT sum(c.minutes) FROM contest_awards c
      WHERE c.session_id = ${s}.id AND c.applied_at IS NOT NULL), 0)) END`;
}

/** SQL instant: the scheduled end plus the extra minutes. NULL without a schedule. */
export function personalEndSql(s: string, extra: string): string {
  return `strftime('%Y-%m-%dT%H:%M:%fZ', ${s}.ends_at, '+' || (${extra}) || ' minutes')`;
}

const closeSql = (s: string, extra: string) =>
  `strftime('%Y-%m-%dT%H:%M:%fZ', ${personalEndSql(s, extra)}, '+' || ${s}.grace_minutes || ' minutes')`;

/**
 * SQL boolean: is intake open now. While the contest follows its schedule,
 * intake runs from the start to the end plus the grace period. Otherwise
 * `intake_open` decides, which is the manual override and also today's switch.
 * Extra minutes only lengthen a contestant's time, so while the scheduled end
 * lies ahead, the CASE answers without reading them. Only a contestant after
 * the scheduled end pays for the read of the awards.
 */
export function intakeOpenSql(s: string, extra = '0'): string {
  return `(CASE WHEN ${s}.intake_follows_schedule = 1
    THEN CASE WHEN ${nowSql} < ${s}.starts_at THEN 0 WHEN ${nowSql} < ${s}.ends_at THEN 1
      ELSE ${nowSql} < ${closeSql(s, extra)} END
    ELSE ${s}.intake_open = 1 END)`;
}

/**
 * SQL json_object for the intake state: `open`, `reason`, `changes_at`. It uses
 * the same terms as `intakeOpenSql`. `changes_at` is the next of the start, the
 * end, and the end plus grace that lies after now. It is NULL while an override
 * holds and after the schedule is over.
 */
export function intakeStateSql(s: string, extra = '0'): string {
  const end = personalEndSql(s, extra);
  const close = closeSql(s, extra);
  return `json_object('open', json(CASE WHEN ${intakeOpenSql(s, extra)} THEN 'true' ELSE 'false' END),
    'reason', CASE WHEN ${s}.intake_follows_schedule = 0 THEN
        CASE WHEN ${s}.intake_open = 1 THEN 'override_open' ELSE 'override_closed' END
      WHEN ${nowSql} < ${s}.starts_at THEN 'before_start'
      WHEN ${nowSql} < ${end} THEN 'running'
      WHEN ${nowSql} < ${close} THEN 'grace'
      ELSE 'ended' END,
    'changes_at', CASE WHEN ${s}.intake_follows_schedule = 0 THEN NULL
      WHEN ${nowSql} < ${s}.starts_at THEN ${s}.starts_at
      WHEN ${nowSql} < ${end} THEN ${end}
      WHEN ${nowSql} < ${close} THEN ${close} END)`;
}

/**
 * SQL json_object for the clock of one snapshot. The browser only displays it.
 * `entry` is NULL for staff, who get no personal end time.
 */
export function clockSql(s: string, options: { timeZone: string; entry: string; extra: string }): string {
  const { timeZone, entry, extra } = options;
  return `json_object('time_zone', ${timeZone},
    'schedule', CASE WHEN ${s}.starts_at IS NULL THEN NULL ELSE json_object('starts_at', ${s}.starts_at,
      'ends_at', ${s}.ends_at, 'grace_minutes', ${s}.grace_minutes) END,
    'follows_schedule', json(CASE WHEN ${s}.intake_follows_schedule = 1 THEN 'true' ELSE 'false' END),
    'intake', ${intakeStateSql(s, extra)},
    'personal_end_at', CASE WHEN ${entry} IS NULL THEN NULL ELSE ${personalEndSql(s, extra)} END,
    'extra_minutes', ${extra})`;
}

export interface ScheduleColumns { starts_at: string | null; ends_at: string | null; grace_minutes: number }

/** The schedule of a contest row. Null for a contest created before schedules existed. */
export function scheduleOf(row: ScheduleColumns): Schedule | null {
  return row.starts_at === null || row.ends_at === null ? null
    : { startsAt: row.starts_at, endsAt: row.ends_at, graceMinutes: row.grace_minutes };
}

/** The intake mode of a contest row. The override holds the state of `intake_open`. */
export function intakeModeOf(row: { intake_follows_schedule: number; intake_open: number }): IntakeMode {
  return row.intake_follows_schedule === 1 ? 'schedule' : row.intake_open === 1 ? 'open' : 'closed';
}

/** Reads the `intakeStateSql` object of a row. */
export function parseIntake(json: string): IntakeState {
  const { open, reason, changes_at: changesAt } = JSON.parse(json) as { open: boolean; reason: IntakeState['reason']; changes_at: string | null };
  return { open, reason, changesAt };
}
