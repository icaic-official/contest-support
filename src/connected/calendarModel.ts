import type { ContestSummary } from "@/backend/contracts";
import { zonedParts } from "./zonedTime";

/** A contest that has a schedule. */
export type ScheduledContest = ContestSummary & { schedule: NonNullable<ContestSummary["schedule"]> };

/** One day of one event, in the event's time zone. */
export interface CalendarDay {
  /** `YYYY-MM-DD` in the event's zone. */
  date: string;
  /** The first contest's start, which formats the day's heading. */
  instant: string;
  contests: ScheduledContest[];
}

export interface CalendarEvent {
  eventId: string;
  eventName: string;
  timeZone: string;
  days: CalendarDay[];
}

/**
 * Groups scheduled contests by event, then by the day they start in the event's
 * time zone, in start order. Events keep the order of their first contest.
 * Contests without a schedule are left out. The calendar lists only scheduled contests.
 */
export function groupCalendar(contests: readonly ContestSummary[]): CalendarEvent[] {
  const scheduled = contests
    .filter((contest): contest is ScheduledContest => contest.schedule !== null)
    .sort((a, b) => a.schedule.startsAt.localeCompare(b.schedule.startsAt) || a.id.localeCompare(b.id));
  const events = new Map<string, CalendarEvent>();
  for (const contest of scheduled) {
    let event = events.get(contest.eventId);
    if (!event) {
      event = { eventId: contest.eventId, eventName: contest.eventName, timeZone: contest.timeZone, days: [] };
      events.set(contest.eventId, event);
    }
    const date = zonedParts(contest.schedule.startsAt, contest.timeZone).date;
    let day = event.days.find((item) => item.date === date);
    if (!day) {
      day = { date, instant: contest.schedule.startsAt, contests: [] };
      event.days.push(day);
    }
    day.contests.push(contest);
  }
  return [...events.values()];
}

const dayMs = 86_400_000;

/**
 * The calendar window for a page of seven days. Page 0 starts at the beginning
 * of today on the viewer's device. A contest that started earlier and still runs
 * overlaps the window, so it shows.
 */
export function calendarWindow(page: number, now: number): { from: string; to: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const from = start.getTime() + page * 7 * dayMs;
  return { from: new Date(from).toISOString(), to: new Date(from + 7 * dayMs).toISOString() };
}
