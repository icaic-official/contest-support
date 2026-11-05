import { memo, type ReactNode, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Hand,
  Handshake,
  RotateCcw,
} from "lucide-react";
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
import {
  isRunning,
  type Issue,
  type Resolution,
  type Snapshot,
  type Team,
} from "@/connected/model";
import { clockDuration } from "@/connected/ui";
import { useChangedIssues } from "../useChangedIssues";
import {
  PersonAvatar,
  StatusBadge,
  StatusIcon,
  LiveUnresolvedTimer,
} from "../components/issueDisplay";
import type { ConsolePageProps, RowAction } from "./consoleProps";
import { type QueueStats, queueStats } from "./consoleModel";
import type { QueueSort, QueueSortKey } from "./queueSort";

const columns: readonly {
  key: QueueSortKey;
  label: string;
  className?: string;
}[] = [
  { key: "issue", label: "Issue", className: "pl-4" },
  { key: "status", label: "Status" },
  { key: "report", label: "Report" },
  { key: "team", label: "Team" },
  { key: "owner", label: "Owner" },
  { key: "unresolved", label: "Unresolved", className: "text-right" },
];

/** What a sortable table needs: the current sort and a way to change it. */
interface Sorting {
  sort: QueueSort;
  onSort: (key: QueueSortKey) => void;
}

/**
 * A column header. With `sorting` it is a native button, so Tab and Enter
 * work. Without it the header is plain text.
 */
function ColumnHead({
  column,
  sorting,
}: {
  column: (typeof columns)[number];
  sorting?: Sorting | undefined;
}) {
  if (!sorting) {
    return (
      <TableHead className={`${column.className ?? ""} text-muted-foreground`}>
        {column.label}
      </TableHead>
    );
  }
  const { sort, onSort } = sorting;
  const active = sort.key === column.key;
  const Icon = !active
    ? ChevronsUpDown
    : sort.direction === "asc"
      ? ArrowUp
      : ArrowDown;
  return (
    <TableHead
      aria-sort={
        active
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : undefined
      }
      className={column.className}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={`inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        {column.label}
        <Icon
          aria-hidden="true"
          className={`size-3 ${active ? "" : "opacity-50"}`}
        />
      </button>
    </TableHead>
  );
}

/** The id of the open button of an issue row. Focus returns to it. */
export function issueRowId(issueId: string): string {
  return `issue-row-${issueId}`;
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
  sorting,
}: {
  issues: readonly Issue[];
  props: ConsolePageProps;
  caption: string;
  empty: ReactNode;
  /** Omit it for headers that do not sort. */
  sorting?: Sorting | undefined;
}) {
  const { state, now, workflow } = props;
  const changed = useChangedIssues(state.issues, state.session?.id, now);
  // The console builds new callbacks on every render, and it renders every
  // second. The rows call the latest ones through these stable wrappers, so a
  // row that did not change does not render again.
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const open = useCallback((id: string) => latest.current.openIssue(id), []);
  const run = useCallback(
    (issue: Issue, action: RowAction) => latest.current.runRowAction(issue, action),
    [],
  );
  const teams = useMemo(
    () => new Map(state.teams.map((team) => [team.id, team])),
    [state.teams],
  );
  const reopened = useMemo(
    () =>
      new Set(
        state.resolutions
          .filter((record) => record.reopened_at)
          .map((record) => record.issue_id),
      ),
    [state.resolutions],
  );
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
            {columns.map((column) => (
              <ColumnHead key={column.key} column={column} sorting={sorting} />
            ))}
            <TableHead className="pr-4">
              <span className="sr-only">Action</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.map((issue) => {
            const action = props.rowAction(issue);
            return (
              <IssueRow
                key={issue.id}
                issue={issue}
                team={teams.get(issue.team_id)}
                resolutions={state.resolutions}
                clockOffset={props.shell.data.clockOffset}
                selected={workflow.selectedIssueId === issue.id}
                changed={changed.has(issue.id)}
                reopened={issue.status !== "resolved" && reopened.has(issue.id)}
                action={action}
                locked={workflow.command.locked}
                running={
                  action !== undefined &&
                  isRunning(workflow.command.running, action, issue.id)
                }
                onOpen={open}
                onRun={run}
              />
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

const IssueRow = memo(function IssueRow({
  issue,
  team,
  resolutions,
  clockOffset,
  selected,
  changed,
  reopened,
  action,
  locked,
  running,
  onOpen,
  onRun,
}: {
  issue: Issue;
  team: Team | undefined;
  resolutions: readonly Resolution[];
  clockOffset: { readonly current: number };
  selected: boolean;
  changed: boolean;
  reopened: boolean;
  action: RowAction | undefined;
  locked: boolean;
  running: boolean;
  onOpen: (issueId: string) => void;
  onRun: (issue: Issue, action: RowAction) => void;
}) {
  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      data-changed={changed ? "" : undefined}
      className="cursor-pointer data-[changed]:animate-row-flash"
      onClick={() => onOpen(issue.id)}
    >
      <TableCell className="pl-4">
        <button
          id={issueRowId(issue.id)}
          data-issue-row=""
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(issue.id);
          }}
          className="rounded-sm font-mono text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="sr-only">Open </span>ISS-{issue.number}
        </button>
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={issue.status} />
          {reopened && (
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
              issue.owner_name ? "truncate" : "truncate text-muted-foreground"
            }
          >
            {issue.owner_name ?? "Unassigned"}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <LiveUnresolvedTimer
          issue={issue}
          resolutions={resolutions}
          clockOffset={clockOffset}
          className="text-sm"
        />
      </TableCell>
      <TableCell className="pr-4 text-right">
        {action && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={locked}
            loading={running}
            onClick={(event) => {
              event.stopPropagation();
              onRun(issue, action);
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
});

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
