import type { NewTeam, RosterCommand } from "@/backend/contracts";
import {
  categoriesMax,
  hasControlCharacter,
  rosterKey,
  rosterTextMax,
  teamsPerCommandMax,
} from "@/connected/roster";
import type { Issue, Snapshot, Team } from "@/connected/model";

/** Sorts team names so that "Team 2" comes before "Team 10". */
export const compareNames = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
}).compare;

/** One line of the "Add teams" box and what is wrong with it, if anything. */
export interface TeamLine {
  /** The line number in the box, counting blank lines. */
  line: number;
  name: string;
  location: string;
  problem?: string;
}

function lineProblem(name: string, location: string): string | undefined {
  if (name.length > rosterTextMax || location.length > rosterTextMax) {
    return `Use at most ${rosterTextMax} characters.`;
  }
  return hasControlCharacter(name + location)
    ? "Remove control characters."
    : undefined;
}

/**
 * Reads the "Add teams" box. A line is a team name, then a tab or a comma and
 * the location. Blank lines are skipped. A line is a problem when its name is
 * too long, repeats an earlier line, or is already in the roster.
 */
export function parseTeamLines(
  text: string,
  existing: readonly Pick<Team, "name">[],
): TeamLine[] {
  const taken = new Set(existing.map((team) => rosterKey(team.name)));
  const seen = new Map<string, number>();
  const lines: TeamLine[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    const tab = raw.indexOf("\t");
    const cut = tab >= 0 ? tab : raw.indexOf(",");
    const name = (cut >= 0 ? raw.slice(0, cut) : raw).trim();
    const location = (cut >= 0 ? raw.slice(cut + 1) : "").replace(/\s+/g, " ").trim();
    const key = rosterKey(name);
    let problem = name ? lineProblem(name, location) : "Write a team name first.";
    if (!problem && seen.has(key)) {
      problem = `Same name as line ${seen.get(key)}.`;
    } else if (!problem && taken.has(key)) {
      problem = "Already in the roster.";
    }
    if (!seen.has(key)) seen.set(key, index + 1);
    lines.push({ line: index + 1, name, location, problem });
  });
  return lines;
}

/** Whether the lines can be sent: at least one, none with a problem, not too many. */
export function teamLinesError(lines: readonly TeamLine[]): string | undefined {
  if (lines.length > teamsPerCommandMax) {
    return `Add up to ${teamsPerCommandMax} teams at a time.`;
  }
  return lines.some((line) => line.problem)
    ? "Fix or remove the lines with a problem."
    : undefined;
}

/**
 * The command that adds the lines. `ids` keeps one ID for each name until the
 * request succeeds, so a repeated send after a lost answer adds no second team.
 */
export function addTeamsCommand(
  lines: readonly TeamLine[],
  ids: Map<string, string>,
): RosterCommand {
  const teams: NewTeam[] = lines.map(({ name, location }) => {
    const key = rosterKey(name);
    const id = ids.get(key) ?? crypto.randomUUID();
    ids.set(key, id);
    return { id, name, location };
  });
  return { type: "add_teams", teams };
}

/** What a team holds in the session. A team with either stays in the roster. */
export interface TeamUsage {
  issues: number;
  accounts: number;
}

/** The issues and the accounts of every team, from one pass over the snapshot. */
export function teamUsage(
  issues: readonly Pick<Issue, "team_id">[],
  members: Snapshot["members"],
): Map<string, TeamUsage> {
  const usage = new Map<string, TeamUsage>();
  const of = (id: string) => {
    const found = usage.get(id) ?? { issues: 0, accounts: 0 };
    usage.set(id, found);
    return found;
  };
  for (const issue of issues) of(issue.team_id).issues++;
  for (const { membership } of members) {
    if (membership.team_id) of(membership.team_id).accounts++;
  }
  return usage;
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** Why a team stays, in words for the admin. Undefined when it can be deleted. */
export function teamKeptReason(usage: TeamUsage | undefined): string | undefined {
  if (!usage || (!usage.issues && !usage.accounts)) return undefined;
  return [
    usage.issues && plural(usage.issues, "issue", "issues"),
    usage.accounts && plural(usage.accounts, "account", "accounts"),
  ]
    .filter(Boolean)
    .join(" and ");
}

/** The number of issues of each category. A legacy issue without a category is not counted. */
export function categoryUsage(
  issues: readonly Pick<Issue, "category">[],
): Map<string, number> {
  const usage = new Map<string, number>();
  for (const { category } of issues) {
    if (category) usage.set(category, (usage.get(category) ?? 0) + 1);
  }
  return usage;
}

/** What is wrong with a category list, or undefined when it can be saved. */
export function categoriesError(categories: readonly string[]): string | undefined {
  if (!categories.length) return "Keep at least one category.";
  if (categories.length > categoriesMax) {
    return `Use at most ${categoriesMax} categories.`;
  }
  const names = categories.map((name) => name.trim());
  if (names.some((name) => !name)) return "Give every category a name.";
  if (names.some((name) => name.length > rosterTextMax)) {
    return `Use at most ${rosterTextMax} characters in a category.`;
  }
  return new Set(names.map(rosterKey)).size === names.length
    ? undefined
    : "Two categories have the same name.";
}

/** The command that saves a category list. */
export function setCategoriesCommand(categories: readonly string[]): RosterCommand {
  return { type: "set_categories", categories: categories.map((name) => name.trim()) };
}

/** Moves one item one place and returns a new list. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return [...items];
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** The notice after a recorded roster command. */
export function rosterNotice(command: RosterCommand): string {
  switch (command.type) {
    case "add_teams":
      return `Added ${plural(command.teams.length, "team", "teams")}.`;
    case "update_team":
      return "Team saved.";
    case "delete_team":
      return "Team deleted.";
    case "set_categories":
      return "Categories saved.";
  }
}

/** What is wrong with a team name or location edit, or undefined when it can be saved. */
export function teamEditError(
  name: string,
  location: string,
  teamId: string,
  teams: readonly Pick<Team, "id" | "name">[],
): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "Write a team name.";
  const problem = lineProblem(trimmed, location.trim());
  if (problem) return problem;
  return teams.some(
    (team) => team.id !== teamId && rosterKey(team.name) === rosterKey(trimmed),
  )
    ? "Another team has this name."
    : undefined;
}
