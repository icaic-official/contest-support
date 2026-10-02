import { z } from "zod";

const uuid = z.string().uuid();
const time = z.string().datetime({ offset: true });
export const roleSchema = z.enum(["volunteer", "specialist", "jury"]);
export type Role = z.infer<typeof roleSchema>;
export const membershipSchema = z.object({
  session_id: uuid,
  user_id: uuid,
  team_id: uuid.nullable(),
  roles: z.array(roleSchema),
  is_admin: z.boolean(),
});
export type Membership = z.infer<typeof membershipSchema>;
const sessionSchema = z.object({
  id: uuid,
  event_id: uuid,
  name: z.string(),
  intake_open: z.boolean(),
  categories: z.array(z.string()),
  revision: z.number(),
});
const issueSchema = z.object({
  id: uuid,
  number: z.number(),
  session_id: uuid,
  team_id: uuid,
  reporter: uuid,
  reporter_name: z.string(),
  category: z.string(),
  description: z.string(),
  status: z.enum(["open", "claimed", "escalated", "resolved"]),
  created_at: time,
  first_assigned_at: time.nullable(),
  owner: uuid.nullable(),
  owner_name: z.string().nullable(),
  resolved_at: time.nullable(),
  revision: z.number(),
});
const resolutionSchema = z.object({
  id: uuid,
  session_id: uuid,
  issue_id: uuid,
  actor: uuid,
  actor_name: z.string(),
  at: time,
  summary: z.string(),
  reopened_at: time.nullable(),
  reopened_by: uuid.nullable(),
  reopened_name: z.string().nullable(),
  reason: z.string().nullable(),
});
export const snapshotSchema = z.object({
  session: sessionSchema.nullable(),
  event: z
    .object({ id: uuid, name: z.string(), archived: z.boolean() })
    .nullable(),
  membership: membershipSchema.nullable(),
  teams: z.array(
    z.object({
      id: uuid,
      session_id: uuid,
      name: z.string(),
      location: z.string(),
    }),
  ),
  issues: z.array(issueSchema),
  resolutions: z.array(resolutionSchema),
  history: z.array(
    z.object({
      id: uuid,
      issue_id: uuid,
      at: time,
      actor: uuid,
      actor_name: z.string(),
      text: z.string(),
      visibility: z.enum(["public", "internal"]),
    }),
  ),
  awards: z.array(
    z.object({
      id: uuid,
      issue_id: uuid,
      resolution_id: uuid,
      minutes: z.number().int().nonnegative(),
      explanation: z.string(),
      actor_name: z.string(),
      at: time,
      applied_at: time.nullable(),
      applied_name: z.string().nullable(),
    }),
  ),
  members: z.array(
    z.object({
      membership: membershipSchema,
      person: z.object({ id: uuid, name: z.string(), username: z.string().nullable() }),
    }),
  ),
  audit: z.array(
    z.object({
      id: uuid,
      actor: uuid,
      at: time,
      action: z.string(),
      target: uuid.nullable(),
    }),
  ),
  server_time: time,
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type Resolution = z.infer<typeof resolutionSchema>;
export type Command =
  | { type: "submit"; category: string; description: string; team_id?: string }
  | {
      type: "claim" | "accept" | "escalate" | "apply";
      issue_id: string;
      revision: number;
    }
  | {
      type: "message";
      issue_id: string;
      revision: number;
      text: string;
      visibility: "public" | "internal";
    }
  | { type: "resolve"; issue_id: string; revision: number; summary: string }
  | { type: "reopen"; issue_id: string; revision: number; reason: string }
  | {
      type: "award";
      issue_id: string;
      revision: number;
      minutes: number;
      explanation: string;
    };

export function isSupport(member: Membership): boolean {
  return (
    member.roles.includes("volunteer") || member.roles.includes("specialist")
  );
}
export function isStaff(member: Membership): boolean {
  return member.roles.length > 0 || member.is_admin;
}
export function unresolvedTime(
  issue: Issue,
  resolutions: readonly Resolution[],
  now: number,
): number {
  let total = 0;
  let start = Date.parse(issue.created_at);
  for (const resolution of resolutions.filter((r) => r.issue_id === issue.id)) {
    total += Math.max(0, Date.parse(resolution.at) - start);
    if (!resolution.reopened_at) return total;
    start = Date.parse(resolution.reopened_at);
  }
  return total + Math.max(0, now - start);
}

export function duration(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
