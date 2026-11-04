import { describe, expect, it } from "vitest";
import type { ContestSummary } from "@/backend/contracts";
import { calendarWindow, groupCalendar } from "./calendarModel";

const intake = { open: true, reason: "running", changesAt: null } as const;

function contest(id: string, eventId: string, zone: string, startsAt: string, endsAt: string | null, canOpen = true): ContestSummary {
  return {
    id, name: `Contest ${id}`, eventId, eventName: `Event ${eventId}`, timeZone: zone, contestType: "teams",
    schedule: endsAt ? { startsAt, endsAt, graceMinutes: 0 } : null, intake, canOpen, manage: "none",
  };
}

describe("groupCalendar", () => {
  it("groups by event and by the day in the event's zone, in start order", () => {
    // 20:00Z on 3 Nov is 04:00 on 4 Nov in Singapore, and still 3 Nov in Los Angeles.
    const groups = groupCalendar([
      contest("b", "sg", "Asia/Singapore", "2026-11-03T20:00:00.000Z", "2026-11-03T22:00:00.000Z"),
      contest("a", "sg", "Asia/Singapore", "2026-11-03T01:00:00.000Z", "2026-11-03T03:00:00.000Z"),
      contest("c", "la", "America/Los_Angeles", "2026-11-03T20:00:00.000Z", "2026-11-03T22:00:00.000Z", false),
    ]);
    expect(groups.map((event) => [event.eventId, event.days.map((day) => [day.date, day.contests.map((item) => item.id)])])).toEqual([
      ["sg", [["2026-11-03", ["a"]], ["2026-11-04", ["b"]]]],
      ["la", [["2026-11-03", ["c"]]]],
    ]);
  });

  it("leaves out a contest with no schedule, and keeps a contest the person cannot open", () => {
    const groups = groupCalendar([
      contest("none", "sg", "Asia/Singapore", "", null),
      contest("closed", "sg", "Asia/Singapore", "2026-11-03T01:00:00.000Z", "2026-11-03T03:00:00.000Z", false),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.days[0]!.contests.map((item) => [item.id, item.canOpen])).toEqual([["closed", false]]);
  });
});

describe("calendarWindow", () => {
  it("covers seven days from the start of the device's day, a page at a time", () => {
    const now = new Date(2026, 10, 3, 15, 30).getTime();
    const first = calendarWindow(0, now);
    expect(new Date(first.from).getHours()).toBe(0);
    expect(Date.parse(first.to) - Date.parse(first.from)).toBe(7 * 86_400_000);
    expect(calendarWindow(1, now).from).toBe(first.to);
    expect(Date.parse(calendarWindow(-1, now).to)).toBe(Date.parse(first.from));
  });
});
