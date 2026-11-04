import { describe, expect, it } from "vitest";
import { formatCountdown, formatInZone, viewerNote, zonedParts, zonedWallTime } from "./zonedTime";

describe("zonedWallTime", () => {
  it("converts a plain wall time in a zone without daylight saving", () => {
    expect(zonedWallTime("2026-11-03", "09:00", "Asia/Singapore")).toBe("2026-11-03T01:00:00.000Z");
    expect(zonedWallTime("2026-11-03", "09:00", "UTC")).toBe("2026-11-03T09:00:00.000Z");
  });

  it("moves a time that a spring-forward gap skips to the first valid minute after it", () => {
    // 02:30 on 2026-03-08 does not exist in New York. Clocks jump from 02:00 EST to 03:00 EDT.
    expect(zonedWallTime("2026-03-08", "02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
    expect(zonedParts("2026-03-08T07:30:00.000Z", "America/New_York")).toEqual({ date: "2026-03-08", time: "03:30" });
  });

  it("takes the earlier instant for a time that a fall-back overlap repeats", () => {
    // 01:30 on 2026-11-01 happens in EDT (05:30Z) and again in EST (06:30Z).
    expect(zonedWallTime("2026-11-01", "01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });

  it("uses the right offset on both sides of a change", () => {
    expect(zonedWallTime("2026-03-07", "12:00", "America/New_York")).toBe("2026-03-07T17:00:00.000Z");
    expect(zonedWallTime("2026-03-09", "12:00", "America/New_York")).toBe("2026-03-09T16:00:00.000Z");
  });

  it("refuses text that is not a date and a time", () => {
    expect(zonedWallTime("2026-02-30", "09:00", "UTC")).toBeUndefined();
    expect(zonedWallTime("2026-11-03", "24:00", "UTC")).toBeUndefined();
    expect(zonedWallTime("tomorrow", "09:00", "UTC")).toBeUndefined();
  });
});

describe("zonedParts and formatInZone", () => {
  it("round-trips an instant through its zone", () => {
    const instant = "2026-11-04T01:30:00.000Z";
    const { date, time } = zonedParts(instant, "Asia/Singapore");
    expect({ date, time }).toEqual({ date: "2026-11-04", time: "09:30" });
    expect(zonedWallTime(date, time, "Asia/Singapore")).toBe(instant);
  });

  it("shows the wall time of the zone, not of the device", () => {
    expect(formatInZone("2026-11-04T01:30:00.000Z", "Asia/Singapore", "time")).toMatch(/09:30/);
    expect(formatInZone("2026-11-04T01:30:00.000Z", "America/Los_Angeles", "time")).toMatch(/17:30/);
  });
});

describe("viewerNote", () => {
  it("adds nothing when the viewer's zone shows the same wall time", () => {
    expect(viewerNote("2026-11-04T01:30:00.000Z", "Asia/Singapore", "time", "Asia/Kuala_Lumpur")).toBeUndefined();
  });

  it("shows the viewer's own time when the zones differ", () => {
    expect(viewerNote("2026-11-04T01:30:00.000Z", "Asia/Singapore", "time", "America/Los_Angeles")).toMatch(/Your time: .*17:30/);
  });
});

describe("formatCountdown", () => {
  it("shows hours only when needed", () => {
    expect(formatCountdown(6_130_000)).toBe("1:42:10");
    expect(formatCountdown(65_000)).toBe("1:05");
    expect(formatCountdown(-5)).toBe("0:00");
  });
});
