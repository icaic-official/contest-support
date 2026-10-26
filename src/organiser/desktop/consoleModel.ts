import { statusNames } from "@/connected/labels";
import {
  type Issue,
  isSupport,
  type Membership,
  type Resolution,
  type Snapshot,
  type StatusFilter,
  unresolvedTime,
} from "@/connected/model";
import { normalizeTeamText } from "@/connected/teamSearch";
import { isJuryOnly, issuesByNumber } from "../organiserModel";

/** A page of the organiser desktop console. */
export type ConsolePage =
  | "queue"
  | "mine"
  | "handoffs"
  | "teams"
  | "awards"
  | "overview"
  | "accounts"
  | "roster"
  | "settings";

export const consolePageLabels: Record<ConsolePage, string> = {
  queue: "Queue",
  mine: "Assigned to me",
  handoffs: "Handoffs",
  teams: "Teams & tables",
  awards: "Award review",
  overview: "Overview",
  accounts: "Accounts",
  roster: "Roster",
  settings: "Session settings",
};

/** A group of sidebar pages with a heading. */
export interface ConsoleNavGroup {
  label: string;
  pages: ConsolePage[];
}

/**
 * The sidebar groups that a person's combined roles give, in display order.
 * Volunteers and specialists get the support pages. Jury members get Award
 * review. Admins get Overview, Accounts, Roster and Session settings. Admins without
 * support roles still get Queue, as in the phone app. Every person gets
 * Teams & tables.
 */
export function consoleNavGroups(member: Membership): ConsoleNavGroup[] {
  const work: ConsolePage[] = [];
  if (isSupport(member)) work.push("queue", "mine", "handoffs");
  else if (!isJuryOnly(member)) work.push("queue");
  if (member.roles.includes("jury")) work.push("awards");
  work.push("teams");
  const groups: ConsoleNavGroup[] = [{ label: "Workspace", pages: work }];
  if (member.is_admin) {
    groups.push({ label: "Admin", pages: ["overview", "accounts", "roster", "settings"] });
  }
  return groups;
}

/** Every page that the person can open, in sidebar order. */
export function consolePages(member: Membership): ConsolePage[] {
  return consoleNavGroups(member).flatMap((group) => group.pages);
}

/** The number that the sidebar shows next to a page, if any. */
export function navCount(
  page: ConsolePage,
  issues: readonly Issue[],
  state: Pick<Snapshot, "awards">,
  member: Membership,
): number | undefined {
  switch (page) {
    case "queue":
      return issues.filter((issue) => issue.status !== "resolved").length;
    case "mine":
      return issues.filter(
        (issue) =>
          issue.owner === member.user_id && issue.status !== "resolved",
      ).length;
    case "handoffs":
      return issues.filter((issue) => issue.status === "escalated").length;
    case "awards":
      return issues.filter(
        (issue) =>
          issue.status === "resolved" &&
          !state.awards.some((award) => award.issue_id === issue.id),
      ).length;
    default:
      return undefined;
  }
}

/** A tab of the queue table. */
export type QueueTab =
  | "active"
  | "open"
  | "claimed"
  | "escalated"
  | "resolved"
  | "everything";

export const queueTabs: readonly { tab: QueueTab; label: string }[] = [
  { tab: "active", label: "Active" },
  { tab: "open", label: statusNames.open },
  { tab: "claimed", label: statusNames.claimed },
  { tab: "escalated", label: statusNames.escalated },
  { tab: "resolved", label: statusNames.resolved },
  { tab: "everything", label: "All" },
];

/**
 * Maps the shared status filter of useWorkflowState to a queue tab. "all" is
 * the default and shows active issues, as the phone app does. "claimed"
 * after a reopen shows In progress, so the reopened issue stays in view.
 */
export function queueTabForFilter(filter: StatusFilter): QueueTab {
  return filter === "all" ? "active" : filter;
}

/** The shared status filter value for a queue tab. */
export function filterForQueueTab(tab: QueueTab): StatusFilter {
  return tab === "active" ? "all" : tab;
}

export function matchesQueueTab(issue: Issue, tab: QueueTab): boolean {
  if (tab === "everything") return true;
  if (tab === "active") return issue.status !== "resolved";
  return issue.status === tab;
}

/** The middle value of a list, or undefined for an empty list. */
export function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The numbers on the status cards of the queue and the overview. */
export interface QueueStats {
  open: number;
  /** Unresolved time of the oldest open issue. */
  oldestOpenMs?: number;
  claimed: number;
  /** Distinct owners of issues in progress. */
  helpers: number;
  escalated: number;
  resolved: number;
  /** Median unresolved time of resolved issues. */
  medianResolvedMs?: number;
}

/** Counts issues by status from persisted timestamps. */
export function queueStats(
  issues: readonly Issue[],
  resolutions: readonly Resolution[],
  now: number,
): QueueStats {
  const of = (status: Issue["status"]) =>
    issues.filter((issue) => issue.status === status);
  const open = of("open");
  const claimed = of("claimed");
  const resolved = of("resolved");
  const openTimes = open.map((issue) => unresolvedTime(issue, resolutions, now));
  return {
    open: open.length,
    oldestOpenMs: openTimes.length ? Math.max(...openTimes) : undefined,
    claimed: claimed.length,
    helpers: new Set(claimed.map((issue) => issue.owner).filter(Boolean)).size,
    escalated: of("escalated").length,
    resolved: resolved.length,
    medianResolvedMs: median(
      resolved.map((issue) => unresolvedTime(issue, resolutions, now)),
    ),
  };
}

/**
 * The number of issues in each category of the session. Categories that
 * issues use but the session no longer lists come last.
 */
export function categoryCounts(
  issues: readonly Issue[],
  categories: readonly string[],
): { category: string; count: number }[] {
  const names = [...categories];
  for (const issue of issues) {
    if (!names.includes(issue.category)) names.push(issue.category);
  }
  return names.map((category) => ({
    category,
    count: issues.filter((issue) => issue.category === category).length,
  }));
}

/** Award totals for the overview. */
export interface AwardSummary {
  /** Minutes in all recorded award decisions. */
  minutes: number;
  /** Awards that wait for confirmation in the external contest system. */
  pending: number;
  applied: number;
  /** Resolved issues without an award decision. */
  undecided: number;
}

export function awardSummary(
  issues: readonly Issue[],
  awards: Snapshot["awards"],
): AwardSummary {
  return {
    minutes: awards.reduce((total, award) => total + award.minutes, 0),
    pending: awards.filter((award) => !award.applied_at).length,
    applied: awards.filter((award) => award.applied_at).length,
    undecided: issues.filter(
      (issue) =>
        issue.status === "resolved" &&
        !awards.some((award) => award.issue_id === issue.id),
    ).length,
  };
}

/** Active issues per owner, most first. Owners are identified by person. */
export function ownerWorkload(
  issues: readonly Issue[],
): { owner: string; name: string; active: number }[] {
  const counts = new Map<string, { owner: string; name: string; active: number }>();
  for (const issue of issues) {
    if (!issue.owner || issue.status === "resolved") continue;
    const entry = counts.get(issue.owner) ?? {
      owner: issue.owner,
      name: issue.owner_name ?? "Unknown person",
      active: 0,
    };
    entry.active += 1;
    counts.set(issue.owner, entry);
  }
  return [...counts.values()].sort(
    (a, b) => b.active - a.active || a.name.localeCompare(b.name),
  );
}

/** The most issues that the command palette lists. */
export const paletteIssueLimit = 6;

/**
 * The issues for a command palette query: number matches ("31", "#31",
 * "ISS-31") first, then issues whose report or category contains the
 * query. Text matches need at least three characters.
 */
export function paletteIssues(
  issues: readonly Issue[],
  query: string,
): Issue[] {
  const numbered = issuesByNumber(issues, query);
  const text = normalizeTeamText(query);
  const described =
    text.length < 3
      ? []
      : issues.filter(
          (issue) =>
            !numbered.includes(issue) &&
            (normalizeTeamText(issue.description).includes(text) ||
              normalizeTeamText(issue.category).includes(text)),
        );
  return [...numbered, ...described].slice(0, paletteIssueLimit);
}

/** Whether a palette entry label matches the query. An empty query matches. */
export function labelMatches(label: string, query: string): boolean {
  const text = normalizeTeamText(query);
  return !text || normalizeTeamText(label).includes(text);
}

/** The person who resolved an issue most recently, if it is resolved. */
export function latestResolver(
  issue: Issue,
  resolutions: readonly Resolution[],
): string | undefined {
  if (issue.status !== "resolved") return undefined;
  const records = resolutions.filter((record) => record.issue_id === issue.id);
  return records.at(-1)?.actor_name;
}
