import { type RefObject, useEffect } from "react";

/** Reads again when the window regains focus or the tab becomes visible, unless a command is running. */
export function useRefreshOnReturn(reload: () => Promise<void>, running: RefObject<boolean>): void {
  useEffect(() => {
    const refresh = () => {
      if (!running.current && document.visibilityState === "visible") void reload();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload, running]);
}

/** After a change removed the focused control, moves focus to the page heading instead of the page body. */
export function keepFocus(): void {
  requestAnimationFrame(() => {
    if (document.activeElement === document.body) document.querySelector<HTMLElement>("h1[tabindex]")?.focus();
  });
}
