import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { ContestantApp } from "@/contestant/ContestantApp";
import { OrganiserApp } from "@/organiser/OrganiserApp";
import { NoSessionAccess } from "@/screens/NoSessionAccess";
import { useCommand } from "./hooks/useCommand";
import { useSessionSnapshot } from "./hooks/useSessionSnapshot";
import { type UiKind, uiKindFor } from "./model";
import type { ShellProps } from "./shell";
import { canOpenPage, pageForPath } from "./navigation";

/**
 * Loads the session data and selects the UI from the membership: team
 * accounts get the contestant UI, everyone else gets the organiser UI.
 *
 * The last selected UI stays mounted while a refresh error or a session
 * change removes the snapshot, so its forms and selection survive. The shell
 * then shows NoSessionAccess itself.
 */
export function Workspace(props: Omit<ShellProps, "data">) {
  const { pathname } = useLocation();
  const data = useSessionSnapshot(props.user.id);
  const membership = data.snapshot?.membership;
  const current = membership ? uiKindFor(membership) : undefined;
  const [kind, setKind] = useState<UiKind>();
  if (current && current !== kind) setKind(current);
  const page = pageForPath(pathname);
  if (pathname === "/") return <Navigate to="/issues" replace />;
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
  if (shown === "contestant") return <ContestantApp {...props} data={data} />;
  if (shown === "organiser") return <OrganiserApp {...props} data={data} />;
  return <SessionAccess {...props} data={data} />;
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
