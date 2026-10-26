import { useId, useState } from "react";
import {
  Camera,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Hand,
  KeyRound,
  LogOut,
  Search,
  Trash2,
} from "lucide-react";
import { themeOptions } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { accountName } from "@/connected/accountModel";
import {
  changePictureButtonId,
  useAvatarEditor,
} from "@/connected/hooks/useAvatarEditor";
import type { WorkflowState } from "@/connected/hooks/useWorkflowState";
import { awardMinutesLabel } from "@/connected/labels";
import {
  isRunning,
  type Issue,
  type Membership,
  type Snapshot,
} from "@/connected/model";
import { PictureEditor } from "@/connected/PictureEditor";
import type { ShellProps } from "@/connected/shell";
import { searchTeams, unresolvedCount } from "@/connected/teamSearch";
import { documentationUrl } from "@/lib/links";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  AwardEvidence,
  PersonAvatar,
  PlaceTile,
  UnresolvedTimer,
} from "../components/issueDisplay";
import {
  type AwardList,
  awardListLabels,
  awardListOrder,
  awardLists,
  chipForFilter,
  filterForChip,
  isJuryOnly,
  issuesByNumber,
  type IssueSheetKind,
  matchesChip,
  queueChips,
  roleNames,
  sortByUnresolved,
  visibleIssues,
} from "../organiserModel";
import { type CardAction, EmptyList, IssueCard } from "./PhoneParts";

/** A sheet that the issue view opens when it appears. */
export type IssueSheet = IssueSheetKind;

/** What every phone tab needs from the app. */
export interface PhoneTabProps {
  shell: ShellProps;
  state: Snapshot;
  member: Membership;
  workflow: WorkflowState;
  now: number;
  /** Pushes the issue view, optionally with a sheet open. */
  openIssue: (issueId: string, sheet?: IssueSheet) => void;
  /** The inline action of a queue card for this person, if any. */
  cardAction: (issue: Issue) => CardAction | undefined;
  /** Runs Claim or Accept from a card and stays in the list. */
  runCardAction: (issue: Issue, action: CardAction) => void;
}

function IssueList({
  issues,
  props,
}: {
  issues: readonly Issue[];
  props: PhoneTabProps;
}) {
  return (
    <ul className="space-y-2.5">
      {issues.map((issue) => (
        <IssueCard
          key={issue.id}
          issue={issue}
          state={props.state}
          now={props.now}
          command={props.workflow.command}
          action={props.cardAction(issue)}
          onOpen={() => props.openIssue(issue.id)}
          onAction={(action) => props.runCardAction(issue, action)}
        />
      ))}
    </ul>
  );
}

/**
 * The queue: the oldest waiting issue with Claim and go, status chips, and
 * cards sorted by unresolved time, longest first.
 */
export function QueueTab(props: PhoneTabProps) {
  const { state, member, workflow, now } = props;
  const chip = chipForFilter(workflow.statusFilter);
  const issues = visibleIssues(state.issues, member);
  const sorted = sortByUnresolved(issues, state.resolutions, now);
  const waiting = sorted.filter((issue) => issue.status === "open");
  const oldest = waiting[0];
  const oldestTeam = state.teams.find((team) => team.id === oldest?.team_id);
  const shown = sorted.filter((issue) => matchesChip(issue, chip));
  const canClaim = oldest ? props.cardAction(oldest) === "claim" : false;
  return (
    <div className="space-y-4">
      {oldest && canClaim && (
        <section
          aria-label="Oldest waiting issue"
          className="rounded-2xl bg-primary p-4 text-primary-foreground"
        >
          <div className="flex items-center justify-between text-xs opacity-70">
            <span>Oldest waiting</span>
            <span>{waiting.length} waiting</span>
          </div>
          <div className="mt-1 flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold">
                {oldestTeam?.name}
              </div>
              <div className="truncate text-sm">{oldestTeam?.location}</div>
              <p className="truncate text-sm opacity-70">{oldest.description}</p>
            </div>
            <UnresolvedTimer
              issue={oldest}
              resolutions={state.resolutions}
              now={now}
              className="text-3xl font-semibold !text-primary-foreground"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="mt-3 h-12 w-full text-base"
            disabled={workflow.command.locked}
            loading={isRunning(workflow.command.running, "claim", oldest.id)}
            onClick={() => {
              void workflow.command.act({
                type: "claim",
                issue_id: oldest.id,
                revision: oldest.revision,
              });
            }}
          >
            <Hand aria-hidden="true" />
            Claim and go
          </Button>
        </section>
      )}
      <div
        role="group"
        aria-label="Filter the queue"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
      >
        {queueChips.map((item) => {
          const count = issues.filter((issue) =>
            matchesChip(issue, item.chip),
          ).length;
          return (
            <button
              key={item.chip}
              type="button"
              aria-pressed={chip === item.chip}
              onClick={() => workflow.setStatusFilter(filterForChip(item.chip))}
              className={cn(
                "h-11 shrink-0 rounded-full border px-4 text-sm font-medium focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                chip === item.chip && "border-primary bg-primary text-primary-foreground",
              )}
            >
              {item.label} <span className="opacity-60">{count}</span>
            </button>
          );
        })}
      </div>
      {shown.length ? (
        <IssueList issues={shown} props={props} />
      ) : (
        <EmptyList>
          {issues.length
            ? "No issues in this view. Choose another filter."
            : "Reports will appear here when they are submitted."}
        </EmptyList>
      )}
      {shown.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Sorted by unresolved time, longest first.
        </p>
      )}
    </div>
  );
}

/** The issues that this person owns, active first. */
export function MineTab(props: PhoneTabProps) {
  const { state, member, now } = props;
  const mine = sortByUnresolved(
    state.issues.filter((issue) => issue.owner === member.user_id),
    state.resolutions,
    now,
  );
  const active = mine.filter((issue) => issue.status !== "resolved");
  const resolved = mine.filter((issue) => issue.status === "resolved");
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {active.length} active · {resolved.length} resolved
      </p>
      {active.length ? (
        <IssueList issues={active} props={props} />
      ) : (
        <EmptyList>You own no active issues. Claim one from the queue.</EmptyList>
      )}
      {resolved.length > 0 && (
        <section aria-labelledby="mine-resolved" className="space-y-2">
          <h2
            id="mine-resolved"
            className="px-1 text-xs font-medium text-muted-foreground"
          >
            Resolved by you
          </h2>
          <IssueList issues={resolved} props={props} />
        </section>
      )}
    </div>
  );
}

/**
 * Finds teams by name, location or table with the T0008 fuzzy search, and
 * issues by number. A team opens its issues.
 */
export function FindTab(props: PhoneTabProps) {
  const { state, member } = props;
  const id = useId();
  const [query, setQuery] = useState("");
  const [teamId, setTeamId] = useState<string>();
  const issues = visibleIssues(state.issues, member);
  const team = state.teams.find((item) => item.id === teamId);
  if (team) {
    const teamIssues = sortByUnresolved(
      issues.filter((issue) => issue.team_id === team.id),
      state.resolutions,
      props.now,
    );
    return (
      <div className="space-y-4">
        <Button
          type="button"
          variant="ghost"
          className="-ml-2 h-11"
          onClick={() => setTeamId(undefined)}
        >
          <ChevronLeft aria-hidden="true" />
          All teams
        </Button>
        <div className="flex items-center gap-3">
          <PlaceTile location={team.location} size="lg" inverted />
          <div>
            <h2 className="text-lg font-semibold">{team.name}</h2>
            <p className="text-sm text-muted-foreground">{team.location}</p>
          </div>
        </div>
        {teamIssues.length ? (
          <IssueList issues={teamIssues} props={props} />
        ) : (
          <EmptyList>
            {isJuryOnly(member)
              ? "This team has no resolved issues."
              : "This team has no issues."}
          </EmptyList>
        )}
      </div>
    );
  }
  const numbered = issuesByNumber(issues, query);
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
    <div className="space-y-4">
      <div className="relative">
        <label htmlFor={`${id}-find`} className="sr-only">
          Find a team, table or issue number
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
          placeholder="Team, table or issue number"
          className="h-11 pl-9 text-base md:text-sm"
        />
      </div>
      {numbered.length > 0 && (
        <section aria-labelledby={`${id}-issues`} className="space-y-2">
          <h2
            id={`${id}-issues`}
            className="px-1 text-xs font-medium text-muted-foreground"
          >
            Issues
          </h2>
          <IssueList issues={numbered} props={props} />
        </section>
      )}
      <section aria-labelledby={`${id}-teams`} className="space-y-2">
        <h2
          id={`${id}-teams`}
          className="px-1 text-xs font-medium text-muted-foreground"
        >
          Teams
        </h2>
        {teams.length ? (
          <ul className="divide-y rounded-xl border bg-card">
            {teams.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setTeamId(item.id)}
                  className="flex min-h-14 w-full items-center gap-3 p-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <PlaceTile location={item.location} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {item.location}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "text-xs",
                      item.unresolved
                        ? "font-medium text-status-escalated"
                        : "text-muted-foreground",
                    )}
                  >
                    {item.unresolved ? `${item.unresolved} unresolved` : "Clear"}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 text-muted-foreground"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          !numbered.length && <EmptyList>No matching teams.</EmptyList>
        )}
        {query.trim() && result.overflow && (
          <p role="status" className="px-1 text-xs text-muted-foreground">
            Keep typing to narrow the list.
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * The jury award lists: resolved issues without an award, awards that wait
 * for external application (also on reopened issues) and applied awards.
 */
export function AwardsTab(props: PhoneTabProps) {
  const { state, workflow, now } = props;
  const [list, setList] = useState<AwardList>("decide");
  const lists = awardLists(state);
  const archived = Boolean(state.event?.archived);
  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label="Award lists"
        className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1"
      >
        {awardListOrder.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={list === value}
            onClick={() => setList(value)}
            className={cn(
              "h-11 rounded-md text-sm font-medium focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              list === value && "bg-background shadow-sm",
            )}
          >
            {awardListLabels[value]}{" "}
            <span className="opacity-60">{lists[value].length}</span>
          </button>
        ))}
      </div>
      {lists[list].length ? (
        <ul aria-label={awardListLabels[list]} className="space-y-2.5">
          {lists[list].map((row) => {
            const { issue, team, award } = row;
            return (
              <li key={issue.id} className="rounded-xl border bg-card p-3">
                <button
                  id={`issue-card-${issue.id}`}
                  type="button"
                  onClick={() => props.openIssue(issue.id)}
                  className="w-full rounded-md text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">ISS-{issue.number}</span>·
                    <span className="truncate">
                      {team?.name ?? "Team unavailable"}
                      {team?.location && ` · ${team.location}`}
                    </span>
                    <span className="ml-auto shrink-0">
                      <UnresolvedTimer
                        issue={issue}
                        resolutions={state.resolutions}
                        now={now}
                      />{" "}
                      unresolved
                    </span>
                  </span>
                  <span className="mt-1.5 block text-[15px] leading-snug font-medium">
                    {issue.description}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {issue.category}
                  </span>
                </button>
                <AwardEvidence row={row} />
                {award && (
                  <div className="mt-3 flex items-center gap-3">
                    <span className="text-2xl font-bold tabular-nums">
                      {awardMinutesLabel(award.minutes)}
                    </span>
                    <span className="flex-1 text-xs text-muted-foreground">
                      “{award.explanation}”
                    </span>
                  </div>
                )}
                {award?.applied_at && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-status-resolved">
                    <CheckCheck aria-hidden="true" className="size-3.5" />
                    Applied · confirmed by {award.applied_name}
                  </p>
                )}
                {!archived && list === "decide" && props.member.roles.includes("jury") && (
                  <Button
                    type="button"
                    className="mt-3 h-11 w-full"
                    disabled={workflow.command.locked}
                    onClick={() => props.openIssue(issue.id, "award")}
                  >
                    Decide award
                  </Button>
                )}
                {!archived && list === "apply" && (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 h-11 w-full"
                    disabled={workflow.command.locked}
                    onClick={() => props.openIssue(issue.id, "apply")}
                  >
                    <CheckCheck aria-hidden="true" />
                    Confirm applied externally
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyList>Nothing in this list.</EmptyList>
      )}
    </div>
  );
}

/**
 * The person, their roles, the session switcher when they have several
 * sessions, password change, appearance and sign-out.
 */
export function MeTab(props: PhoneTabProps & { onSessionChange: () => void }) {
  const { shell, state, member, workflow } = props;
  const { user, username, data } = shell;
  const id = useId();
  const theme = useTheme();
  const picture = useAvatarEditor();
  const name = accountName(state, user, username);
  const rowClass =
    "flex min-h-12 w-full items-center gap-3 p-3 text-left text-[15px] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 p-1">
        <PersonAvatar
          name={name}
          personId={user.id}
          className="size-14 text-base"
        />
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold">{name}</div>
          <div className="text-sm text-muted-foreground">
            {roleNames(member)}
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            {username ?? user.email}
          </div>
        </div>
      </div>
      <PictureEditor picture={picture} />
      <section aria-labelledby={`${id}-session`} className="space-y-2">
        <h2
          id={`${id}-session`}
          className="px-1 text-xs font-medium text-muted-foreground"
        >
          Contest session
        </h2>
        {data.sessions.length > 1 ? (
          <fieldset
            disabled={workflow.command.locked}
            className="divide-y rounded-xl border bg-card"
          >
            <legend className="sr-only">Choose a contest session</legend>
            {data.sessions.map((session) => (
              <label key={session.id} className={cn(rowClass, "cursor-pointer")}>
                <input
                  type="radio"
                  name={`${id}-sessions`}
                  value={session.id}
                  checked={session.id === data.sessionId}
                  onChange={() => {
                    data.selectSession(session.id);
                    props.onSessionChange();
                  }}
                  className="size-4 accent-current"
                />
                <span className="flex-1">{session.name}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="rounded-xl border bg-card p-3 text-[15px]">
            {state.session?.name}
          </p>
        )}
      </section>
      <div className="divide-y rounded-xl border bg-card">
        <button
          id={changePictureButtonId}
          type="button"
          className={rowClass}
          disabled={picture.busy}
          onClick={picture.pick}
        >
          <Camera aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="flex-1">
            Change picture
            <span className="block text-xs text-muted-foreground">
              Saving removes any location or camera data from the photo.
            </span>
          </span>
        </button>
        {picture.hasPicture && (
          <button
            type="button"
            className={rowClass}
            disabled={picture.busy}
            onClick={picture.askRemove}
          >
            <Trash2 aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="flex-1">Remove picture</span>
          </button>
        )}
        <button type="button" className={rowClass} onClick={shell.changePassword}>
          <KeyRound aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="flex-1">Change password</span>
          <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
        </button>
        <fieldset className="p-3">
          <legend className="sr-only">Appearance</legend>
          <div className="flex items-center gap-3">
            <span className="flex-1 text-[15px]" aria-hidden="true">
              Appearance
            </span>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {themeOptions.map(({ value, label, icon: Icon }) => (
                <label
                  key={value}
                  className={cn(
                    "flex h-11 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                    theme.preference === value && "bg-background shadow-sm",
                  )}
                >
                  <input
                    type="radio"
                    name={`${id}-theme`}
                    checked={theme.preference === value}
                    onChange={() => theme.setPreference(value)}
                    className="sr-only"
                  />
                  <Icon aria-hidden="true" className="size-3.5" />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </fieldset>
        <a
          className={rowClass}
          href={documentationUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="flex-1">Documentation</span>
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      <div className="rounded-xl border bg-card">
        <button type="button" className={rowClass} onClick={shell.signOut}>
          <LogOut aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="flex-1">Sign out</span>
        </button>
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        Ask an organizer if your roles or team assignment need to change.
        Development deployment.
      </p>
    </div>
  );
}
