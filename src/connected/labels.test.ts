import { describe, expect, it } from "vitest";
import { relativeAge } from "./labels";

describe("relativeAge", () => {
  it("formats minutes and hours", () => {
    const start = "2026-10-17T10:00:00Z";
    expect(relativeAge(start, Date.parse("2026-10-17T10:00:30Z"))).toBe("now");
    expect(relativeAge(start, Date.parse("2026-10-17T10:09:00Z"))).toBe("9m ago");
    expect(relativeAge(start, Date.parse("2026-10-17T12:05:00Z"))).toBe("2h 5m ago");
  });
});
