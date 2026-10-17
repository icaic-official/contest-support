import { useState } from "react";
import { type CommandRunner, useCommand } from "./useCommand";
import type { SessionData } from "./useSessionSnapshot";

/** Command and issue selection state that a UI shell shares with its layouts. */
export interface WorkflowState {
  command: CommandRunner;
  /** The issue that the person looks at, or "" for the first visible issue. */
  selectedIssueId: string;
  selectIssue: (issueId: string) => void;
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
  const [selectedIssueId, selectIssue] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const command = useCommand({
    sessionId: data.sessionId,
    refresh: data.refresh,
    onRecorded: (issueId, recorded) => {
      selectIssue(issueId);
      // Show a reopened issue even when the filter was "resolved".
      if (recorded.type === "reopen") setStatusFilter("claimed");
    },
  });
  return {
    command,
    selectedIssueId,
    selectIssue,
    statusFilter,
    setStatusFilter,
  };
}
