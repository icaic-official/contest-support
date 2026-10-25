/** Refresh period while no live channel reports changes. */
export const DISCONNECTED_REFRESH_MS = 60_000;
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
