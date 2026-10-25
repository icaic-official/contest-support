import type { ReactNode } from "react";
import { Hand, Handshake, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isRunning, type Issue, type Snapshot } from "@/connected/model";
import { clockDuration } from "@/connected/ui";
import { useChangedIssues } from "../useChangedIssues";
import {
  PersonAvatar,
  StatusBadge,
  StatusIcon,
  UnresolvedTimer,
} from "../components/issueDisplay";
import type { ConsolePageProps } from "./consoleProps";
import { type QueueStats, queueStats } from "./consoleModel";

/** The id of the open button of an issue row. Focus returns to it. */
export function issueRowId(issueId: string): string {
  return `issue-row-${issueId}`;
}

/** Whether an active issue was resolved before and then reopened. */
function wasReopened(issue: Issue, state: Snapshot): boolean {
  return (
    issue.status !== "resolved" &&
    state.resolutions.some(
      (record) => record.issue_id === issue.id && record.reopened_at,
    )
  );
}

/**
 * Issues in a data table. The issue number is a button that opens the side
 * sheet, so every row is reachable with Tab and Enter. A click anywhere on
 * the row also opens it. Claim or Accept is a separate button in the row.
 * A row that a live update added or changed fades from a tint. This includes
 * a reply or a claim that the person made.
 */
export function IssueTable({
  issues,
  props,
  caption,
  empty,
}: {
  issues: readonly Issue[];
  props: ConsolePageProps;
  caption: string;
  empty: ReactNode;
}) {
  const { state, now, workflow } = props;
  const changed = useChangedIssues(state.issues, state.session?.id, now);
  if (!issues.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow className="text-xs hover:bg-transparent">
            <TableHead className="pl-4 text-muted-foreground">Issue</TableHead>
            <TableHead className="text-muted-foreground">Status</TableHead>
            <TableHead className="text-muted-foreground">Report</TableHead>
            <TableHead className="text-muted-foreground">Team</TableHead>
            <TableHead className="text-muted-foreground">Owner</TableHead>
            <TableHead className="text-right text-muted-foreground">
              Unresolved
            </TableHead>
            <TableHead className="pr-4">
              <span className="sr-only">Action</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.map((issue) => {
            const team = state.teams.find((item) => item.id === issue.team_id);
            const action = props.rowAction(issue);
            const selected = workflow.selectedIssueId === issue.id;
            return (
              <TableRow
                key={issue.id}
                data-state={selected ? "selected" : undefined}
                data-changed={changed.has(issue.id) ? "" : undefined}
                className="cursor-pointer data-[changed]:animate-row-flash"
                onClick={() => props.openIssue(issue.id)}
              >
                <TableCell className="pl-4">
                  <button
                    id={issueRowId(issue.id)}
                    data-issue-row=""
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.openIssue(issue.id);
                    }}
                    className="rounded-sm font-mono text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <span className="sr-only">Open </span>ISS-{issue.number}
                  </button>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={issue.status} />
                    {wasReopened(issue, state) && (
                      <Badge variant="outline" className="text-muted-foreground">
                        <RotateCcw aria-hidden="true" />
                        Reopened
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="w-full max-w-0">
                  <div className="truncate font-medium">{issue.description}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {issue.category}
                  </div>
                </TableCell>
                <TableCell className="max-w-48">
                  <div className="truncate font-medium">{team?.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {team?.location}
                  </div>
                </TableCell>
                <TableCell className="max-w-44">
                  <div className="flex items-center gap-2">
                    <PersonAvatar
                      name={issue.owner_name}
                      personId={issue.owner}
                      className="size-7 text-[10px]"
                    />
                    <span
                      className={
                        issue.owner_name
                          ? "truncate"
                          : "truncate text-muted-foreground"
                      }
                    >
                      {issue.owner_name ?? "Unassigned"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <UnresolvedTimer
                    issue={issue}
                    resolutions={state.resolutions}
                    now={now}
                    className="text-sm"
                  />
                </TableCell>
                <TableCell className="pr-4 text-right">
                  {action && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={workflow.command.locked}
                      loading={isRunning(
                        workflow.command.running,
                        action,
                        issue.id,
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.runRowAction(issue, action);
                      }}
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
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function statCards(stats: QueueStats) {
  const plural = (count: number, word: string) =>
    `${count} ${word}${count === 1 ? "" : "s"}`;
  return [
    {
      status: "open",
      label: "Waiting for a helper",
      value: stats.open,
      note:
        stats.oldestOpenMs === undefined
          ? "Nobody is waiting"
          : `Oldest ${clockDuration(stats.oldestOpenMs)}`,
    },
    {
      status: "claimed",
      label: "Being worked on",
      value: stats.claimed,
      note: `${plural(stats.helpers, "helper")} active`,
    },
    {
      status: "escalated",
      label: "Awaiting specialist",
      value: stats.escalated,
      note: "Owner keeps it until accepted",
    },
    {
      status: "resolved",
      label: "Resolved",
      value: stats.resolved,
      note:
        stats.medianResolvedMs === undefined
          ? "None yet"
          : `Median ${clockDuration(stats.medianResolvedMs)} unresolved`,
    },
  ] as const;
}

/**
 * Four status cards: waiting with the oldest wait, in progress with the
 * number of helpers, awaiting a specialist, and resolved with the median
 * unresolved time. Each card has an icon and a label.
 */
export function StatCards({
  issues,
  state,
  now,
}: {
  issues: readonly Issue[];
  state: Snapshot;
  now: number;
}) {
  const stats = queueStats(issues, state.resolutions, now);
  return (
    <ul
      aria-label="Issue status counts"
      className="grid grid-cols-2 gap-4 xl:grid-cols-4"
    >
      {statCards(stats).map((card) => (
        <li key={card.status} className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            {card.label}
            <StatusIcon status={card.status} className="size-4" />
          </div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">
            {card.value}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{card.note}</div>
        </li>
      ))}
    </ul>
  );
}
