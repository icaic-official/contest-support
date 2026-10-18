import { describe, expect, it } from "vitest";
import type { Issue, Membership, Resolution, Snapshot } from "@/connected/model";
import {
  ageClass,
  ageTier,
  awardLists,
  chipForFilter,
  filterForChip,
  isJuryOnly,
  issueAbilities,
  issuesByNumber,
  matchesChip,
  openableIssues,
  organiserTabs,
  placeOf,
  primaryAction,
  queueChips,
  sortByUnresolved,
  visibleIssues,
} from "./organiserModel";

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

const noAwards: Pick<Snapshot, "awards" | "event"> = {
  awards: [],
  event: { id: "event", name: "Event", archived: false },
};

describe("organiserTabs", () => {
  it("gives helpers Queue, Mine, Find and Me", () => {
    expect(organiserTabs(member({ roles: ["volunteer"] }))).toEqual([
      "queue",
      "mine",
      "find",
      "me",
    ]);
    expect(organiserTabs(member({ roles: ["specialist"] }))).toEqual([
      "queue",
      "mine",
      "find",
      "me",
    ]);
  });

  it("gives jury-only members Awards, Find and Me", () => {
    const jury = member({ roles: ["jury"] });
    expect(isJuryOnly(jury)).toBe(true);
    expect(organiserTabs(jury)).toEqual(["awards", "find", "me"]);
  });

  it("adds Session for admins and combines roles", () => {
    expect(
      organiserTabs(member({ roles: ["volunteer"], is_admin: true })),
    ).toEqual(["queue", "mine", "find", "session", "me"]);
    expect(
      organiserTabs(member({ roles: ["volunteer", "jury"] })),
    ).toEqual(["queue", "mine", "awards", "find", "me"]);
    expect(organiserTabs(member({ is_admin: true }))).toEqual([
      "queue",
      "find",
      "session",
      "me",
    ]);
    const juryAdmin = member({ roles: ["jury"], is_admin: true });
    expect(isJuryOnly(juryAdmin)).toBe(false);
    expect(organiserTabs(juryAdmin)).toEqual([
      "queue",
      "awards",
      "find",
      "session",
      "me",
    ]);
  });
});

describe("queue filtering and order", () => {
  const issues = [
    issue({ id: "a", number: 1, status: "open" }),
    issue({ id: "b", number: 2, status: "escalated" }),
    issue({ id: "c", number: 3, status: "claimed" }),
    issue({ id: "d", number: 4, status: "resolved" }),
  ];

  it("shows jury-only members resolved issues only", () => {
    expect(
      visibleIssues(issues, member({ roles: ["jury"] })).map((i) => i.id),
    ).toEqual(["d"]);
    expect(visibleIssues(issues, member({ roles: ["volunteer"] }))).toHaveLength(4);
  });

  it("matches each chip to its statuses", () => {
    const ids = (chip: (typeof queueChips)[number]["chip"]) =>
      issues.filter((i) => matchesChip(i, chip)).map((i) => i.id);
    expect(ids("waiting")).toEqual(["a"]);
    expect(ids("handoffs")).toEqual(["b"]);
    expect(ids("active")).toEqual(["a", "b", "c"]);
    expect(ids("resolved")).toEqual(["d"]);
  });

  it("maps the shared status filter to chips and back", () => {
    expect(chipForFilter("all")).toBe("active");
    // A reopened issue sets the shared filter to "claimed".
    expect(chipForFilter("claimed")).toBe("active");
    for (const { chip } of queueChips) {
      expect(chipForFilter(filterForChip(chip))).toBe(chip);
    }
  });

  it("sorts by unresolved time and excludes resolved intervals", () => {
    const now = Date.parse("2026-10-17T11:00:00Z");
    const old = issue({ id: "old", number: 5, created_at: "2026-10-17T10:00:00Z" });
    const fresh = issue({ id: "fresh", number: 6, created_at: "2026-10-17T10:50:00Z" });
    // Created first, but resolved for 50 minutes before a reopen.
    const reopened = issue({
      id: "reopened",
      number: 7,
      created_at: "2026-10-17T09:55:00Z",
      status: "claimed",
    });
    const resolutions: Resolution[] = [
      {
        id: "r",
        session_id: "session",
        issue_id: "reopened",
        actor: other,
        actor_name: "Helper",
        at: "2026-10-17T10:00:00Z",
        summary: "Fixed",
        reopened_at: "2026-10-17T10:50:00Z",
        reopened_by: other,
        reopened_name: "Team",
        reason: "Again",
      },
    ];
    expect(
      sortByUnresolved([fresh, reopened, old], resolutions, now).map((i) => i.id),
    ).toEqual(["old", "reopened", "fresh"]);
  });

  it("keeps the lower issue number first for equal times", () => {
    const now = Date.parse("2026-10-17T11:00:00Z");
    const a = issue({ id: "a", number: 9 });
    const b = issue({ id: "b", number: 3 });
    expect(sortByUnresolved([a, b], [], now).map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("ageTier", () => {
  it("is neutral below 10 minutes, amber below 20 and rose after", () => {
    expect(ageTier(9 * 60_000 + 59_000)).toBe("fresh");
    expect(ageTier(10 * 60_000)).toBe("warn");
    expect(ageTier(19 * 60_000 + 59_000)).toBe("warn");
    expect(ageTier(20 * 60_000)).toBe("critical");
  });

  it("keeps resolved issues neutral", () => {
    expect(ageClass("critical", true)).toBe("text-foreground");
    expect(ageClass("warn", false)).toBe("text-age-warn");
    expect(ageClass("critical", false)).toBe("text-age-critical");
  });
});

describe("placeOf", () => {
  it("splits the area from the table or desk number", () => {
    expect(placeOf("Hall A · Table 7")).toEqual({ area: "Hall A", seat: "7" });
    expect(placeOf("Hall B · Desk 04")).toEqual({ area: "Hall B", seat: "04" });
    expect(placeOf("Lab 3, PC 12")).toEqual({ area: "Lab 3", seat: "12" });
    expect(placeOf("Desk 12")).toEqual({ area: "", seat: "12" });
  });

  it("keeps a location without a number as the area", () => {
    expect(placeOf("Remote")).toEqual({ area: "Remote", seat: "" });
  });
});

describe("issuesByNumber", () => {
  const issues = [issue({ id: "a", number: 31 }), issue({ id: "b", number: 3 })];
  it("matches plain, hash and ISS numbers exactly", () => {
    expect(issuesByNumber(issues, "31").map((i) => i.id)).toEqual(["a"]);
    expect(issuesByNumber(issues, "#3").map((i) => i.id)).toEqual(["b"]);
    expect(issuesByNumber(issues, "ISS-31").map((i) => i.id)).toEqual(["a"]);
    expect(issuesByNumber(issues, "aurora")).toEqual([]);
  });
});

describe("issueAbilities and primaryAction", () => {
  it("lets support staff claim an open issue", () => {
    const can = issueAbilities(issue(), noAwards, member({ roles: ["volunteer"] }));
    expect(can.claim).toBe(true);
    expect(can.reply).toBe(true);
    expect(primaryAction(can)).toBe("claim");
  });

  it("lets only the owner resolve or escalate", () => {
    const claimed = issue({ status: "claimed", owner: me, owner_name: "Me" });
    const mine = issueAbilities(claimed, noAwards, member({ roles: ["volunteer"] }));
    expect(mine.resolve && mine.escalate).toBe(true);
    expect(primaryAction(mine)).toBe("resolve");
    const theirs = issueAbilities(
      { ...claimed, owner: other },
      noAwards,
      member({ roles: ["volunteer"] }),
    );
    expect(theirs.resolve || theirs.escalate).toBe(false);
    expect(primaryAction(theirs)).toBeUndefined();
  });

  it("keeps the owner during a handoff until another specialist accepts", () => {
    const escalated = issue({ status: "escalated", owner: me, owner_name: "Me" });
    const owner = issueAbilities(
      escalated,
      noAwards,
      member({ roles: ["volunteer", "specialist"] }),
    );
    expect(owner.accept).toBe(false);
    expect(owner.resolve).toBe(true);
    const specialist = issueAbilities(
      { ...escalated, owner: other },
      noAwards,
      member({ roles: ["specialist"] }),
    );
    expect(primaryAction(specialist)).toBe("accept");
  });

  it("gives the jury the award, then the external application", () => {
    const resolved = issue({ status: "resolved" });
    const jury = member({ roles: ["jury"] });
    const before = issueAbilities(resolved, noAwards, jury);
    expect(primaryAction(before)).toBe("award");
    expect(before.reopen).toBe(false);
    expect(before.reply).toBe(false);
    const award = {
      id: "award",
      issue_id: "issue",
      resolution_id: "r",
      minutes: 5,
      explanation: "Lost time",
      actor_name: "Jury",
      at: "2026-10-17T11:00:00Z",
      applied_at: null,
      applied_name: null,
    };
    const after = issueAbilities(resolved, { ...noAwards, awards: [award] }, jury);
    expect(after.award).toBe(false);
    expect(primaryAction(after)).toBe("apply");
    const applied = issueAbilities(
      resolved,
      {
        ...noAwards,
        awards: [{ ...award, applied_at: "2026-10-17T11:05:00Z", applied_name: "Jury" }],
      },
      jury,
    );
    expect(primaryAction(applied)).toBeUndefined();
  });

  it("lets support staff reopen a resolved issue", () => {
    const can = issueAbilities(
      issue({ status: "resolved" }),
      noAwards,
      member({ roles: ["volunteer"] }),
    );
    expect(primaryAction(can)).toBe("reopen");
  });

  it("allows nothing in an archived event", () => {
    const can = issueAbilities(
      issue(),
      { awards: [], event: { id: "event", name: "Event", archived: true } },
      member({ roles: ["volunteer"], is_admin: true }),
    );
    expect(Object.values(can).some(Boolean)).toBe(false);
  });
});

describe("jury award lists (T0009)", () => {
  const jury = member({ roles: ["jury"] });
  const resolvedAt = "2026-10-17T10:30:00Z";
  function resolution(issueId: string, at: string): Resolution {
    return {
      id: `resolution-${issueId}`,
      session_id: "session",
      issue_id: issueId,
      actor: other,
      actor_name: "Priya",
      at,
      summary: "Fixed",
      reopened_at: null,
      reopened_by: null,
      reopened_name: null,
      reason: null,
    };
  }
  function award(
    issueId: string,
    at: string,
    appliedAt: string | null = null,
  ): Snapshot["awards"][number] {
    return {
      id: `award-${issueId}`,
      issue_id: issueId,
      resolution_id: `resolution-${issueId}`,
      minutes: 0,
      explanation: "No change",
      actor_name: "Jury",
      at,
      applied_at: appliedAt,
      applied_name: appliedAt ? "Lead" : null,
    };
  }
  function state(overrides: Partial<Snapshot>): Snapshot {
    return {
      session: {
        id: "session",
        event_id: "event",
        name: "Primary",
        intake_open: true,
        categories: ["Network"],
        revision: 1,
        max_image_bytes: 1048576,
        max_images_per_issue: 5,
        max_image_bytes_per_issue: 5242880,
      },
      event: { id: "event", name: "Event", archived: false },
      membership: jury,
      teams: [],
      issues: [],
      resolutions: [],
      awards: [],
      history: [],
      attachments: [],
      pending_removals: [],
      members: [],
      audit: [],
      server_time: resolvedAt,
      ...overrides,
    };
  }
  const decide = issue({ id: "decide", number: 1, status: "resolved", resolved_at: resolvedAt });
  const reopened = issue({ id: "reopened", number: 2, status: "claimed", owner: other });
  const applied = issue({ id: "applied", number: 3, status: "resolved", resolved_at: resolvedAt });
  const snapshot = state({
    issues: [decide, reopened, applied],
    resolutions: [
      resolution("decide", resolvedAt),
      { ...resolution("reopened", "2026-10-17T10:10:00Z"), reopened_at: "2026-10-17T10:20:00Z" },
      resolution("applied", "2026-10-17T10:05:00Z"),
    ],
    awards: [
      award("reopened", "2026-10-17T10:12:00Z"),
      award("applied", "2026-10-17T10:06:00Z", "2026-10-17T10:07:00Z"),
    ],
  });

  it("keeps a pending award on a reopened issue in To apply", () => {
    const lists = awardLists(snapshot);
    expect(lists.decide.map((row) => row.issue.id)).toEqual(["decide"]);
    expect(lists.apply.map((row) => row.issue.id)).toEqual(["reopened"]);
    expect(lists.apply[0]?.resolution?.reopened_at).not.toBeNull();
    expect(lists.done.map((row) => row.issue.id)).toEqual(["applied"]);
  });

  it("lets a jury-only member open the reopened issue with a pending award", () => {
    expect(openableIssues(snapshot, jury).map((item) => item.id)).toEqual([
      "decide",
      "applied",
      "reopened",
    ]);
    expect(
      openableIssues(snapshot, member({ roles: ["volunteer"] })),
    ).toHaveLength(3);
  });
});
