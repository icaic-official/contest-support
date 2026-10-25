import type { Command, Role } from '../connected/model.ts';
import type { Caller } from './authentication.ts';

export type CommandResult =
  | { outcome: 'committed'; issueId: string }
  | { outcome: 'rejected'; reason: 'access' | 'state' | 'request_id' | 'input' }
  | { outcome: 'unknown' };

export interface WorkflowState {
  actor: { id: string; name: string };
  membership: { team_id: string | null; roles: Role[]; is_admin: boolean };
  session: { id: string; intake_open: boolean; categories: string[] };
  archived: boolean;
  teams: string[];
  issue: {
    id: string; team_id: string; status: 'open' | 'claimed' | 'escalated' | 'resolved';
    owner: string | null; revision: number;
  } | null;
  resolution: { id: string } | null;
  award: { id: string; applied_at: string | null } | null;
}

/** A closed set of operations, with time supplied by the atomic persistence commit. */
export interface WorkflowDecision {
  type: Command['type'];
  issueId: string | null;
  teamId: string;
  history: { text: string; visibility: 'public' | 'internal' };
  submission?: { category: string; description: string };
  issue?: { status?: 'open' | 'claimed' | 'escalated' | 'resolved'; owner?: string };
  resolution?: { summary: string };
  reopen?: { reason: string };
  award?: { resolutionId: string; minutes: number; explanation: string };
  apply?: { awardId: string };
}

export interface WorkflowRead {
  state: WorkflowState;
  /** An adapter-owned dependency value. Never send this value to the browser. */
  dependency: unknown;
  receipt: { sessionId: string; command: unknown; issueId: string } | null;
}
export type WorkflowCommitResult = CommandResult | { outcome: 'retry' };
export interface WorkflowPersistence {
  read(caller: Caller, sessionId: string, requestId: string, command: Command): Promise<WorkflowRead | undefined>;
  /** Recheck current access and dependencies. Commit all effects together or none. */
  commit(caller: Caller, sessionId: string, requestId: string, command: Command,
    read: WorkflowRead, decision: WorkflowDecision): Promise<WorkflowCommitResult>;
}

type Rejection = Extract<CommandResult, { outcome: 'rejected' }>;
const reject = (reason: Rejection['reason']): Rejection => ({ outcome: 'rejected', reason });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** PostgreSQL btrim(text) removes spaces, and length(text) counts Unicode code points. */
export function workflowText(value: string): string {
  return value.replace(/^ +| +$/g, '');
}
function validText(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const length = Array.from(workflowText(value)).length;
  return length >= 1 && length <= 2000;
}

/** Keep original text and additional JSON fields for receipt equality. */
export function isWorkflowCommand(value: unknown): value is Command {
  if (!object(value)) return false;
  if (value.type === 'submit') return validText(value.description) && typeof value.category === 'string' &&
    (value.team_id === undefined || typeof value.team_id === 'string');
  if (typeof value.issue_id !== 'string' || !uuid.test(value.issue_id) ||
    !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false;
  switch (value.type) {
    case 'claim': case 'accept': case 'escalate': case 'apply': return true;
    case 'message': return validText(value.text) && (value.visibility === 'public' || value.visibility === 'internal');
    case 'resolve': return validText(value.summary);
    case 'reopen': return validText(value.reason);
    case 'award': return validText(value.explanation) && Number.isInteger(value.minutes) &&
      (value.minutes as number) >= 0 && (value.minutes as number) <= 2147483647;
    default: return false;
  }
}

/** JSON object key order is irrelevant to the existing PostgreSQL receipt contract. */
export function equalWorkflowJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length &&
    left.every((item, index) => equalWorkflowJson(item, right[index]));
  if (!object(left) || !object(right)) return false;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined).sort();
  const other = Object.keys(right).filter((key) => right[key] !== undefined).sort();
  return keys.length === other.length && keys.every((key, index) =>
    key === other[index] && equalWorkflowJson(left[key], right[key]));
}

/** Existing workflow decisions. Persistence must reject changes to the captured state. */
export function decideWorkflow(state: WorkflowState, command: Command): WorkflowDecision | Rejection {
  const { membership: member, issue, actor } = state;
  if (state.archived) {
    return reject('access');
  }
  const hasSupportRole = member.roles.includes('volunteer') || member.roles.includes('specialist');
  const hasJuryRole = member.roles.includes('jury');
  const isStaff = member.is_admin || member.roles.length > 0;

  if (command.type === 'submit') {
    const lacksSubmissionRole = member.team_id === null && !hasSupportRole;
    const teamIntakeClosed = member.team_id !== null && !state.session.intake_open;
    if (lacksSubmissionRole || teamIntakeClosed) {
      return reject('access');
    }
    const teamId = member.team_id ?? command.team_id;
    if (!teamId || !state.teams.includes(teamId) || !state.session.categories.includes(command.category)) {
      return reject('input');
    }
    const description = workflowText(command.description);
    return {
      type: 'submit', issueId: null, teamId,
      submission: { category: command.category, description },
      history: { text: `Issue submitted: ${description}`, visibility: 'public' },
    };
  }

  if (!issue) {
    return reject('access');
  }
  const isIssueTeam = member.team_id === issue.team_id;
  if (!isStaff && !isIssueTeam) {
    return reject('access');
  }
  if (issue.revision !== command.revision) {
    return reject('state');
  }
  const decision: WorkflowDecision = {
    type: command.type, issueId: issue.id, teamId: issue.team_id,
    history: { text: '', visibility: 'public' },
  };
  switch (command.type) {
    case 'claim':
      if (!hasSupportRole || issue.status !== 'open') {
        return reject('state');
      }
      decision.issue = { status: 'claimed', owner: actor.id };
      decision.history.text = 'Issue claimed.';
      break;
    case 'escalate':
      if (!hasSupportRole || issue.owner !== actor.id || issue.status !== 'claimed') {
        return reject('state');
      }
      decision.issue = { status: 'escalated' };
      decision.history.text = 'Specialist handoff requested. Current owner retained.';
      break;
    case 'accept':
      if (!member.roles.includes('specialist') || issue.status !== 'escalated' || issue.owner === actor.id) {
        return reject('state');
      }
      decision.issue = { status: 'claimed', owner: actor.id };
      decision.history.text = 'Specialist accepted ownership.';
      break;
    case 'message': {
      const canReply = member.team_id !== null || hasSupportRole || hasJuryRole;
      const canUseVisibility = command.visibility !== 'internal' || isStaff;
      if (issue.status === 'resolved' || !canReply || !canUseVisibility) {
        return reject('state');
      }
      decision.history = { text: workflowText(command.text), visibility: command.visibility };
      break;
    }
    case 'resolve': {
      // Admins can close an issue for an absent owner. The owner stays recorded.
      // They can also close an open issue directly. An unowned issue has no owner to keep,
      // so the admin becomes the owner. The first assignment time stays empty.
      const isOwner = hasSupportRole && issue.owner === actor.id;
      if (!(isOwner || member.is_admin) || issue.status === 'resolved') {
        return reject('state');
      }
      decision.issue = issue.owner === null ? { status: 'resolved', owner: actor.id } : { status: 'resolved' };
      decision.resolution = { summary: workflowText(command.summary) };
      decision.history.text = `Resolved: ${decision.resolution.summary}`;
      break;
    }
    case 'reopen':
      if (issue.status !== 'resolved' || (!hasSupportRole && !isIssueTeam)) {
        return reject('state');
      }
      decision.issue = { status: 'claimed' };
      decision.reopen = { reason: workflowText(command.reason) };
      decision.history.text = `Reopened: ${decision.reopen.reason}`;
      break;
    case 'award':
      if (!hasJuryRole || issue.status !== 'resolved' || !state.resolution || state.award) {
        return reject('state');
      }
      decision.award = {
        resolutionId: state.resolution.id,
        minutes: command.minutes,
        explanation: workflowText(command.explanation),
      };
      decision.history.text = `${command.minutes} minutes awarded: ${decision.award.explanation}`;
      break;
    case 'apply': {
      const canConfirmAward = hasSupportRole || hasJuryRole;
      if (!canConfirmAward || !state.award || state.award.applied_at !== null) {
        return reject('state');
      }
      decision.apply = { awardId: state.award.id };
      decision.history.text = 'External application confirmed. No contest clock was changed by Minsky.';
      break;
    }
  }
  return decision;
}

export class WorkflowService {
  constructor(private readonly store: WorkflowPersistence) {}

  async execute(caller: Caller, sessionId: string, requestId: string, input: unknown): Promise<CommandResult> {
    if (!uuid.test(sessionId) || !uuid.test(requestId) || !isWorkflowCommand(input)) return reject('input');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const read = await this.store.read(caller, sessionId, requestId, input);
        if (!read || read.state.archived) return reject('access');
        // Commit also checks current access before receipt replay. A read alone cannot
        // certify a replay across a concurrent permission change.
        if (read.receipt) {
          if (read.receipt.sessionId !== sessionId || !equalWorkflowJson(read.receipt.command, input)) return reject('request_id');
          const replay = await this.store.commit(caller, sessionId, requestId, input, read, {
            type: input.type, issueId: read.receipt.issueId, teamId: '', history: { text: '', visibility: 'public' },
          });
          if (replay.outcome !== 'retry') return replay;
          continue;
        }
        const decision = decideWorkflow(read.state, input);
        if ('outcome' in decision) return decision;
        const result = await this.store.commit(caller, sessionId, requestId, input, read, decision);
        if (result.outcome !== 'retry') return result;
      } catch {
        // A transport failure can occur after commit. Only retry the same request ID.
        return { outcome: 'unknown' };
      }
    }
    return { outcome: 'unknown' };
  }
}
