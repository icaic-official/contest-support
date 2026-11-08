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

/** Remembers which screens this device used, so the next visit can download them early. */
export function rememberScreen(kind: UiKind): void {
  try {
    window.localStorage.setItem(screenKey, kind);
  } catch {
    // Without storage the next visit downloads the screens after the sign-in check.
  }
}

/**
 * Starts the download of the screens that the last visit used. The code is
 * public, so a wrong guess only costs bytes: Workspace still loads what the
 * membership needs. The download then runs while the browser checks the
 * session, not after.
 */
export function preloadRememberedScreen(): void {
  let kind: string | null;
  try {
    kind = window.localStorage.getItem(screenKey);
  } catch {
    return;
  }
  if (kind === "contestant") void loadContestantApp();
  else if (kind === "organiser") {
    void loadOrganiserApp();
    preloadOrganiserLayout();
  }
}
