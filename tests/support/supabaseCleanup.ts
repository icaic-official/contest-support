import type { SupabaseClient } from "@supabase/supabase-js";

/** Session-scoped tables in a safe delete order. Add new session tables here. */
const sessionTables = [
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
  const attachments = await admin.from("attachments").select("id,session_id,issue_id").in("session_id", sessionIds);
  if (attachments.error) fail("issue image lookup");
  const announcementImages = await admin.from("announcement_images")
    .select("id,session_id,announcement_id").in("session_id", sessionIds);
  if (announcementImages.error) fail("announcement image lookup");
  const objects: Array<[string, string[]]> = [
    ["issue-attachments", (attachments.data ?? []).flatMap((image) =>
      ["original", "thumbnail"].map((kind) => `${image.session_id}/${image.issue_id}/${image.id}/${kind}`))],
    ["announcement-images", (announcementImages.data ?? []).map((image) =>
      `${image.session_id}/${image.announcement_id}/${image.id}`)],
  ];
  for (const [bucket, paths] of objects) {
    if (paths.length && (await admin.storage.from(bucket).remove(paths)).error) fail(`${bucket} objects`);
  }
  for (const table of sessionTables) {
    if ((await admin.from(table).delete().in("session_id", sessionIds)).error) fail(table);
  }
  if ((await admin.from("sessions").delete().in("id", sessionIds)).error) fail("sessions");
}
