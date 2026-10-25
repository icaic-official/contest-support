import type { Issue } from "./model";

/** Plain-language names for issue statuses. */
export const statusNames: Record<Issue["status"], string> = {
  open: "Open",
  claimed: "In progress",
  escalated: "Awaiting specialist",
  resolved: "Resolved",
};

/** The preset that takes no comment. */
export const noCommentSummary = "Resolved without comment";

/** Resolution summaries that staff can choose instead of a custom summary. */
export const resolutionPresets = [
  noCommentSummary,
  "Service restored",
  "Device issue resolved",
  "Problem statement clarified",
];

/** The longest resolution summary and award explanation. */
export const maxSummaryLength = 2000;

/**
 * The summary for a resolve choice: a preset with an optional comment after
 * it, or the custom text. Empty until the choice is complete.
 */
export function resolutionSummary(
  choice: string,
  custom: string,
  comment: string,
): string {
  if (choice === "custom") return custom.trim();
  if (choice !== "" && choice !== noCommentSummary && comment.trim() !== "") {
    return `${choice}: ${comment.trim()}`;
  }
  return choice;
}

/** Award minutes that the jury can choose instead of a custom value. */
export const awardMinutePresets = [0, 5, 10, 15, 30, 60];

/** The largest award that the database stores. */
export const maxAwardMinutes = 2147483647;

/**
 * Whole award minutes from the custom field. Undefined for a decimal, an
 * exponent, a sign, text, or a value above the database limit.
 */
export function parseAwardMinutes(text: string): number | undefined {
  const value = text.trim();
  if (!/^\d+$/u.test(value)) return undefined;
  const minutes = Number(value);
  return minutes <= maxAwardMinutes ? minutes : undefined;
}

/** A contestant-facing amount such as "No time added", "1 minute" or "5 minutes". */
export function awardMinutesLabel(minutes: number): string {
  if (minutes === 0) return "No time added";
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

/** A short age such as "now", "9m ago" or "2h 5m ago". */
export function relativeAge(value: string, now: number): string {
  const minutes = Math.floor(Math.max(0, now - Date.parse(value)) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}
