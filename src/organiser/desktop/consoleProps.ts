import type { WorkflowState } from "@/connected/hooks/useWorkflowState";
import type { Issue, Membership, Snapshot } from "@/connected/model";
import type { ShellProps } from "@/connected/shell";

/** The inline action of a queue row. */
export type RowAction = "claim" | "accept";

/** A tab of the issue side sheet. */
export type SheetTab = "activity" | "images" | "outcome";

/** What every console page needs from the shell. */
export interface ConsolePageProps {
  shell: ShellProps;
  state: Snapshot;
  member: Membership;
  workflow: WorkflowState;
  now: number;
  /** Opens the issue side sheet, optionally on one tab. */
  openIssue: (issueId: string, tab?: SheetTab) => void;
  /** The inline action of a row for this person, if any. */
  rowAction: (issue: Issue) => RowAction | undefined;
  /** Runs Claim or Accept from a row and stays on the page. */
  runRowAction: (issue: Issue, action: RowAction) => void;
}

/** The id of the heading of the current page. Navigation focuses it. */
export const consoleHeadingId = "console-heading";
