import type { ReactNode } from "react";
import {
  Archive,
  CircleUserRound,
  Hand,
  Handshake,
  Inbox,
  type LucideIcon,
  Scale,
  Search,
  Settings2,
  UserRoundCheck,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SlidingIndicator } from "@/components/ui/sliding-indicator";
import type { CommandRunner } from "@/connected/hooks/useCommand";
import type { SessionData } from "@/connected/hooks/useSessionSnapshot";
import { isRunning, type Issue, type Snapshot } from "@/connected/model";
import { cn } from "@/lib/utils";
import { CommandFeedback } from "../actions/ActionSheet";
import {
  ConnectionBadge,
  PersonAvatar,
  PlaceTile,
  StatusBadge,
  UnresolvedTimer,
} from "../components/issueDisplay";
import type { OrganiserTab } from "../organiserModel";

const tabMeta: Record<OrganiserTab, { label: string; icon: LucideIcon }> = {
  queue: { label: "Queue", icon: Inbox },
  mine: { label: "Mine", icon: UserRoundCheck },
  awards: { label: "Awards", icon: Scale },
  find: { label: "Find", icon: Search },
  session: { label: "Session", icon: Settings2 },
  me: { label: "Me", icon: CircleUserRound },
};

export function tabLabel(tab: OrganiserTab): string {
  return tabMeta[tab].label;
}

/** The bottom tab bar. Each tab is a button of at least 44 by 44 pixels. */
export function TabBar({
  tabs,
  current,
  onSelect,
}: {
  tabs: readonly OrganiserTab[];
  current: OrganiserTab;
  onSelect: (tab: OrganiserTab) => void;
}) {
  return (
    <nav
      aria-label="Organizer sections"
      className="shrink-0 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul
        className="relative isolate grid"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        <SlidingIndicator className="top-0 left-0 h-[3px] w-[calc(var(--indicator-w)-2rem)] translate-x-[calc(var(--indicator-x)+1rem)] rounded-b-full bg-foreground" />
        {tabs.map((tab) => {
          const { label, icon: Icon } = tabMeta[tab];
          const active = tab === current;
          return (
            <li key={tab}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onSelect(tab)}
                className={cn(
                  "flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors duration-(--motion-fast) ease-out active:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn("size-5", active && "stroke-[2.4]")}
                />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The top of a tab: Live or Reconnecting, the event and the intake state,
 * the tab heading and an optional action.
 */
export function PhoneHeader({
  title,
  headingId,
  state,
  connected,
  action,
}: {
  title: string;
  headingId: string;
  state: Snapshot;
  connected: boolean;
  action?: ReactNode;
}) {
  return (
    <header className="shrink-0 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <ConnectionBadge connected={connected} />
        <span aria-hidden="true">·</span>
        <span className="truncate">
          {state.event?.name ?? "Your contest"} · {state.session?.name}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <h1
          id={headingId}
          tabIndex={-1}
          className="flex-1 text-3xl font-bold tracking-tight outline-none"
        >
          {title}
        </h1>
        {action}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Contestant intake {state.session?.intake_open ? "open" : "closed"}
      </p>
    </header>
  );
}

/**
 * Banners that every tab shows: an archived event, a refresh error, the last
 * command result and the retry button. An error stays pinned to the top of
 * the scrolling list, because the card that failed can be far down it.
 */
export function PhoneStatus({
  state,
  data,
  command,
}: {
  state: Snapshot;
  data: SessionData;
  command: CommandRunner;
}) {
  const failed = Boolean(data.refreshError || command.error);
  return (
    <div
      className={cn(
        "space-y-2 empty:hidden",
        failed && "sticky top-0 z-10 bg-background pb-2",
      )}
    >
      {state.event?.archived && (
        <Alert>
          <Archive aria-hidden="true" />
          <AlertDescription>
            This event is archived. Records are read only.
          </AlertDescription>
        </Alert>
      )}
      {data.refreshError && (
        <Alert variant="destructive">
          <AlertDescription>
            <p role="alert">{data.refreshError}</p>
          </AlertDescription>
        </Alert>
      )}
      <CommandFeedback command={command} />
      {command.notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {command.notice}
        </p>
      )}
    </div>
  );
}

/** The inline action of a queue card. */
export type CardAction = "claim" | "accept";

/**
 * A queue card. The hall and table come first, then the status, the aging
 * timer, the team, the description, the category and the owner. The whole
 * card opens the issue. Claim or Accept is a separate button.
 */
export function IssueCard({
  issue,
  state,
  now,
  command,
  action,
  onOpen,
  onAction,
}: {
  issue: Issue;
  state: Snapshot;
  now: number;
  command: CommandRunner;
  action?: CardAction;
  onOpen: () => void;
  onAction: (action: CardAction) => void;
}) {
  const team = state.teams.find((item) => item.id === issue.team_id);
  return (
    <li className="relative rounded-xl border bg-card p-3 transition-colors duration-(--motion-fast) ease-out has-[>button:active]:bg-accent has-[>button:focus-visible]:ring-[3px] has-[>button:focus-visible]:ring-ring/50">
      <button
        id={`issue-card-${issue.id}`}
        type="button"
        onClick={onOpen}
        className="absolute inset-0 rounded-xl outline-none"
      >
        <span className="sr-only">
          Open ISS-{issue.number}, {team?.name}, {team?.location}
        </span>
      </button>
      <div className="pointer-events-none flex gap-3">
        <PlaceTile location={team?.location ?? ""} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusBadge status={issue.status} />
            <span className="font-mono text-xs text-muted-foreground">
              ISS-{issue.number}
            </span>
            <UnresolvedTimer
              issue={issue}
              resolutions={state.resolutions}
              now={now}
              className="ml-auto text-sm"
            />
          </div>
          <div className="mt-1.5 truncate font-semibold">{team?.name}</div>
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {issue.description}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {issue.category}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs">
              <PersonAvatar
                name={issue.owner_name}
                personId={issue.owner}
                className="size-6 text-[9px]"
              />
              <span className="truncate">
                {issue.owner_name ?? "Unassigned"}
              </span>
            </span>
            {action && (
              <Button
                type="button"
                className="pointer-events-auto relative h-11"
                disabled={command.locked}
                loading={isRunning(command.running, action, issue.id)}
                onClick={() => onAction(action)}
                aria-label={`${action === "claim" ? "Claim" : "Accept handoff for"} ISS-${issue.number}`}
              >
                {action === "claim" ? (
                  <Hand aria-hidden="true" />
                ) : (
                  <Handshake aria-hidden="true" />
                )}
                {action === "claim" ? "Claim" : "Accept"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/** A message for an empty list. */
export function EmptyList({ children }: { children: ReactNode }) {
  return (
    <p className="py-12 text-center text-sm text-muted-foreground">{children}</p>
  );
}
