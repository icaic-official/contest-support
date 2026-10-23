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
  settings: "/administration/settings",
  account: "/account",
} as const;

export type WorkspacePage = keyof typeof workspacePaths;

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
  if (page === "overview" || page === "accounts" || page === "settings") {
    return member.is_admin;
  }
  if (page === "mine" || page === "handoffs") return isSupport(member);
  return true;
}

/** Moves focus after navigation, including browser Back and Forward. */
export function useRouteFocus(headingId: string, ready: boolean): void {
  const { pathname } = useLocation();
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!ready || previous.current === pathname) return;
    // Menus restore trigger focus when they close. Focus the new page afterward.
    const frame = window.requestAnimationFrame(() => {
      previous.current = pathname;
      document.getElementById(headingId)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [headingId, pathname, ready]);
}
