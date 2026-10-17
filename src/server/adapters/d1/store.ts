import type { ApplicationStore, Caller, CommandResult, IssueCommand, IssueView } from "../../applicationStore";
import { WorkflowService, workflowText } from "../../workflow.ts";
import type { WorkflowPersistence, WorkflowRead, WorkflowDecision, WorkflowCommitResult } from "../../workflow.ts";
import type { Command, Role } from "../../../connected/model.ts";
import type { D1Connection } from "./connection";

interface State {
  issue_id: string;
  membership_team: string | null;
  is_admin: number;
  roles: string;
  team_id: string;
  status: IssueView["status"];
  owner: string | null;
  first_assigned_at: string | null;
  public_revision: number;
  write_version: number;
  access_version: number;
  login_version: number;
  membership_version: number;
  session_version: number;
  event_version: number;
  archived: number;
  staff: number;
  support: number;
  can_message: number;
  sequence: number;
  history: string;
  receipt_command: string | null;
  receipt_session: string | null;
  receipt_issue: string | null;
}

// One primary query checks access and builds the view from the same SQLite snapshot.
const stateSql = `
  SELECT i.id AS issue_id, i.team_id, i.status, i.owner, i.first_assigned_at,
    m.team_id AS membership_team, m.is_admin,
    (SELECT json_group_array(r.role) FROM membership_roles r WHERE r.session_id=m.session_id AND r.account_id=a.id) AS roles,
    i.public_revision, i.write_version, a.access_version, l.version AS login_version,
    m.version AS membership_version, s.version AS session_version, e.version AS event_version,
    e.archived,
    (m.is_admin = 1 OR EXISTS (SELECT 1 FROM membership_roles r WHERE r.session_id = m.session_id AND r.account_id = a.id)) AS staff,
    EXISTS (SELECT 1 FROM membership_roles r WHERE r.session_id = m.session_id AND r.account_id = a.id AND r.role IN ('volunteer', 'specialist')) AS support,
    (m.team_id IS NOT NULL OR EXISTS (SELECT 1 FROM membership_roles r WHERE r.session_id = m.session_id AND r.account_id = a.id)) AS can_message,
    COALESCE((SELECT sequence FROM audience_sequences q WHERE q.session_id = s.id AND q.audience = CASE
      WHEN m.is_admin = 1 OR EXISTS (SELECT 1 FROM membership_roles r WHERE r.session_id = m.session_id AND r.account_id = a.id)
      THEN 'staff' ELSE 'team:' || m.team_id END), 0) AS sequence,
    (SELECT json_group_array(json_object('actor', h.actor, 'text', h.text, 'visibility', h.visibility)) FROM
      (SELECT * FROM history WHERE issue_id = i.id AND (visibility = 'public' OR m.is_admin = 1 OR EXISTS
        (SELECT 1 FROM membership_roles r WHERE r.session_id = m.session_id AND r.account_id = a.id)) ORDER BY at, id) h) AS history,
    cr.command AS receipt_command, cr.session_id AS receipt_session, cr.issue_id AS receipt_issue
  FROM accounts a
  JOIN logins l ON l.account_id = a.id AND l.id = ? AND l.revoked = 0 AND l.expires_at > unixepoch()
  JOIN memberships m ON m.account_id = a.id AND m.session_id = ?
  JOIN sessions s ON s.id = m.session_id
  JOIN events e ON e.id = s.event_id
  JOIN issues i ON i.session_id = s.id AND i.id = ?
  LEFT JOIN command_receipts cr ON cr.actor = a.id AND cr.request_id = ?
  WHERE a.id = ? AND a.disabled = 0 AND a.must_change = 0
    AND (i.team_id = m.team_id OR m.is_admin = 1 OR EXISTS
      (SELECT 1 FROM membership_roles r WHERE r.session_id = m.session_id AND r.account_id = a.id))`;

/** D1 owns each batch. Callers never receive SQL or a transaction callback. */
export class D1ApplicationStore implements ApplicationStore, WorkflowPersistence {
  constructor(private readonly db: D1Connection) {}

  private readState(caller: Caller, sessionId: string, issueId: string, requestId = "") {
    return this.db.prepare(stateSql).bind(caller.loginId, sessionId, issueId, requestId, caller.accountId).first<State>();
  }

  async issue(caller: Caller, sessionId: string, issueId: string): Promise<IssueView | undefined> {
    const state = await this.readState(caller, sessionId, issueId);
    if (!state) return undefined;
    return {
      issueId: state.issue_id, status: state.status, owner: state.owner,
      firstAssignedAt: state.first_assigned_at, revision: state.public_revision,
      sequence: state.sequence, history: JSON.parse(state.history),
    };
  }

  async execute(caller: Caller, sessionId: string, requestId: string, input: IssueCommand): Promise<CommandResult> {
    return new WorkflowService(this).execute(caller, sessionId, requestId, input);
  }

  async read(caller: Caller, sessionId: string, requestId: string, command: Command): Promise<WorkflowRead | undefined> {
    // This adapter deliberately supports only the original two-command proof.
    if (command.type !== "claim" && command.type !== "message") return undefined;
    const state = await this.readState(caller, sessionId, command.issue_id, requestId);
    if (!state) return undefined;
    return {
      state: {
        actor: { id: caller.accountId, name: "" },
        membership: { team_id: state.membership_team, roles: JSON.parse(state.roles) as Role[], is_admin: !!state.is_admin },
        session: { id: sessionId, intake_open: false, categories: [] }, archived: !!state.archived,
        teams: [], issue: { id: state.issue_id, team_id: state.team_id, status: state.status,
          owner: state.owner, revision: state.public_revision }, resolution: null, award: null,
      },
      dependency: state,
      receipt: state.receipt_command === null ? null : {
        sessionId: state.receipt_session!, command: JSON.parse(state.receipt_command), issueId: state.receipt_issue!,
      },
    };
  }

  async commit(caller: Caller, sessionId: string, requestId: string, command: Command,
    read: WorkflowRead, decision: WorkflowDecision): Promise<WorkflowCommitResult> {
    if (command.type !== "claim" && command.type !== "message") return { outcome: "rejected", reason: "input" };
    const state = read.dependency as State;
    const canonical = JSON.stringify(command);
    // Receipt replay must also cross a current primary access read. It writes no plan.
    if (read.receipt) {
      const current = await this.readState(caller, sessionId, command.issue_id, requestId);
      if (!current || current.archived) return { outcome: "rejected", reason: "access" };
      return { outcome: "committed", issueId: read.receipt.issueId };
    }
      const at = new Date().toISOString();
      const assertionId = crypto.randomUUID();
      const visible = decision.history.visibility === "public";
      const audiences = visible ? ["staff", `team:${state.team_id}`] : ["staff"];
      const prepare = (sql: string, ...values: Array<string | number | null>) => this.db.prepare(sql).bind(...values);
      const statements = [
        // Reserve first. A failed assertion must also roll back this receipt.
        prepare("INSERT INTO command_receipts (actor, request_id, session_id, command, issue_id) VALUES (?, ?, ?, ?, ?)", caller.accountId, requestId, sessionId, canonical, state.issue_id),
        prepare(`INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN EXISTS (
          SELECT 1 FROM (${stateSql}) current WHERE current.archived = 0
            AND current.access_version = ? AND current.login_version = ? AND current.membership_version = ?
            AND current.session_version = ? AND current.event_version = ? AND current.write_version = ?
        ) THEN 1 ELSE 0 END)`, assertionId, caller.loginId, sessionId, state.issue_id, requestId, caller.accountId,
          state.access_version, state.login_version, state.membership_version, state.session_version, state.event_version, state.write_version),
        prepare(`UPDATE issues SET status = ?, owner = ?, first_assigned_at = ?,
          public_revision = public_revision + ?, write_version = write_version + 1 WHERE id = ? AND write_version = ?`,
          decision.issue?.status ?? state.status,
          decision.issue?.owner ?? state.owner,
          command.type === "claim" ? (state.first_assigned_at ?? at) : state.first_assigned_at,
          visible ? 1 : 0, state.issue_id, state.write_version),
        prepare("INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE 0 END)", `${assertionId}:write`),
        prepare("INSERT INTO history (id, issue_id, actor, at, text, visibility) VALUES (?, ?, ?, ?, ?, ?)", crypto.randomUUID(), state.issue_id, caller.accountId, at,
          workflowText(decision.history.text), decision.history.visibility),
      ];
      for (const audience of audiences) {
        statements.push(
          prepare(`INSERT INTO audience_sequences (session_id, audience, sequence) VALUES (?, ?, 1)
            ON CONFLICT (session_id, audience) DO UPDATE SET sequence = sequence + 1`, sessionId, audience),
          prepare(`INSERT INTO notifications (id, session_id, audience, sequence)
            SELECT ?, session_id, audience, sequence FROM audience_sequences WHERE session_id = ? AND audience = ?`, crypto.randomUUID(), sessionId, audience),
        );
      }
      statements.push(prepare("DELETE FROM command_assertions WHERE id IN (?, ?)", assertionId, `${assertionId}:write`));
      try {
        await this.db.batch(statements);
        return { outcome: "committed", issueId: state.issue_id };
      } catch (error) {
        // Only known SQLite rollbacks permit reevaluation. Transport failures stay unknown.
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("CHECK constraint failed: valid = 1") &&
            !message.includes("UNIQUE constraint failed: command_receipts.actor, command_receipts.request_id")) {
          return { outcome: "unknown" };
        }
        return { outcome: "retry" };
      }
  }
}
