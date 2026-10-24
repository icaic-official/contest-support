import type { SupabaseClient } from "@supabase/supabase-js";
import { attachmentPath } from "../../src/connected/imageFile";

/** Session-scoped tables in a safe delete order. A database test compares this list with the migrations. */
export const sessionTables = [
  "announcement_images",
  "announcements",
  "attachments",
  "admin_audit",
  "history",
  "awards",
  "resolutions",
  "issues",
  "changes",
  "staff_changes",
  "memberships",
  "teams",
];

function fail(operation: string): never {
  // Provider messages stay out of test output. The operation names the failed step.
  throw new Error(`Fixture cleanup failed for ${operation}.`);
}

/**
 * Delete the stored files and rows of fixture sessions, then the sessions.
 * It filters every request by the given session IDs and never resets a project.
 */
export async function removeFixtureSessions(admin: SupabaseClient, sessionIds: string[]): Promise<void> {
  if (!sessionIds.length) return;
  const [attachments, announcementImages] = await Promise.all([
    admin.from("attachments").select("id,session_id,issue_id").in("session_id", sessionIds),
    admin.from("announcement_images").select("id,session_id,announcement_id").in("session_id", sessionIds),
  ]);
  if (attachments.error) fail("issue image lookup");
  if (announcementImages.error) fail("announcement image lookup");
  const issuePaths = (attachments.data ?? []).flatMap((image) => (["original", "thumbnail"] as const)
    .map((kind) => attachmentPath(image.session_id, image.issue_id, image.id, kind)));
  const announcementPaths = (announcementImages.data ?? [])
    .map((image) => `${image.session_id}/${image.announcement_id}/${image.id}`);
  const [issueFiles, announcementFiles] = await Promise.all([
    issuePaths.length ? admin.storage.from("issue-attachments").remove(issuePaths) : undefined,
    announcementPaths.length ? admin.storage.from("announcement-images").remove(announcementPaths) : undefined,
  ]);
  if (issueFiles?.error) fail("issue-attachments objects");
  if (announcementFiles?.error) fail("announcement-images objects");
  for (const table of sessionTables) {
    if ((await admin.from(table).delete().in("session_id", sessionIds)).error) fail(table);
  }
  if ((await admin.from("sessions").delete().in("id", sessionIds)).error) fail("sessions");
}
