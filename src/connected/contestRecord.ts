import "../lib/zodConfig";
import { z } from "zod";
import { roleSchema, snapshotSchema } from "./model.ts";

/**
 * The complete support record of one contest, as the Worker returns it to an
 * admin for the contest archive. Unlike the snapshot, it keeps every row:
 * removed announcements, withdrawn awards, removed images, and the whole audit.
 * Field names follow the D1 columns. A change to a field changes `version`.
 */
export const CONTEST_RECORD_FORMAT = "minsky-contest-record";
export const CONTEST_RECORD_VERSION = 1;

const uuid = z.string().uuid();
const time = z.string().datetime({ offset: true });
const visibility = z.enum(["public", "internal"]);
const imageState = z.enum(["pending", "ready", "deleting", "deleted", "abandoned", "expired"]);
const snapshot = snapshotSchema.shape;

const awardFields = {
  id: uuid,
  minutes: z.number().int().nonnegative(),
  explanation: z.string(),
  actor: uuid,
  actor_name: z.string(),
  at: time,
  applied_at: time.nullable(),
  applied_by: uuid.nullable(),
  applied_name: z.string().nullable(),
  withdrawn_at: time.nullable(),
  withdrawn_by: uuid.nullable(),
  withdrawn_name: z.string().nullable(),
};

export const contestRecordSchema = z.object({
  format: z.literal(CONTEST_RECORD_FORMAT),
  version: z.literal(CONTEST_RECORD_VERSION),
  exported_at: time,
  exported_by: z.object({ id: uuid, name: z.string() }),
  event: z.object({
    id: uuid,
    name: z.string(),
    code: z.string().nullable(),
    time_zone: z.string(),
    archived: z.boolean(),
  }),
  contest: z.object({
    id: uuid,
    name: z.string(),
    kind: z.enum(["practice", "live"]),
    contest_type: z.enum(["singles", "mixed", "teams"]),
    starts_at: time.nullable(),
    ends_at: time.nullable(),
    grace_minutes: z.number().int().nonnegative(),
    intake_follows_schedule: z.boolean(),
    categories: z.array(z.string()),
    max_image_bytes: z.number().int().positive(),
    max_images_per_issue: z.number().int().positive(),
    max_image_bytes_per_issue: z.number().int().positive(),
  }),
  teams: z.array(
    z.object({
      id: uuid,
      entrant_id: uuid.nullable(),
      kind: z.enum(["team", "single"]).nullable(),
      name: z.string(),
      location: z.string(),
    }),
  ),
  /** Assigned seats only. Event admins and webmasters hold no seat; rows name them as actors. */
  members: z.array(
    z.object({
      account_id: uuid,
      name: z.string(),
      handle: z.string().nullable(),
      team_id: uuid.nullable(),
      is_admin: z.boolean(),
      roles: z.array(roleSchema),
    }),
  ),
  issues: z.array(snapshot.issues.element),
  /** Public replies and internal staff notes, told apart by `visibility`. */
  history: z.array(snapshot.history.element),
  resolutions: z.array(snapshot.resolutions.element),
  awards: z.array(z.object({ ...awardFields, issue_id: uuid, resolution_id: uuid })),
  contest_awards: z.array(z.object(awardFields)),
  announcements: z.array(
    z.object({
      id: uuid,
      title: z.string(),
      details: z.string(),
      author: uuid,
      author_name: z.string(),
      published_at: time,
      expires_at: time.nullable(),
      edited_at: time.nullable(),
      edited_by: uuid.nullable(),
      edited_name: z.string().nullable(),
      removed_at: time.nullable(),
      removed_by: uuid.nullable(),
      removed_name: z.string().nullable(),
    }),
  ),
  /** Every image row. Only a `ready` row has an `original_path` whose bytes the archive can hold. */
  issue_images: z.array(
    z.object({
      id: uuid,
      issue_id: uuid,
      uploader: uuid,
      uploader_name: z.string(),
      visibility,
      state: imageState,
      byte_size: z.number().int().nonnegative().nullable(),
      content_type: z.string().nullable(),
      original_name: z.string(),
      original_path: z.string().nullable(),
      original_digest: z.string().nullable(),
      created_at: time,
      uploaded_at: time.nullable(),
      deleted_by: uuid.nullable(),
      deleted_at: time.nullable(),
    }),
  ),
  announcement_images: z.array(
    z.object({
      id: uuid,
      announcement_id: uuid,
      uploader: uuid,
      uploader_name: z.string(),
      name: z.string(),
      state: imageState,
      byte_size: z.number().int().nonnegative().nullable(),
      content_type: z.string().nullable(),
      object_key: z.string().nullable(),
      digest: z.string().nullable(),
      uploaded_at: time.nullable(),
      deleted_by: uuid.nullable(),
      deleted_at: time.nullable(),
    }),
  ),
  /** Every contest audit row. `detail` is the stored JSON, parsed. */
  audit: z.array(
    z.object({
      id: uuid,
      actor: uuid.nullable(),
      actor_name: z.string().nullable(),
      at: time,
      action: z.string(),
      target: z.string().nullable(),
      detail: z.unknown(),
    }),
  ),
});
export type ContestRecord = z.infer<typeof contestRecordSchema>;
