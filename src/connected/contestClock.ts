import type { ContestClock } from "./model";
import { formatCountdown, formatInZone, viewerNote, zonedParts } from "./zonedTime";

/** What the clock says now. The browser only displays what D1 derived. */
export interface ClockText {
  /** The first line. */
  headline: string;
  /** Further lines, each a sentence. */
  details: string[];
  /** Time left until the next change, for a visible countdown. Undefined when none. */
  countdown?: string | undefined;
}

/** The instant after which this viewer can no longer report: the end, plus extra minutes, plus grace. */
export function closesAt(clock: ContestClock): string | undefined {
  const schedule = clock.schedule;
  if (!schedule) return undefined;
  const end = Date.parse(clock.personal_end_at ?? schedule.ends_at);
  return new Date(end + schedule.grace_minutes * 60_000).toISOString();
}

/** A time in the event's zone. It names the day too when the day is not today in that zone. */
function stamp(instant: string, zone: string, now: number): string {
  const today = zonedParts(new Date(now).toISOString(), zone).date;
  return formatInZone(instant, zone, zonedParts(instant, zone).date === today ? "time" : "datetime");
}

const closedByHand = "Reporting is closed by the organizers.";

/**
 * Where the schedule puts this viewer now, and when that changes. A hand
 * override hides both from `intake`, so the clock derives them again.
 */
function scheduledIntake(schedule: NonNullable<ContestClock["schedule"]>, endAt: string, now: number): ContestClock["intake"] {
  const start = Date.parse(schedule.starts_at);
  const end = Date.parse(endAt);
  const closes = end + schedule.grace_minutes * 60_000;
  const phase = (reason: ContestClock["intake"]["reason"], until: number | null) => ({
    open: false,
    reason,
    changes_at: until === null ? null : new Date(until).toISOString(),
  });
  if (now < start) return phase("before_start", start);
  if (now < end) return phase("running", end);
  if (now < closes) return phase("grace", closes);
  return phase("ended", null);
}

/** The clock as lines of text. `now` is server time in milliseconds. */
export function clockText(clock: ContestClock, now: number): ClockText {
  const zone = clock.time_zone;
  const schedule = clock.schedule;
  if (schedule && clock.intake.reason === "override_closed") {
    // The contestant keeps the own clock and end time. The closure is the second line.
    const text = clockText({ ...clock, intake: scheduledIntake(schedule, clock.personal_end_at ?? schedule.ends_at, now) }, now);
    return { ...text, details: [closedByHand, ...text.details] };
  }
  const { reason, changes_at: changesAt } = clock.intake;
  const left = changesAt ? formatCountdown(Date.parse(changesAt) - now) : undefined;
  if (!schedule) {
    return { headline: clock.intake.open ? "Reporting is open." : "Reporting is closed.", details: [] };
  }
  const endAt = clock.personal_end_at ?? schedule.ends_at;
  const closes = new Date(Date.parse(endAt) + schedule.grace_minutes * 60_000).toISOString();
  const details: string[] = [];
  const startNote = viewerNote(schedule.starts_at, zone, "time");
  switch (reason) {
    case "before_start":
      if (left) details.push(`Opens in ${left}.`);
      if (startNote) details.push(`${startNote}.`);
      return { headline: `Reporting opens at ${stamp(schedule.starts_at, zone, now)}.`, details, countdown: left };
    case "running": {
      if (clock.extra_minutes > 0) {
        details.push(
          `Your end time is ${stamp(endAt, zone, now)}. It includes ${clock.extra_minutes} minutes that staff confirmed as applied.`,
        );
      } else {
        details.push(`The contest ends at ${stamp(endAt, zone, now)}.`);
      }
      if (schedule.grace_minutes > 0) details.push(`Reporting stays open ${schedule.grace_minutes} minutes after that.`);
      const note = viewerNote(endAt, zone, "time");
      if (note) details.push(`${note}.`);
      return { headline: `Ends in ${left ?? ""}`.trim(), details, countdown: left };
    }
    case "grace":
      details.push(`The contest ended at ${stamp(endAt, zone, now)}. Reporting closes at ${stamp(closes, zone, now)}.`);
      return { headline: `Reporting closes in ${left ?? ""}`.trim(), details, countdown: left };
    case "ended":
      return {
        headline: `Reporting closed at ${stamp(closes, zone, now)}.`,
        details: [`The contest ended at ${stamp(endAt, zone, now)}.`],
      };
    case "override_open":
      return { headline: "Reporting is open. The organizers are holding it open.", details: [] };
    case "override_closed":
      return { headline: closedByHand, details: [] };
  }
}

/** Why the viewer cannot report now. Undefined while reporting is open. */
export function closedMessage(clock: ContestClock | null | undefined, now: number): string | undefined {
  if (!clock || clock.intake.open) return undefined;
  switch (clock.intake.reason) {
    case "before_start":
    case "ended":
      return clockText(clock, now).headline;
    default:
      return "Reporting is closed by the organizers.";
  }
}
