import {
  ArrowUpRight,
  CheckCheck,
  CircleCheck,
  Clock,
  Lock,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { historyText } from "@/connected/historyEvents";
import { awardMinutesLabel, formatDate } from "@/connected/labels";
import type { Award, HistoryEntry, Issue, Snapshot } from "@/connected/model";
import { clockDuration } from "@/connected/ui";
import { cn } from "@/lib/utils";
import { PersonAvatar, UnresolvedTimer } from "./issueDisplay";
import { Count, Meta } from "@/components/meta";

function wallTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** The live unresolved time and the time to first assignment. */
export function IssueTimers({
  issue,
  state,
  now,
}: {
  issue: Issue;
  state: Snapshot;
  now: number;
}) {
  const running = issue.status !== "resolved";
  return (
    <dl className="grid grid-cols-2 gap-2">
      <div className="rounded-xl border p-3">
        <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {!running && <Clock aria-hidden="true" className="size-3" />}
          {running ? (
            "Unresolved"
          ) : (
            <Meta>
              <span>Unresolved</span>
              <span className="opacity-70">stopped</span>
            </Meta>
          )}
        </dt>
        <dd className="mt-0.5 text-2xl font-semibold">
          <UnresolvedTimer
            issue={issue}
            resolutions={state.resolutions}
            now={now}
          />
        </dd>
      </div>
      <div className="rounded-xl border p-3">
        <dt className="text-xs text-muted-foreground">First assignment</dt>
        <dd className="mt-0.5 font-mono text-2xl font-semibold tabular-nums">
          {issue.first_assigned_at
            ? clockDuration(
                Date.parse(issue.first_assigned_at) -
                  Date.parse(issue.created_at),
              )
            : "—"}
        </dd>
        <dd className="text-[11px] text-muted-foreground">
          {issue.first_assigned_at ? "after submission" : "Not assigned yet"}
        </dd>
      </div>
    </dl>
  );
}

const lifecycleSteps = [
  { label: "Submitted" },
  { label: "Claimed" },
  { label: "Specialist", optional: true },
  { label: "Resolved" },
];
const lifecycleIndex: Record<Issue["status"], number> = {
  open: 0,
  claimed: 1,
  escalated: 2,
  resolved: 3,
};

/**
 * The time or state under each lifecycle step, for the desktop stepper:
 * submission and first assignment times, "Requested" while a handoff waits,
 * and the resolution time.
 */
export function lifecycleDetails(issue: Issue): string[] {
  return [
    wallTime(issue.created_at),
    issue.first_assigned_at ? wallTime(issue.first_assigned_at) : "—",
    issue.status === "escalated" ? "Requested" : "—",
    issue.status === "resolved" && issue.resolved_at
      ? wallTime(issue.resolved_at)
      : "—",
  ];
}

/**
 * Four steps from submission to resolution. The current step is marked.
 * The specialist step is optional: an owner can resolve without a handoff.
 * Status alone cannot show that a handoff happened, because accepting it
 * returns the issue to "claimed". So the step is solid only while a handoff
 * waits, and dashed otherwise.
 * `details` adds one line under each step label.
 */
export function LifecycleBar({
  status,
  details,
}: {
  status: Issue["status"];
  details?: readonly string[];
}) {
  const at = lifecycleIndex[status];
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label="Issue progress">
      {lifecycleSteps.map(({ label, optional }, index) => {
        const skipped = optional && index !== at;
        return (
          <li key={label} aria-current={index === at ? "step" : undefined}>
            <div
              className={cn(
                "h-1.5 rounded-full",
                skipped
                  ? "bg-[repeating-linear-gradient(90deg,var(--muted-foreground)_0_4px,transparent_4px_8px)] opacity-40"
                  : index < at || (index === at && status === "resolved")
                    ? "bg-primary"
                    : index === at
                      ? "bg-primary/50"
                      : "bg-muted",
              )}
            />
            <div
              className={cn(
                "mt-1 text-[11px]",
                index <= at && !skipped ? "font-medium" : "text-muted-foreground",
              )}
            >
              {label}
              {optional && (
                <span className="ml-1 text-[10px] font-normal">optional</span>
              )}
            </div>
            {details && (
              <div className="font-mono text-[11px] text-muted-foreground">
                {details[index]}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The current owner, identified by person. */
export function OwnerCard({
  issue,
  userId,
}: {
  issue: Issue;
  userId: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-3">
      <PersonAvatar
        name={issue.owner_name}
        personId={issue.owner}
        className="size-9"
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">Owner</div>
        <div className="truncate font-medium">
          {issue.owner_name
            ? issue.owner === userId
              ? `You (${issue.owner_name})`
              : issue.owner_name
            : "Nobody yet"}
        </div>
      </div>
    </div>
  );
}

/** Shows that a handoff waits for a specialist. The owner stays responsible. */
export function HandoffBanner({ issue }: { issue: Issue }) {
  if (issue.status !== "escalated") return null;
  return (
    <div
      role="note"
      className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
    >
      <ArrowUpRight
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-status-escalated"
      />
      <div>
        <div className="font-medium">Specialist handoff requested</div>
        <div className="text-muted-foreground">
          {issue.owner_name ?? "The owner"} stays responsible until a
          specialist accepts.
        </div>
      </div>
    </div>
  );
}

/**
 * The award decision and, as a separate step, its confirmation in the
 * external contest system. Minsky does not change a contest clock.
 */
export function AwardReceipt({
  award,
  state,
}: {
  award: Award | undefined;
  state: Snapshot;
}) {
  if (!award) return null;
  const earlier = state.resolutions.some(
    (r) => r.id === award.resolution_id && r.reopened_at,
  );
  return (
    <section
      aria-label="Time award"
      className="rounded-xl border p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xl font-bold tabular-nums">
          {awardMinutesLabel(award.minutes)}
        </span>
        <Badge
          variant="outline"
          className={cn(
            "bg-background",
            award.withdrawn_at
              ? "text-muted-foreground"
              : award.applied_at
                ? "text-status-resolved"
                : "text-status-escalated",
          )}
        >
          {award.withdrawn_at ? (
            <Undo2 aria-hidden="true" />
          ) : award.applied_at ? (
            <CheckCheck aria-hidden="true" />
          ) : (
            <Clock aria-hidden="true" />
          )}
          {award.withdrawn_at
            ? "Withdrawn, gives no time"
            : award.applied_at
              ? "Applied externally"
              : "Pending external application"}
        </Badge>
      </div>
      <p className="mt-1 text-sm">{award.explanation}</p>
      {earlier && (
        <p className="mt-1 text-xs text-muted-foreground">
          This decision relates to an earlier resolution. One award is allowed
          per issue.
        </p>
      )}
      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        <p>
          <Meta>
            <span>Decided by {award.actor_name}</span>
            <span className="tabular-nums">{formatDate(award.at)}</span>
          </Meta>
        </p>
        {award.applied_at && (
          <p>
            <Meta>
              <span>Confirmed by {award.applied_name ?? "staff"}</span>
              <span className="tabular-nums">{formatDate(award.applied_at)}</span>
            </Meta>
          </p>
        )}
        {award.withdrawn_at && (
          <p>
            <Meta>
              <span>Withdrawn by {award.withdrawn_name ?? "staff"}</span>
              <span className="tabular-nums">{formatDate(award.withdrawn_at)}</span>
            </Meta>
          </p>
        )}
      </div>
      {award.withdrawn_at && (
        <p className="mt-1 text-xs text-muted-foreground">
          A withdrawn award stays in the record. This issue cannot take another
          award.
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Minsky records confirmation only. It does not change a contest clock.
      </p>
    </section>
  );
}

/** Every resolution summary with its actor, time and any reopening. */
export function ResolutionHistory({
  issue,
  state,
}: {
  issue: Issue;
  state: Snapshot;
}) {
  const records = state.resolutions.filter((r) => r.issue_id === issue.id);
  if (!records.length) return null;
  return (
    <section aria-label="Resolutions" className="space-y-2">
      {records.map((r) => (
        <div
          key={r.id}
          className={cn(
            "rounded-xl border p-3",
            r.reopened_at
              ? "bg-muted/40"
              : "border-emerald-500/40 bg-emerald-500/5",
          )}
        >
          <div className="flex items-center gap-1.5 text-xs text-status-resolved">
            <CircleCheck aria-hidden="true" className="size-3.5" />
            <Meta>
              <span className="font-medium">
                {r.reopened_at ? "Previous resolution" : "Resolution summary"}
              </span>
              <span className="opacity-80">{r.actor_name}</span>
              <span className="tabular-nums opacity-80">{formatDate(r.at)}</span>
            </Meta>
          </div>
          <p className="mt-1 text-sm font-medium">{r.summary}</p>
          {r.reopened_at && (
            <p className="mt-2 flex gap-1.5 text-xs text-muted-foreground">
              <RotateCcw aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
              <span>
                <Meta>
                  <span>Reopened by {r.reopened_name}</span>
                  <span className="tabular-nums">{formatDate(r.reopened_at)}</span>
                </Meta>
                <span className="mt-0.5 block text-foreground/80">{r.reason}</span>
              </span>
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

function ActivityEntry({ item, text }: { item: HistoryEntry; text: string }) {
  const internal = item.visibility === "internal";
  return (
    <li className="flex gap-2.5">
      <PersonAvatar
        name={item.actor_name}
        personId={item.actor}
        className="size-7 text-[10px]"
      />
      <div
        className={cn(
          "min-w-0 flex-1 rounded-xl border p-3",
          internal ? "internal-surface" : "bg-card",
        )}
      >
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium">{item.actor_name}</span>
          <time
            dateTime={item.at}
            title={formatDate(item.at)}
            className="text-muted-foreground"
          >
            {wallTime(item.at)}
          </time>
          {internal ? (
            <span className="ml-auto flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
              <Lock aria-hidden="true" className="size-3" />
              <Meta>
                <span>Internal note</span>
                <span className="font-normal opacity-80">staff only</span>
              </Meta>
            </span>
          ) : (
            <span className="ml-auto text-muted-foreground">
              Visible to the team
            </span>
          )}
        </div>
        <p className="mt-1 text-sm break-words whitespace-pre-wrap">
          {text}
        </p>
      </div>
    </li>
  );
}

/**
 * The shared activity history of an issue. Internal notes have an amber
 * striped surface and a "staff only" label.
 */
export function ActivityList({
  issue,
  state,
}: {
  issue: Issue;
  state: Snapshot;
}) {
  const history = state.history.filter((item) => item.issue_id === issue.id);
  const context = {
    issue,
    resolutions: state.resolutions.filter((r) => r.issue_id === issue.id),
    award: state.awards.find((a) => a.issue_id === issue.id),
  };
  return (
    <section aria-labelledby={`activity-${issue.id}`}>
      <h2
        id={`activity-${issue.id}`}
        className="pb-2 text-xs font-medium text-muted-foreground"
      >
        Activity{" "}
        <Count unit={history.length === 1 ? "entry" : "entries"}>{history.length}</Count>
      </h2>
      <ol className="space-y-2.5">
        <li className="flex items-center gap-2 pl-2 text-xs text-muted-foreground">
          <Meta>
            <span>Submitted by {issue.reporter_name}</span>
            <span className="tabular-nums">{formatDate(issue.created_at)}</span>
          </Meta>
        </li>
        {history.map((item) => (
          <ActivityEntry
            key={item.id}
            item={item}
            text={historyText(item, context)}
          />
        ))}
      </ol>
    </section>
  );
}
