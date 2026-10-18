import { describe, expect, it } from "vitest";
import { juryWorklists } from "./jury";
import {
  type Issue,
  type Resolution,
  type Snapshot,
  unresolvedTime,
} from "./model";

const issue: Issue = {
  id: "issue",
  number: 1,
  session_id: "session",
  team_id: "team",
  reporter: "reporter",
  reporter_name: "Team",
  category: "Backend",
  description: "Connection lost",
  status: "resolved",
  created_at: "2026-10-02T10:00:00Z",
  first_assigned_at: "2026-10-02T10:01:00Z",
  owner: "helper",
  owner_name: "Helper",
  resolved_at: "2026-10-02T10:05:00Z",
  revision: 3,
};
const resolution: Resolution = {
  id: "resolution",
  session_id: "session",
  issue_id: "issue",
  actor: "helper",
  actor_name: "Helper",
  at: "2026-10-02T10:05:00Z",
  summary: "Service restored",
  reopened_at: null,
  reopened_by: null,
  reopened_name: null,
  reason: null,
};
const award: Snapshot["awards"][number] = {
  id: "award",
  issue_id: "issue",
  resolution_id: "resolution",
  minutes: 0,
  explanation: "No adjustment required",
  actor_name: "Jury",
  at: "2026-10-02T10:06:00Z",
  applied_at: null,
  applied_name: null,
};
function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    session: {
      id: "session",
      event_id: "event",
      name: "Primary",
      intake_open: true,
      categories: ["Backend"],
      revision: 1,
      max_image_bytes: 5 * 1024 * 1024,
      max_images_per_issue: 5,
      max_image_bytes_per_issue: 20 * 1024 * 1024,
    },
    event: { id: "event", name: "Contest", archived: false },
    membership: {
      session_id: "session",
      user_id: "jury",
      roles: ["jury"],
      team_id: null,
      is_admin: false,
    },
    teams: [
      { id: "team", session_id: "session", name: "Aurora", location: "A12" },
    ],
    issues: [issue],
    resolutions: [resolution],
    awards: [],
    history: [],
    attachments: [],
    pending_removals: [],
    members: [],
    audit: [],
    server_time: "2026-10-02T10:10:00Z",
    ...overrides,
  };
}

describe("jury worklist eligibility", () => {
  it.each([
    ["resolved without an award", "resolved", false, false, 1, 0],
    ["reopened without an award", "claimed", false, false, 0, 0],
    ["awaiting handoff without an award", "escalated", false, false, 0, 0],
    ["zero-minute decision", "resolved", true, false, 0, 1],
    ["reopened pending decision", "claimed", true, false, 0, 1],
    ["resolved again with pending decision", "resolved", true, false, 0, 1],
    ["applied award", "resolved", true, true, 0, 0],
    ["reopened applied award", "claimed", true, true, 0, 0],
  ] as const)(
    "classifies %s",
    (_name, status, hasAward, applied, decisions, applications) => {
      const lists = juryWorklists(
        snapshot({
          issues: [{ ...issue, status }],
          awards: hasAward
            ? [
                {
                  ...award,
                  applied_at: applied ? "2026-10-02T10:07:00Z" : null,
                },
              ]
            : [],
        }),
      );
      expect(lists.decision).toHaveLength(decisions);
      expect(lists.application).toHaveLength(applications);
    },
  );

  it("uses the current resolution after reopening, but retains an existing award's evidence", () => {
    const old = { ...resolution, reopened_at: "2026-10-02T10:08:00Z" };
    const current = {
      ...resolution,
      id: "current",
      at: "2026-10-02T10:10:00Z",
      summary: "Cable replaced",
    };
    const state = snapshot({
      issues: [{ ...issue, resolved_at: current.at }],
      resolutions: [old, current],
    });
    expect(juryWorklists(state).decision[0].resolution?.summary).toBe(
      "Cable replaced",
    );
    const pending = juryWorklists({ ...state, awards: [award] }).application[0];
    expect(pending.resolution?.summary).toBe("Service restored");
    expect(pending.resolution?.reopened_at).toBe(old.reopened_at);
    expect(
      unresolvedTime(
        pending.issue,
        pending.resolutions,
        Date.parse(state.server_time),
      ),
    ).toBe(7 * 60000);
  });

  it("orders by resolution or award time, with deterministic number and id ties, without changing history", () => {
    const state = snapshot({
      issues: [
        issue,
        { ...issue, id: "older", number: 3 },
        { ...issue, id: "tie-b", number: 2 },
        { ...issue, id: "tie-a", number: 2 },
      ],
      resolutions: [
        resolution,
        {
          ...resolution,
          id: "old-r",
          issue_id: "older",
          at: "2026-10-02T10:04:00Z",
        },
        { ...resolution, id: "r-b", issue_id: "tie-b" },
        { ...resolution, id: "r-a", issue_id: "tie-a" },
      ],
    });
    const before = JSON.stringify(state);
    expect(juryWorklists(state).decision.map((row) => row.issue.id)).toEqual([
      "older",
      "issue",
      "tie-a",
      "tie-b",
    ]);
    expect(JSON.stringify(state)).toBe(before);
    state.awards = [
      { ...award, issue_id: "older", at: "2026-10-02T10:09:00Z" },
      award,
    ];
    expect(juryWorklists(state).application.map((row) => row.issue.id)).toEqual(
      ["issue", "older"],
    );
  });

  it("keeps teams and active session isolation independent of input order", () => {
    const lists = juryWorklists(
      snapshot({
        teams: [
          {
            id: "other-team",
            session_id: "session",
            name: "Cedar",
            location: "A18",
          },
          ...snapshot().teams,
        ],
        issues: [
          { ...issue, id: "foreign", session_id: "foreign" },
          { ...issue, id: "cedar", team_id: "other-team", number: 2 },
          issue,
        ],
        resolutions: [
          resolution,
          { ...resolution, id: "cedar-r", issue_id: "cedar" },
        ],
      }),
    );
    expect(lists.decision.map((row) => row.team?.name)).toEqual([
      "Aurora",
      "Cedar",
    ]);
  });

  it("requires jury membership in the selected session, including combined roles and archived reads", () => {
    const state = snapshot();
    for (const roles of [[], ["volunteer"], ["specialist"]] as const) {
      expect(
        juryWorklists({
          ...state,
          membership: {
            ...state.membership!,
            roles: [...roles],
            is_admin: true,
          },
        }).decision,
      ).toHaveLength(0);
    }
    expect(juryWorklists({ ...state, membership: null }).decision).toHaveLength(
      0,
    );
    expect(
      juryWorklists({
        ...state,
        membership: { ...state.membership!, session_id: "other" },
      }).decision,
    ).toHaveLength(0);
    expect(
      juryWorklists({
        ...state,
        membership: { ...state.membership!, roles: ["jury", "specialist"] },
        event: { ...state.event!, archived: true },
      }).decision,
    ).toHaveLength(1);
  });
});
