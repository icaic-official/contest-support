import { z } from "zod";
import { can, seatOf } from "./capabilities.ts";

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
  /** Derived: whether this viewer may report now. A contestant's end is the personal end. */
  intake_open: z.boolean(),
  categories: z.array(z.string()),
  revision: z.number(),
  max_image_bytes: z.number().int().positive(),
  max_images_per_issue: z.number().int().positive(),
  max_image_bytes_per_issue: z.number().int().positive(),
});
const attachmentSchema = z.object({
  id: uuid,
  issue_id: uuid,
  uploader: uuid,
  uploader_name: z.string(),
  uploaded_at: time,
  visibility: z.enum(["public", "internal"]),
  byte_size: z.number().int().positive(),
  content_type: z.string(),
  original_name: z.string(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
const pendingRemovalSchema = z.object({
  id: uuid,
  issue_id: uuid,
  original_name: z.string(),
});
export type PendingRemoval = z.infer<typeof pendingRemovalSchema>;
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
const intakeSchema = z.object({
  open: z.boolean(),
  reason: z.enum(["before_start", "running", "grace", "ended", "override_open", "override_closed"]),
  /** The next instant at which the reason changes by time alone. The browser refreshes then. */
  changes_at: time.nullable(),
});
/** What the schedule, the override, and confirmed awards make of one contest, derived by D1. */
const clockSchema = z.object({
  time_zone: z.string(),
  schedule: z
    .object({ starts_at: time, ends_at: time, grace_minutes: z.number().int().nonnegative() })
    .nullable(),
  follows_schedule: z.boolean(),
  intake: intakeSchema,
  /** Contestants only: the scheduled end plus the extra minutes that staff confirmed as applied. */
  personal_end_at: time.nullable(),
  extra_minutes: z.number().int().nonnegative(),
});
export type ContestClock = z.infer<typeof clockSchema>;
const contestAwardSchema = z.object({
  id: uuid,
  minutes: z.number().int().nonnegative(),
  explanation: z.string(),
  actor_name: z.string(),
  at: time,
  applied_at: time.nullable(),
  applied_name: z.string().nullable(),
});
export type ContestAward = z.infer<typeof contestAwardSchema>;
export const snapshotSchema = z.object({
  session: sessionSchema.nullable(),
  clock: clockSchema.nullish(),
  /** Staff read every contest-wide award. A contestant reads those that staff confirmed. */
  contest_awards: z.array(contestAwardSchema).default([]),
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
      /** The entrant that this entry belongs to. Commands name the entrant, not the entry. */
      entrant_id: uuid.nullable().optional(),
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
  attachments: z.array(attachmentSchema).default([]),
  pending_removals: z.array(pendingRemovalSchema).default([]),
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
      /** `username` is the handle, which the person types to sign in. */
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
export type IssueStatus = Issue["status"];
/**
 * The queue filter that the phone and desktop layouts share. "all" shows
 * active issues. "everything" shows every issue.
 */
export type StatusFilter = "all" | "everything" | IssueStatus;
export type Resolution = z.infer<typeof resolutionSchema>;
export type Team = Snapshot["teams"][number];
export type Award = Snapshot["awards"][number];
export type HistoryEntry = Snapshot["history"][number];
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

/**
 * True when `running` is a command of this type, and for this issue when
 * `issueId` is given. A view uses it to show a spinner on the one control
 * that started the command that runs now.
 */
export function isRunning(
  running: Command | undefined,
  type: Command["type"],
  issueId?: string,
): boolean {
  if (running?.type !== type) return false;
  return (
    issueId === undefined ||
    ("issue_id" in running && running.issue_id === issueId)
  );
}

export function isSupport(member: Membership): boolean {
  return can(seatOf(member), "claim");
}
export function isStaff(member: Membership): boolean {
  return can(seatOf(member), "read_internal");
}
/** The UI for a membership. Team accounts get the contestant UI. */
export type UiKind = "contestant" | "organiser";
export function uiKindFor(member: Membership): UiKind {
  return seatOf(member)?.kind === "contestant" ? "contestant" : "organiser";
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
