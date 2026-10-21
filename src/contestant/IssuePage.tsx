import {
  Check,
  CircleCheck,
  CircleDashed,
  Footprints,
  RotateCcw,
  Scale,
  Send,
} from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CommandRunner } from "@/connected/hooks/useCommand";
import { IssueImages } from "@/connected/IssueImages";
import { formatDate } from "@/connected/labels";
import { type Issue, type Snapshot, unresolvedTime } from "@/connected/model";
import { clockDuration } from "@/connected/ui";
import { cn } from "@/lib/utils";
import {
  contestantHeadingId,
  conversation,
  issueHeadline,
  issueResolutions,
  publicHistory,
  teamImages,
  type TrackerStep,
  trackerSteps,
  wasReopened,
} from "./contestantView";
import { StatusBadge } from "./StatusBadge";

/** A wall-clock time such as 14:17. */
function wallTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

const stepIcons: Record<TrackerStep["id"], typeof Send> = {
  sent: Send,
  assigned: Footprints,
  resolved: CircleCheck,
  award: Scale,
};

/** The four-step progress tracker. */
function Tracker({ steps }: { steps: readonly TrackerStep[] }) {
  return (
    <ol className="grid grid-cols-4 gap-3" aria-label="Progress">
      {steps.map((step, index) => {
        const Icon = step.done ? Check : stepIcons[step.id];
        return (
          <li key={step.id} aria-current={step.current ? "step" : undefined}>
            <div className="flex items-center gap-2" aria-hidden="true">
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full",
                  step.done
                    ? "bg-primary text-primary-foreground"
                    : step.current
                      ? "border-2 border-primary"
                      : "border text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
              </span>
              {index < steps.length - 1 && (
                <span
                  className={cn(
                    "h-0.5 flex-1 rounded",
                    step.done ? "bg-primary" : "bg-border",
                  )}
                />
              )}
            </div>
            <p
              className={cn(
                "mt-2 text-sm font-medium",
                !step.done && !step.current && "text-muted-foreground",
              )}
            >
              {step.label}
              <span className="sr-only">
                {step.done ? ", done" : step.current ? ", current step" : ", not yet"}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">{step.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One report of the team: headline, timer, tracker, resolutions, award,
 * public messages, team-visible images and the reply box.
 */
export function IssuePage({
  issue,
  snapshot,
  userId,
  location,
  now,
  command,
  replyDraft,
  onReplyDraft,
  reopenDraft,
  onReopenDraft,
  refresh,
}: {
  issue: Issue;
  snapshot: Snapshot;
  userId: string;
  location: string | undefined;
  now: number;
  command: CommandRunner;
  replyDraft: string;
  onReplyDraft: (value: string) => void;
  reopenDraft: string;
  onReopenDraft: (value: string) => void;
  refresh: () => Promise<void>;
}) {
  const id = useId();
  const [reopenOpen, setReopenOpen] = useState(Boolean(reopenDraft));
  const archived = Boolean(snapshot.event?.archived);
  const active = issue.status !== "resolved";
  const resolutions = issueResolutions(snapshot.resolutions, issue.id);
  const award = snapshot.awards.find((item) => item.issue_id === issue.id);
  const reopened = wasReopened(resolutions);
  const current = resolutions.find((item) => !item.reopened_at);
  const earlier = resolutions.filter((item) => item.reopened_at).reverse();
  const items = conversation(publicHistory(snapshot.history, issue.id), {
    issue,
    resolutions,
    award,
    userId,
  });
  const images = teamImages(snapshot.attachments, issue.id);
  const base = { issue_id: issue.id, revision: issue.revision };
  const locked = command.locked || archived;

  return (
    <article className="mx-auto max-w-4xl space-y-6 p-8">
      <header>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="font-mono">ISS-{issue.number}</span>
          <span aria-hidden="true">·</span>
          <span>{issue.category}</span>
          <span aria-hidden="true">·</span>
          <span>
            sent{" "}
            <time dateTime={issue.created_at} title={formatDate(issue.created_at)}>
              {wallTime(issue.created_at)}
            </time>
          </span>
          <StatusBadge status={issue.status} />
        </p>
        <h1
          id={contestantHeadingId}
          tabIndex={-1}
          className="mt-1 text-2xl font-semibold tracking-tight outline-none"
        >
          {issueHeadline(issue, { location, reopened })}
        </h1>
        {issue.status === "escalated" && issue.owner_name && (
          <p className="mt-1 text-muted-foreground">
            {issue.owner_name} stays responsible until a specialist takes over.
          </p>
        )}
      </header>

      <section
        aria-label="Your report"
        className="rounded-xl border bg-card p-6"
      >
        <div className="flex items-start gap-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-normal text-muted-foreground">
              Your report
            </h2>
            <p className="mt-1 text-[15px] break-words whitespace-pre-wrap">
              {issue.description}
            </p>
          </div>
          <div className="text-right">
            <p className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
              {active && (
                <span
                  aria-hidden="true"
                  className="size-1.5 animate-pulse rounded-full bg-emerald-500"
                />
              )}
              {active ? "Unresolved time" : "Total unresolved time"}
            </p>
            <p className="font-mono text-4xl font-semibold tabular-nums">
              {clockDuration(unresolvedTime(issue, snapshot.resolutions, now))}
              <span className="sr-only">
                {active ? ", running" : ", stopped"}
              </span>
            </p>
          </div>
        </div>
        <div className="mt-6 border-t pt-6">
          <Tracker steps={trackerSteps(issue, award, wallTime)} />
        </div>
      </section>

      {current && !active && (
        <section
          aria-labelledby={`${id}-resolution`}
          className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-5"
        >
          <h2
            id={`${id}-resolution`}
            className="flex items-center gap-2 text-sm font-medium text-status-resolved"
          >
            <CircleCheck className="size-4" aria-hidden="true" />
            Resolution
          </h2>
          <p className="mt-1 text-lg font-medium break-words">{current.summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {current.actor_name} ·{" "}
            <time dateTime={current.at} title={formatDate(current.at)}>
              {wallTime(current.at)}
            </time>
          </p>
          {!archived &&
            (reopenOpen ? (
              <form
                className="mt-4 grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (locked || !reopenDraft.trim()) return;
                  void command.act(
                    { type: "reopen", ...base, reason: reopenDraft },
                    {
                      onSuccess: () => {
                        onReopenDraft("");
                        setReopenOpen(false);
                      },
                    },
                  );
                }}
              >
                <Label htmlFor={`${id}-reason`}>
                  What is still wrong? Staff and your team can see this reason.
                </Label>
                <div className="flex gap-2">
                  <Textarea
                    id={`${id}-reason`}
                    autoFocus
                    required
                    maxLength={2000}
                    rows={2}
                    className="min-h-10 flex-1"
                    value={reopenDraft}
                    disabled={locked}
                    onChange={(event) => onReopenDraft(event.target.value)}
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={locked || !reopenDraft.trim()}
                  >
                    <RotateCcw aria-hidden="true" />
                    Reopen issue
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  The same helper stays responsible. The timer continues from
                  where it stopped.
                </p>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto justify-self-start p-0 text-muted-foreground"
                  onClick={() => setReopenOpen(false)}
                >
                  Keep it resolved
                </Button>
              </form>
            ) : (
              <Button
                variant="link"
                className="mt-3 h-auto p-0 text-muted-foreground hover:text-foreground has-[>svg]:px-0"
                disabled={locked}
                onClick={() => setReopenOpen(true)}
              >
                <RotateCcw aria-hidden="true" />
                The problem is back? Reopen this issue
              </Button>
            ))}
        </section>
      )}

      {earlier.length > 0 && (
        <section aria-labelledby={`${id}-earlier`} className="rounded-xl border p-5">
          <h2 id={`${id}-earlier`} className="text-sm font-medium">
            Earlier resolutions
          </h2>
          <ol className="mt-3 space-y-3">
            {earlier.map((item) => (
              <li key={item.id} className="border-l-2 pl-3 text-sm">
                <p className="break-words">{item.summary}</p>
                <p className="text-xs text-muted-foreground">
                  Resolved by {item.actor_name} · {formatDate(item.at)}
                </p>
                {item.reopened_at && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reopened by {item.reopened_by === userId ? "you" : item.reopened_name}{" "}
                    · {formatDate(item.reopened_at)}: {item.reason}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {award && (
        <section
          aria-labelledby={`${id}-award`}
          className="grid grid-cols-[auto_1fr] items-center gap-5 rounded-xl border bg-card p-5"
        >
          <div className="px-4 text-center" aria-hidden="true">
            <p className="text-4xl font-bold tabular-nums">+{award.minutes}</p>
            <p className="text-xs text-muted-foreground">minutes</p>
          </div>
          <div>
            <h2 id={`${id}-award`} className="font-medium">
              Time award<span className="sr-only">, {award.minutes} minutes</span>
            </h2>
            <p className="text-sm break-words text-muted-foreground">
              {award.explanation}
            </p>
            {resolutions.some(
              (item) => item.id === award.resolution_id && item.reopened_at,
            ) && (
              <p className="mt-1 text-xs text-muted-foreground">
                The jury decided this award for an earlier resolution. One award
                is allowed per issue.
              </p>
            )}
            <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <li className="flex items-center gap-1.5 text-status-resolved">
                <CircleCheck className="size-3.5" aria-hidden="true" />
                Decided by the jury ·{" "}
                <time dateTime={award.at} title={formatDate(award.at)}>
                  {wallTime(award.at)}
                </time>
              </li>
              <li
                className={cn(
                  "flex items-center gap-1.5",
                  award.applied_at ? "text-status-resolved" : "text-muted-foreground",
                )}
              >
                {award.applied_at ? (
                  <CircleCheck className="size-3.5" aria-hidden="true" />
                ) : (
                  <CircleDashed className="size-3.5" aria-hidden="true" />
                )}
                {award.applied_at ? (
                  <>
                    Applied to your contest time ·{" "}
                    <time
                      dateTime={award.applied_at}
                      title={formatDate(award.applied_at)}
                    >
                      {wallTime(award.applied_at)}
                    </time>
                  </>
                ) : (
                  "Not yet applied to your contest time"
                )}
              </li>
            </ol>
          </div>
        </section>
      )}

      <section aria-labelledby={`${id}-messages`} className="rounded-xl border bg-card">
        <div className="flex items-baseline gap-2 border-b px-5 py-4">
          <h2 id={`${id}-messages`} className="font-semibold">
            Messages
          </h2>
          <span className="text-xs text-muted-foreground">
            Staff and your team
          </span>
        </div>
        <ol className="space-y-4 p-5" aria-label="Messages and updates">
          {items.map((item) =>
            item.kind === "event" ? (
              <li
                key={item.entry.id}
                className="flex items-center gap-3 text-xs text-muted-foreground"
              >
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
                <span className="max-w-[70%] text-center break-words">
                  {item.text} ·{" "}
                  <time dateTime={item.entry.at} title={formatDate(item.entry.at)}>
                    {wallTime(item.entry.at)}
                  </time>
                </span>
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
              </li>
            ) : item.mine ? (
              <li key={item.entry.id} className="flex justify-end">
                <div className="max-w-[70%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">
                  <p className="text-xs opacity-70">
                    You ·{" "}
                    <time dateTime={item.entry.at} title={formatDate(item.entry.at)}>
                      {wallTime(item.entry.at)}
                    </time>
                  </p>
                  <p className="text-sm break-words whitespace-pre-wrap">
                    {item.entry.text}
                  </p>
                </div>
              </li>
            ) : (
              <li key={item.entry.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold"
                >
                  {initials(item.entry.actor_name)}
                </span>
                <div className="max-w-[70%] rounded-2xl rounded-bl-md border px-4 py-2.5">
                  <p className="text-xs text-muted-foreground">
                    {item.entry.actor_name} ·{" "}
                    <time dateTime={item.entry.at} title={formatDate(item.entry.at)}>
                      {wallTime(item.entry.at)}
                    </time>
                  </p>
                  <p className="text-sm break-words whitespace-pre-wrap">
                    {item.entry.text}
                  </p>
                </div>
              </li>
            ),
          )}
        </ol>
        {images.length > 0 && snapshot.session && (
          <div className="px-5 pb-5">
            <IssueImages
              sessionId={snapshot.session.id}
              issueId={issue.id}
              archived={archived}
              canUpload={false}
              staff={false}
              userId={userId}
              limits={{
                maxImageBytes: snapshot.session.max_image_bytes,
                maxImages: snapshot.session.max_images_per_issue,
                maxTotalBytes: snapshot.session.max_image_bytes_per_issue,
              }}
              attachments={images}
              pendingRemovals={[]}
              onChanged={refresh}
            />
          </div>
        )}
        {active && !archived && (
          <form
            className="flex items-end gap-2 border-t p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (locked || !replyDraft.trim()) return;
              void command.act(
                { type: "message", ...base, text: replyDraft, visibility: "public" },
                // Clears the draft once the server records the message, also
                // when the person sends it again with Retry last request.
                { onSuccess: () => onReplyDraft("") },
              );
            }}
          >
            <Label htmlFor={`${id}-reply`} className="sr-only">
              Reply to staff
            </Label>
            <Textarea
              id={`${id}-reply`}
              rows={1}
              maxLength={2000}
              required
              className="max-h-40 min-h-10 flex-1"
              placeholder="Add details for staff…"
              value={replyDraft}
              // Read-only, not disabled, so focus stays here while it sends.
              readOnly={command.locked}
              aria-disabled={command.locked}
              onChange={(event) => onReplyDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends; Shift+Enter adds a new line.
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <Button
              type="submit"
              className="h-10"
              disabled={command.locked || !replyDraft.trim()}
            >
              <Send aria-hidden="true" />
              Send
            </Button>
          </form>
        )}
        {archived && (
          <p className="border-t p-4 text-sm text-muted-foreground">
            This event is archived. Records are read only.
          </p>
        )}
      </section>
    </article>
  );
}
