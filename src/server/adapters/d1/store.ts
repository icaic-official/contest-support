import type { Caller } from '../../authentication';
import type { WorkflowPersistence, WorkflowRead, WorkflowDecision, WorkflowCommitResult } from '../../workflow.ts';
import type { Command, IssueStatus, Role } from '../../../connected/model.ts';
import { contestDataBindings, contestDataSql } from '../cloudflare/authority';
import { extraMinutesSql, intakeOpenSql } from '../cloudflare/schedule';
import type { D1Connection, D1Statement, D1Value } from './connection';

interface WorkflowColumns {
  actor_name: string;
  membership_team: string | null;
  is_admin: number;
  roles: string;
  categories: string;
  archived: number;
  teams: string;
  issue_id: string | null;
  team_id: string | null;
  status: IssueStatus | null;
  owner: string | null;
  public_revision: number | null;
  resolution_id: string | null;
  award_id: string | null;
  applied_at: string | null;
  withdrawn_at: string | null;
  dependency: string;
}

/** The LEFT JOIN on command_receipts fills all three columns or none. */
type ReceiptColumns =
  | { receipt_command: null; receipt_session: null; receipt_issue: null }
  | { receipt_command: string; receipt_session: string; receipt_issue: string };

type WorkflowRow = WorkflowColumns & ReceiptColumns;

// Each read uses one primary SQLite snapshot. The contest resolver checks the
// login, the identity session, and the caller's seat. Its stamp covers every
// version that access depends on. `teams` holds only the membership team and
// the team that a submit names. Intake is derived from the schedule, the
// override, and the contestant's confirmed extra time. The dependency carries
// it, so a submit that crosses the close fails its batch and retries. The read
// takes its intake from the dependency, so each evaluation computes it once.
const intakeOpen = intakeOpenSql('s', extraMinutesSql('s', 'c.team_id'));
const workflowSql = `SELECT c.account_name AS actor_name, c.team_id AS membership_team, c.is_admin, c.roles,
    s.categories, c.archived,
    (SELECT json_group_array(t.id) FROM (SELECT id FROM teams WHERE session_id = s.id AND id IN (c.team_id, ?) ORDER BY id) t) AS teams,
    i.id AS issue_id, i.team_id, i.status, i.owner, i.public_revision,
    (SELECT id FROM resolutions WHERE issue_id = i.id AND reopened_at IS NULL) AS resolution_id,
    aw.id AS award_id, aw.applied_at, aw.withdrawn_at,
    json_object('authority', json(c.stamp), 'name', c.account_name, 'expires', c.identity_expires_at,
      'teams', (SELECT json_group_array(t.id) FROM (SELECT id FROM teams WHERE session_id = s.id AND id IN (c.team_id, ?) ORDER BY id) t),
      'intake', ${intakeOpen},
      'issue', i.write_version,
      'resolutions', (SELECT json_group_array(json_object('id', r.id, 'at', r.at, 'reopened_at', r.reopened_at,
        'reopened_by', r.reopened_by, 'summary', r.summary, 'reason', r.reason))
        FROM (SELECT * FROM resolutions WHERE issue_id = i.id ORDER BY id) r),
      'award', json_object('id', aw.id, 'applied_at', aw.applied_at, 'applied_by', aw.applied_by, 'withdrawn_at', aw.withdrawn_at,
        'minutes', aw.minutes, 'explanation', aw.explanation, 'resolution', aw.resolution_id)) AS dependency,
    cr.command AS receipt_command, cr.session_id AS receipt_session, cr.issue_id AS receipt_issue
  FROM (${contestDataSql('caller')}) c
  JOIN sessions s ON s.id = c.session_id
  LEFT JOIN command_receipts cr ON cr.actor = c.account_id AND cr.request_id = ?
  LEFT JOIN issues i ON i.session_id = s.id AND i.id = COALESCE(?, cr.issue_id) AND (i.team_id = c.team_id OR c.staff = 1)
  LEFT JOIN awards aw ON aw.issue_id = i.id
  WHERE (? IS NULL OR i.id IS NOT NULL)
    AND (cr.session_id IS NULL OR cr.session_id <> s.id OR i.id IS NOT NULL)`;

/** Persist shared workflow decisions with current identity and atomic D1 batches. */
export class D1ApplicationStore implements WorkflowPersistence {
  constructor(private readonly db: D1Connection) {}

  private statement(sql: string, ...values: D1Value[]): D1Statement {
    return this.db.prepare(sql).bind(...values);
  }

  /** Bind values in statement order. Only a submit names a team and has no issue. */
  private parameters(caller: Caller, sessionId: string, requestId: string, command: Command) {
    const team = command.type === 'submit' ? command.team_id ?? null : null;
    const issueId = command.type === 'submit' ? null : command.issue_id;
    return [team, team, ...contestDataBindings(caller, sessionId), requestId, issueId, issueId];
  }

  async read(caller: Caller, sessionId: string, requestId: string, command: Command): Promise<WorkflowRead | undefined> {
    const row = await this.statement(workflowSql, ...this.parameters(caller, sessionId, requestId, command)).first<WorkflowRow>();
    if (!row) return undefined;
    return {
      state: {
        actor: { id: caller.accountId, name: row.actor_name },
        membership: { team_id: row.membership_team, is_admin: !!row.is_admin, roles: JSON.parse(row.roles) as Role[] },
        session: { id: sessionId, intake_open: (JSON.parse(row.dependency) as { intake: number }).intake === 1, categories: JSON.parse(row.categories) as string[] },
        archived: !!row.archived, teams: JSON.parse(row.teams) as string[],
        issue: row.issue_id && row.status && row.team_id && row.public_revision !== null
          ? { id: row.issue_id, team_id: row.team_id, status: row.status, owner: row.owner, revision: row.public_revision } : null,
        resolution: row.resolution_id ? { id: row.resolution_id } : null,
        award: row.award_id ? { id: row.award_id, applied_at: row.applied_at, withdrawn_at: row.withdrawn_at } : null,
      },
      dependency: row.dependency,
      receipt: row.receipt_command === null ? null : {
        sessionId: row.receipt_session, command: JSON.parse(row.receipt_command), issueId: row.receipt_issue,
      },
    };
  }

  async commit(caller: Caller, sessionId: string, requestId: string, command: Command,
    read: WorkflowRead, decision: WorkflowDecision, onUnknown?: (error: unknown) => void): Promise<WorkflowCommitResult> {
    const assertionId = crypto.randomUUID();
    const parameters = this.parameters(caller, sessionId, requestId, command);
    const assertion = (suffix: string, condition: string, ...values: D1Value[]) =>
      this.statement(`INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN ${condition} THEN 1 ELSE 0 END)`,
        `${assertionId}:${suffix}`, ...values);
    // Reuse the authorized read query for access checks inside either batch.
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
        return this.rollbackResult(error, onUnknown);
      }
    }
    if (typeof read.dependency !== 'string' || decision.type !== command.type ||
        (command.type !== 'submit' && decision.issueId !== command.issue_id)) {
      return { outcome: 'rejected', reason: 'input' };
    }
    const issueId = decision.issueId ?? crypto.randomUUID();
    // The generated UUID is safe SQL text. All request data uses bound values.
    const at = `(SELECT at FROM workflow_commit_times WHERE id = '${assertionId}')`;

    // Build one batch in execution order. First reject stale dependencies and
    // lost access, then capture one database timestamp for every effect.
    const statements = [
      assertion('read', `EXISTS (SELECT 1 FROM (${workflowSql}) current WHERE current.archived = 0 AND current.dependency = ?)`,
        ...parameters, read.dependency),
      this.statement('INSERT INTO workflow_commit_times (id) VALUES (?)', assertionId),
    ];

    // Create or update the issue before its dependent records.
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
    // Keep this assertion immediately after the issue write. changes() checks
    // that write and must reject a missing issue before later effects execute.
    statements.push(assertion('write', 'changes() = 1'));

    // Preserve resolution history and the separate award/application records.
    if (decision.resolution) {
      statements.push(this.statement(`INSERT INTO resolutions
      (id, session_id, issue_id, actor, actor_name, at, summary) VALUES (?, ?, ?, ?, ?, ${at}, ?)`,
      crypto.randomUUID(), sessionId, issueId, caller.accountId, read.state.actor.name, decision.resolution.summary));
    }
    if (decision.reopen) {
      statements.push(this.statement(`UPDATE resolutions SET reopened_at = ${at}, reopened_by = ?,
        reopened_name = ?, reason = ? WHERE issue_id = ? AND reopened_at IS NULL`,
      caller.accountId, read.state.actor.name, decision.reopen.reason, issueId), assertion('reopen', 'changes() = 1'));
    }
    if (decision.award) {
      statements.push(this.statement(`INSERT INTO awards
      (id, session_id, issue_id, resolution_id, minutes, explanation, actor, actor_name, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${at})`, crypto.randomUUID(), sessionId, issueId,
      decision.award.resolutionId, decision.award.minutes, decision.award.explanation, caller.accountId, read.state.actor.name));
    }
    if (decision.apply) {
      statements.push(this.statement(`UPDATE awards SET applied_at = ${at}, applied_by = ?, applied_name = ?
        WHERE id = ? AND issue_id = ? AND applied_at IS NULL AND withdrawn_at IS NULL`, caller.accountId, read.state.actor.name,
      decision.apply.awardId, issueId), assertion('apply', 'changes() = 1'));
    }
    if (decision.withdraw) {
      statements.push(this.statement(`UPDATE awards SET withdrawn_at = ${at}, withdrawn_by = ?, withdrawn_name = ?
        WHERE id = ? AND issue_id = ? AND applied_at IS NULL AND withdrawn_at IS NULL`, caller.accountId, read.state.actor.name,
      decision.withdraw.awardId, issueId), assertion('withdraw', 'changes() = 1'));
    }
    // Record authenticated history and the receipt in the same transaction.
    statements.push(
      this.statement(`INSERT INTO history (id, issue_id, actor, actor_name, at, text, visibility)
        VALUES (?, ?, ?, ?, ${at}, ?, ?)`, crypto.randomUUID(), issueId, caller.accountId,
      read.state.actor.name, decision.history.text, decision.history.visibility),
      this.statement('INSERT INTO command_receipts (actor, request_id, session_id, command, issue_id) VALUES (?, ?, ?, ?, ?)',
        caller.accountId, requestId, sessionId, JSON.stringify(command), issueId),
    );
    // Queue delivery for the permitted audiences. External delivery happens
    // after this batch commits, so it cannot publish a rolled-back command.
    const audiences = decision.history.visibility === 'public' ? ['staff', `team:${decision.teamId}`] : ['staff'];
    for (const audience of audiences) {
      statements.push(
        this.statement(`INSERT INTO audience_sequences (session_id, audience, sequence) VALUES (?, ?, 1)
          ON CONFLICT (session_id, audience) DO UPDATE SET sequence = sequence + 1`, sessionId, audience),
        this.statement(`INSERT INTO notifications (id, session_id, audience, sequence)
          SELECT ?, session_id, audience, sequence FROM audience_sequences WHERE session_id = ? AND audience = ?`,
        crypto.randomUUID(), sessionId, audience),
      );
    }
    statements.push(
      // Recheck access after all effects to reject expiry during a long batch.
      // Do not compare dependencies changed by this command.
      assertion('access', currentAccess, ...parameters),
      // This batch's assertion IDs are `<id>:<suffix>`. ';' follows ':' in byte order.
      this.statement('DELETE FROM command_assertions WHERE id > ? AND id < ?', `${assertionId}:`, `${assertionId};`),
      this.statement('DELETE FROM workflow_commit_times WHERE id = ?', assertionId),
    );
    try {
      // Execute every stage together. A failed assertion rolls back all effects.
      await this.db.batch(statements);
      return { outcome: 'committed', issueId };
    } catch (error) {
      return this.rollbackResult(error, onUnknown);
    }
  }

  private rollbackResult(error: unknown, onUnknown: ((error: unknown) => void) | undefined): WorkflowCommitResult {
    const message = error instanceof Error ? error.message : '';
    // Only a known atomic rollback permits reevaluation. Network failures can
    // hide a successful commit; callers must retain the same request ID.
    if (message.includes('CHECK constraint failed: valid = 1') ||
      message.includes('UNIQUE constraint failed: command_receipts.actor, command_receipts.request_id')) {
      return { outcome: 'retry' };
    }
    onUnknown?.(error);
    return { outcome: 'unknown' };
  }
}
