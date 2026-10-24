import { type ReactNode, useId, useState } from "react";
import { ChevronLeft, MapPin, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  pillIndicator,
  SlidingIndicator,
} from "@/components/ui/sliding-indicator";
import { TeamSearch } from "@/connected/TeamSearch";
import {
  searchTeams,
  type TeamSelection,
  unresolvedCount,
} from "@/connected/teamSearch";
import { cn } from "@/lib/utils";
import { PlaceTile } from "../components/issueDisplay";
import {
  isJuryOnly,
  sortByUnresolved,
  visibleIssues,
} from "../organiserModel";
import { type ConsolePageProps, consoleHeadingId } from "./consoleProps";
import {
  filterForQueueTab,
  matchesQueueTab,
  queueTabForFilter,
  queueTabs,
} from "./consoleModel";
import { IssueTable, StatCards } from "./IssueTable";

/** The heading, the description and an optional action of a page. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1
          id={consoleHeadingId}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight outline-none"
        >
          {title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** Opens the "Report for a team" dialog. */
export function ReportButton({
  disabled,
  onClick,
  label = "Report for a team",
}: {
  disabled: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <Button type="button" disabled={disabled} onClick={onClick}>
      <Plus aria-hidden="true" />
      {label}
    </Button>
  );
}

const footnote =
  "Sorted by unresolved time, longest first. Timers are grey under 10 minutes, amber under 20 minutes and rose after that. Press J or K to move between rows.";

/**
 * The issue queue: status cards, status tabs with counts, the T0008 team
 * filter and the issue table, sorted by unresolved time.
 */
export function QueuePage({
  props,
  teamSelection,
  onTeamSelection,
  onReport,
}: {
  props: ConsolePageProps;
  teamSelection: TeamSelection;
  onTeamSelection: (selection: TeamSelection) => void;
  /** Opens the report dialog. Omit it when the person cannot report. */
  onReport?: () => void;
}) {
  const { state, member, workflow, now } = props;
  const issues = visibleIssues(state.issues, member);
  const teamIssues = teamSelection.teamId
    ? issues.filter((issue) => issue.team_id === teamSelection.teamId)
    : issues;
  const tab = queueTabForFilter(workflow.statusFilter);
  const shown = sortByUnresolved(
    teamIssues.filter((issue) => matchesQueueTab(issue, tab)),
    state.resolutions,
    now,
  );
  const archived = Boolean(state.event?.archived);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Issue queue"
        description={`Live view of every report in ${state.session?.name ?? "this session"}. Timers come from saved timestamps.`}
        action={
          onReport && (
            <ReportButton
              disabled={archived || workflow.command.locked}
              onClick={onReport}
            />
          )
        }
      />
      <StatCards issues={issues} state={state} now={now} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div
          role="group"
          aria-label="Filter by status"
          className="relative isolate flex flex-wrap gap-1 rounded-lg bg-muted p-1"
        >
          <SlidingIndicator className={pillIndicator} />
          {queueTabs.map((item) => {
            const count = teamIssues.filter((issue) =>
              matchesQueueTab(issue, item.tab),
            ).length;
            return (
              <button
                key={item.tab}
                type="button"
                aria-pressed={tab === item.tab}
                onClick={() =>
                  workflow.setStatusFilter(filterForQueueTab(item.tab))
                }
                className={cn(
                  "h-8 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors duration-(--motion-base) ease-out focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  tab === item.tab && "text-foreground",
                )}
              >
                {item.label}{" "}
                <span className="text-xs tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="w-80">
          <TeamSearch
            id="queue-team-search"
            label="Find a team"
            teams={state.teams}
            issues={state.issues}
            selection={teamSelection}
            onSelection={onTeamSelection}
            variant="field"
          />
        </div>
      </div>
      <IssueTable
        issues={shown}
        props={props}
        caption="Issue queue"
        empty={
          issues.length
            ? "No issues in this view. Choose another status or team."
            : "Reports will appear here when they are submitted."
        }
      />
      {shown.length > 0 && (
        <p className="text-xs text-muted-foreground">{footnote}</p>
      )}
    </div>
  );
}

/** The issues that this person owns: active first, then resolved. */
export function MinePage({ props }: { props: ConsolePageProps }) {
  const { state, member, now } = props;
  const mine = sortByUnresolved(
    state.issues.filter((issue) => issue.owner === member.user_id),
    state.resolutions,
    now,
  );
  const active = mine.filter((issue) => issue.status !== "resolved");
  const resolved = mine.filter((issue) => issue.status === "resolved");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Assigned to me"
        description={`${active.length} active · ${resolved.length} resolved. You stay the owner during a handoff until a specialist accepts.`}
      />
      <IssueTable
        issues={active}
        props={props}
        caption="Your active issues"
        empty="You own no active issues. Claim one from the queue."
      />
      {resolved.length > 0 && (
        <section aria-labelledby="mine-resolved" className="space-y-3">
          <h2 id="mine-resolved" className="text-sm font-semibold">
            Resolved by you
          </h2>
          <IssueTable
            issues={resolved}
            props={props}
            caption="Issues you resolved"
            empty=""
          />
        </section>
      )}
    </div>
  );
}

/** Issues that wait for a specialist to accept the handoff. */
export function HandoffsPage({ props }: { props: ConsolePageProps }) {
  const { state, member, now } = props;
  const waiting = sortByUnresolved(
    visibleIssues(state.issues, member).filter(
      (issue) => issue.status === "escalated",
    ),
    state.resolutions,
    now,
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Handoffs"
        description={
          member.roles.includes("specialist")
            ? "Accept a handoff to become the owner. The current owner stays responsible until a specialist accepts."
            : "Only specialists can accept a handoff. The current owner stays responsible until a specialist accepts."
        }
      />
      <IssueTable
        issues={waiting}
        props={props}
        caption="Handoffs waiting for a specialist"
        empty="No handoffs are waiting."
      />
    </div>
  );
}

/**
 * Every team with its location and unresolved reports. The T0008 fuzzy
 * search matches names, locations and tables. A team opens its issues.
 */
export function TeamsPage({
  props,
  teamId,
  onTeam,
  onReport,
}: {
  props: ConsolePageProps;
  teamId: string | undefined;
  onTeam: (teamId: string | undefined) => void;
  /** Opens the report dialog for a team. Omit it when the person cannot report. */
  onReport?: (teamId: string) => void;
}) {
  const { state, member, workflow, now } = props;
  const id = useId();
  const [query, setQuery] = useState("");
  const team = state.teams.find((item) => item.id === teamId);
  const archived = Boolean(state.event?.archived);
  if (team) {
    const teamIssues = sortByUnresolved(
      visibleIssues(state.issues, member).filter(
        (issue) => issue.team_id === team.id,
      ),
      state.resolutions,
      now,
    );
    return (
      <div className="space-y-6">
        <Button
          type="button"
          variant="ghost"
          className="-ml-3"
          onClick={() => onTeam(undefined)}
        >
          <ChevronLeft aria-hidden="true" />
          All teams
        </Button>
        <div className="flex flex-wrap items-center gap-4">
          <PlaceTile location={team.location} size="lg" inverted />
          <div className="min-w-0 flex-1">
            <h1
              id={consoleHeadingId}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight outline-none"
            >
              {team.name}
            </h1>
            <p className="text-sm text-muted-foreground">{team.location}</p>
          </div>
          {onReport && (
            <ReportButton
              label="Report for this team"
              disabled={archived || workflow.command.locked}
              onClick={() => onReport(team.id)}
            />
          )}
        </div>
        <IssueTable
          issues={teamIssues}
          props={props}
          caption={`Issues of ${team.name}`}
          empty={
            isJuryOnly(member)
              ? "This team has no resolved issues."
              : "This team has no issues."
          }
        />
      </div>
    );
  }
  const result = searchTeams(state.teams, state.issues, query);
  const teams = query.trim()
    ? result.suggestions
    : [...state.teams]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({
          ...item,
          unresolved: unresolvedCount(state.issues, item.id),
        }));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Teams & tables"
        description="Every team in this session, with its location and unresolved reports."
      />
      <div className="relative max-w-sm">
        <label htmlFor={`${id}-find`} className="sr-only">
          Find a team or table
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={`${id}-find`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Team name, location or table"
          className="pl-9"
        />
      </div>
      {teams.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onTeam(item.id)}
                className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <PlaceTile location={item.location} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.name}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">{item.location}</span>
                  </span>
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 bg-background",
                    item.unresolved
                      ? "text-status-escalated"
                      : "text-muted-foreground",
                  )}
                >
                  {item.unresolved ? `${item.unresolved} unresolved` : "Clear"}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No matching teams.
        </p>
      )}
      {query.trim() && result.overflow && (
        <p role="status" className="text-xs text-muted-foreground">
          Keep typing to narrow the list.
        </p>
      )}
    </div>
  );
}
