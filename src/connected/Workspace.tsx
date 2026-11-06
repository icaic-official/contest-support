import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { BuildId } from "@/components/build-id";
import { RenderErrorBoundary } from "@/components/render-error-boundary";
import { Button } from "@/components/ui/button";
import { ContestantApp } from "@/contestant/ContestantApp";
import { OrganiserApp } from "@/organiser/OrganiserApp";
import { NoSessionAccess } from "@/screens/NoSessionAccess";
import { Announcements } from "./Announcements";
import { AvatarProvider } from "./Avatars";
import { useCommand } from "./hooks/useCommand";
import { useSessionSnapshot } from "./hooks/useSessionSnapshot";
import { type UiKind, uiKindFor } from "./model";
import type { ShellProps } from "./shell";
import { canOpenPage, eventPath, eventRouteOf, isEntryPath, pageForPath, sitePath } from "./navigation";
import { EventConsolePage } from "@/event/EventConsole";
import { useNoContestLanding } from "@/event/useOwnEvent";
import { SiteDashboard } from "@/site/SiteDashboard";

/**
 * Loads the session data and selects the UI from the membership: team
 * accounts get the contestant UI, everyone else gets the organiser UI.
 *
 * The last selected UI stays mounted while a refresh error or a session
 * change removes the snapshot, so its forms and selection survive. The shell
 * then shows NoSessionAccess itself.
 */
export function Workspace({
  onLiveChange,
  ...props
}: Omit<ShellProps, "data"> & {
  /** Reports whether the live update channel is connected. */
  onLiveChange: (live: boolean) => void;
}) {
  const { pathname } = useLocation();
  const data = useSessionSnapshot(props.user.id);
  const { connected } = data;
  useEffect(() => {
    onLiveChange(connected);
    return () => onLiveChange(false);
  }, [connected, onLiveChange]);
  const membership = data.snapshot?.membership;
  const current = membership ? uiKindFor(membership) : undefined;
  const [kind, setKind] = useState<UiKind>();
  if (current && current !== kind) setKind(current);
  const page = pageForPath(pathname);
  // A webmaster with no readable contest, or an event admin whose event has no contest yet, has nothing else to open.
  const noContest = data.loaded && !data.snapshot && data.sessions.length === 0 && !data.refreshError;
  const landing = useNoContestLanding(noContest);
  const eventRoute = eventRouteOf(pathname);
  if (eventRoute) {
    return (
      <EventConsolePage
        key={eventRoute.eventId ?? ""}
        eventId={eventRoute.eventId}
        user={props.user}
        signOut={props.signOut}
        hasContests={data.sessions.length > 0}
      />
    );
  }
  if (noContest && landing === "event") return <Navigate to={eventPath()} replace />;
  if (noContest && landing === "site" && pathname.replace(/\/+$/u, "") !== sitePath) {
    return <Navigate to={sitePath} replace />;
  }
  // The site page needs no readable contest, so a webmaster who must join
  // first can still reach the setting that asks for the join.
  if (pathname.replace(/\/+$/u, "") === sitePath) {
    return <SiteDashboard user={props.user} data={data} signOut={props.signOut} />;
  }
  if (isEntryPath(pathname)) return <Navigate to="/issues" replace />;
  if (!page) {
    return (
      <div className="flex flex-col items-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <Button asChild>
          <Link to="/issues">Issues</Link>
        </Button>
      </div>
    );
  }
  if (membership && !canOpenPage(page, membership)) {
    return <Navigate to="/issues" replace />;
  }
  const shown = current ?? kind;
  const app =
    shown === "contestant" ? (
      <ContestantApp {...props} data={data} />
    ) : shown === "organiser" ? (
      <OrganiserApp {...props} data={data} />
    ) : undefined;
  if (!app) return <SessionAccess {...props} data={data} />;
  // Announcements and pictures read independently, so the UI below never waits for them.
  return (
    <AvatarProvider data={data} userId={props.user.id}>
      <div className="flex h-dvh flex-col">
        {/* Drafts and prompts belong to one session. */}
        <Announcements key={data.sessionId} data={data} />
        {/* A crash in one UI keeps the announcements and build id visible. */}
        <div className="min-h-0 flex-1">
          <RenderErrorBoundary scope="region" resetKey={pathname}>
            {app}
          </RenderErrorBoundary>
        </div>
        <p className="px-4 py-0.5 text-right text-[11px] text-muted-foreground">
          <BuildId />
        </p>
      </div>
    </AvatarProvider>
  );
}

/** Keeps retries available after the account gate when no memberships remain. */
function SessionAccess(props: ShellProps) {
  const command = useCommand({
    sessionId: props.data.sessionId,
    refresh: props.data.refresh,
  });
  return (
    <NoSessionAccess
      data={props.data}
      account={props.username ?? props.user.email ?? undefined}
      signOut={props.signOut}
      error={command.error}
      onRetry={command.pending && !command.busy ? command.retry : undefined}
    />
  );
}
