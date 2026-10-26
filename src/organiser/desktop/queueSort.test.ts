import { describe, expect, it } from "vitest";
import type { Issue, Team } from "@/connected/model";
import {
  defaultQueueSort,
  nextQueueSort,
  type QueueSort,
  sortQueueIssues,
} from "./queueSort";

const now = Date.parse("2026-10-17T12:00:00Z");

const teams: Team[] = [
  { id: "t-a", session_id: "s", name: "zebra Labs", location: "A" },
  { id: "t-b", session_id: "s", name: "Alpha", location: "B" },
  { id: "t-c", session_id: "s", name: "mango", location: "C" },
];

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: `issue-${overrides.number}`,
    number: 1,
    session_id: "s",
    team_id: "t-a",
    reporter: "r",
    reporter_name: "Team",
    category: "Network",
    description: "Broken",
    status: "open",
    created_at: "2026-10-17T11:00:00Z",
    first_assigned_at: null,
    owner: null,
    owner_name: null,
    resolved_at: null,
    revision: 1,
    ...overrides,
  };
}

// Numbers 2, 10 and 9 would sort wrongly as text. Unresolved minutes differ
// from the number order. Every column has a different order.
const issues: Issue[] = [
  issue({
    number: 10,
    status: "resolved",
    description: "beta",
    team_id: "t-b",
    owner_name: "Zoe",
    created_at: "2026-10-17T11:55:00Z",
  }),
  issue({
    number: 2,
    status: "escalated",
    description: "Alpha",
    team_id: "t-c",
    owner_name: "amir",
    created_at: "2026-10-17T11:10:00Z",
  }),
  issue({
    number: 9,
    status: "open",
    description: "Gamma",
    team_id: "t-a",
    owner_name: null,
    created_at: "2026-10-17T11:40:00Z",
  }),
  issue({
    number: 5,
    status: "claimed",
    description: "delta",
    team_id: "t-b",
    owner_name: "Bea",
    created_at: "2026-10-17T11:30:00Z",
  }),
];

function numbers(sort: QueueSort, input: readonly Issue[] = issues): number[] {
  return sortQueueIssues(input, sort, teams, [], now).map(
    (item) => item.number,
  );
}

describe("sortQueueIssues", () => {
  it("defaults to longest unresolved first", () => {
    expect(defaultQueueSort).toEqual({ key: "unresolved", direction: "desc" });
    expect(numbers(defaultQueueSort)).toEqual([2, 5, 9, 10]);
  });

  it.each([
    ["issue", [2, 5, 9, 10], [10, 9, 5, 2]],
    ["status", [9, 5, 2, 10], [10, 2, 5, 9]],
    ["report", [2, 10, 5, 9], [9, 5, 10, 2]],
    ["team", [5, 10, 2, 9], [9, 2, 5, 10]],
    ["owner", [2, 5, 10, 9], [10, 5, 2, 9]],
    ["unresolved", [10, 9, 5, 2], [2, 5, 9, 10]],
  ] as const)("sorts %s ascending and descending", (key, asc, desc) => {
    expect(numbers({ key, direction: "asc" })).toEqual(asc);
    expect(numbers({ key, direction: "desc" })).toEqual(desc);
  });

  it("keeps Unassigned last in both directions", () => {
    expect(numbers({ key: "owner", direction: "asc" }).at(-1)).toBe(9);
    expect(numbers({ key: "owner", direction: "desc" }).at(-1)).toBe(9);
  });

  it("orders issue numbers as numbers", () => {
    expect(numbers({ key: "issue", direction: "asc" })).toEqual([2, 5, 9, 10]);
  });

  it("breaks ties by issue number", () => {
    const tied = [
      issue({ number: 7, status: "open" }),
      issue({ number: 3, status: "open" }),
    ];
    expect(numbers({ key: "status", direction: "desc" }, tied)).toEqual([3, 7]);
  });

  it("does not change the input", () => {
    const before = issues.map((item) => item.number);
    numbers({ key: "issue", direction: "desc" });
    expect(issues.map((item) => item.number)).toEqual(before);
  });
});

describe("nextQueueSort", () => {
  it("sorts a new column ascending", () => {
    expect(nextQueueSort(defaultQueueSort, "team")).toEqual({
      key: "team",
      direction: "asc",
    });
  });

  it("flips the active column", () => {
    expect(nextQueueSort(defaultQueueSort, "unresolved").direction).toBe("asc");
    expect(
      nextQueueSort({ key: "team", direction: "asc" }, "team").direction,
    ).toBe("desc");
  });
});
