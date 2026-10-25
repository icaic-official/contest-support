import { describe, expect, it } from "vitest";
import {
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
