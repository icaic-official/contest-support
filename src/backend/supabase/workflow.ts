import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Backend } from '../contracts';
import { WorkflowRejectedError } from '../errors';

const resultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('committed'), issueId: z.string().uuid() }),
  z.object({ outcome: z.literal('rejected'), reason: z.enum(['input', 'access', 'state', 'request_id']) }),
  z.object({ outcome: z.literal('unknown') }),
]);

/** Opt-in server workflow transport. The Supabase browser adapter still uses the legacy RPC. */
export function createServerWorkflowExecutor(client: SupabaseClient): Backend['workflows']['execute'] {
  return async (sessionId, requestId, command) => {
    const { data, error } = await client.functions.invoke('workflow', { body: { sessionId, requestId, command } });
    if (error) {
      // An explicit rejection from the trusted endpoint confirms that no write
      // occurred. Other HTTP failures can follow a committed transaction.
      if ('context' in error && error.context instanceof Response) {
        const body: unknown = await error.context.clone().json().catch(() => undefined);
        const rejected = resultSchema.safeParse(body);
        if (rejected.success && rejected.data.outcome === 'rejected') {
          throw new WorkflowRejectedError(`Workflow rejected: ${rejected.data.reason}.`);
        }
      }
      throw new Error('Workflow outcome is unknown. Retry the same request.');
    }
    const result = resultSchema.parse(data);
    if (result.outcome === 'rejected') throw new WorkflowRejectedError(`Workflow rejected: ${result.reason}.`);
    if (result.outcome === 'unknown') throw new Error('Workflow outcome is unknown. Retry the same request.');
    return result.issueId;
  };
}
