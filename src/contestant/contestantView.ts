import type { Attachment, Issue, Resolution, Snapshot } from "@/connected/model";

/** The id of the main heading. Navigation moves focus to it. */
export const contestantHeadingId = "contestant-heading";

type HistoryEntry = Snapshot["history"][number];
type Award = Snapshot["awards"][number];

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

function sameTime(a: string | null | undefined, b: string): boolean {
  return Boolean(a) && Date.parse(a ?? "") === Date.parse(b);
}

/**
 * Sorts the public activity into chat messages and workflow events. The
 * history table does not store a type, so events are found by their fixed
 * text and, where the text contains free input, by the record timestamp.
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
  const { issue, resolutions, award, userId } = context;
  return entries.map((entry): ConversationItem => {
    const who = entry.actor === userId ? "You" : entry.actor_name;
    const event = (text: string): ConversationItem => ({
      kind: "event",
      entry,
      text,
    });
    const value = entry.text;
    if (value === "Issue claimed.") return event(`${who} took the report`);
    if (value === "Specialist handoff requested. Current owner retained.") {
      return event(`${who} asked a specialist for help`);
    }
    if (value === "Specialist accepted ownership.") {
      return event(`${who} took over as specialist`);
    }
    if (value === "Image added.") return event(`${who} added an image`);
    if (value === "Image removed.") return event(`${who} removed an image`);
    if (value.startsWith("External application confirmed.")) {
      return event("The time award was applied to your contest time");
    }
    if (
      value.startsWith("Issue submitted: ") &&
      sameTime(issue.created_at, entry.at)
    ) {
      return event(`${who} sent the report`);
    }
    if (
      value.startsWith("Resolved: ") &&
      resolutions.some((r) => sameTime(r.at, entry.at))
    ) {
      return event(`${who} resolved the issue`);
    }
    if (
      value.startsWith("Reopened: ") &&
      resolutions.some((r) => sameTime(r.reopened_at, entry.at))
    ) {
      return event(
        `${who} reopened the issue: ${value.slice("Reopened: ".length)}`,
      );
    }
    if (/^\d+ minutes awarded: /.test(value) && sameTime(award?.at, entry.at)) {
      return event("The jury decided a time award");
    }
    return { kind: "message", entry, mine: entry.actor === userId };
  });
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
              .join(" · ")
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
        ? `+${award.minutes} min decided`
        : resolved
          ? "The jury can decide an award"
          : "After resolution",
      done: Boolean(award),
    },
  ];
  const current = steps.findIndex((step) => !step.done);
  return steps.map((step, index) => ({ ...step, current: index === current }));
}

/** A short age such as "now", "9m ago" or "2h 5m ago". */
export function relativeAge(value: string, now: number): string {
  const minutes = Math.floor(Math.max(0, now - Date.parse(value)) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

/** Why the team cannot send a report now, or undefined when it can. */
export function reportBlocker(
  snapshot: Pick<Snapshot, "event" | "session">,
): string | undefined {
  if (snapshot.event?.archived) {
    return "This event is archived. Records are read only.";
  }
  if (!snapshot.session?.intake_open) {
    return "Reporting is closed by the organisers.";
  }
  return undefined;
}
