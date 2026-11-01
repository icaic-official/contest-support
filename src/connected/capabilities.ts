import type { Seat } from "../backend/contracts.ts";
import type { Membership, Role } from "./model.ts";

/**
 * What a seat may do in a contest. The Worker's workflow decisions and the
 * browser's gates both read this one table. A new capability without a row
 * fails to compile.
 */
export type Capability =
  | "read_internal"
  | "submit_for_any_entry"
  | "submit_own"
  | "claim"
  | "escalate"
  | "accept"
  | "resolve_any"
  | "reopen_any"
  | "award"
  | "apply"
  | "announce"
  | "upload_staff_images"
  | "configure_contest"
  | "see_members";

function hasRole(seat: Seat, role: Role): boolean {
  return seat.kind === "staff" && seat.roles.includes(role);
}

const supports = (seat: Seat) => hasRole(seat, "volunteer") || hasRole(seat, "specialist");
const isAdmin = (seat: Seat) => seat.kind === "staff" && seat.admin;

export const capabilityRule: { readonly [C in Capability]: (seat: Seat) => boolean } = {
  read_internal: (seat) => seat.kind === "staff",
  submit_for_any_entry: (seat) => seat.kind === "staff",
  submit_own: (seat) => seat.kind === "contestant",
  claim: supports,
  escalate: supports,
  accept: (seat) => hasRole(seat, "specialist"),
  resolve_any: isAdmin,
  reopen_any: supports,
  award: (seat) => hasRole(seat, "jury"),
  apply: (seat) => supports(seat) || hasRole(seat, "jury"),
  announce: (seat) => isAdmin(seat) || hasRole(seat, "jury"),
  upload_staff_images: (seat) => seat.kind === "staff",
  configure_contest: isAdmin,
  see_members: isAdmin,
};

export function can(seat: Seat | null, capability: Capability): boolean {
  return seat !== null && capabilityRule[capability](seat);
}

/**
 * The seat that a membership describes. A team membership is a contestant
 * seat, even if it also holds roles. A membership with no team, role, or admin
 * holds no seat.
 */
export function seatOf(member: Pick<Membership, "team_id" | "roles" | "is_admin">): Seat | null {
  if (member.team_id) return { kind: "contestant", entryId: member.team_id, entrantKind: "team" };
  if (!member.is_admin && member.roles.length === 0) return null;
  return { kind: "staff", admin: member.is_admin, roles: member.roles };
}
