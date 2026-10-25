import { describe, expect, it } from "vitest";
import {
  accountActivity,
  accountKind,
  accountName,
  accountSections,
  capabilities,
  capabilityInfo,
} from "./accountModel";
import type { Issue, Membership, Resolution, Snapshot } from "./model";

const SESSION = "00000000-0000-4000-8000-000000000100";
const TEAM = "00000000-0000-4000-8000-000000000200";
const PRIYA = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
const TEAM_USER = "00000000-0000-4000-8000-000000000001";

function issue(n: number, overrides: Partial<Issue> = {}): Issue {
  return {
    id: `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`,
    number: n,
    session_id: SESSION,
    team_id: TEAM,
    reporter: TEAM_USER,
    reporter_name: "Aurora",
    category: "Network",
    description: `Report ${n}`,
    status: "open",
    created_at: "2026-10-17T10:00:00Z",
    first_assigned_at: null,
    owner: null,
    owner_name: null,
    resolved_at: null,
    revision: 1,
    ...overrides,
  };
}

function resolution(n: number, overrides: Partial<Resolution> = {}): Resolution {
  return {
    id: `00000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`,
    session_id: SESSION,
    issue_id: issue(n).id,
    actor: PRIYA,
    actor_name: "Priya Raman",
    at: "2026-10-17T10:20:00Z",
    summary: "Service restored",
    reopened_at: null,
    reopened_by: null,
    reopened_name: null,
    reason: null,
    ...overrides,
  };
}

let historyCount = 0;
function entry(
  n: number,
  overrides: Partial<Snapshot["history"][number]> = {},
): Snapshot["history"][number] {
  historyCount++;
  return {
    id: `00000000-0000-4000-8000-${String(500 + historyCount).padStart(12, "0")}`,
    issue_id: issue(n).id,
    at: "2026-10-17T10:05:00Z",
    actor: PRIYA,
    actor_name: "Priya Raman",
    text: "On my way.",
    visibility: "public",
    ...overrides,
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    session: null,
    event: null,
    membership: null,
    teams: [{ id: TEAM, session_id: SESSION, name: "Aurora", location: "Hall A, Desk 12" }],
    issues: [],
    resolutions: [],
    history: [],
    attachments: [],
    pending_removals: [],
    awards: [],
    members: [],
    audit: [],
    server_time: "2026-10-17T11:00:00Z",
    ...overrides,
  };
}

const staff: Membership = {
  session_id: SESSION,
  user_id: PRIYA,
  team_id: null,
  roles: ["volunteer", "jury"],
  is_admin: true,
};
const team: Membership = { ...staff, user_id: TEAM_USER, team_id: TEAM, roles: [], is_admin: false };

describe("accountKind", () => {
  it("describes a team account by its team", () => {
    expect(accountKind(snapshot(), team)).toEqual({
      kind: "team",
      teamName: "Aurora",
      location: "Hall A, Desk 12",
    });
  });

  it("keeps a team account usable when its team is missing", () => {
    expect(accountKind(snapshot({ teams: [] }), team)).toEqual({
      kind: "team",
      teamName: "Your team",
      location: "",
    });
  });

  it("describes a staff account by its roles and admin flag", () => {
    expect(accountKind(snapshot(), staff)).toEqual({
      kind: "staff",
      roles: ["volunteer", "jury"],
      isAdmin: true,
    });
  });
});

describe("capabilities", () => {
  it("lists roles first, then the admin flag, and gives a team none", () => {
    expect(capabilities(accountKind(snapshot(), staff))).toEqual([
      "volunteer",
      "jury",
      "admin",
    ]);
    expect(capabilities(accountKind(snapshot(), team))).toEqual([]);
  });

  it("describes every capability the account can hold", () => {
    for (const info of Object.values(capabilityInfo)) {
      expect(info.label).not.toBe("");
      expect(info.description).toMatch(/\.$/);
    }
  });
});

describe("accountSections", () => {
  it("has unique ids for the page anchors", () => {
    const ids = accountSections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("security");
  });
});

describe("accountName", () => {
  const user = { id: PRIYA, name: "Account name", email: "p@example.test" };
  it("prefers the person record, then the account fields", () => {
    const members = [
      {
        membership: staff,
        person: { id: PRIYA, name: "Priya Raman", username: "priya" },
      },
    ];
    expect(accountName(snapshot({ members }), user, "priya")).toBe("Priya Raman");
    expect(accountName(snapshot(), user, "priya")).toBe("Account name");
    expect(accountName(snapshot(), { id: PRIYA }, "priya")).toBe("priya");
    expect(accountName(snapshot(), { id: PRIYA, email: "p@example.test" }, null)).toBe(
      "p@example.test",
    );
    expect(accountName(snapshot(), { id: PRIYA }, null)).toBe("Your account");
  });
});

describe("accountActivity for staff", () => {
  it("counts the open issues the person owns and the resolutions the person recorded", () => {
    const state = snapshot({
      issues: [
        issue(1, { owner: PRIYA, status: "claimed" }),
        issue(2, { owner: PRIYA, status: "escalated" }),
        issue(3, { owner: PRIYA, status: "resolved" }),
        issue(4, { owner: OTHER, status: "claimed" }),
      ],
      resolutions: [
        resolution(3),
        resolution(4, { actor: OTHER, actor_name: "Someone else" }),
      ],
    });
    const activity = accountActivity(state, staff, PRIYA);
    expect(activity.open).toBe(2);
    expect(activity.resolved).toBe(1);
  });

  it("counts replies and notes but not workflow steps", () => {
    const state = snapshot({
      issues: [issue(1, { owner: PRIYA, status: "claimed" })],
      history: [
        entry(1, { text: "Issue claimed." }),
        entry(1, { text: "On my way.", at: "2026-10-17T10:06:00Z" }),
        entry(1, {
          text: "Check the switch.",
          visibility: "internal",
          at: "2026-10-17T10:07:00Z",
        }),
        entry(1, { actor: OTHER, text: "Another person wrote this." }),
      ],
    });
    const activity = accountActivity(state, staff, PRIYA);
    expect(activity.messages).toBe(2);
    expect(activity.recent.map((item) => [item.kind, item.text])).toEqual([
      ["note", "Check the switch."],
      ["reply", "On my way."],
    ]);
  });

  it("shows a resolution once, from the resolution", () => {
    const at = "2026-10-17T10:20:00Z";
    const state = snapshot({
      issues: [issue(1, { owner: PRIYA, status: "resolved" })],
      resolutions: [resolution(1, { at })],
      history: [entry(1, { text: "Resolved: Service restored", at })],
    });
    const activity = accountActivity(state, staff, PRIYA);
    expect(activity.messages).toBe(0);
    expect(activity.recent).toEqual([
      {
        id: resolution(1).id,
        at,
        issueNumber: 1,
        kind: "resolution",
        text: "Service restored",
      },
    ]);
  });

  it("lists the five newest entries first", () => {
    const state = snapshot({
      issues: [issue(1, { owner: PRIYA, status: "claimed" })],
      history: Array.from({ length: 7 }, (_, index) =>
        entry(1, {
          text: `Message ${index}`,
          at: `2026-10-17T10:0${index}:00Z`,
        }),
      ),
    });
    const activity = accountActivity(state, staff, PRIYA);
    expect(activity.messages).toBe(7);
    expect(activity.recent.map((item) => item.text)).toEqual([
      "Message 6",
      "Message 5",
      "Message 4",
      "Message 3",
      "Message 2",
    ]);
  });

  it("has nothing to show for a person who did nothing yet", () => {
    expect(accountActivity(snapshot(), staff, PRIYA)).toEqual({
      open: 0,
      resolved: 0,
      messages: 0,
      recent: [],
    });
  });
});

describe("accountActivity for a team account", () => {
  it("counts the team's unresolved and resolved reports and its own replies", () => {
    const state = snapshot({
      issues: [
        issue(1),
        issue(2, { status: "claimed" }),
        issue(3, { status: "resolved" }),
        issue(4, { team_id: "00000000-0000-4000-8000-000000000201" }),
      ],
      resolutions: [resolution(3)],
      history: [
        entry(1, {
          actor: TEAM_USER,
          actor_name: "Aurora",
          text: "Still no network.",
        }),
        entry(1, { text: "A helper wrote this." }),
      ],
    });
    const activity = accountActivity(state, team, TEAM_USER);
    expect(activity.open).toBe(2);
    expect(activity.resolved).toBe(1);
    expect(activity.messages).toBe(1);
    expect(activity.recent.map((item) => item.kind)).toEqual(["reply"]);
  });
});
