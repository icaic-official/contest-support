import { describe, expect, it } from "vitest";
import {
  chooseHighlightedTeam,
  chooseTeam,
  clearTeamSelection,
  closeTeamList,
  editTeamQuery,
  initialTeamSelection,
  issueVisibleForTeam,
  moveTeamHighlight,
  searchTeams,
  type SearchIssue,
  type SearchTeam,
  submitTeamId,
  suggestionLimit,
  unresolvedCount,
} from "./teamSearch";

const teams: SearchTeam[] = [
  { id: "aurora", name: "Aurora", location: "Hall A · Desk 12" },
  { id: "exact-place", name: "North", location: "Aurora" },
  { id: "words", name: "North Aurora", location: "Hall B · Desk 18" },
  { id: "partial", name: "Aurorax", location: "Hall C · Desk 3" },
  { id: "fuzzy", name: "Aurroa", location: "Hall D · Desk 9" },
  { id: "cedar", name: "Team Cedar", location: "Hall A · Desk 04" },
  { id: "orbit", name: "Équipe Orbit", location: "A12" },
  { id: "table", name: "Table", location: "Desk 12" },
];

const issues: SearchIssue[] = [
  { team_id: "aurora", status: "open" },
  { team_id: "aurora", status: "claimed" },
  { team_id: "aurora", status: "resolved" },
  { team_id: "cedar", status: "escalated" },
  { team_id: "orbit", status: "resolved" },
];

describe("team search", () => {
  it("ranks exact names, exact locations, whole words, partial words, and spelling", () => {
    const result = searchTeams(teams, issues, "aurora");
    expect(result.suggestions.map((team) => team.id)).toEqual([
      "aurora",
      "exact-place",
      "words",
      "partial",
      "fuzzy",
    ]);
    expect(result.suggestions.map((team) => team.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(result.overflow).toBe(false);
  });

  it("matches partial names, word order, accents, and small spelling mistakes", () => {
    expect(searchTeams(teams, issues, "aur").suggestions.map((team) => team.id)).toContain(
      "aurora",
    );
    expect(searchTeams(teams, issues, "12 desk").suggestions.map((team) => team.id)).toEqual(
      expect.arrayContaining(["aurora", "table"]),
    );
    expect(searchTeams(teams, issues, "equipe").suggestions[0]?.id).toBe("orbit");
    expect(searchTeams(teams, issues, "ceadr").suggestions.map((team) => team.id)).toContain(
      "cedar",
    );
  });

  it("matches whole table numbers, including leading zeros and compact codes", () => {
    const twelve = searchTeams(teams, issues, "12").suggestions.map((team) => team.id);
    expect(twelve).toEqual(expect.arrayContaining(["aurora", "orbit", "table"]));
    expect(twelve).not.toContain("cedar");
    expect(searchTeams(teams, issues, "1").suggestions).toEqual([]);
    expect(searchTeams(teams, issues, "04").suggestions.map((team) => team.id)).toEqual([
      "cedar",
    ]);
    expect(searchTeams(teams, issues, "A12").suggestions.map((team) => team.id)).toEqual(
      expect.arrayContaining(["orbit", "aurora"]),
    );
    expect(searchTeams(teams, issues, "A").suggestions.map((team) => team.id)).toEqual(
      expect.arrayContaining(["aurora", "cedar"]),
    );
    expect(searchTeams(teams, issues, "A").suggestions.map((team) => team.id)).not.toContain(
      "partial",
    );
  });

  it("returns no suggestions for an empty or weak query and caps the list", () => {
    expect(searchTeams(teams, issues, "   ").suggestions).toEqual([]);
    expect(searchTeams(teams, issues, "zz").suggestions).toEqual([]);
    const many = Array.from({ length: suggestionLimit + 1 }, (_, index) => ({
      id: `team-${index}`,
      name: `Team ${String.fromCharCode(65 + index)}`,
      location: "Hall Z",
    }));
    const result = searchTeams(many, [], "team");
    expect(result.suggestions).toHaveLength(suggestionLimit);
    expect(result.overflow).toBe(true);
    expect(result.suggestions[0]?.name).toBe("Team A");
  });

  it("counts unresolved issues without using the status filter", () => {
    expect(unresolvedCount(issues, "aurora")).toBe(2);
    expect(unresolvedCount(issues, "orbit")).toBe(0);
    const open = { team_id: "aurora", status: "open" };
    const resolved = { team_id: "aurora", status: "resolved" };
    expect(issueVisibleForTeam(open, "aurora", "resolved", false)).toBe(false);
    expect(issueVisibleForTeam(resolved, "aurora", "resolved", false)).toBe(true);
    expect(issueVisibleForTeam(open, "aurora", "all", true)).toBe(false);
    expect(issueVisibleForTeam(resolved, "aurora", "open", true)).toBe(true);
    expect(issueVisibleForTeam(resolved, "cedar", "all", false)).toBe(false);
  });

  it("keeps the first suggestion unselected until staff choose an id", () => {
    const result = searchTeams(teams, issues, "aurora");
    const searching = editTeamQuery(initialTeamSelection(), "aurora");
    expect(searching.teamId).toBeNull();
    expect(searching.activeIndex).toBe(-1);
    expect(submitTeamId(searching)).toBeNull();
    const highlighted = moveTeamHighlight(searching, 1, result.suggestions.length);
    expect(highlighted.activeIndex).toBe(0);
    expect(submitTeamId(highlighted)).toBeNull();
    expect(chooseHighlightedTeam(searching, result.suggestions.map((team) => team.id))).toBe(
      searching,
    );
    const chosen = chooseHighlightedTeam(
      highlighted,
      result.suggestions.map((team) => team.id),
    );
    expect(submitTeamId(chosen)).toBe(result.suggestions[0]?.id);
    const second = chooseTeam(result.suggestions[1]?.id ?? "");
    expect(submitTeamId(second)).toBe("exact-place");
    expect(submitTeamId(editTeamQuery(second, "ced"))).toBeNull();
    expect(closeTeamList({ ...second, open: true, activeIndex: 1 }).teamId).toBe(
      "exact-place",
    );
    expect(submitTeamId(clearTeamSelection())).toBeNull();
  });
});
