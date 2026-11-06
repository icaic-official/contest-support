import { useCallback, useSyncExternalStore } from "react";

/** Viewports at least this wide get the desktop layouts. Narrower ones get phone layouts. */
export const desktopQuery = "(min-width: 1024px)";

/** Returns true while the CSS media query matches. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
  );
}
