import type { IssueStatus } from "./model";

export const suggestionLimit = 8;

export type SearchTeam = {
  id: string;
  name: string;
  location: string;
};

export type SearchIssue = {
  team_id: string;
  status: IssueStatus;
};

/**
 * 1 exact name, 2 exact location, 3 whole word, 4 word prefix, 5 text inside
 * a word, 6 small spelling mistake, 7 letters in order across the name and
 * location.
 */
export type MatchRank = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type TeamMatch = {
  id: string;
  name: string;
  location: string;
  unresolved: number;
  rank: MatchRank;
};

export type TeamSearchResult = {
  suggestions: TeamMatch[];
  overflow: boolean;
  /** Every match, before the list limit. */
  total: number;
};

export type TeamSelection = {
  teamId: string | null;
  query: string;
  open: boolean;
  activeIndex: number;
  activeControl: string | null;
};

export function initialTeamSelection(): TeamSelection {
  return {
    teamId: null,
    query: "",
    open: false,
    activeIndex: -1,
    activeControl: null,
  };
}

/** Fold accents and punctuation so word order can be compared independently. */
export function normalizeTeamText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/ +/g, " ");
}

function teamTokens(value: string): string[] {
  const normalized = normalizeTeamText(value);
  if (!normalized) return [];
  const tokens: string[] = [];
  for (const word of normalized.split(" ")) {
    const parts = word.match(/\p{L}+|\p{N}+/gu);
    if (parts) tokens.push(...parts);
  }
  return tokens;
}

/**
 * Whole numbers match with or without leading zeros.
 * A shorter number is not a match for a longer one, so "1" does not match "12".
 */
function canonicalNumber(value: string): string {
  const stripped = value.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
}

function damerauLevenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const distances: number[] = Array.from(
    { length: rows * columns },
    () => 0,
  );
  const index = (row: number, column: number) => row * columns + column;
  const at = (row: number, column: number): number => {
    const distance = distances[index(row, column)];
    if (distance === undefined) throw new RangeError("Edit distance cell is out of range.");
    return distance;
  };
  for (let row = 0; row < rows; row++) distances[index(row, 0)] = row;
  for (let column = 0; column < columns; column++) distances[index(0, column)] = column;
  for (let row = 1; row < rows; row++) {
    for (let column = 1; column < columns; column++) {
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
      let distance = Math.min(
        at(row - 1, column) + 1,
        at(row, column - 1) + 1,
        at(row - 1, column - 1) + substitution,
      );
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        distance = Math.min(distance, at(row - 2, column - 2) + 1);
      }
      distances[index(row, column)] = distance;
    }
  }
  return at(left.length, right.length);
}

function spellingMatch(query: string, field: string): boolean {
  if (query.length < 4) return false;
  const limit = query.length <= 5 ? 1 : 2;
  if (Math.abs(query.length - field.length) > limit) return false;
  return damerauLevenshtein(query, field) <= limit;
}

/**
 * `wholeOnly` stops a one-letter token from matching inside a word, so "hall a"
 * does not match every hall.
 */
function tokenRank(
  query: string,
  fields: readonly string[],
  wholeOnly: boolean,
): MatchRank | null {
  let best: MatchRank | null = null;
  const queryIsNumber = /^\p{N}+$/u.test(query);
  for (const field of fields) {
    const fieldIsNumber = /^\p{N}+$/u.test(field);
    if (queryIsNumber || fieldIsNumber) {
      if (
        queryIsNumber &&
        fieldIsNumber &&
        canonicalNumber(query) === canonicalNumber(field)
      ) {
        return 3;
      }
      continue;
    }
    if (query === field) return 3;
    if (wholeOnly) continue;
    if (field.startsWith(query)) {
      best = best === null || best > 4 ? 4 : best;
    } else if (field.includes(query)) {
      best = best === null || best > 5 ? 5 : best;
    } else if ((best === null || best > 6) && spellingMatch(query, field)) {
      best = 6;
    }
  }
  return best;
}

function rankTeam(query: string, team: SearchTeam): MatchRank | null {
  const normalized = normalizeTeamText(query);
  if (!normalized) return null;
  if (normalized === normalizeTeamText(team.name)) return 1;
  if (normalized === normalizeTeamText(team.location)) return 2;
  const queries = teamTokens(query);
  if (queries.length === 0) return null;
  const fields = [...teamTokens(team.name), ...teamTokens(team.location)];
  let worst: MatchRank = 3;
  for (const token of queries) {
    const rank = tokenRank(
      token,
      fields,
      queries.length > 1 && token.length === 1,
    );
    if (rank === null) return inOrderRank(normalized, team);
    if (rank > worst) worst = rank;
  }
  return worst;
}

function isSubsequence(letters: string, text: string): boolean {
  let at = 0;
  for (const letter of text) {
    if (letter === letters[at]) at++;
    if (at === letters.length) return true;
  }
  return false;
}

/**
 * Letters typed in order, skipping others, such as "ialp" for
 * "Installation Alpha". Numbers never match this way.
 */
function inOrderRank(normalized: string, team: SearchTeam): MatchRank | null {
  const letters = normalized.replace(/ /g, "");
  if (letters.length < 2 || /\p{N}/u.test(letters)) return null;
  const text = normalizeTeamText(`${team.name} ${team.location}`).replace(
    / /g,
    "",
  );
  return isSubsequence(letters, text) ? 7 : null;
}

export function unresolvedCount(
  issues: readonly SearchIssue[],
  teamId: string,
): number {
  return issues.filter(
    (issue) => issue.team_id === teamId && issue.status !== "resolved",
  ).length;
}

export function unresolvedLabel(count: number): string {
  return count === 1 ? "1 unresolved issue" : `${count} unresolved issues`;
}

function sortMatches(matches: TeamMatch[]): TeamMatch[] {
  return matches.sort(
    (left, right) =>
      left.rank - right.rank ||
      left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
      left.location.localeCompare(right.location, "en", { sensitivity: "base" }) ||
      left.id.localeCompare(right.id),
  );
}

function limited(matches: TeamMatch[]): TeamSearchResult {
  return {
    suggestions: matches.slice(0, suggestionLimit),
    overflow: matches.length > suggestionLimit,
    total: matches.length,
  };
}

export function searchTeams(
  teams: readonly SearchTeam[],
  issues: readonly SearchIssue[],
  query: string,
): TeamSearchResult {
  if (!normalizeTeamText(query)) {
    return { suggestions: [], overflow: false, total: 0 };
  }
  const matches: TeamMatch[] = [];
  for (const team of teams) {
    const rank = rankTeam(query, team);
    if (rank === null) continue;
    matches.push({
      id: team.id,
      name: team.name,
      location: team.location,
      unresolved: unresolvedCount(issues, team.id),
      rank,
    });
  }
  return limited(sortMatches(matches));
}

/**
 * The list under the search box. An empty query lists every team by name so
 * people can browse. Other queries use `searchTeams`.
 */
export function suggestTeams(
  teams: readonly SearchTeam[],
  issues: readonly SearchIssue[],
  query: string,
): TeamSearchResult {
  if (normalizeTeamText(query)) return searchTeams(teams, issues, query);
  return limited(
    sortMatches(
      teams.map((team) => ({
        id: team.id,
        name: team.name,
        location: team.location,
        unresolved: unresolvedCount(issues, team.id),
        rank: 1,
      })),
    ),
  );
}

/** Editing the chosen text drops its id. A query never selects a team by itself. */
export function editTeamQuery(
  selection: TeamSelection,
  query: string,
  activeControl: string | null = selection.activeControl,
): TeamSelection {
  return {
    teamId: null,
    query,
    open: true,
    activeIndex: -1,
    activeControl,
  };
}

/** Shows the list. An empty box lists every team so people can browse. */
export function openTeamList(
  selection: TeamSelection,
  activeControl: string,
): TeamSelection {
  return { ...selection, open: true, activeIndex: -1, activeControl };
}

/**
 * Typed text reopens the list on focus. An empty box waits for a click or
 * ArrowDown, because a dialog focuses its first field when it opens.
 */
export function focusTeamQuery(
  selection: TeamSelection,
  activeControl: string,
): TeamSelection {
  if (!normalizeTeamText(selection.query)) return selection;
  return openTeamList(selection, activeControl);
}

export function moveTeamHighlight(
  selection: TeamSelection,
  direction: -1 | 1,
  count: number,
): TeamSelection {
  if (count === 0) return selection;
  const next = selection.activeIndex + direction;
  return {
    ...selection,
    open: true,
    activeIndex: Math.max(-1, Math.min(count - 1, next)),
  };
}

export function chooseTeam(teamId: string): TeamSelection {
  return {
    teamId,
    query: "",
    open: false,
    activeIndex: -1,
    activeControl: null,
  };
}

export function chooseHighlightedTeam(
  selection: TeamSelection,
  suggestionIds: readonly string[],
): TeamSelection {
  if (selection.activeIndex < 0) return selection;
  const teamId = suggestionIds[selection.activeIndex];
  if (!teamId) return selection;
  return chooseTeam(teamId);
}

export function closeTeamList(selection: TeamSelection): TeamSelection {
  return { ...selection, open: false, activeIndex: -1 };
}

export function clearTeamSelection(): TeamSelection {
  return initialTeamSelection();
}

export function submitTeamId(selection: TeamSelection): string | null {
  return selection.teamId;
}

/**
 * Keeps a chosen team after a refresh only while the person can still search
 * teams and the team still exists in the session.
 */
export function keepTeamSelection(
  selection: TeamSelection,
  canSearchTeams: boolean,
  teams: readonly { id: string }[],
): TeamSelection {
  if (
    !canSearchTeams ||
    (selection.teamId && !teams.some((team) => team.id === selection.teamId))
  ) {
    return initialTeamSelection();
  }
  return selection;
}
