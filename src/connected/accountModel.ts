import type { AccountIdentity } from "@/backend/contracts";
import { workflowEvent } from "./historyEvents";
import type { Membership, Role, Snapshot } from "./model";

/** Who the account is in the selected session. A team account has no staff roles. */
export type AccountKind =
  | { kind: "team"; teamName: string; location: string }
  | { kind: "staff"; roles: readonly Role[]; isAdmin: boolean };

export function accountKind(state: Snapshot, member: Membership): AccountKind {
  if (member.team_id) {
    const team = state.teams.find((item) => item.id === member.team_id);
    return {
      kind: "team",
      teamName: team?.name ?? "Your team",
      location: team?.location ?? "",
    };
  }
  return { kind: "staff", roles: member.roles, isAdmin: member.is_admin };
}

/** A staff capability. The admin flag is not a role, but it reads like one. */
export type Capability = Role | "admin";

/** What each capability allows, from the rules in src/server/workflow.ts. */
export const capabilityInfo: Record<
  Capability,
  { label: string; description: string }
> = {
  volunteer: {
    label: "Volunteer",
    description:
      "Claims open issues, replies to teams, writes internal notes, and resolves the issues you own. Reports an issue for a team, and asks a specialist for help.",
  },
  specialist: {
    label: "Specialist",
    description:
      "Does everything a volunteer does. Also accepts the issues that other staff hand off for specialist help.",
  },
  jury: {
    label: "Jury",
    description:
      "Reviews resolved issues, decides time awards, confirms when an award is applied to the contest clock, and publishes announcements.",
  },
  admin: {
    label: "Session admin",
    description:
      "Manages accounts, roles, contestant intake, image limits, and announcements for this session. Resolves an assigned issue when its owner is away. This role alone does not claim or reply to issues.",
  },
};

/** What a team account can do. */
export const teamAccountDescription =
  "Reports issues for your team, replies to staff, reopens a resolved report, and views the images that staff share with your team.";

/** The capabilities of a staff account, roles first. A team account has none. */
export function capabilities(kind: AccountKind): readonly Capability[] {
  if (kind.kind === "team") return [];
  return [...kind.roles, ...(kind.isAdmin ? (["admin"] as const) : [])];
}

/** The sections of the account page, in order. They also make its section nav. */
export const accountSections = [
  { id: "profile", label: "Profile" },
  { id: "access", label: "Access" },
  { id: "sessions", label: "Sessions" },
  { id: "security", label: "Security" },
  { id: "appearance", label: "Appearance" },
  { id: "activity", label: "Activity" },
  { id: "help", label: "Help" },
] as const;

/** The name that the console, the phone Me tab and the account page show. */
export function accountName(
  state: Snapshot,
  user: AccountIdentity,
  username: string | null,
): string {
  return (
    state.members.find((item) => item.person.id === user.id)?.person.name ??
    user.name ??
    username ??
    user.email ??
    "Your account"
  );
}

export interface AccountActivityItem {
  id: string;
  at: string;
  issueNumber: number;
  kind: "reply" | "note" | "resolution";
  text: string;
}

export interface AccountActivity {
  /** Staff: unresolved issues the person owns. Team: unresolved team issues. */
  open: number;
  /** Staff: resolutions the person recorded. Team: resolved team issues. */
  resolved: number;
  /** Replies and notes the person wrote. */
  messages: number;
  /** Newest first, at most 5, from the person's history entries and resolutions. */
  recent: AccountActivityItem[];
}

const recentLimit = 5;

/**
 * What the person did in the selected session, from the snapshot they can
 * see. Workflow steps such as a claim or a resolution are not messages. A
 * resolution counts for its actor and appears once, from the resolution.
 */
export function accountActivity(
  state: Snapshot,
  member: Membership,
  userId: string,
): AccountActivity {
  const teamId = member.team_id;
  const issues = teamId
    ? state.issues.filter((issue) => issue.team_id === teamId)
    : state.issues.filter((issue) => issue.owner === userId);
  const resolutions = state.resolutions.filter(
    (resolution) => resolution.actor === userId,
  );
  const issuesById = new Map(state.issues.map((issue) => [issue.id, issue]));

  const messages: AccountActivityItem[] = [];
  for (const entry of state.history) {
    if (entry.actor !== userId) continue;
    const issue = issuesById.get(entry.issue_id);
    if (!issue) continue;
    const event = workflowEvent(entry, {
      issue,
      resolutions: state.resolutions.filter(
        (resolution) => resolution.issue_id === issue.id,
      ),
      award: state.awards.find((award) => award.issue_id === issue.id),
    });
    if (event) continue;
    messages.push({
      id: entry.id,
      at: entry.at,
      issueNumber: issue.number,
      kind: entry.visibility === "internal" ? "note" : "reply",
      text: entry.text,
    });
  }

  const recorded = resolutions.flatMap((resolution): AccountActivityItem[] => {
    const issue = issuesById.get(resolution.issue_id);
    if (!issue) return [];
    return [
      {
        id: resolution.id,
        at: resolution.at,
        issueNumber: issue.number,
        kind: "resolution",
        text: resolution.summary,
      },
    ];
  });

  return {
    open: issues.filter((issue) => issue.status !== "resolved").length,
    resolved: teamId
      ? issues.filter((issue) => issue.status === "resolved").length
      : resolutions.length,
    messages: messages.length,
    recent: [...messages, ...recorded]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))
      .slice(0, recentLimit),
  };
}
