import { describe, expect, it } from "vitest";
import {
  isRunning,
  isStaff,
  type Issue,
  isSupport,
  type Membership,
  type Resolution,
  uiKindFor,
  unresolvedTime,
} from "./model";

const i: Issue = {
  id: "issue",
  number: 1,
  session_id: "session",
  team_id: "team",
  reporter: "user",
  reporter_name: "Team",
  category: "Backend",
  description: "Broken",
  status: "claimed",
  created_at: "2026-10-02T10:00:00Z",
  first_assigned_at: "2026-10-02T10:01:00Z",
  owner: "helper",
  owner_name: "Helper",
  resolved_at: null,
  revision: 2,
};
const resolution: Resolution = {
  id: "resolution",
  session_id: "session",
  issue_id: "issue",
  actor: "helper",
  actor_name: "Helper",
  at: "2026-10-02T10:05:00Z",
  summary: "Fixed",
  reopened_at: "2026-10-02T10:08:00Z",
  reopened_by: "team",
  reopened_name: "Team",
  reason: "Still broken",
};
describe("connected presentation", () => {
  it("excludes resolved intervals and keeps the exact seven-minute example", () => {
    expect(
      unresolvedTime(i, [resolution], Date.parse("2026-10-02T10:10:00Z")),
    ).toBe(7 * 60000);
    expect(
      unresolvedTime(
        i,
        [{ ...resolution, reopened_at: null }],
        Date.parse("2026-10-02T10:30:00Z"),
      ),
    ).toBe(5 * 60000);
  });
  it("combines support and jury without treating admin as support", () => {
    const admin: Membership = {
      session_id: "s",
      user_id: "u",
      team_id: null,
      roles: [],
      is_admin: true,
    };
    expect(isStaff(admin)).toBe(true);
    expect(isSupport(admin)).toBe(false);
    expect(isSupport({ ...admin, roles: ["specialist", "jury"] })).toBe(true);
  });
  it("gives team accounts the contestant UI and every other membership the organiser UI", () => {
    const staff: Membership = {
      session_id: "s",
      user_id: "u",
      team_id: null,
      roles: ["jury"],
      is_admin: false,
    };
    expect(uiKindFor(staff)).toBe("organiser");
    expect(uiKindFor({ ...staff, roles: [], is_admin: true })).toBe("organiser");
    expect(uiKindFor({ ...staff, roles: [], team_id: "team" })).toBe("contestant");
  });
  it("shows a running command only on the control of its type and issue", () => {
    const claim = { type: "claim", issue_id: "a", revision: 1 } as const;
    expect(isRunning(undefined, "claim")).toBe(false);
    expect(isRunning(claim, "claim")).toBe(true);
    expect(isRunning(claim, "claim", "a")).toBe(true);
    expect(isRunning(claim, "claim", "b")).toBe(false);
    expect(isRunning(claim, "accept", "a")).toBe(false);
    const submit = { type: "submit", category: "Backend", description: "x" } as const;
    expect(isRunning(submit, "submit")).toBe(true);
    expect(isRunning(submit, "submit", "a")).toBe(false);
  });
});
