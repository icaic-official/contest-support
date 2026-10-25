import { describe, expect, it } from "vitest";
import type { Membership } from "./model";
import {
  announcementCommand,
  draftOf,
  draftProblem,
  editReview,
  expiryFromInput,
  toLocalInput,
} from "./announcementForm";
import {
  type Announcement,
  announcementStatus,
  canManageAnnouncements,
} from "./announcementModel";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const announcement: Announcement = {
  id: id(1), session_id: id(2), title: "Lunch", details: "At noon.", author: id(3),
  author_name: "Person", published_at: "2026-10-24T00:00:00.000Z", expires_at: null,
  edited_at: null, edited_by: null, edited_name: null, removed_at: null,
  removed_by: null, removed_name: null, revision: 2,
};
const member: Membership = { session_id: id(2), user_id: id(3), team_id: null, roles: [], is_admin: false };

describe("announcement model", () => {
  it("allows only admins and jury to manage", () => {
    expect(canManageAnnouncements({ ...member, is_admin: true })).toBe(true);
    expect(canManageAnnouncements({ ...member, roles: ["jury", "volunteer"] })).toBe(true);
    for (const roles of [[], ["volunteer"], ["specialist"]] as const) {
      expect(canManageAnnouncements({ ...member, roles: [...roles] })).toBe(false);
    }
    expect(canManageAnnouncements({ ...member, team_id: id(4) })).toBe(false);
  });

  it("derives Active, Expired, and Removed from server time", () => {
    const now = Date.parse("2026-10-24T01:00:00.000Z");
    expect(announcementStatus(announcement, now)).toBe("Active");
    expect(announcementStatus({ ...announcement, expires_at: "2026-10-24T01:00:00.000Z" }, now)).toBe("Expired");
    expect(announcementStatus({ ...announcement, expires_at: "2026-10-24T01:00:00.001Z" }, now)).toBe("Active");
    expect(announcementStatus({ ...announcement, removed_at: "2026-10-24T00:30:00.000Z" }, now)).toBe("Removed");
  });
});

describe("announcement drafts", () => {
  const now = Date.parse("2026-10-24T00:00:00.000Z");
  it("round-trips an expiry through the local input format", () => {
    const iso = "2026-12-01T09:30:00.000Z";
    expect(expiryFromInput(toLocalInput(iso))).toBe(iso);
    expect(toLocalInput(null)).toBe("");
    expect(expiryFromInput("")).toBeNull();
    expect(expiryFromInput("not a time")).toBeUndefined();
  });

  it("explains each invalid draft before sending it", () => {
    const valid = { title: " Lunch ", details: " At noon. ", expires: "" };
    expect(draftProblem(valid, now)).toBeUndefined();
    expect(draftProblem({ ...valid, title: "  " }, now)).toMatch(/title/);
    expect(draftProblem({ ...valid, title: "x".repeat(161) }, now)).toMatch(/title/);
    expect(draftProblem({ ...valid, details: "" }, now)).toMatch(/details/);
    expect(draftProblem({ ...valid, details: "x".repeat(10001) }, now)).toMatch(/10,000/);
    expect(draftProblem({ ...valid, expires: "2020-01-01T00:00" }, now)).toMatch(/future/);
    expect(draftProblem({ ...valid, expires: "bad" }, now)).toMatch(/valid expiry/);
  });

  it("builds publish and edit commands from trimmed text", () => {
    const draft = { title: " Lunch ", details: " At noon. ", expires: "" };
    expect(announcementCommand(draft)).toEqual({ type: "publish", title: "Lunch", details: "At noon.", expires_at: null });
    expect(announcementCommand(draft, { id: id(1), revision: 2 })).toEqual({
      type: "edit", id: id(1), revision: 2, title: "Lunch", details: "At noon.", expires_at: null,
    });
    expect(draftOf(announcement)).toEqual({ title: "Lunch", details: "At noon.", expires: "" });
  });

  it("requires a review whenever the stored revision moves past the draft's base", () => {
    expect(editReview(2, announcement)).toBe("current");
    expect(editReview(2, { ...announcement, revision: 3 })).toBe("review");
    expect(editReview(3, { ...announcement, revision: 4 })).toBe("review");
    expect(editReview(2, { ...announcement, removed_at: "2026-10-24T00:30:00.000Z", revision: 3 })).toBe("removed");
    expect(editReview(2, undefined)).toBe("removed");
  });
});
