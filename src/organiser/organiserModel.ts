import {
  type Issue,
  isStaff,
  isSupport,
  type Membership,
  type Resolution,
  type Snapshot,
  unresolvedTime,
} from "@/connected/model";
import { type JuryRow, juryWorklists } from "@/connected/jury";
import { normalizeTeamText } from "@/connected/teamSearch";

/** A tab of the organiser phone app. */
export type OrganiserTab = "queue" | "mine" | "awards" | "find" | "session" | "me";

/**
 * Jury members without support roles or admin rights see resolved issues
 * only. This is the same rule as before T0015.
 */
export function isJuryOnly(member: Membership): boolean {
  return (
    member.roles.includes("jury") && !isSupport(member) && !member.is_admin
  );
}

/**
 * The tabs that a person's combined roles give, in display order.
 * Volunteers and specialists get Queue and Mine. Jury members get Awards.
 * Admins without support roles still get Queue to follow the session. Every
 * person gets Find and Me. Admins also get Session.
 */
export function organiserTabs(member: Membership): OrganiserTab[] {
  const tabs: OrganiserTab[] = [];
  if (isSupport(member)) tabs.push("queue", "mine");
  else if (!isJuryOnly(member)) tabs.push("queue");
  if (member.roles.includes("jury")) tabs.push("awards");
  tabs.push("find");
  if (member.is_admin) tabs.push("session");
  tabs.push("me");
  return tabs;
}

/** The issues that this person can see in the organiser app. */
export function visibleIssues(
  issues: readonly Issue[],
  member: Membership,
): Issue[] {
  return isJuryOnly(member)
    ? issues.filter((issue) => issue.status === "resolved")
    : [...issues];
}

/**
 * The issues that this person can open. Jury members can also open an issue
 * that was reopened after its award, while the award waits for external
 * application (T0009). The ordinary jury queue stays resolved only.
 */
export function openableIssues(state: Snapshot, member: Membership): Issue[] {
  const issues = visibleIssues(state.issues, member);
  if (!isJuryOnly(member)) return issues;
  const pending = juryWorklists(state)
    .application.map((row) => row.issue)
    .filter((issue) => issue.status !== "resolved");
  return [...issues, ...pending];
}

/** A list of the jury award pages. */
export type AwardList = "decide" | "apply" | "done";

/**
 * The jury award lists. "decide" and "apply" are the T0009 worklists:
 * resolved issues without an award, oldest resolution first, and every award
 * that waits for external application, also on a reopened issue and with
 * zero minutes, oldest decision first. "done" holds resolved issues with an
 * applied award, latest confirmation first.
 */
export function awardLists(state: Snapshot): Record<AwardList, JuryRow[]> {
  const { decision, application } = juryWorklists(state);
  const resolutions = (issueId: string) =>
    state.resolutions.filter((item) => item.issue_id === issueId);
  const done = state.awards
    .filter((award) => award.applied_at)
    .flatMap((award): JuryRow[] => {
      const issue = state.issues.find((item) => item.id === award.issue_id);
      if (!issue || issue.status !== "resolved") return [];
      return [
        {
          issue,
          team: state.teams.find((team) => team.id === issue.team_id),
          resolution: state.resolutions.find(
            (item) => item.id === award.resolution_id,
          ),
          resolutions: resolutions(issue.id),
          award,
        },
      ];
    })
    .sort(
      (a, b) =>
        Date.parse(b.award?.applied_at ?? "") -
          Date.parse(a.award?.applied_at ?? "") ||
        a.issue.number - b.issue.number,
    );
  return { decide: decision, apply: application, done };
}

/** A filter chip of the queue. */
export type QueueChip = "waiting" | "handoffs" | "active" | "resolved";

export const queueChips: readonly { chip: QueueChip; label: string }[] = [
  { chip: "waiting", label: "Waiting" },
  { chip: "handoffs", label: "Handoffs" },
  { chip: "active", label: "All active" },
  { chip: "resolved", label: "Resolved" },
];

/**
 * Maps the shared status filter of useWorkflowState to a chip. "all" and
 * "claimed" show all active issues, so a reopened issue stays in view.
 */
export function chipForFilter(filter: string): QueueChip {
  if (filter === "open") return "waiting";
  if (filter === "escalated") return "handoffs";
  if (filter === "resolved") return "resolved";
  return "active";
}

/** The shared status filter value for a chip. */
export function filterForChip(chip: QueueChip): string {
  return { waiting: "open", handoffs: "escalated", active: "all", resolved: "resolved" }[chip];
}

export function matchesChip(issue: Issue, chip: QueueChip): boolean {
  switch (chip) {
    case "waiting":
      return issue.status === "open";
    case "handoffs":
      return issue.status === "escalated";
    case "active":
      return issue.status !== "resolved";
    case "resolved":
      return issue.status === "resolved";
  }
}

/**
 * Sorts issues by unresolved time, longest first. Equal times keep the
 * lower issue number first so the order is stable between refreshes.
 */
export function sortByUnresolved(
  issues: readonly Issue[],
  resolutions: readonly Resolution[],
  now: number,
): Issue[] {
  return issues
    .map((issue) => ({ issue, ms: unresolvedTime(issue, resolutions, now) }))
    .sort((a, b) => b.ms - a.ms || a.issue.number - b.issue.number)
    .map(({ issue }) => issue);
}

/** How long an issue has waited: under 10 minutes, under 20, or longer. */
export type AgeTier = "fresh" | "warn" | "critical";

export const ageWarnMs = 10 * 60_000;
export const ageCriticalMs = 20 * 60_000;

export function ageTier(ms: number): AgeTier {
  if (ms < ageWarnMs) return "fresh";
  if (ms < ageCriticalMs) return "warn";
  return "critical";
}

/** The text color for an age tier. Resolved issues stay neutral. */
export function ageClass(tier: AgeTier, resolved: boolean): string {
  if (resolved || tier === "fresh") return "text-foreground";
  return tier === "warn" ? "text-age-warn" : "text-age-critical";
}

/** The area and the table or desk number of a team location. */
export interface Place {
  /** For example "Hall A". Empty when the location has no area. */
  area: string;
  /** For example "7". Empty when the location has no number. */
  seat: string;
}

/**
 * Splits a location such as "Hall A · Table 7" into its area and seat
 * number, so cards can show the seat first. Other text stays in `area`.
 */
export function placeOf(location: string): Place {
  const match = location
    .trim()
    .match(
      /^(.*?)[\s,·|/-]*(?:\b(?:table|desk|seat|station|booth|pc)\s*)?#?(\d+[a-z]?)$/iu,
    );
  if (!match) return { area: location.trim(), seat: "" };
  return { area: match[1].replace(/[\s,·|/-]+$/u, "").trim(), seat: match[2] };
}

/**
 * Returns the issues whose number matches the query, such as "31",
 * "#31" or "ISS-31".
 */
export function issuesByNumber(
  issues: readonly Issue[],
  query: string,
): Issue[] {
  const match = normalizeTeamText(query).match(/^(?:iss\s*)?(\d+)$/u);
  if (!match) return [];
  const number = Number(match[1]);
  return issues.filter((issue) => issue.number === number);
}

/** The main action of the issue view's bottom bar. */
export type PrimaryAction =
  | "claim"
  | "resolve"
  | "accept"
  | "reopen"
  | "award"
  | "apply";

/** What the person can do with one issue. */
export interface IssueAbilities {
  claim: boolean;
  escalate: boolean;
  accept: boolean;
  resolve: boolean;
  reopen: boolean;
  reply: boolean;
  /** Choose public or internal audience for a reply. */
  internalNotes: boolean;
  award: boolean;
  apply: boolean;
  upload: boolean;
}

/**
 * The actions that the membership allows on an issue. These are the same
 * rules as the workflow screens before T0015. The database enforces them
 * again.
 */
export function issueAbilities(
  issue: Issue,
  state: Pick<Snapshot, "awards" | "event">,
  member: Membership,
): IssueAbilities {
  const archived = Boolean(state.event?.archived);
  const support = isSupport(member);
  const staff = isStaff(member);
  const active = issue.status !== "resolved";
  const owner = support && issue.owner === member.user_id;
  const award = state.awards.find((item) => item.issue_id === issue.id);
  const jury = member.roles.includes("jury");
  const allowed = {
    claim: support && issue.status === "open",
    escalate: owner && issue.status === "claimed",
    accept:
      issue.status === "escalated" &&
      member.roles.includes("specialist") &&
      issue.owner !== member.user_id,
    resolve: active && owner,
    reopen: !active && (support || member.team_id === issue.team_id),
    reply: active && (support || jury),
    internalNotes: staff,
    award: !active && !award && jury,
    apply: Boolean(award && !award.applied_at && (support || jury)),
    upload: staff,
  };
  if (!archived) return allowed;
  return Object.fromEntries(
    Object.keys(allowed).map((key) => [key, false]),
  ) as unknown as IssueAbilities;
}

/**
 * Picks the one primary action for the bottom bar. Jury work comes first on
 * resolved issues, because a reopen is rarer than an award decision.
 */
export function primaryAction(
  abilities: IssueAbilities,
): PrimaryAction | undefined {
  if (abilities.accept) return "accept";
  if (abilities.claim) return "claim";
  if (abilities.resolve) return "resolve";
  if (abilities.award) return "award";
  if (abilities.apply) return "apply";
  if (abilities.reopen) return "reopen";
  return undefined;
}

/** Initials for an avatar, for example "PR" for "Priya Raman". */
export function initials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

/** The role names of a membership, for example "Volunteer · Admin". */
export function roleNames(member: Membership): string {
  if (member.team_id) return "Contestant";
  return [...member.roles, ...(member.is_admin ? ["admin"] : [])]
    .map((role) => role.charAt(0).toUpperCase() + role.slice(1))
    .join(" · ");
}
