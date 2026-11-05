import { afterEach, describe, expect, it, vi } from "vitest";
import { boundaryDelay } from "./hooks/refreshSchedule";
import { clockText, closedMessage, closesAt } from "./contestClock";
import type { ContestClock } from "./model";

const schedule = {
  starts_at: "2026-11-03T05:00:00.000Z",
  ends_at: "2026-11-03T10:00:00.000Z",
  grace_minutes: 15,
};

function clock(overrides: Partial<ContestClock> & { reason: ContestClock["intake"]["reason"] }): ContestClock {
  const { reason, ...rest } = overrides;
  return {
    time_zone: "Asia/Singapore",
    schedule,
    follows_schedule: true,
    intake: { open: reason === "running" || reason === "grace" || reason === "override_open", reason, changes_at: null },
    personal_end_at: schedule.ends_at,
    extra_minutes: 0,
    ...rest,
  };
}

const at = (iso: string) => Date.parse(iso);

/** Pins the zone that the viewer's device reports, so no test depends on the host zone. */
function viewerIn(zone: string) {
  const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...resolved.call(this), timeZone: zone };
  });
}

afterEach(() => vi.restoreAllMocks());

describe("clockText", () => {
  it("names the opening time in the event zone before the start", () => {
    const text = clockText(
      clock({ reason: "before_start", intake: { open: false, reason: "before_start", changes_at: schedule.starts_at } }),
      at("2026-11-03T04:00:00.000Z"),
    );
    // 05:00Z is 13:00 in Singapore.
    expect(text.headline).toMatch(/^Reporting opens at .*13:00\.$/);
    expect(text.countdown).toBe("1:00:00");
  });

  const running = () => clock({ reason: "running", intake: { open: true, reason: "running", changes_at: schedule.ends_at } });

  it("counts down to the end while the contest runs, with no extra line for a viewer in the event zone", () => {
    viewerIn("Asia/Singapore");
    const text = clockText(running(), at("2026-11-03T08:17:50.000Z"));
    expect(text.headline).toBe("Ends in 1:42:10");
    expect(text.details).toEqual([
      expect.stringMatching(/^The contest ends at .*18:00\.$/),
      "Reporting stays open 15 minutes after that.",
    ]);
  });

  it("adds the viewer's own time for a viewer in another zone", () => {
    viewerIn("America/New_York");
    const text = clockText(running(), at("2026-11-03T08:17:50.000Z"));
    expect(text.headline).toBe("Ends in 1:42:10");
    // 10:00Z is 05:00 in New York.
    expect(text.details).toEqual([
      expect.stringMatching(/^The contest ends at .*18:00\.$/),
      "Reporting stays open 15 minutes after that.",
      expect.stringMatching(/^Your time: .*05:00\.$/),
    ]);
  });

  it("tells a contestant the personal end time and that staff confirmed the minutes", () => {
    const personal = "2026-11-03T10:10:00.000Z";
    const text = clockText(
      clock({
        reason: "running",
        personal_end_at: personal,
        extra_minutes: 10,
        intake: { open: true, reason: "running", changes_at: personal },
      }),
      at("2026-11-03T09:00:00.000Z"),
    );
    expect(text.details[0]).toMatch(/^Your end time is .*18:10\. It includes 10 minutes that staff confirmed as applied\.$/);
  });

  it("says when reporting closes during grace and when it closed", () => {
    const grace = clockText(
      clock({ reason: "grace", intake: { open: true, reason: "grace", changes_at: "2026-11-03T10:15:00.000Z" } }),
      at("2026-11-03T10:07:00.000Z"),
    );
    expect(grace.headline).toBe("Reporting closes in 8:00");
    expect(grace.details[0]).toMatch(/ended at .*18:00\. Reporting closes at .*18:15\./);
    const ended = clockText(clock({ reason: "ended" }), at("2026-11-03T11:00:00.000Z"));
    expect(ended.headline).toMatch(/^Reporting closed at .*18:15\.$/);
    expect(ended.countdown).toBeUndefined();
  });

  it("says that organizers hold intake by hand", () => {
    expect(clockText(clock({ reason: "override_open" }), 0).headline).toMatch(/holding it open/);
    expect(clockText(clock({ reason: "override_closed" }), 0).headline).toBe("Reporting is closed by the organizers.");
  });

  it("shows only open or closed for a contest with no schedule", () => {
    const none = clock({ reason: "override_closed", schedule: null, personal_end_at: null, follows_schedule: false });
    expect(clockText(none, 0)).toEqual({ headline: "Reporting is closed.", details: [] });
  });
});

describe("closedMessage and closesAt", () => {
  it("returns a message only while intake is closed", () => {
    expect(closedMessage(clock({ reason: "running" }), 0)).toBeUndefined();
    expect(closedMessage(null, 0)).toBeUndefined();
    expect(closedMessage(clock({ reason: "before_start" }), at("2026-11-03T04:00:00.000Z"))).toMatch(/^Reporting opens at .*13:00\.$/);
    expect(closedMessage(clock({ reason: "ended" }), at("2026-11-03T11:00:00.000Z"))).toMatch(/^Reporting closed at .*18:15\.$/);
    expect(closedMessage(clock({ reason: "override_closed" }), 0)).toBe("Reporting is closed by the organizers.");
    expect(closedMessage(clock({ reason: "awaiting_live_passwords" }), 0)).toBe("Reporting opens when every team has its live password.");
  });

  it("adds grace to the personal end", () => {
    expect(closesAt(clock({ reason: "ended", personal_end_at: "2026-11-03T10:10:00.000Z" }))).toBe("2026-11-03T10:25:00.000Z");
    expect(closesAt(clock({ reason: "ended", schedule: null }))).toBeUndefined();
  });
});

describe("boundaryDelay", () => {
  const boundary = "2026-11-03T10:00:00.000Z";

  it("waits for the boundary in server time, then adds up to 15 seconds", () => {
    const now = at("2026-11-03T09:59:00.000Z");
    expect(boundaryDelay(boundary, now, 0, () => 0)).toBe(60_000);
    expect(boundaryDelay(boundary, now, 0, () => 1)).toBe(75_000);
    // A device clock that runs 5 seconds behind the server reaches the boundary 5 seconds sooner.
    expect(boundaryDelay(boundary, now, 5_000, () => 0)).toBe(55_000);
  });

  it("refreshes at once when the boundary has passed, and waits for none while an override holds", () => {
    expect(boundaryDelay(boundary, at("2026-11-03T10:30:00.000Z"), 0, () => 0)).toBe(0);
    expect(boundaryDelay(null, 0, 0)).toBeUndefined();
    expect(boundaryDelay(undefined, 0, 0)).toBeUndefined();
  });

  it("leaves a boundary beyond the timer limit to the periodic refresh", () => {
    expect(boundaryDelay("2027-11-03T10:00:00.000Z", at("2026-11-03T10:00:00.000Z"), 0, () => 0)).toBeUndefined();
  });
});
