import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTED_REFRESH_MS,
  DISCONNECTED_REFRESH_MS,
  startRefreshSchedule,
} from "./refreshSchedule";

function setup(connected: boolean) {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  const refresh = vi.fn();
  const stop = startRefreshSchedule({ refresh, connected, window, document });
  return { window, document, refresh, stop };
}

afterEach(() => vi.useRealTimers());

describe("refresh schedule", () => {
  it("refreshes every 10 seconds while the live channel is down", () => {
    vi.useFakeTimers();
    const { refresh, stop } = setup(false);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(60_000 / DISCONNECTED_REFRESH_MS);
    stop();
  });

  it("refreshes once a minute while the live channel is connected", () => {
    vi.useFakeTimers();
    const { refresh, stop } = setup(true);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(60_000 / CONNECTED_REFRESH_MS);
    stop();
  });

  it("refreshes at once on focus, return to the tab, and coming online", () => {
    vi.useFakeTimers();
    const { window, document, refresh, stop } = setup(true);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(2);
    document.visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
  });

  it("stops the timer and the listeners", () => {
    vi.useFakeTimers();
    const { window, document, refresh, stop } = setup(false);
    stop();
    vi.advanceTimersByTime(120_000);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).not.toHaveBeenCalled();
  });
});
