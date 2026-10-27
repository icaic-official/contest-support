import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { isSupport, type Membership } from "./model";

/** Shared addresses for the contestant, phone, and desktop screens. */
export const workspacePaths = {
  queue: "/issues",
  mine: "/issues/mine",
  handoffs: "/issues/handoffs",
  teams: "/issues/teams",
  awards: "/jury",
  overview: "/administration",
  accounts: "/administration/accounts",
  roster: "/administration/roster",
  settings: "/administration/settings",
  account: "/account",
} as const;

export type WorkspacePage = keyof typeof workspacePaths;

/** The sign-in page. The landing page at `/` links here. */
export const signInPath = "/sign-in";

/** True for the signed-out entry addresses, which a signed-in person leaves for the queue. */
export function isEntryPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/u, "");
  return path === "" || path === signInPath;
}

export function pageForPath(pathname: string): WorkspacePage | undefined {
  const path = pathname.replace(/\/+$/u, "");
  for (const page of Object.keys(workspacePaths) as WorkspacePage[]) {
    if (workspacePaths[page] === path) return page;
  }
  return undefined;
}

/** Backend permissions remain authoritative for every read and write. */
export function canOpenPage(page: WorkspacePage, member: Membership): boolean {
  if (page === "queue" || page === "account") return true;
  if (member.team_id) return false;
  if (page === "awards") return member.roles.includes("jury");
  if (
    page === "overview" ||
    page === "accounts" ||
    page === "roster" ||
    page === "settings"
  ) {
    return member.is_admin;
  }
  if (page === "mine" || page === "handoffs") return isSupport(member);
  return true;
}

/** Router state that asks the next page to focus one control. */
interface FocusRequest {
  focusId: string;
}

/** The state to pass to `navigate` so that the page focuses the control with this ID. */
export function focusRequest(focusId: string): FocusRequest {
  return { focusId };
}

/** The control that the location asks the page to focus, if any. */
export function requestedFocusId(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null || !("focusId" in state)) {
    return undefined;
  }
  return typeof state.focusId === "string" ? state.focusId : undefined;
}

/**
 * Moves focus after navigation, including browser Back and Forward. An
 * address with a fragment, such as `/account#security`, names a place inside
 * the page. The page then moves focus itself.
 */
export function useRouteFocus(headingId: string, ready: boolean): void {
  const { pathname, hash } = useLocation();
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!ready || previous.current === pathname) return;
    if (hash) {
      previous.current = pathname;
      return;
    }
    // Menus restore trigger focus when they close. Focus the new page afterward.
    const frame = window.requestAnimationFrame(() => {
      previous.current = pathname;
      document.getElementById(headingId)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hash, headingId, pathname, ready]);
}
