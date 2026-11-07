import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import type { ContestSummary } from "@/backend/contracts";
import { can, seatOf } from "./capabilities";
import type { Membership } from "./model";

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

/** The webmasters' site page. It belongs to no contest. */
export const sitePath = "/site";

/** The event console. `/event` opens the caller's own event, `/event/<id>` a named one. */
export const eventBase = "/event";

export function eventPath(eventId?: string): string {
  return eventId === undefined ? eventBase : `${eventBase}/${eventId}`;
}

/** The event console that an address names, or undefined for any other address. */
export function eventRouteOf(pathname: string): { eventId: string | undefined } | undefined {
  const match = /^\/event(?:\/([0-9a-f-]{36}))?\/?$/u.exec(pathname);
  return match ? { eventId: match[1] } : undefined;
}

const contestParam = "contest";

/** The contest that an address names with `?contest=`, or undefined when it names none. */
export function contestOfSearch(search: string): string | undefined {
  return new URLSearchParams(search).get(contestParam) || undefined;
}

/** The search text with `?contest=` set to this contest. Every other parameter stays. */
export function searchWithContest(search: string, contestId: string): string {
  const params = new URLSearchParams(search);
  params.set(contestParam, contestId);
  return `?${params}`;
}

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
  const seat = seatOf(member);
  if (seat?.kind === "contestant") return false;
  if (page === "awards") return can(seat, "award");
  if (
    page === "overview" ||
    page === "accounts" ||
    page === "roster" ||
    page === "settings"
  ) {
    return can(seat, "configure_contest");
  }
  if (page === "mine" || page === "handoffs") return can(seat, "claim");
  return true;
}

/**
 * Whether the site page or an event console may open for this person, as far
 * as the contest list tells. An event admin lists every contest of the event
 * and a webmaster lists the contests that the site setting lets them read, each
 * with the person's `manage` level. A list where no contest has the level
 * `event` or `site` means that the person holds neither, so the page never
 * downloads the staff screen. An empty list tells nothing: a webmaster who has
 * joined no contest, or an event admin whose event has none, has one. The
 * screen's own read decides then, and the server refuses everyone else.
 *
 * - `wait`: the first read of the list has not ended.
 * - `deny`: the person has neither level.
 * - `open`: show the screen.
 *
 * `read` says that a read has ended, and a non-empty list needs no more. The
 * session hook publishes the list before it reads the snapshot, and it sends no
 * snapshot read for an empty list. So the wait is never on a snapshot.
 */
export function levelScreenAccess(
  contests: readonly Pick<ContestSummary, "manage">[],
  read: boolean,
): "wait" | "deny" | "open" {
  if (contests.length === 0) return read ? "open" : "wait";
  return contests.some(({ manage }) => manage === "event" || manage === "site") ? "open" : "deny";
}

/** Router state that asks the next page to focus one control. */
interface FocusRequest {
  focusId: string;
  /** Tells two requests for the same control apart. */
  token: string;
}

/** The state to pass to `navigate` so that the page focuses the control with this ID. */
export function focusRequest(focusId: string): FocusRequest {
  return { focusId, token: crypto.randomUUID() };
}

/** The focus request that the location asks for, if any. */
export function requestedFocus(state: unknown): FocusRequest | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const { focusId, token } = state as Partial<Record<keyof FocusRequest, unknown>>;
  return typeof focusId === "string" && typeof token === "string" ? { focusId, token } : undefined;
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
    let focused = false;
    const frame = window.requestAnimationFrame(() => {
      focused = true;
      previous.current = pathname;
      document.getElementById(headingId)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      // A quick Back or Forward can return to the earlier address before this
      // frame runs. Its heading was replaced since the last focus, so the
      // earlier address needs focus again.
      if (!focused) previous.current = undefined;
    };
  }, [hash, headingId, pathname, ready]);
}
