import { createHash } from "node:crypto";
import { type ContestRecord, contestRecordSchema } from "./contestRecord.ts";

/** A fictional contest record for unit tests and browser specs. Nothing in it is real. */

/** Text that only staff may read. No contestant-visible archive file may hold it. */
export const INTERNAL_NOTE = "SENTINEL-INTERNAL-NOTE do not tell the team about the cable stock";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ids = {
  event: uuid(1),
  contest: uuid(2),
  staff: uuid(3),
  admin: uuid(4),
  teamA: uuid(5),
  teamB: uuid(6),
  issue: (number: number) => uuid(100 + number),
  image: (n: number) => uuid(200 + n),
  announcement: (n: number) => uuid(300 + n),
};

/** The bytes that the fixture serves for an image. */
export function imageBytes(imageId: string): Uint8Array {
  return new TextEncoder().encode(`fixture image ${imageId}`);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const digestOf = (imageId: string) => sha256Hex(imageBytes(imageId));

const t = (minutes: number) => new Date(Date.UTC(2026, 10, 3, 5, 0, 0) + minutes * 60_000).toISOString();

const award = {
  actor: ids.staff,
  actor_name: "Jordan Jury",
  applied_at: null,
  applied_by: null,
  applied_name: null,
  withdrawn_at: null,
  withdrawn_by: null,
  withdrawn_name: null,
};

/**
 * Two teams and three issues. Issue 1 holds a team-visible image, a staff-only
 * image, an internal note, an applied award, and a removed image. Issue 7 holds
 * a withdrawn award. The announcements include one that an admin removed.
 */
export function fixtureRecord(): ContestRecord {
  return contestRecordSchema.parse({
    format: "minsky-contest-record",
    version: 1,
    exported_at: t(600),
    exported_by: { id: ids.admin, name: "Alex Admin" },
    event: { id: ids.event, name: "Fixture Olympiad", code: "fixture-olympiad", time_zone: "Asia/Singapore", archived: false },
    contest: {
      id: ids.contest,
      name: "Spring finals",
      kind: "live",
      contest_type: "teams",
      starts_at: t(0),
      ends_at: t(300),
      grace_minutes: 10,
      intake_follows_schedule: true,
      categories: ["Network", "Device"],
      max_image_bytes: 10485760,
      max_images_per_issue: 12,
      max_image_bytes_per_issue: 125829120,
    },
    teams: [
      { id: ids.teamA, entrant_id: uuid(7), kind: "team", name: "Aurora", location: "Hall A, desk 12" },
      { id: ids.teamB, entrant_id: uuid(8), kind: "team", name: "Cedar", location: "Hall B, desk 4" },
    ],
    members: [
      { account_id: ids.staff, name: "Jordan Jury", handle: "jordan", team_id: null, is_admin: false, roles: ["volunteer", "jury"] },
      { account_id: ids.admin, name: "Alex Admin", handle: "alex", team_id: null, is_admin: true, roles: [] },
    ],
    issues: [
      {
        id: ids.issue(1), number: 1, session_id: ids.contest, team_id: ids.teamA, reporter: ids.staff, reporter_name: "Jordan Jury",
        category: "Network", description: "Cable is loose <script>alert(1)</script> & \"flaky\"", status: "resolved",
        created_at: t(10), first_assigned_at: t(12), owner: ids.staff, owner_name: "Jordan Jury", resolved_at: t(40), revision: 4,
      },
      {
        id: ids.issue(7), number: 7, session_id: ids.contest, team_id: ids.teamB, reporter: ids.staff, reporter_name: "Jordan Jury",
        category: "Device", description: "=HYPERLINK(\"http://example.invalid\")", status: "open",
        created_at: t(50), first_assigned_at: null, owner: null, owner_name: null, resolved_at: null, revision: 0,
      },
      {
        id: ids.issue(12), number: 12, session_id: ids.contest, team_id: ids.teamA, reporter: ids.staff, reporter_name: "Jordan Jury",
        category: "Device", description: "Monitor flickers", status: "claimed",
        created_at: t(60), first_assigned_at: t(61), owner: ids.staff, owner_name: "Jordan Jury", resolved_at: null, revision: 1,
      },
    ],
    history: [
      { id: uuid(401), issue_id: ids.issue(1), at: t(10), actor: ids.staff, actor_name: "Jordan Jury", text: "Issue submitted: Cable is loose", visibility: "public" },
      { id: uuid(402), issue_id: ids.issue(1), at: t(12), actor: ids.staff, actor_name: "Jordan Jury", text: "Issue claimed.", visibility: "public" },
      { id: uuid(403), issue_id: ids.issue(1), at: t(15), actor: ids.staff, actor_name: "Jordan Jury", text: INTERNAL_NOTE, visibility: "internal" },
      { id: uuid(404), issue_id: ids.issue(1), at: t(20), actor: ids.staff, actor_name: "Jordan Jury", text: "I will bring a new cable.", visibility: "public" },
      { id: uuid(405), issue_id: ids.issue(1), at: t(40), actor: ids.staff, actor_name: "Jordan Jury", text: "Resolved: Replaced the cable", visibility: "public" },
      { id: uuid(406), issue_id: ids.issue(1), at: t(41), actor: ids.staff, actor_name: "Jordan Jury", text: "5 minutes awarded: Lost time while waiting", visibility: "public" },
      { id: uuid(407), issue_id: ids.issue(1), at: t(45), actor: ids.staff, actor_name: "Jordan Jury", text: "External application confirmed.", visibility: "public" },
      { id: uuid(408), issue_id: ids.issue(7), at: t(50), actor: ids.staff, actor_name: "Jordan Jury", text: "Issue submitted: =HYPERLINK(\"http://example.invalid\")", visibility: "public" },
      { id: uuid(409), issue_id: ids.issue(7), at: t(55), actor: ids.staff, actor_name: "Jordan Jury", text: "1 minutes awarded: Test award", visibility: "public" },
      { id: uuid(410), issue_id: ids.issue(7), at: t(56), actor: ids.staff, actor_name: "Jordan Jury", text: "Time award withdrawn. It gives no time.", visibility: "public" },
    ],
    resolutions: [
      {
        id: uuid(501), session_id: ids.contest, issue_id: ids.issue(1), actor: ids.staff, actor_name: "Jordan Jury", at: t(40),
        summary: "Replaced the cable", reopened_at: null, reopened_by: null, reopened_name: null, reason: null,
      },
    ],
    awards: [
      {
        ...award, id: uuid(601), issue_id: ids.issue(1), resolution_id: uuid(501), minutes: 5, explanation: "Lost time while waiting",
        at: t(41), applied_at: t(45), applied_by: ids.staff, applied_name: "Jordan Jury",
      },
      {
        ...award, id: uuid(602), issue_id: ids.issue(7), resolution_id: uuid(501), minutes: 1, explanation: "Test award",
        at: t(55), withdrawn_at: t(56), withdrawn_by: ids.staff, withdrawn_name: "Jordan Jury",
      },
    ],
    contest_awards: [
      { ...award, id: uuid(701), minutes: 10, explanation: "Network outage in Hall A", at: t(100), applied_at: t(110), applied_by: ids.staff, applied_name: "Jordan Jury" },
      { ...award, id: uuid(702), minutes: 3, explanation: "Pending contest award", at: t(120) },
      { ...award, id: uuid(703), minutes: 2, explanation: "Withdrawn contest award", at: t(130), withdrawn_at: t(131), withdrawn_by: ids.staff, withdrawn_name: "Jordan Jury" },
    ],
    announcements: [
      {
        id: ids.announcement(1), title: "Lunch at noon", details: "Lunch is in Hall C.", author: ids.admin, author_name: "Alex Admin",
        published_at: t(20), expires_at: null, edited_at: null, edited_by: null, edited_name: null, removed_at: null, removed_by: null, removed_name: null,
      },
      {
        id: ids.announcement(2), title: "Wrong room", details: "Ignore: the final is in Hall B.", author: ids.admin, author_name: "Alex Admin",
        published_at: t(30), expires_at: null, edited_at: null, edited_by: null, edited_name: null, removed_at: t(35), removed_by: ids.admin, removed_name: "Alex Admin",
      },
    ],
    issue_images: [
      {
        id: ids.image(1), issue_id: ids.issue(1), uploader: ids.staff, uploader_name: "Jordan Jury", visibility: "public", state: "ready",
        byte_size: imageBytes(ids.image(1)).byteLength, content_type: "image/png", original_name: "loose cable.png",
        original_path: `${ids.contest}/${ids.issue(1)}/${ids.image(1)}/original`, original_digest: digestOf(ids.image(1)),
        created_at: t(11), uploaded_at: t(11), deleted_by: null, deleted_at: null,
      },
      {
        id: ids.image(2), issue_id: ids.issue(1), uploader: ids.staff, uploader_name: "Jordan Jury", visibility: "internal", state: "ready",
        byte_size: imageBytes(ids.image(2)).byteLength, content_type: "image/jpeg", original_name: "../stock room.jpg",
        original_path: `${ids.contest}/${ids.issue(1)}/${ids.image(2)}/original`, original_digest: digestOf(ids.image(2)),
        created_at: t(16), uploaded_at: t(16), deleted_by: null, deleted_at: null,
      },
      {
        id: ids.image(3), issue_id: ids.issue(1), uploader: ids.staff, uploader_name: "Jordan Jury", visibility: "internal", state: "deleted",
        byte_size: null, content_type: "image/png", original_name: "removed.png", original_path: null, original_digest: null,
        created_at: t(17), uploaded_at: t(17), deleted_by: ids.staff, deleted_at: t(18),
      },
    ],
    announcement_images: [
      {
        id: ids.image(11), announcement_id: ids.announcement(1), uploader: ids.admin, uploader_name: "Alex Admin", name: "menu.webp", state: "ready",
        byte_size: imageBytes(ids.image(11)).byteLength, content_type: "image/webp",
        object_key: `${ids.contest}/announcements/${ids.announcement(1)}/${ids.image(11)}`, digest: digestOf(ids.image(11)),
        uploaded_at: t(21), deleted_by: null, deleted_at: null,
      },
      {
        id: ids.image(12), announcement_id: ids.announcement(2), uploader: ids.admin, uploader_name: "Alex Admin", name: "wrong room.png", state: "ready",
        byte_size: imageBytes(ids.image(12)).byteLength, content_type: "image/png",
        object_key: `${ids.contest}/announcements/${ids.announcement(2)}/${ids.image(12)}`, digest: digestOf(ids.image(12)),
        uploaded_at: t(31), deleted_by: null, deleted_at: null,
      },
    ],
    audit: [
      { id: uuid(801), actor: ids.admin, actor_name: "Alex Admin", at: t(0), action: "set_intake", target: null, detail: { mode: "open" } },
      { id: uuid(802), actor: null, actor_name: null, at: t(5), action: "system_note", target: null, detail: null },
    ],
  });
}
