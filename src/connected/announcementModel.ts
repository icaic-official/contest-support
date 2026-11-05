import "../lib/zodConfig";
import { z } from "zod";
import type { Membership } from "./model.ts";

const uuid = z.string().uuid();
const time = z.string().datetime({ offset: true });

export const ANNOUNCEMENT_TITLE_MAX = 160;
export const ANNOUNCEMENT_DETAILS_MAX = 10000;
export const ANNOUNCEMENT_IMAGE_MAX_COUNT = 4;
export const ANNOUNCEMENT_IMAGE_MAX_BYTES = 10485760;

const announcementSchema = z.object({
  id: uuid,
  session_id: uuid,
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
  revision: z.number(),
});
const announcementImageSchema = z.object({
  id: uuid,
  session_id: uuid,
  announcement_id: uuid,
  uploader: uuid,
  uploader_name: z.string(),
  name: z.string(),
  bytes: z.number(),
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  uploaded_at: time,
});
export const announcementSnapshotSchema = z.object({
  announcements: z.array(announcementSchema),
  images: z.array(announcementImageSchema),
  server_time: time,
});
export type Announcement = z.infer<typeof announcementSchema>;
export type AnnouncementImage = z.infer<typeof announcementImageSchema>;
export type AnnouncementSnapshot = z.infer<typeof announcementSnapshotSchema>;
export type AnnouncementCommand =
  | {
    type: "publish";
    title: string;
    details: string;
    expires_at: string | null;
  }
  | {
    type: "edit";
    id: string;
    revision: number;
    title: string;
    details: string;
    expires_at: string | null;
  }
  | { type: "remove"; id: string; revision: number };

/** Providers apply this rule again on the server. The UI uses it only to offer controls. */
export function canManageAnnouncements(member: Membership): boolean {
  return member.is_admin || member.roles.includes("jury");
}

export function announcementStatus(
  announcement: Announcement,
  now: number,
): "Active" | "Expired" | "Removed" {
  if (announcement.removed_at) return "Removed";
  if (announcement.expires_at && Date.parse(announcement.expires_at) <= now) {
    return "Expired";
  }
  return "Active";
}
