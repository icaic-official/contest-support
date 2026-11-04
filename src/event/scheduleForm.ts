import { GRACE_MINUTES_MAX, type Schedule } from "@/backend/contracts";
import { formatInZone, viewerNote, zonedParts, zonedWallTime } from "@/connected/zonedTime";

/** What an event admin types for a schedule: wall times in the event's zone. */
export interface ScheduleDraft {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  /** Text, so the field can be empty while typing. */
  grace: string;
}

/** The draft of a stored schedule, in the event's zone. */
export function draftOf(schedule: Schedule, timeZone: string): ScheduleDraft {
  const start = zonedParts(schedule.startsAt, timeZone);
  const end = zonedParts(schedule.endsAt, timeZone);
  return {
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    grace: String(schedule.graceMinutes),
  };
}

/** A new contest starts as a draft on today's date, 09:00 to 11:00, with no grace. */
export function emptyDraft(timeZone: string, now = Date.now()): ScheduleDraft {
  const today = zonedParts(new Date(now).toISOString(), timeZone).date;
  return { startDate: today, startTime: "09:00", endDate: today, endTime: "11:00", grace: "0" };
}

/** The schedule that a draft names, or the problem to show. */
export function scheduleOfDraft(
  draft: ScheduleDraft,
  timeZone: string,
): { schedule: Schedule } | { problem: string } {
  const startsAt = zonedWallTime(draft.startDate, draft.startTime, timeZone);
  const endsAt = zonedWallTime(draft.endDate, draft.endTime, timeZone);
  if (!startsAt) return { problem: "Choose a start date and time." };
  if (!endsAt) return { problem: "Choose an end date and time." };
  if (endsAt <= startsAt) return { problem: "The contest must end after it starts." };
  const grace = Number(draft.grace);
  if (draft.grace.trim() === "" || !Number.isInteger(grace) || grace < 0 || grace > GRACE_MINUTES_MAX) {
    return { problem: `Grace is a whole number of minutes from 0 to ${GRACE_MINUTES_MAX}.` };
  }
  return { schedule: { startsAt, endsAt, graceMinutes: grace } };
}

export function sameSchedule(a: Schedule | null, b: Schedule): boolean {
  return !!a && a.startsAt === b.startsAt && a.endsAt === b.endsAt && a.graceMinutes === b.graceMinutes;
}

/**
 * The schedule in words, in the event's zone: "Tue 3 Nov, 13:00 to 18:00, 15 min grace".
 * A contest that ends on another day names that day too.
 */
export function describeSchedule(schedule: Schedule, timeZone: string): string {
  const sameDay = zonedParts(schedule.startsAt, timeZone).date === zonedParts(schedule.endsAt, timeZone).date;
  const range = sameDay
    ? `${formatInZone(schedule.startsAt, timeZone, "datetime")} to ${formatInZone(schedule.endsAt, timeZone, "time")}`
    : `${formatInZone(schedule.startsAt, timeZone, "datetime")} to ${formatInZone(schedule.endsAt, timeZone, "datetime")}`;
  return schedule.graceMinutes > 0 ? `${range}, ${schedule.graceMinutes} min grace` : range;
}

/** The viewer's own time for the start, when the viewer's zone differs from the event's. */
export function startViewerNote(schedule: Schedule, timeZone: string): string | undefined {
  return viewerNote(schedule.startsAt, timeZone, "datetime");
}
