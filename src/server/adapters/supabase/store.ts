import { z } from 'zod';
import type { Caller } from '../../authentication.ts';
import type { Command } from '../../../connected/model.ts';
import type { WorkflowCommitResult, WorkflowDecision, WorkflowPersistence, WorkflowRead } from '../../workflow.ts';

/** Supplied by a trusted server client. Never construct this client in a browser. */
export type WorkflowRpc = (name: string, parameters: Record<string, unknown>) => Promise<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;

const id = z.string().uuid();
const readSchema = z.object({
  state: z.object({
    actor: z.object({ id, name: z.string() }),
    membership: z.object({ team_id: id.nullable(), roles: z.array(z.enum(['volunteer', 'specialist', 'jury'])), is_admin: z.boolean() }),
    session: z.object({ id, intake_open: z.boolean(), categories: z.array(z.string()) }),
    archived: z.boolean(),
    teams: z.array(id),
    issue: z.object({ id, team_id: id, status: z.enum(['open', 'claimed', 'escalated', 'resolved']), owner: id.nullable(), revision: z.number().int().nonnegative() }).nullable(),
    resolution: z.object({ id }).nullable(),
    award: z.object({ id, applied_at: z.string().nullable() }).nullable(),
  }),
  dependency: z.unknown(),
  receipt: z.object({ sessionId: id, command: z.unknown(), issueId: id }).nullable(),
});
const resultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('committed'), issueId: id }),
  z.object({ outcome: z.literal('retry') }),
  z.object({ outcome: z.literal('rejected'), reason: z.enum(['access', 'state', 'request_id', 'input']) }),
]);

/** PostgreSQL locks dependencies and commits effects, history, signal, and receipt. */
export function createSupabaseWorkflowPersistence(rpc: WorkflowRpc): WorkflowPersistence {
  function parameters(caller: Caller, sessionId: string, requestId: string, command: Command) {
    return { p_actor: caller.accountId, p_login: caller.loginId, p_session: sessionId, p_request: requestId, p_action: command };
  }

  return {
    async read(caller: Caller, sessionId: string, requestId: string, command: Command): Promise<WorkflowRead | undefined> {
      const response = await rpc('shared_workflow_read', parameters(caller, sessionId, requestId, command));
      if (response.error) throw new Error('Workflow read failed.');
      return response.data === null ? undefined : readSchema.parse(response.data);
    },
    async commit(caller: Caller, sessionId: string, requestId: string, command: Command,
      read: WorkflowRead, decision: WorkflowDecision): Promise<WorkflowCommitResult> {
      const response = await rpc('shared_workflow_commit', {
        ...parameters(caller, sessionId, requestId, command), p_dependency: read.dependency, p_decision: decision,
      });
      if (response.error) {
        // These PostgreSQL errors certify a rolled-back transaction. A transport
        // failure or an unrecognized response cannot establish the write outcome.
        const code = response.error.code;
        if (code === '40001' || code === '40P01') return { outcome: 'retry' };
        if (code && /^(22...|23...|42...|P0001)$/.test(code)) return { outcome: 'rejected', reason: 'state' };
        return { outcome: 'unknown' };
      }
      const result = resultSchema.safeParse(response.data);
      return result.success ? result.data : { outcome: 'unknown' };
    },
  };
}
