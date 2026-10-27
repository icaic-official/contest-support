import type { AccountCommand, MembershipInput } from "@/backend/contracts";
import { statusNames } from "@/connected/labels";
import type { Issue, Membership, Role, Snapshot } from "@/connected/model";

/** The username rule of the `admin` function, as an HTML `pattern`. */
export const usernamePattern = "[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}";

/** The staff roles in the order that the forms show them. */
export const staffRoles: readonly Role[] = ["volunteer", "specialist", "jury"];

/** Session image limits in the units that admins edit. */
export interface ImageLimits {
  fileMb: number;
  count: number;
  totalMb: number;
}

/** The smallest and largest value of each image limit. */
export const imageLimitBounds: Record<
  keyof ImageLimits,
  { min: number; max: number }
> = {
  fileMb: { min: 1, max: 50 },
  count: { min: 1, max: 24 },
  totalMb: { min: 1, max: 120 },
};

const megabyte = 1048576;

/** The current image limits of a session. */
export function limitsOfSession(
  session: NonNullable<Snapshot["session"]>,
): ImageLimits {
  return {
    fileMb: session.max_image_bytes / megabyte,
    count: session.max_images_per_issue,
    totalMb: session.max_image_bytes_per_issue / megabyte,
  };
}

/** Whether a limit is a whole number inside its bounds. */
export function isValidLimit(key: keyof ImageLimits, value: number): boolean {
  const { min, max } = imageLimitBounds[key];
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Moves a limit by one step and keeps it inside its bounds. */
export function stepLimit(
  key: keyof ImageLimits,
  value: number,
  step: 1 | -1,
): number {
  const { min, max } = imageLimitBounds[key];
  const start = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, start + step));
}

/** The image limits as the backend administration contract takes them. */
export function imageLimitsInput(limits: ImageLimits) {
  return {
    fileMegabytes: limits.fileMb,
    count: limits.count,
    totalMegabytes: limits.totalMb,
  };
}

/**
 * The membership that an admin edits. A team account has no staff roles and
 * no admin rights, as in the form from before T0015.
 */
export interface MembershipDraft {
  kind: "staff" | "team";
  /** The team of a team account. It is empty until the admin chooses one. */
  teamId: string;
  roles: readonly Role[];
  isAdmin: boolean;
}

/** The draft of an existing membership, or of a new staff account. */
export function draftOfMembership(
  member?: Membership,
  defaultRoles: readonly Role[] = [],
): MembershipDraft {
  if (!member) {
    return { kind: "staff", teamId: "", roles: defaultRoles, isAdmin: false };
  }
  return {
    kind: member.team_id ? "team" : "staff",
    teamId: member.team_id ?? "",
    roles: staffRoles.filter((role) => member.roles.includes(role)),
    isAdmin: member.is_admin,
  };
}

/** Whether a draft can be sent. A team account needs its team. */
export function isCompleteMembership(draft: MembershipDraft): boolean {
  return draft.kind === "staff" || draft.teamId !== "";
}

/** Adds or removes one role and keeps the roles in form order. */
export function toggleRole(
  draft: MembershipDraft,
  role: Role,
  on: boolean,
): MembershipDraft {
  const roles = new Set(draft.roles);
  if (on) roles.add(role);
  else roles.delete(role);
  return { ...draft, roles: staffRoles.filter((item) => roles.has(item)) };
}

/**
 * The membership fields that the server stores for a draft. A team account
 * has no staff roles and no admin rights.
 */
export function membershipInput(draft: MembershipDraft): MembershipInput {
  const teamId = draft.kind === "team" && draft.teamId ? draft.teamId : null;
  return {
    teamId,
    roles: teamId ? [] : [...draft.roles],
    isAdmin: teamId ? false : draft.isAdmin,
  };
}

/** A new account as the create form holds it. */
export interface NewAccount {
  name: string;
  username: string;
  membership: MembershipDraft;
}

/** The account command that creates an account. */
export function createAccountCommand(account: NewAccount): AccountCommand {
  return {
    action: "create_account",
    username: account.username.trim(),
    name: account.name.trim(),
    ...membershipInput(account.membership),
  };
}

/** The account command that gives an account its first username. */
export function setUsernameCommand(
  userId: string,
  username: string,
): AccountCommand {
  return { action: "set_username", userId, username: username.trim() };
}

/** The account command that issues a new temporary password. */
export function resetPasswordCommand(userId: string): AccountCommand {
  return { action: "reset_password", userId };
}

/** One session member as the snapshot holds it. */
export type SessionMember = Snapshot["members"][number];

/**
 * What an account is in this session: the team name of a team account, or
 * its staff roles and Admin.
 */
export function accountKind(
  member: Membership,
  teams: Snapshot["teams"],
): { team?: string; labels: string[] } {
  if (member.team_id) {
    return {
      team:
        teams.find((team) => team.id === member.team_id)?.name ??
        "Team contestant",
      labels: [],
    };
  }
  return {
    labels: [
      ...staffRoles
        .filter((role) => member.roles.includes(role))
        .map((role) => role.charAt(0).toUpperCase() + role.slice(1)),
      ...(member.is_admin ? ["Admin"] : []),
    ],
  };
}

/** The number of issues in each status, in status order. */
export function statusCounts(
  issues: readonly Issue[],
): { status: Issue["status"]; label: string; count: number }[] {
  return (Object.keys(statusNames) as Issue["status"][]).map((status) => ({
    status,
    label: statusNames[status],
    count: issues.filter((issue) => issue.status === status).length,
  }));
}

/**
 * An audit entry in words, for example "reset password for Ben Okoro". The
 * target is always an account. Its name is missing when the action has no
 * target and when the person is no longer in the session. The ID never shows.
 */
export function auditEntryText(
  members: readonly SessionMember[],
  entry: Pick<Snapshot["audit"][number], "action" | "target">,
): string {
  const action = entry.action.replaceAll("_", " ");
  const name = members.find((item) => item.person.id === entry.target)?.person.name;
  return name ? `${action} for ${name}` : action;
}

/** The name of an audit actor, or the account ID when it left the session. */
export function actorName(
  members: readonly SessionMember[],
  actor: string,
): string {
  return members.find((item) => item.person.id === actor)?.person.name ?? actor;
}
