import { describe, expect, it } from "vitest";
import {
  addTeamsCommand,
  categoriesError,
  categoryUsage,
  compareNames,
  moveItem,
  parseTeamLines,
  teamKeptReason,
  teamLinesError,
  teamUsage,
} from "./rosterModel";

describe("parseTeamLines", () => {
  it("reads a name, then a location after a comma or a tab", () => {
    const lines = parseTeamLines("Aurora, Hall A, desk 12\nCedar\tHall B\n\n  Delta  \r\nEpsilon,", []);
    expect(lines.map(({ line, name, location }) => [line, name, location])).toEqual([
      [1, "Aurora", "Hall A, desk 12"],
      [2, "Cedar", "Hall B"],
      [4, "Delta", ""],
      [5, "Epsilon", ""],
    ]);
    expect(teamLinesError(lines)).toBeUndefined();
  });

  it("flags a repeated name, a name in the roster and a missing name", () => {
    const lines = parseTeamLines("Aurora\n aurora \nCedar\n, Hall", [{ name: "CEDAR" }]);
    expect(lines.map((line) => line.problem)).toEqual([
      undefined,
      "Same name as line 1.",
      "Already in the roster.",
      "Write a team name first.",
    ]);
    expect(teamLinesError(lines)).toBe("Fix or remove the lines with a problem.");
  });

  it("flags text that is too long or holds a control character", () => {
    const lines = parseTeamLines(`${"x".repeat(201)}\nOk, ${"y".repeat(201)}\nBad\u0007`, []);
    expect(lines.map((line) => line.problem)).toEqual([
      "Use at most 200 characters.",
      "Use at most 200 characters.",
      "Remove control characters.",
    ]);
  });

  it("limits one request to 300 teams", () => {
    const text = Array.from({ length: 301 }, (_, index) => `T${index}`).join("\n");
    expect(teamLinesError(parseTeamLines(text, []))).toBe("Add up to 300 teams at a time.");
  });
});

describe("addTeamsCommand", () => {
  it("keeps one ID for each name across repeated sends", () => {
    const ids = new Map<string, string>();
    const lines = parseTeamLines("Aurora, Hall A\nCedar", []);
    const first = addTeamsCommand(lines, ids);
    const again = addTeamsCommand(parseTeamLines("Cedar\nAurora, Hall A", []), ids);
    if (first.type !== "add_teams" || again.type !== "add_teams") throw new Error("Wrong command.");
    const byName = (command: typeof first) => Object.fromEntries(command.teams.map((team) => [team.name, team.id]));
    expect(byName(again)).toEqual(byName(first));
    expect(new Set(first.teams.map((team) => team.id)).size).toBe(2);
  });
});

describe("usage", () => {
  const member = (team: string | null) => ({
    membership: { session_id: "s", user_id: "u", team_id: team, roles: [], is_admin: false },
    person: { id: "p", name: "Person", username: null },
  });

  it("counts issues and accounts of each team and words the reason", () => {
    const usage = teamUsage(
      [{ team_id: "a" }, { team_id: "a" }, { team_id: "b" }],
      [member("a"), member("c"), member(null)],
    );
    expect(teamKeptReason(usage.get("a"))).toBe("2 issues and 1 account");
    expect(teamKeptReason(usage.get("b"))).toBe("1 issue");
    expect(teamKeptReason(usage.get("c"))).toBe("1 account");
    expect(teamKeptReason(usage.get("none"))).toBeUndefined();
  });

  it("counts issues of each category and skips a legacy blank category", () => {
    const usage = categoryUsage([{ category: "Devices" }, { category: "Devices" }, { category: "" }]);
    expect([...usage]).toEqual([["Devices", 2]]);
  });
});

describe("categoriesError", () => {
  it.each([
    [[], "Keep at least one category."],
    [["Ok", " "], "Give every category a name."],
    [["Ok", "ok "], "Two categories have the same name."],
    [["x".repeat(201)], "Use at most 200 characters in a category."],
    [Array.from({ length: 51 }, (_, index) => `C${index}`), "Use at most 50 categories."],
    [["Network", "Power"], undefined],
  ])("checks %j", (list, message) => {
    expect(categoriesError(list)).toBe(message);
  });
});

describe("list helpers", () => {
  it("moves one item and ignores a move off the list", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 3)).toEqual(["a", "b", "c"]);
  });

  it("sorts numbers inside names by value", () => {
    expect(["Team 10", "Team 2", "team 1"].sort(compareNames)).toEqual(["team 1", "Team 2", "Team 10"]);
  });
});
