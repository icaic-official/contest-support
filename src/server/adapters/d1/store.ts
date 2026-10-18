import type { ApplicationStore, Caller, CommandResult, IssueCommand, IssueView } from "../../applicationStore";
import { WorkflowService } from "../../workflow.ts";
import type { WorkflowPersistence, WorkflowRead, WorkflowDecision, WorkflowCommitResult } from "../../workflow.ts";
import type { Command, Role } from "../../../connected/model.ts";
import type { D1Connection, D1Statement } from "./connection";

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
class BoundedD1ProofStore implements ApplicationStore, WorkflowPersistence {
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
        decision.history.text, decision.history.visibility),
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

interface WorkflowRow {
  actor_name: string;
  membership_team: string | null;
  is_admin: number;
  roles: string;
  intake_open: number;
  categories: string;
  archived: number;
  teams: string;
  issue_id: string | null;
  team_id: string | null;
  status: IssueView['status'] | null;
  owner: string | null;
  first_assigned_at: string | null;
  public_revision: number | null;
  sequence: number;
  history: string;
  resolution_id: string | null;
  award_id: string | null;
  applied_at: string | null;
  dependency: string;
  receipt_command: string | null;
  receipt_session: string | null;
  receipt_issue: string | null;
}

// Each read uses one primary SQLite snapshot. A missing identity session always
// denies access, including after password resets and identity-session removal.
const workflowSql = `SELECT a.name AS actor_name, m.team_id AS membership_team, m.is_admin,
    (SELECT json_group_array(r.role) FROM membership_roles r
      WHERE r.session_id = s.id AND r.account_id = a.id) AS roles,
    s.intake_open, s.categories, e.archived,
    (SELECT json_group_array(t.id) FROM (SELECT id FROM teams WHERE session_id = s.id ORDER BY id) t) AS teams,
    i.id AS issue_id, i.team_id, i.status, i.owner, i.first_assigned_at, i.public_revision,
    COALESCE((SELECT sequence FROM audience_sequences q WHERE q.session_id = s.id AND q.audience = CASE
      WHEN m.is_admin = 1 OR EXISTS (SELECT 1 FROM membership_roles r WHERE r.session_id = s.id AND r.account_id = a.id)
      THEN 'staff' ELSE 'team:' || m.team_id END), 0) AS sequence,
    (SELECT json_group_array(json_object('actor', h.actor, 'text', h.text, 'visibility', h.visibility)) FROM
      (SELECT * FROM history WHERE issue_id = i.id AND (visibility = 'public' OR m.is_admin = 1 OR EXISTS
        (SELECT 1 FROM membership_roles r WHERE r.session_id = s.id AND r.account_id = a.id)) ORDER BY at, id) h) AS history,
    (SELECT id FROM resolutions WHERE issue_id = i.id AND reopened_at IS NULL) AS resolution_id,
    aw.id AS award_id, aw.applied_at,
    json_object('access', a.access_version, 'name', a.name, 'generation', a.credential_generation,
      'login', l.version, 'identity', b.id, 'expires', b.expiresAt,
      'membership', m.version, 'session', s.version, 'event', e.version,
      'teams', (SELECT json_group_array(t.id) FROM (SELECT id FROM teams WHERE session_id = s.id ORDER BY id) t),
      'issue', i.write_version,
      'resolutions', (SELECT json_group_array(json_object('id', r.id, 'at', r.at, 'reopened_at', r.reopened_at,
        'reopened_by', r.reopened_by, 'summary', r.summary, 'reason', r.reason))
        FROM (SELECT * FROM resolutions WHERE issue_id = i.id ORDER BY id) r),
      'award', json_object('id', aw.id, 'applied_at', aw.applied_at, 'applied_by', aw.applied_by,
        'minutes', aw.minutes, 'explanation', aw.explanation, 'resolution', aw.resolution_id)) AS dependency,
    cr.command AS receipt_command, cr.session_id AS receipt_session, cr.issue_id AS receipt_issue
  FROM accounts a
  JOIN logins l ON l.account_id = a.id AND l.id = ? AND l.revoked = 0 AND l.expires_at > unixepoch()
    AND l.credential_generation = a.credential_generation
  JOIN ba_session b ON b.id = l.identity_session_id AND b.userId = a.id
    AND b.expiresAt > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  JOIN memberships m ON m.account_id = a.id AND m.session_id = ?
  JOIN sessions s ON s.id = m.session_id
  JOIN events e ON e.id = s.event_id
  LEFT JOIN command_receipts cr ON cr.actor = a.id AND cr.request_id = ?
  LEFT JOIN issues i ON i.session_id = s.id AND i.id = COALESCE(?, cr.issue_id)
    AND (i.team_id = m.team_id OR m.is_admin = 1 OR EXISTS
      (SELECT 1 FROM membership_roles r WHERE r.session_id = s.id AND r.account_id = a.id))
  LEFT JOIN awards aw ON aw.issue_id = i.id
  WHERE a.id = ? AND a.disabled = 0 AND a.must_change = 0 AND a.credential_state = 'ready'
    AND (? IS NULL OR i.id IS NOT NULL)
    AND (cr.session_id IS NULL OR cr.session_id <> s.id OR i.id IS NOT NULL)`;

export interface D1StoreOptions {
  /** Only the isolated historical proof uses its deliberately smaller schema. */
  mode?: 'transaction-proof';
}

/** Persist shared workflow decisions with current identity and atomic D1 batches. */
export class D1ApplicationStore implements ApplicationStore, WorkflowPersistence {
  private readonly proof: BoundedD1ProofStore | undefined;

  constructor(private readonly db: D1Connection, options: D1StoreOptions = {}) {
    if (options.mode === 'transaction-proof') this.proof = new BoundedD1ProofStore(db);
  }

  private statement(sql: string, ...values: Array<string | number | null>): D1Statement {
    return this.db.prepare(sql).bind(...values);
  }

  private parameters(caller: Caller, sessionId: string, requestId: string, issueId: string | null) {
    return [caller.loginId, sessionId, requestId, issueId, caller.accountId, issueId];
  }

  private row(caller: Caller, sessionId: string, requestId: string, issueId: string | null) {
    return this.statement(workflowSql, ...this.parameters(caller, sessionId, requestId, issueId)).first<WorkflowRow>();
  }

  async issue(caller: Caller, sessionId: string, issueId: string): Promise<IssueView | undefined> {
    if (this.proof) return this.proof.issue(caller, sessionId, issueId);
    const row = await this.row(caller, sessionId, '', issueId);
    if (!row || !row.issue_id || !row.status || row.public_revision === null) return undefined;
    return { issueId: row.issue_id, status: row.status, owner: row.owner,
      firstAssignedAt: row.first_assigned_at, revision: row.public_revision,
      sequence: row.sequence, history: JSON.parse(row.history) };
  }

  async execute(caller: Caller, sessionId: string, requestId: string, command: Command): Promise<CommandResult> {
    return new WorkflowService(this).execute(caller, sessionId, requestId, command);
  }

  async read(caller: Caller, sessionId: string, requestId: string, command: Command): Promise<WorkflowRead | undefined> {
    if (this.proof) return this.proof.read(caller, sessionId, requestId, command);
    const row = await this.row(caller, sessionId, requestId, command.type === 'submit' ? null : command.issue_id);
    if (!row) return undefined;
    return {
      state: {
        actor: { id: caller.accountId, name: row.actor_name },
        membership: { team_id: row.membership_team, is_admin: !!row.is_admin, roles: JSON.parse(row.roles) as Role[] },
        session: { id: sessionId, intake_open: !!row.intake_open, categories: JSON.parse(row.categories) },
        archived: !!row.archived, teams: JSON.parse(row.teams),
        issue: row.issue_id && row.status && row.team_id && row.public_revision !== null
          ? { id: row.issue_id, team_id: row.team_id, status: row.status, owner: row.owner, revision: row.public_revision } : null,
        resolution: row.resolution_id ? { id: row.resolution_id } : null,
        award: row.award_id ? { id: row.award_id, applied_at: row.applied_at } : null,
      },
      dependency: row.dependency,
      receipt: row.receipt_command === null ? null : {
        sessionId: row.receipt_session!, command: JSON.parse(row.receipt_command), issueId: row.receipt_issue!,
      },
    };
  }

  async commit(caller: Caller, sessionId: string, requestId: string, command: Command,
    read: WorkflowRead, decision: WorkflowDecision): Promise<WorkflowCommitResult> {
    if (this.proof) return this.proof.commit(caller, sessionId, requestId, command, read, decision);
    const assertionId = crypto.randomUUID();
    const requestedIssue = command.type === 'submit' ? null : command.issue_id;
    const parameters = this.parameters(caller, sessionId, requestId, requestedIssue);
    const assertion = (suffix: string, condition: string, ...values: Array<string | number | null>) =>
      this.statement(`INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN ${condition} THEN 1 ELSE 0 END)`,
        `${assertionId}:${suffix}`, ...values);
    const currentAccess = `EXISTS (SELECT 1 FROM (${workflowSql}) current WHERE current.archived = 0)`;
    if (read.receipt) {
      // Receipt replay crosses the same atomic boundary as a new write. This
      // permits an access change to win while this request waits for the batch.
      try {
        await this.db.batch([
          assertion('replay', `${currentAccess} AND EXISTS (SELECT 1 FROM command_receipts
            WHERE actor = ? AND request_id = ? AND session_id = ? AND issue_id = ? AND command = ?)`,
          ...parameters, caller.accountId, requestId, sessionId, read.receipt.issueId, JSON.stringify(read.receipt.command)),
          this.statement('DELETE FROM command_assertions WHERE id = ?', `${assertionId}:replay`),
        ]);
        return { outcome: 'committed', issueId: read.receipt.issueId };
      } catch (error) {
        return this.rollbackResult(error);
      }
    }
    if (typeof read.dependency !== 'string' || decision.type !== command.type ||
        (command.type !== 'submit' && decision.issueId !== command.issue_id)) {
      return { outcome: 'rejected', reason: 'input' };
    }
    const issueId = decision.issueId ?? crypto.randomUUID();
    // The generated UUID is safe SQL text. All request data uses bound values.
    const at = `(SELECT at FROM workflow_commit_times WHERE id = '${assertionId}')`;
    const statements = [
      assertion('read', `EXISTS (SELECT 1 FROM (${workflowSql}) current WHERE current.archived = 0 AND current.dependency = ?)`,
        ...parameters, read.dependency),
      this.statement('INSERT INTO workflow_commit_times (id) VALUES (?)', assertionId),
    ];
    if (decision.submission) {
      statements.push(
        this.statement(`INSERT INTO session_issue_sequences (session_id, number)
          SELECT ?, COALESCE(MAX(number), 0) + 1 FROM issues WHERE session_id = ?
          ON CONFLICT (session_id) DO UPDATE SET number = MAX(number, (SELECT COALESCE(MAX(number), 0)
            FROM issues WHERE session_id = excluded.session_id)) + 1`, sessionId, sessionId),
        this.statement(`INSERT INTO issues (id, session_id, team_id, number, reporter, reporter_name,
          category, description, status, created_at)
          SELECT ?, ?, ?, q.number, ?, ?, ?, ?, 'open', ${at}
          FROM session_issue_sequences q WHERE q.session_id = ?`,
        issueId, sessionId, decision.teamId, caller.accountId, read.state.actor.name,
        decision.submission.category, decision.submission.description, sessionId),
      );
    } else {
      statements.push(this.statement(`UPDATE issues SET status = COALESCE(?, status),
        owner = CASE WHEN ? IS NULL THEN owner ELSE ? END,
        owner_name = CASE WHEN ? IS NULL THEN owner_name ELSE ? END,
        first_assigned_at = CASE WHEN ? = 'claim' THEN COALESCE(first_assigned_at, ${at}) ELSE first_assigned_at END,
        resolved_at = CASE WHEN ? = 'resolve' THEN ${at} WHEN ? = 'reopen' THEN NULL ELSE resolved_at END,
        public_revision = public_revision + ?, write_version = write_version + 1 WHERE id = ? AND session_id = ?`,
      decision.issue?.status ?? null, decision.issue?.owner ?? null, decision.issue?.owner ?? null,
      decision.issue?.owner ?? null, read.state.actor.name, command.type, command.type, command.type,
      decision.history.visibility === 'public' ? 1 : 0, issueId, sessionId));
    }
    statements.push(assertion('write', 'changes() = 1'));
    if (decision.resolution) statements.push(this.statement(`INSERT INTO resolutions
      (id, session_id, issue_id, actor, actor_name, at, summary) VALUES (?, ?, ?, ?, ?, ${at}, ?)`,
    crypto.randomUUID(), sessionId, issueId, caller.accountId, read.state.actor.name, decision.resolution.summary));
    if (decision.reopen) {
      statements.push(this.statement(`UPDATE resolutions SET reopened_at = ${at}, reopened_by = ?,
        reopened_name = ?, reason = ? WHERE issue_id = ? AND reopened_at IS NULL`,
      caller.accountId, read.state.actor.name, decision.reopen.reason, issueId), assertion('reopen', 'changes() = 1'));
    }
    if (decision.award) statements.push(this.statement(`INSERT INTO awards
      (id, session_id, issue_id, resolution_id, minutes, explanation, actor, actor_name, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${at})`, crypto.randomUUID(), sessionId, issueId,
    decision.award.resolutionId, decision.award.minutes, decision.award.explanation, caller.accountId, read.state.actor.name));
    if (decision.apply) {
      statements.push(this.statement(`UPDATE awards SET applied_at = ${at}, applied_by = ?, applied_name = ?
        WHERE id = ? AND issue_id = ? AND applied_at IS NULL`, caller.accountId, read.state.actor.name,
      decision.apply.awardId, issueId), assertion('apply', 'changes() = 1'));
    }
    statements.push(
      this.statement(`INSERT INTO history (id, issue_id, actor, actor_name, at, text, visibility)
        VALUES (?, ?, ?, ?, ${at}, ?, ?)`, crypto.randomUUID(), issueId, caller.accountId,
      read.state.actor.name, decision.history.text, decision.history.visibility),
      this.statement('INSERT INTO command_receipts (actor, request_id, session_id, command, issue_id) VALUES (?, ?, ?, ?, ?)',
        caller.accountId, requestId, sessionId, JSON.stringify(command), issueId),
    );
    for (const audience of decision.history.visibility === 'public' ? ['staff', `team:${decision.teamId}`] : ['staff']) {
      statements.push(
        this.statement(`INSERT INTO audience_sequences (session_id, audience, sequence) VALUES (?, ?, 1)
          ON CONFLICT (session_id, audience) DO UPDATE SET sequence = sequence + 1`, sessionId, audience),
        this.statement(`INSERT INTO notifications (id, session_id, audience, sequence)
          SELECT ?, session_id, audience, sequence FROM audience_sequences WHERE session_id = ? AND audience = ?`,
        crypto.randomUUID(), sessionId, audience),
      );
    }
    statements.push(
      // The final statement also rejects expiry during a long batch. Unlike the
      // first assertion, it does not compare state changed by this command.
      assertion('access', currentAccess, ...parameters),
      this.statement(`DELETE FROM command_assertions WHERE id IN (?, ?, ?, ?, ?)`,
        `${assertionId}:read`, `${assertionId}:write`, `${assertionId}:reopen`, `${assertionId}:apply`, `${assertionId}:access`),
      this.statement('DELETE FROM workflow_commit_times WHERE id = ?', assertionId),
    );
    try {
      await this.db.batch(statements);
      return { outcome: 'committed', issueId };
    } catch (error) {
      return this.rollbackResult(error);
    }
  }

  private rollbackResult(error: unknown): WorkflowCommitResult {
    const message = error instanceof Error ? error.message : '';
    // Only a known atomic rollback permits reevaluation. Network failures can
    // hide a successful commit; callers must retain the same request ID.
    return message.includes('CHECK constraint failed: valid = 1') ||
      message.includes('UNIQUE constraint failed: command_receipts.actor, command_receipts.request_id')
      ? { outcome: 'retry' } : { outcome: 'unknown' };
  }
}
