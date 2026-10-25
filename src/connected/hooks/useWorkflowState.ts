import { useCallback, useRef, useState } from "react";
import { type CommandRunner, useCommand } from "./useCommand";
import type { SessionData } from "./useSessionSnapshot";

/** Command and issue selection state that a UI shell shares with its layouts. */
export interface WorkflowState {
  command: CommandRunner;
  /** The issue that the person looks at, or "" for the first visible issue. */
  selectedIssueId: string;
  selectIssue: (issueId: string) => void;
  /**
   * How many times the person has chosen an issue. A recorded command does
   * not move this mark.
   */
  selectionMark: () => number;
  /** "all" or an issue status. */
  statusFilter: string;
  setStatusFilter: (filter: string) => void;
}

/**
 * Creates the command runner and the selected issue for one shell. Call it in
 * the shell, above any layout switch, so a pending request and the selected
 * issue survive a change of viewport.
 */
export function useWorkflowState(data: SessionData): WorkflowState {
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // Counts selection changes. A recorded command selects its issue only when
  // the selection did not change while the command ran, so Back during the
  // refresh after a command is not undone.
  const selections = useRef(0);
  const selectionsAtStart = useRef(0);
  const selectIssue = useCallback((issueId: string) => {
    selections.current++;
    setSelectedIssueId(issueId);
  }, []);
  const command = useCommand({
    sessionId: data.sessionId,
    refresh: data.refresh,
    applySnapshot: data.applySnapshot,
    onStart: () => {
      selectionsAtStart.current = selections.current;
    },
    onRecorded: (issueId, recorded, options) => {
      if (selections.current !== selectionsAtStart.current) return;
      // An inline queue action stays on the list. Selecting here would open
      // the issue and close it again after this function returns.
      if (!options.stayOnPage) setSelectedIssueId(issueId);
      // Show a reopened issue even when the filter was "resolved".
      if (recorded.type === "reopen") setStatusFilter("claimed");
    },
  });
  const selectionMark = useCallback(() => selections.current, []);
  return {
    command,
    selectedIssueId,
    selectIssue,
    selectionMark,
    statusFilter,
    setStatusFilter,
  };
}
