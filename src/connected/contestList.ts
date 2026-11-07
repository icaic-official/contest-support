import type { ContestSummary, IntakeReason } from "@/backend/contracts";
import { intakeHeadline } from "./intakeText";
import { formatInZone, zonedParts, zoneLabel } from "./zonedTime";

/**
 * The note on a contest row. The server derives the reason, so the row needs
 * no clock. A row has no note before the start, because its start time already
 * says that.
 */
function intakeNote(reason: IntakeReason): string | null {
  switch (reason) {
    case "before_start":
      return null;
    case "running":
      return "Running now";
    case "ended":
      return "Ended";
    default:
      return intakeHeadline(reason);
  }
}

/** A contest's name, with its event when another listed contest has the same name. */
export function contestLabel(contests: readonly ContestSummary[], contest: ContestSummary): string {
  const shared = contests.some((other) => other.id !== contest.id && other.name === contest.name);
  return shared ? `${contest.name} · ${contest.eventName}` : contest.name;
}

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareContests(a: ContestSummary, b: ContestSummary): number {
  if (a.schedule && b.schedule) {
    return Date.parse(a.schedule.startsAt) - Date.parse(b.schedule.startsAt) || byText(a.id, b.id);
  }
  if (a.schedule || b.schedule) return a.schedule ? -1 : 1;
  return a.name.localeCompare(b.name) || byText(a.id, b.id);
}

/** The contests by start time, then ID. Contests with no schedule come last, by name, then ID. */
export function orderContests(contests: readonly ContestSummary[]): ContestSummary[] {
  return [...contests].sort(compareContests);
}

function endsAt(contest: ContestSummary): number {
  return contest.schedule ? Date.parse(contest.schedule.endsAt) : Number.NEGATIVE_INFINITY;
}

/**
 * The contest to open when the person has chosen none. A contest that takes
 * reports comes first: `running`, then `grace`, then any other open reason.
 * Next comes the first scheduled contest whose window has not ended at `now`.
 * The window decides here because a held or waiting reason never expires, so
 * a contest from last month can still carry one. Last comes the scheduled
 * contest that ends latest, then the first listed. `ordered` comes from
 * `orderContests`.
 */
export function defaultContest(ordered: readonly ContestSummary[], now: number): ContestSummary | undefined {
  const open = ordered.filter((contest) => contest.intake.open);
  const withReason = (reason: IntakeReason) => open.find((contest) => contest.intake.reason === reason);
  const taking = withReason("running") ?? withReason("grace") ?? open[0];
  if (taking) return taking;
  const next = ordered.find((contest) => contest.intake.reason !== "ended" && endsAt(contest) > now);
  if (next) return next;
  let latest: ContestSummary | undefined;
  for (const contest of ordered) {
    if (contest.schedule && (!latest || endsAt(contest) >= endsAt(latest))) latest = contest;
  }
  return latest ?? ordered[0];
}

/** One line of the contest picker. */
export interface ContestRow {
  id: string;
  name: string;
  /** The start in the event's zone, or null for a contest with no schedule. */
  start: string | null;
  /** The intake note, or null when the start time says enough. */
  marker: string | null;
  /** True while the contest takes reports. The row stands out then. */
  open: boolean;
}

/** The rows of the contest picker, in the order given. */
export function contestRows(contests: readonly ContestSummary[]): ContestRow[] {
  // A person who reaches several events can see times from several zones.
  const withZone = new Set(contests.map((contest) => contest.timeZone)).size > 1;
  const years = contests.flatMap(({ schedule, timeZone }) =>
    schedule ? [zonedParts(schedule.startsAt, timeZone).date.slice(0, 4)] : [],
  );
  const withYear = new Set(years).size > 1;
  return contests.map((contest) => {
    let start: string | null = null;
    if (contest.schedule) {
      const { startsAt } = contest.schedule;
      start = formatInZone(startsAt, contest.timeZone, withYear ? "datetimeYear" : "datetime");
      if (withZone) start += ` ${zoneLabel(contest.timeZone, Date.parse(startsAt))}`;
    }
    return {
      id: contest.id,
      name: contestLabel(contests, contest),
      start,
      marker: intakeNote(contest.intake.reason),
      open: contest.intake.open,
    };
  });
}

/** The start and the intake note of a row, for example `Tue 3 Nov, 13:00 · Running now`. Null for neither. */
export function rowDetail(row: ContestRow): string | null {
  const parts = [row.start, row.marker].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The row as one line of text, for example `Live 1 · Tue 3 Nov, 13:00 · Running now`. */
export function rowText(row: ContestRow): string {
  const detail = rowDetail(row);
  return detail === null ? row.name : `${row.name} · ${detail}`;
}
