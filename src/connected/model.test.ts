import { describe, expect, it } from "vitest";
import {
  duration,
  isStaff,
  type Issue,
  isSupport,
  type Membership,
  type Resolution,
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
  it("formats elapsed time without rounding up or displaying negative seconds", () => {
    expect(duration(-1)).toBe("0m 00s");
    expect(duration(59999)).toBe("0m 59s");
    expect(duration(60100)).toBe("1m 00s");
  });
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
});
