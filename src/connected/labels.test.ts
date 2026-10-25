import { describe, expect, it } from "vitest";
import { awardMinutesLabel, relativeAge } from "./labels";

describe("relativeAge", () => {
  it("formats minutes and hours", () => {
    const start = "2026-10-17T10:00:00Z";
    expect(relativeAge(start, Date.parse("2026-10-17T10:00:30Z"))).toBe("now");
    expect(relativeAge(start, Date.parse("2026-10-17T10:09:00Z"))).toBe("9m ago");
    expect(relativeAge(start, Date.parse("2026-10-17T12:05:00Z"))).toBe("2h 5m ago");
  });
});

describe("awardMinutesLabel", () => {
  it("names a zero-minute award as no time added", () => {
    expect(awardMinutesLabel(0)).toBe("No time added");
  });

  it("uses the singular for one minute", () => {
    expect(awardMinutesLabel(1)).toBe("1 minute");
  });

  it("uses the plural for other amounts", () => {
    expect(awardMinutesLabel(5)).toBe("5 minutes");
    expect(awardMinutesLabel(60)).toBe("60 minutes");
  });
});
