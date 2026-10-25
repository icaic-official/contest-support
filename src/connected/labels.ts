import type { Issue } from "./model";

/** Plain-language names for issue statuses. */
export const statusNames: Record<Issue["status"], string> = {
  open: "Open",
  claimed: "In progress",
  escalated: "Awaiting specialist",
  resolved: "Resolved",
};

/** Resolution summaries that staff can choose instead of a custom summary. */
export const resolutionPresets = [
  "Resolved without comment",
  "Service restored",
  "Device issue resolved",
  "Problem statement clarified",
];

/** Award minutes that the jury can choose instead of a custom value. */
export const awardMinutePresets = [0, 5, 10, 15, 30, 60];

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
