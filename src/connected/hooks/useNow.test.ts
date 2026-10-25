import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./useNow";

// A server render runs the first render and no effects, so it shows the value
// that the first paint after a refresh would show, before any timer tick.
function firstRender(clockOffset: { current: number }): number {
  function Clock() {
    return String(useNow(clockOffset));
  }
  return Number(renderToString(createElement(Clock)));
}

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-25T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["behind the server", 90_000],
    ["ahead of the server", -90_000],
  ])("starts at server time when the device clock is %s", (_, offset) => {
    expect(firstRender({ current: offset })).toBe(Date.now() + offset);
  });
});
