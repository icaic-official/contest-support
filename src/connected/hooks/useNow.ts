import { type RefObject, useEffect, useState } from "react";

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
