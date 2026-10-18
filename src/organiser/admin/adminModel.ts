import { statusNames } from "@/connected/labels";
import type { Issue, Membership, Role, Snapshot } from "@/connected/model";

/** The username rule of the `admin` function, as an HTML `pattern`. */
export const usernamePattern = "[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}";

const usernameExpression = new RegExp(`^${usernamePattern}$`);

/** Whether the admin function accepts this username. */
export function isValidUsername(value: string): boolean {
  return usernameExpression.test(value.trim());
}

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

/** The parameters of the `set_image_limits` RPC. */
export function imageLimitsParams(sessionId: string, limits: ImageLimits) {
  return {
    p_session: sessionId,
    p_file_mb: limits.fileMb,
    p_count: limits.count,
    p_total_mb: limits.totalMb,
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

/** The membership fields that the server stores for a draft. */
export function membershipValues(draft: MembershipDraft) {
  const team = draft.kind === "team" && draft.teamId ? draft.teamId : null;
  return {
    team,
    roles: team ? [] : [...draft.roles],
    admin: team ? false : draft.isAdmin,
  };
}

/** The parameters of `manage_member` that add or update a membership. */
export function manageMemberParams(
  sessionId: string,
  userId: string,
  draft: MembershipDraft,
) {
  const values = membershipValues(draft);
  return {
    p_session: sessionId,
    p_user: userId.trim(),
    p_team: values.team,
    p_roles: values.roles,
    p_admin: values.admin,
    p_remove: false,
  };
}

/** The parameters of `manage_member` that remove session access. */
export function revokeMemberParams(sessionId: string, userId: string) {
  return { p_session: sessionId, p_user: userId, p_remove: true };
}

/** A new account as the create form holds it. */
export interface NewAccount {
  name: string;
  username: string;
  membership: MembershipDraft;
}

/** One request body of the `admin` Edge Function. */
export type AdminRequest =
  | {
      action: "create_account";
      session_id: string;
      username: string;
      name: string;
      team_id: string | null;
      roles: Role[];
      is_admin: boolean;
    }
  | {
      action: "set_username";
      session_id: string;
      user_id: string;
      username: string;
    }
  | { action: "reset_password"; session_id: string; user_id: string };

/** The `admin` function body that creates an account. */
export function createAccountRequest(
  sessionId: string,
  account: NewAccount,
): AdminRequest {
  const values = membershipValues(account.membership);
  return {
    action: "create_account",
    session_id: sessionId,
    username: account.username.trim(),
    name: account.name.trim(),
    team_id: values.team,
    roles: values.roles,
    is_admin: values.admin,
  };
}

/** The `admin` function body that gives an account its first username. */
export function setUsernameRequest(
  sessionId: string,
  userId: string,
  username: string,
): AdminRequest {
  return {
    action: "set_username",
    session_id: sessionId,
    user_id: userId,
    username: username.trim(),
  };
}

/** The `admin` function body that issues a new temporary password. */
export function resetPasswordRequest(
  sessionId: string,
  userId: string,
): AdminRequest {
  return { action: "reset_password", session_id: sessionId, user_id: userId };
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
        .map((role) => role[0].toUpperCase() + role.slice(1)),
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

/** An audit action in words, for example "reset password". */
export function auditActionText(action: string): string {
  return action.replaceAll("_", " ");
}

/** The name of an audit actor, or the account ID when it left the session. */
export function actorName(
  members: readonly SessionMember[],
  actor: string,
): string {
  return members.find((item) => item.person.id === actor)?.person.name ?? actor;
}
