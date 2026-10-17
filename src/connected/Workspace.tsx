import { useState } from "react";
import { ContestantApp } from "@/contestant/ContestantApp";
import { OrganiserApp } from "@/organiser/OrganiserApp";
import { NoSessionAccess } from "@/screens/NoSessionAccess";
import { useSessionSnapshot } from "./hooks/useSessionSnapshot";
import { type UiKind, uiKindFor } from "./model";
import type { ShellProps } from "./shell";

/**
 * Loads the session data and selects the UI from the membership: team
 * accounts get the contestant UI, everyone else gets the organiser UI.
 *
 * The last selected UI stays mounted while a refresh error or a session
 * change removes the snapshot, so its forms and selection survive. The shell
 * then shows NoSessionAccess itself.
 */
export function Workspace(props: Omit<ShellProps, "data">) {
  const data = useSessionSnapshot(props.user.id);
  const membership = data.snapshot?.membership;
  const current = membership ? uiKindFor(membership) : undefined;
  const [kind, setKind] = useState<UiKind>();
  if (current && current !== kind) setKind(current);
  const shown = current ?? kind;
  if (shown === "contestant") return <ContestantApp {...props} data={data} />;
  if (shown === "organiser") return <OrganiserApp {...props} data={data} />;
  return (
    <NoSessionAccess
      data={data}
      account={props.username ?? props.user.email ?? undefined}
      signOut={props.signOut}
    />
  );
}
