/** Server operations for the bounded transaction proof, independent of providers. */
export interface Caller {
  /** Supplied by a trusted identity adapter, never accepted from a request body. */
  accountId: string;
  loginId: string;
}

export type IssueCommand =
  | { type: "claim"; issue_id: string; revision: number }
  | {
      type: "message";
      issue_id: string;
      revision: number;
      text: string;
      visibility: "public" | "internal";
    };

export type CommandResult =
  | { outcome: "committed"; issueId: string }
  | { outcome: "rejected"; reason: "access" | "state" | "request_id" | "input" }
  | { outcome: "unknown" };

export interface IssueView {
  issueId: string;
  status: "open" | "claimed" | "escalated" | "resolved";
  owner: string | null;
  firstAssignedAt: string | null;
  revision: number;
  sequence: number;
  history: Array<{ actor: string; text: string; visibility: "public" | "internal" }>;
}

/** Each command commits its state, receipt, history, and notifications together. */
export interface ApplicationStore {
  execute(caller: Caller, sessionId: string, requestId: string, command: IssueCommand): Promise<CommandResult>;
  /** One consistent read checks current access and excludes private data. */
  issue(caller: Caller, sessionId: string, issueId: string): Promise<IssueView | undefined>;
}
