import { describe, expect, it } from "vitest";
import {
  awardMinutesLabel,
  noCommentSummary,
  parseAwardMinutes,
  relativeAge,
  resolutionSummary,
} from "./labels";

describe("relativeAge", () => {
  it("formats minutes and hours", () => {
    const start = "2026-10-17T10:00:00Z";
    expect(relativeAge(start, Date.parse("2026-10-17T10:00:30Z"))).toBe("now");
    expect(relativeAge(start, Date.parse("2026-10-17T10:09:00Z"))).toBe("9m ago");
    expect(relativeAge(start, Date.parse("2026-10-17T12:05:00Z"))).toBe("2h 5m ago");
  });
});

describe("resolutionSummary", () => {
  it("adds an optional comment to a preset", () => {
    expect(resolutionSummary("Service restored", "", "")).toBe("Service restored");
    expect(resolutionSummary("Service restored", "", "  Swapped the hub.  ")).toBe(
      "Service restored: Swapped the hub.",
    );
  });

  it("ignores a comment on the no-comment preset", () => {
    expect(resolutionSummary(noCommentSummary, "", "Left over")).toBe(noCommentSummary);
  });

  it("uses only the custom text for a custom summary", () => {
    expect(resolutionSummary("custom", " Own words ", "unused")).toBe("Own words");
    expect(resolutionSummary("custom", "  ", "")).toBe("");
  });

  it("has no summary before a choice", () => {
    expect(resolutionSummary("", "", "comment")).toBe("");
  });
});

describe("parseAwardMinutes", () => {
  it("accepts whole minutes from zero to the database limit", () => {
    expect(parseAwardMinutes("0")).toBe(0);
    expect(parseAwardMinutes(" 12 ")).toBe(12);
    expect(parseAwardMinutes("2147483647")).toBe(2147483647);
  });

  it.each(["", "2.5", "2.0", "1e3", "-1", "+5", "5 min", "2147483648", "٣"])(
    "rejects %j",
    (text) => {
      expect(parseAwardMinutes(text)).toBeUndefined();
    },
  );
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
