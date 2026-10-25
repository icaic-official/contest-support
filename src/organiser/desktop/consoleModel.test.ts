import { describe, expect, it } from "vitest";
import type { Issue, Membership, Resolution, Snapshot } from "@/connected/model";
import { chipForFilter } from "../organiserModel";
import {
  awardSummary,
  categoryCounts,
  consoleNavGroups,
  consolePages,
  everythingFilter,
  filterForQueueTab,
  labelMatches,
  latestResolver,
  matchesQueueTab,
  median,
  navCount,
  ownerWorkload,
  paletteIssues,
  queueStats,
  queueTabForFilter,
  queueTabs,
} from "./consoleModel";

const me = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";

function member(overrides: Partial<Membership> = {}): Membership {
  return {
    session_id: "session",
    user_id: me,
    team_id: null,
    roles: [],
    is_admin: false,
    ...overrides,
  };
}

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue",
    number: 1,
    session_id: "session",
    team_id: "team",
    reporter: other,
    reporter_name: "Team",
    category: "Network",
    description: "Broken",
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

function resolution(overrides: Partial<Resolution> = {}): Resolution {
  return {
    id: "resolution",
    session_id: "session",
    issue_id: "issue",
    actor: other,
    actor_name: "Priya Raman",
    at: "2026-10-17T10:10:00Z",
    summary: "Fixed",
    reopened_at: null,
    reopened_by: null,
    reopened_name: null,
    reason: null,
    ...overrides,
  };
}

type Award = Snapshot["awards"][number];

function award(overrides: Partial<Award> = {}): Award {
  return {
    id: "award",
    issue_id: "issue",
    resolution_id: "resolution",
    minutes: 5,
    explanation: "Judge outage",
    actor_name: "Hana Kim",
    at: "2026-10-17T10:20:00Z",
    applied_at: null,
    applied_name: null,
    ...overrides,
  };
}

describe("consoleNavGroups", () => {
  it("gives support staff the queue pages and Teams & tables", () => {
    expect(consolePages(member({ roles: ["volunteer"] }))).toEqual([
      "queue",
      "mine",
      "handoffs",
      "teams",
    ]);
  });

  it("gives jury-only members Award review and Teams & tables", () => {
    expect(consolePages(member({ roles: ["jury"] }))).toEqual([
      "awards",
      "teams",
    ]);
  });

  it("combines every role of one person without duplicates", () => {
    const groups = consoleNavGroups(
      member({ roles: ["specialist", "jury"], is_admin: true }),
    );
    expect(groups.map((group) => group.label)).toEqual(["Workspace", "Admin"]);
    expect(groups.flatMap((group) => group.pages)).toEqual([
      "queue",
      "mine",
      "handoffs",
      "awards",
      "teams",
      "overview",
      "accounts",
      "roster",
      "settings",
    ]);
  });

  it("keeps the queue for admins without support roles", () => {
    expect(consolePages(member({ is_admin: true }))).toEqual([
      "queue",
      "teams",
      "overview",
      "accounts",
      "roster",
      "settings",
    ]);
    expect(consolePages(member({ roles: ["jury"], is_admin: true }))).toContain(
      "queue",
    );
  });
});

describe("navCount", () => {
  const issues = [
    issue({ id: "a", status: "open" }),
    issue({ id: "b", status: "claimed", owner: me }),
    issue({ id: "c", status: "escalated", owner: other }),
    issue({ id: "d", status: "resolved", owner: me }),
    issue({ id: "e", status: "resolved" }),
  ];
  const state = { awards: [award({ issue_id: "d" })] };
  const person = member({ roles: ["volunteer", "jury"] });

  it("counts active, owned, escalated and undecided issues", () => {
    expect(navCount("queue", issues, state, person)).toBe(3);
    expect(navCount("mine", issues, state, person)).toBe(1);
    expect(navCount("handoffs", issues, state, person)).toBe(1);
    expect(navCount("awards", issues, state, person)).toBe(1);
    expect(navCount("teams", issues, state, person)).toBeUndefined();
  });
});

describe("queue tabs", () => {
  it("maps the shared filter to tabs and back", () => {
    for (const { tab } of queueTabs) {
      expect(queueTabForFilter(filterForQueueTab(tab))).toBe(tab);
    }
    expect(queueTabForFilter("all")).toBe("active");
    expect(queueTabForFilter("unknown")).toBe("active");
  });

  it("shows a reopened issue under In progress", () => {
    expect(queueTabForFilter("claimed")).toBe("claimed");
  });

  it("keeps the phone app on All active for the All tab", () => {
    expect(chipForFilter(everythingFilter)).toBe("active");
  });

  it("matches statuses", () => {
    const resolved = issue({ status: "resolved" });
    expect(matchesQueueTab(resolved, "active")).toBe(false);
    expect(matchesQueueTab(resolved, "everything")).toBe(true);
    expect(matchesQueueTab(resolved, "resolved")).toBe(true);
    expect(matchesQueueTab(issue({ status: "open" }), "claimed")).toBe(false);
  });
});

describe("median", () => {
  it("handles empty, odd and even lists", () => {
    expect(median([])).toBeUndefined();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("queueStats", () => {
  it("uses persisted timestamps and excludes resolved intervals", () => {
    const now = Date.parse("2026-10-17T10:30:00Z");
    const issues = [
      issue({ id: "a", created_at: "2026-10-17T10:25:00Z" }),
      issue({ id: "b", created_at: "2026-10-17T10:20:00Z" }),
      issue({ id: "c", status: "claimed", owner: me }),
      issue({ id: "d", status: "claimed", owner: me }),
      issue({ id: "e", status: "claimed", owner: other }),
      issue({ id: "f", status: "escalated", owner: other }),
      issue({ id: "g", status: "resolved" }),
    ];
    const resolutions = [
      // 10:00 → 10:05 resolved, reopened 10:08, resolved 10:10: 7 minutes.
      resolution({
        id: "r1",
        issue_id: "g",
        at: "2026-10-17T10:05:00Z",
        reopened_at: "2026-10-17T10:08:00Z",
      }),
      resolution({ id: "r2", issue_id: "g", at: "2026-10-17T10:10:00Z" }),
    ];
    expect(queueStats(issues, resolutions, now)).toEqual({
      open: 2,
      oldestOpenMs: 10 * 60_000,
      claimed: 3,
      helpers: 2,
      escalated: 1,
      resolved: 1,
      medianResolvedMs: 7 * 60_000,
    });
  });

  it("leaves the times empty without issues", () => {
    const stats = queueStats([], [], 0);
    expect(stats.oldestOpenMs).toBeUndefined();
    expect(stats.medianResolvedMs).toBeUndefined();
  });
});

describe("categoryCounts", () => {
  it("lists session categories first and keeps unknown ones", () => {
    expect(
      categoryCounts(
        [
          issue({ category: "Network" }),
          issue({ category: "Printing" }),
          issue({ category: "Network" }),
        ],
        ["Workstation", "Network"],
      ),
    ).toEqual([
      { category: "Workstation", count: 0 },
      { category: "Network", count: 2 },
      { category: "Printing", count: 1 },
    ]);
  });
});

describe("awardSummary", () => {
  it("separates decisions from external application", () => {
    const issues = [
      issue({ id: "a", status: "resolved" }),
      issue({ id: "b", status: "resolved" }),
      issue({ id: "c", status: "claimed" }),
    ];
    const awards = [
      award({ id: "x", issue_id: "a", minutes: 10 }),
      award({
        id: "y",
        issue_id: "c",
        minutes: 5,
        applied_at: "2026-10-17T11:00:00Z",
      }),
    ];
    expect(awardSummary(issues, awards)).toEqual({
      minutes: 15,
      pending: 1,
      applied: 1,
      undecided: 1,
    });
  });
});

describe("ownerWorkload", () => {
  it("counts active issues per person", () => {
    expect(
      ownerWorkload([
        issue({ status: "claimed", owner: me, owner_name: "Priya" }),
        issue({ status: "escalated", owner: me, owner_name: "Priya" }),
        issue({ status: "claimed", owner: other, owner_name: "Marcus" }),
        issue({ status: "resolved", owner: other, owner_name: "Marcus" }),
        issue({ status: "open" }),
      ]),
    ).toEqual([
      { owner: me, name: "Priya", active: 2 },
      { owner: other, name: "Marcus", active: 1 },
    ]);
  });
});

describe("paletteIssues", () => {
  const issues = [
    issue({ id: "a", number: 31, description: "Keyboard stopped" }),
    issue({ id: "b", number: 3, description: "Printer jam", category: "Printing" }),
    issue({ id: "c", number: 12, description: "Issue 31 follow-up" }),
  ];

  it("puts number matches first", () => {
    expect(paletteIssues(issues, "ISS-31").map((item) => item.id)).toEqual([
      "a",
    ]);
    expect(paletteIssues(issues, "#3").map((item) => item.id)).toEqual(["b"]);
  });

  it("matches report text and category from three characters", () => {
    expect(paletteIssues(issues, "pr")).toEqual([]);
    expect(paletteIssues(issues, "print").map((item) => item.id)).toEqual([
      "b",
    ]);
    expect(paletteIssues(issues, "keyboard").map((item) => item.id)).toEqual([
      "a",
    ]);
  });
});

describe("labelMatches", () => {
  it("ignores case and accents", () => {
    expect(labelMatches("Session settings", "SETT")).toBe(true);
    expect(labelMatches("Café", "cafe")).toBe(true);
    expect(labelMatches("Queue", "")).toBe(true);
    expect(labelMatches("Queue", "award")).toBe(false);
  });
});

describe("latestResolver", () => {
  it("names the person of the current resolution", () => {
    const resolutions = [
      resolution({ id: "r1", actor_name: "Priya", reopened_at: "2026-10-17T10:08:00Z" }),
      resolution({ id: "r2", actor_name: "Marcus" }),
    ];
    expect(latestResolver(issue({ status: "resolved" }), resolutions)).toBe(
      "Marcus",
    );
    expect(latestResolver(issue({ status: "claimed" }), resolutions)).toBe(
      undefined,
    );
  });
});
