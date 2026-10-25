import type { Issue, Resolution, Snapshot } from "./model";

type HistoryEntry = Snapshot["history"][number];
type Award = Snapshot["awards"][number];

/** A workflow step that the server records as a history entry. */
export type WorkflowEvent =
  | { kind: "submitted" }
  | { kind: "claimed" }
  | { kind: "handoff" }
  | { kind: "accepted" }
  | { kind: "image-added" }
  | { kind: "image-removed" }
  | { kind: "applied" }
  | { kind: "resolved" }
  | { kind: "reopened"; reason: string }
  | { kind: "awarded" };

function sameTime(a: string | null | undefined, b: string): boolean {
  return Boolean(a) && Date.parse(a ?? "") === Date.parse(b);
}

/**
 * The workflow step that a history entry records, or undefined for a message
 * that a person wrote. The history table does not store a type, so a step is
 * found by its fixed text and, where the text contains free input, by the
 * timestamp of the record that it belongs to. `resolutions` and `award` must
 * be those of the entry's issue.
 */
export function workflowEvent(
  entry: HistoryEntry,
  context: {
    issue: Issue;
    resolutions: readonly Resolution[];
    award: Award | undefined;
  },
): WorkflowEvent | undefined {
  const { issue, resolutions, award } = context;
  const value = entry.text;
  if (value === "Issue claimed.") return { kind: "claimed" };
  if (value === "Specialist handoff requested. Current owner retained.") {
    return { kind: "handoff" };
  }
  if (value === "Specialist accepted ownership.") return { kind: "accepted" };
  if (value === "Image added.") return { kind: "image-added" };
  if (value === "Image removed.") return { kind: "image-removed" };
  if (value.startsWith("External application confirmed.")) {
    return { kind: "applied" };
  }
  if (
    value.startsWith("Issue submitted: ") &&
    sameTime(issue.created_at, entry.at)
  ) {
    return { kind: "submitted" };
  }
  if (
    value.startsWith("Resolved: ") &&
    resolutions.some((r) => sameTime(r.at, entry.at))
  ) {
    return { kind: "resolved" };
  }
  if (
    value.startsWith("Reopened: ") &&
    resolutions.some((r) => sameTime(r.reopened_at, entry.at))
  ) {
    return { kind: "reopened", reason: value.slice("Reopened: ".length) };
  }
  if (/^\d+ minutes awarded: /.test(value) && sameTime(award?.at, entry.at)) {
    return { kind: "awarded" };
  }
  return undefined;
}
