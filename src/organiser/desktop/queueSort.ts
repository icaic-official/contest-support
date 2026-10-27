import {
  type Issue,
  type Resolution,
  type Team,
  unresolvedTime,
} from "@/connected/model";

export type QueueSortKey =
  "issue" | "status" | "report" | "team" | "owner" | "unresolved";

export type SortDirection = "asc" | "desc";

export interface QueueSort {
  key: QueueSortKey;
  direction: SortDirection;
}

/** Longest unresolved time first, as on page load. */
export const defaultQueueSort: QueueSort = {
  key: "unresolved",
  direction: "desc",
};

/** The order of the workflow: a waiting issue comes before a resolved one. */
const statusOrder: Record<Issue["status"], number> = {
  open: 0,
  claimed: 1,
  escalated: 2,
  resolved: 3,
};

/** A new column sorts ascending. The active column flips its direction. */
export function nextQueueSort(
  current: QueueSort,
  key: QueueSortKey,
): QueueSort {
  if (current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

function text(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/**
 * Sorts issues by one column. Ties keep the lower issue number first, so the
 * order is stable between refreshes. An unassigned issue sorts last in the
 * Owner column in both directions.
 */
export function sortQueueIssues(
  issues: readonly Issue[],
  sort: QueueSort,
  teams: readonly Team[],
  resolutions: readonly Resolution[],
  now: number,
): Issue[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const teamName = (issue: Issue) => teamNames.get(issue.team_id) ?? "";
  const elapsed = new Map(
    sort.key === "unresolved"
      ? issues.map((issue) => [issue.id, unresolvedTime(issue, resolutions, now)])
      : [],
  );
  const compare = (a: Issue, b: Issue): number => {
    switch (sort.key) {
      case "issue":
        return sign * (a.number - b.number);
      case "status":
        return sign * (statusOrder[a.status] - statusOrder[b.status]);
      case "report":
        return sign * text(a.description, b.description);
      case "team":
        return sign * text(teamName(a), teamName(b));
      case "owner": {
        if (!a.owner_name || !b.owner_name) {
          return Number(!a.owner_name) - Number(!b.owner_name);
        }
        return sign * text(a.owner_name, b.owner_name);
      }
      case "unresolved":
        return sign * ((elapsed.get(a.id) ?? 0) - (elapsed.get(b.id) ?? 0));
    }
  };
  return [...issues].sort((a, b) => compare(a, b) || a.number - b.number);
}
