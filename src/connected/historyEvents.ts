import { awardMinutesLabel } from "./labels";
import type { Award, HistoryEntry, Issue, Resolution } from "./model";

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
  | { kind: "awarded" }
  | { kind: "withdrawn" };

/** The start of the text that the server stores for an award. */
const awardedText = /^(\d+) minutes awarded: /;

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
    /** The issue's history records a withdrawn award. */
    awardWithdrawn?: boolean;
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
  if (value === "Time award withdrawn. It gives no time.") return { kind: "withdrawn" };
  // A team never reads a withdrawn award, so its decision entry has no award to match.
  const decided = award ? sameTime(award.at, entry.at) : Boolean(context.awardWithdrawn);
  if (awardedText.test(value) && decided) {
    return { kind: "awarded" };
  }
  return undefined;
}

/**
 * The text that staff read for a history entry. The server stores every
 * award as "N minutes awarded: ...". Staff read "1 minute awarded: ..." and
 * "No time added: ..." instead. Other entries keep their stored text.
 */
export function historyText(
  entry: HistoryEntry,
  context: Parameters<typeof workflowEvent>[1],
): string {
  if (workflowEvent(entry, context)?.kind !== "awarded") return entry.text;
  return entry.text.replace(awardedText, (_, minutes: string) =>
    Number(minutes) === 0
      ? "No time added: "
      : `${awardMinutesLabel(Number(minutes))} awarded: `,
  );
}
