import { categoriesMax, rosterKey, rosterTextMax } from "@/connected/roster";
import type { Issue } from "@/connected/model";

/** Sorts team names so that "Team 2" comes before "Team 10". */
export const compareNames = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
}).compare;

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

/** Moves one item one place and returns a new list. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return [...items];
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
