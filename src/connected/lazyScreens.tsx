import { lazy, type ReactNode, Suspense } from "react";
import { Spinner } from "@/components/ui/spinner";
import { type UiKind } from "./model";
import { preloadOrganiserLayout } from "@/organiser/layouts";

// Each role loads only its own screens. A contestant never downloads the staff
// console, and staff never download the contestant screens.
const loadContestantApp = () => import("@/contestant/ContestantApp");
const loadOrganiserApp = () => import("@/organiser/OrganiserApp");
export const ContestantApp = lazy(() =>
  loadContestantApp().then((m) => ({ default: m.ContestantApp })),
);
export const OrganiserApp = lazy(() =>
  loadOrganiserApp().then((m) => ({ default: m.OrganiserApp })),
);
export const EventConsolePage = lazy(() =>
  import("@/event/EventConsole").then((m) => ({ default: m.EventConsolePage })),
);
export const SiteDashboard = lazy(() =>
  import("@/site/SiteDashboard").then((m) => ({ default: m.SiteDashboard })),
);

/** A short wait for a screen whose code is not ready. */
function ScreenWait() {
  return (
    <p
      role="status"
      className="flex items-center justify-center gap-2 p-6 text-muted-foreground"
    >
      <Spinner className="size-4" />
      Loading…
    </p>
  );
}

/** Shows a short wait while a screen's code downloads. */
export function WithScreen({ children }: { children: ReactNode }) {
  return <Suspense fallback={<ScreenWait />}>{children}</Suspense>;
}

const screenKey = "minsky-screen";

/**
 * Remembers which screens this account used last on this device, so its next
 * visit can download them early. The record names its account, because a
 * device can pass from an organiser to a contestant.
 */
export function rememberScreen(account: string, kind: UiKind): void {
  try {
    window.localStorage.setItem(screenKey, JSON.stringify({ account, kind }));
  } catch {
    // Without storage the next visit downloads the screens after the sign-in check.
  }
}

/** The screens that `account` used last, or nothing when the record is another person's or is not a record. */
function rememberedKind(account: string): unknown {
  try {
    const record: unknown = JSON.parse(window.localStorage.getItem(screenKey) ?? "null");
    if (typeof record === "object" && record !== null && "account" in record && record.account === account && "kind" in record) {
      return record.kind;
    }
  } catch {
    // Storage is unavailable, or an earlier release wrote a bare word that is not JSON.
  }
  return undefined;
}

/**
 * Starts the download of the screens that `account` used last. Call it when the
 * session check names the account, so the download runs while the browser
 * checks the account and reads the session, not after. Before that the device
 * knows nobody: the screens of an earlier person would reach the next one.
 */
export function preloadRememberedScreen(account: string): void {
  const kind = rememberedKind(account);
  if (kind === "contestant") void loadContestantApp();
  else if (kind === "organiser") {
    void loadOrganiserApp();
    preloadOrganiserLayout();
  }
}
