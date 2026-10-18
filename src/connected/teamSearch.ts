export const suggestionLimit = 8;

export type SearchTeam = {
  id: string;
  name: string;
  location: string;
};

export type SearchIssue = {
  team_id: string;
  status: "open" | "claimed" | "escalated" | "resolved" | string;
};

export type MatchRank = 1 | 2 | 3 | 4 | 5;

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
  for (let row = 0; row < rows; row++) distances[index(row, 0)] = row;
  for (let column = 0; column < columns; column++) distances[index(0, column)] = column;
  for (let row = 1; row < rows; row++) {
    for (let column = 1; column < columns; column++) {
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
      let distance = Math.min(
        distances[index(row - 1, column)] + 1,
        distances[index(row, column - 1)] + 1,
        distances[index(row - 1, column - 1)] + substitution,
      );
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        distance = Math.min(distance, distances[index(row - 2, column - 2)] + 1);
      }
      distances[index(row, column)] = distance;
    }
  }
  return distances[index(left.length, right.length)];
}

function spellingMatch(query: string, field: string): boolean {
  if (query.length < 4) return false;
  const limit = query.length <= 5 ? 1 : 2;
  if (Math.abs(query.length - field.length) > limit) return false;
  return damerauLevenshtein(query, field) <= limit;
}

function tokenRank(query: string, fields: readonly string[]): MatchRank | null {
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
    if (query.length >= 3 && field.includes(query)) {
      best = best === null || best > 4 ? 4 : best;
    } else if (best !== 4 && spellingMatch(query, field)) {
      best = 5;
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
    const rank = tokenRank(token, fields);
    if (rank === null) return null;
    if (rank > worst) worst = rank;
  }
  return worst;
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

export function searchTeams(
  teams: readonly SearchTeam[],
  issues: readonly SearchIssue[],
  query: string,
): TeamSearchResult {
  if (!normalizeTeamText(query)) return { suggestions: [], overflow: false };
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
  matches.sort(
    (left, right) =>
      left.rank - right.rank ||
      left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
      left.location.localeCompare(right.location, "en", { sensitivity: "base" }) ||
      left.id.localeCompare(right.id),
  );
  return {
    suggestions: matches.slice(0, suggestionLimit),
    overflow: matches.length > suggestionLimit,
  };
}

/**
 * Jury members stay on resolved issues. Other staff combine the team with the
 * status filter. The unresolved count stays independent of that filter.
 */
export function issueVisibleForTeam(
  issue: SearchIssue,
  teamId: string | null,
  statusFilter: string,
  juryOnly: boolean,
): boolean {
  if (juryOnly && issue.status !== "resolved") return false;
  if (!juryOnly && statusFilter !== "all" && issue.status !== statusFilter) {
    return false;
  }
  return teamId === null || issue.team_id === teamId;
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
    open: normalizeTeamText(query).length > 0,
    activeIndex: -1,
    activeControl,
  };
}

export function focusTeamQuery(
  selection: TeamSelection,
  activeControl: string,
): TeamSelection {
  if (!normalizeTeamText(selection.query)) return selection;
  return { ...selection, open: true, activeIndex: -1, activeControl };
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
