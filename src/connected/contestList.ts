import type { ContestSummary, IntakeReason } from "@/backend/contracts";
import { formatInZone, zoneLabel } from "./zonedTime";

/**
 * The note on a contest row for each intake reason. The server derives the
 * reason, so the row needs no clock. A row has no note before the start,
 * because its start time already says that.
 */
const intakeMarkers: Record<IntakeReason, string | null> = {
  before_start: null,
  running: "Running now",
  grace: "Running now",
  override_open: "Running now",
  override_closed: "Closed by staff",
  awaiting_live_passwords: "Waiting for live passwords",
  ended: "Ended",
};

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
 * The contest to open when the person has chosen none: the one that takes
 * reports now, else the next one, else the one that ended last. `ordered`
 * comes from `orderContests`.
 */
export function defaultContest(ordered: readonly ContestSummary[]): ContestSummary | undefined {
  const open = ordered.find((contest) => contest.intake.open);
  if (open) return open;
  const next = ordered.find((contest) => contest.schedule && contest.intake.reason !== "ended");
  if (next) return next;
  let lastEnded: ContestSummary | undefined;
  for (const contest of ordered) {
    if (contest.schedule && (!lastEnded || endsAt(contest) >= endsAt(lastEnded))) lastEnded = contest;
  }
  return lastEnded ?? ordered[0];
}

/** One line of the contest picker. */
export interface ContestRow {
  id: string;
  name: string;
  /** The start in the event's zone, or null for a contest with no schedule. */
  start: string | null;
  /** The intake note, or null when the start time says enough. */
  marker: string | null;
}

/** The rows of the contest picker, in the order given. */
export function contestRows(contests: readonly ContestSummary[]): ContestRow[] {
  // A person who reaches several events can see times from several zones.
  const withZone = new Set(contests.map((contest) => contest.timeZone)).size > 1;
  return contests.map((contest) => {
    let start: string | null = null;
    if (contest.schedule) {
      const { startsAt } = contest.schedule;
      start = formatInZone(startsAt, contest.timeZone, "datetime");
      if (withZone) start += ` ${zoneLabel(contest.timeZone, Date.parse(startsAt))}`;
    }
    return {
      id: contest.id,
      name: contestLabel(contests, contest),
      start,
      marker: intakeMarkers[contest.intake.reason],
    };
  });
}

/** The row as one line of text, for example `Live 1 · Tue 3 Nov, 13:00 · Running now`. */
export function rowText(row: ContestRow): string {
  return [row.name, row.start, row.marker].filter((part): part is string => part !== null).join(" · ");
}
