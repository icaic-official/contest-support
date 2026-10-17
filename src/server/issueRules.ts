import type { IssueCommand, IssueView } from "./applicationStore";

export interface IssueState {
  status: IssueView["status"];
  revision: number;
  support: boolean;
  staff: boolean;
  canMessage: boolean;
}

/** Pure rules. The store must check these dependencies again when it commits. */
export function decideIssueCommand(state: IssueState, command: IssueCommand): boolean {
  if (command.revision !== state.revision) return false;
  if (command.type === "claim") return state.support && state.status === "open";
  return state.canMessage && state.status !== "resolved" && (command.visibility === "public" || state.staff);
}
