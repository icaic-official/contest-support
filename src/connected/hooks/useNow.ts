import { type RefObject, useEffect, useState, useSyncExternalStore } from "react";

/**
 * Returns the current time and updates it every second. Pass the server clock
 * offset from useSessionSnapshot so timers match the server's timestamps.
 */
export function useNow(clockOffset?: Readonly<RefObject<number>>): number {
  const [now, setNow] = useState(() => Date.now() + (clockOffset?.current ?? 0));
  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(Date.now() + (clockOffset?.current ?? 0)),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [clockOffset]);
  return now;
}

// One timer serves every component that calls `useTick`, so a long list of
// timers costs one interval, and each timer renders alone.
const tickListeners = new Set<() => void>();
let tickTime = Date.now();
let tickTimer: number | undefined;

function subscribeToTick(listener: () => void): () => void {
  if (tickListeners.size === 0) {
    tickTime = Date.now();
    tickTimer = window.setInterval(() => {
      tickTime = Date.now();
      for (const notify of tickListeners) notify();
    }, 1000);
  }
  tickListeners.add(listener);
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0) window.clearInterval(tickTimer);
  };
}

/**
 * The local time of the last tick, once a second. Add the server clock offset
 * to get server time. Use it in a small component that shows a clock, so only
 * that component renders each second.
 */
export function useTick(): number {
  return useSyncExternalStore(subscribeToTick, () => tickTime);
}
