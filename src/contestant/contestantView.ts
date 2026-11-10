import { closedMessage } from "@/connected/contestClock";
import { type WorkflowEvent, workflowEvent } from "@/connected/historyEvents";
import { awardMinutesLabel } from "@/connected/labels";
import type { Attachment, Award, HistoryEntry, Issue, Resolution, Snapshot } from "@/connected/model";

/** The id of the main heading. Navigation moves focus to it. */
export const contestantHeadingId = "contestant-heading";

/**
 * The reports of one team, newest first. The server sends only the team's own
 * issues to a team account. This filter is a second check.
 */
export function teamIssues(
  issues: readonly Issue[],
  teamId: string,
): Issue[] {
  return issues
    .filter((issue) => issue.team_id === teamId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** The resolutions of one issue, oldest first. */
export function issueResolutions(
  resolutions: readonly Resolution[],
  issueId: string,
): Resolution[] {
  return resolutions
    .filter((resolution) => resolution.issue_id === issueId)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * The public activity of one issue. Internal notes are never returned, even
 * when the snapshot contains them.
 */
export function publicHistory(
  history: readonly HistoryEntry[],
  issueId: string,
): HistoryEntry[] {
  return history
    .filter((item) => item.issue_id === issueId && item.visibility === "public")
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * The team-visible images of one issue. Staff-only images are never
 * returned, even when the snapshot contains them.
 */
export function teamImages(
  attachments: readonly Attachment[],
  issueId: string,
): Attachment[] {
  return attachments.filter(
    (item) => item.issue_id === issueId && item.visibility === "public",
  );
}

/** One entry of the contestant message list. */
export type ConversationItem =
  | { kind: "message"; entry: HistoryEntry; mine: boolean }
  | { kind: "event"; entry: HistoryEntry; text: string };

/**
 * Sorts the public activity into chat messages and workflow events. The
 * history table does not store a type, so `workflowEvent` tells them apart.
 */
export function conversation(
  entries: readonly HistoryEntry[],
  context: {
    issue: Issue;
    resolutions: readonly Resolution[];
    award: Award | undefined;
    /** The user ID of the team account. */
    userId: string;
  },
): ConversationItem[] {
  const { userId } = context;
  const awardWithdrawn = entries.some((entry) => workflowEvent(entry, context)?.kind === "withdrawn");
  return entries.map((entry): ConversationItem => {
    const who = entry.actor === userId ? "You" : entry.actor_name;
    const event = workflowEvent(entry, { ...context, awardWithdrawn });
    if (!event) return { kind: "message", entry, mine: entry.actor === userId };
    return { kind: "event", entry, text: eventText(event, who) };
  });
}

/** The sentence that the report timeline shows for a workflow event. */
function eventText(event: WorkflowEvent, who: string): string {
  switch (event.kind) {
    case "submitted":
      return `${who} sent the report`;
    case "claimed":
      return `${who} took the report`;
    case "handoff":
      return `${who} asked a specialist for help`;
    case "accepted":
      return `${who} took over as specialist`;
    case "image-added":
      return `${who} added an image`;
    case "image-removed":
      return `${who} removed an image`;
    case "applied":
      return "The time award was applied to your contest time";
    case "resolved":
      return `${who} resolved the issue`;
    case "reopened":
      return `${who} reopened the issue: ${event.reason}`;
    case "awarded":
      return "The jury decided a time award";
    case "withdrawn":
      return "The jury withdrew the time award";
  }
}

/** The first word of a name, for a friendly headline. */
function firstName(name: string | null): string | undefined {
  return name?.trim().split(/\s+/)[0] || undefined;
}

/** True when a resolution of the issue was reopened. */
export function wasReopened(resolutions: readonly Resolution[]): boolean {
  return resolutions.some((resolution) => resolution.reopened_at);
}

/** A plain-language headline for the issue page. */
export function issueHeadline(
  issue: Issue,
  options: { location: string | undefined; reopened: boolean },
): string {
  const helper = firstName(issue.owner_name) ?? "A helper";
  switch (issue.status) {
    case "open":
      return options.location
        ? `Your report is in the queue. A helper will come to ${options.location}.`
        : "Your report is in the queue. A helper will come to you.";
    case "claimed":
      return options.reopened
        ? `Your issue is open again. ${helper} is handling it.`
        : `${helper} is handling your report.`;
    case "escalated":
      return "A specialist will look at your report.";
    case "resolved":
      return "This issue is resolved.";
  }
}

/** One step of the four-step progress tracker. */
export interface TrackerStep {
  id: "sent" | "assigned" | "resolved" | "award";
  label: string;
  /** A short detail line, for example a time or a name. */
  detail: string;
  done: boolean;
  /** True for the first step that is not done. */
  current: boolean;
}

/**
 * The tracker steps Sent → Helper assigned → Resolved → Time award. Pass a
 * time formatter so that tests do not depend on the local time zone.
 */
export function trackerSteps(
  issue: Issue,
  award: Award | undefined,
  formatTime: (value: string) => string,
): TrackerStep[] {
  const assigned = Boolean(issue.first_assigned_at);
  const resolved = issue.status === "resolved";
  const steps: Array<Omit<TrackerStep, "current">> = [
    {
      id: "sent",
      label: "Sent",
      detail: formatTime(issue.created_at),
      done: true,
    },
    {
      id: "assigned",
      label: "Helper assigned",
      detail:
        assigned && issue.first_assigned_at
          ? [issue.owner_name, formatTime(issue.first_assigned_at)]
              .filter(Boolean)
              .join(", ")
          : "Waiting for a helper",
      done: assigned,
    },
    {
      id: "resolved",
      label: "Resolved",
      detail:
        resolved && issue.resolved_at
          ? formatTime(issue.resolved_at)
          : issue.status === "escalated"
            ? "Waiting for a specialist"
            : "Not yet",
      done: resolved,
    },
    {
      id: "award",
      label: "Time award",
      detail: award
        ? `Decided: ${awardMinutesLabel(award.minutes)}`
        : resolved
          ? "The jury can decide an award"
          : "After resolution",
      done: Boolean(award),
    },
  ];
  const current = steps.findIndex((step) => !step.done);
  return steps.map((step, index) => ({ ...step, current: index === current }));
}

/**
 * Why the team cannot send a report now, or undefined when it can. `now` is
 * server time in milliseconds. It names the time that reporting opens or
 * closed, such as "Reporting opens at 13:00."
 */
export function reportBlocker(
  snapshot: Pick<Snapshot, "event" | "session" | "clock">,
  now: number = Date.now(),
): string | undefined {
  if (snapshot.event?.archived) {
    return "This event is archived. Records are read only.";
  }
  if (!snapshot.session?.intake_open) {
    return closedMessage(snapshot.clock, now) ?? "Reporting is closed by the organizers.";
  }
  return undefined;
}
