/** Refresh period while no live channel reports changes. */
export const DISCONNECTED_REFRESH_MS = 10_000;
/**
 * Safety refresh period while the live channel is connected. Live hints carry
 * every issue and announcement change. This period only bounds how late the
 * client sees what sends no hint: a picture change, an announcement expiry,
 * and an organizer password reset.
 */
export const CONNECTED_REFRESH_MS = 60_000;

interface Source {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface RefreshScheduleOptions {
  refresh: () => void;
  /** True while the live channel is connected. */
  connected: boolean;
  window: Source;
  document: Source & { readonly visibilityState: string };
}

/**
 * Calls refresh on a timer. The timer is slow while the live channel is
 * connected and fast otherwise. Refresh also runs when the window gets focus,
 * the tab becomes visible, or the browser comes back online. Returns a
 * function that stops it.
 */
export function startRefreshSchedule(options: RefreshScheduleOptions): () => void {
  const { refresh, connected, window, document } = options;
  const timer = setInterval(
    refresh,
    connected ? CONNECTED_REFRESH_MS : DISCONNECTED_REFRESH_MS,
  );
  const wake = () => refresh();
  const visible = () => {
    if (document.visibilityState === "visible") refresh();
  };
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", visible);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", wake);
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", visible);
  };
}

/** The longest random delay after a time boundary, so 800 clients do not read in the same second. */
export const BOUNDARY_JITTER_MS = 15_000;
/** The longest delay that a browser timer accepts. */
const TIMER_MAX_MS = 2 ** 31 - 1;

/**
 * Milliseconds until a refresh at the next time boundary, or undefined when
 * there is none to wait for. The boundary is server time, so the clock offset
 * moves it into local time. A random delay of up to 15 seconds follows it.
 * The server's gate stays authoritative. This read only updates what the
 * browser shows.
 */
export function boundaryDelay(
  changesAt: string | null | undefined,
  now: number,
  clockOffset: number,
  random: () => number = Math.random,
): number | undefined {
  if (!changesAt) return undefined;
  const delay = Date.parse(changesAt) - (now + clockOffset) + random() * BOUNDARY_JITTER_MS;
  return delay > TIMER_MAX_MS ? undefined : Math.max(0, delay);
}
