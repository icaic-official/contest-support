import type { Caller } from '../../authentication.ts';
import type { CommandResult } from '../../workflow.ts';

export interface WorkflowEndpoint {
  authenticate(token: string): Promise<Caller | undefined>;
  execute(caller: Caller, sessionId: string, requestId: string, command: unknown): Promise<CommandResult>;
  origins: readonly string[];
}

/** Bearer authentication occurs before any privileged persistence operation. */
export function workflowHandler(endpoint: WorkflowEndpoint) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin') ?? '';
    const headers = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Origin': endpoint.origins.includes(origin) ? origin : '',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !endpoint.origins.includes(origin)) return respond({ error: 'Origin is not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return respond({ error: 'POST required.' }, 405);
    const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!bearer) return respond({ outcome: 'rejected', reason: 'access' }, 401);
    try {
      const caller = await endpoint.authenticate(bearer);
      if (!caller) return respond({ outcome: 'rejected', reason: 'access' }, 401);
      let input: unknown;
      try { input = await request.json(); } catch { return respond({ outcome: 'rejected', reason: 'input' }, 400); }
      if (!input || typeof input !== 'object' || !('sessionId' in input) || !('requestId' in input) ||
        !('command' in input) || typeof input.sessionId !== 'string' || typeof input.requestId !== 'string') {
        return respond({ outcome: 'rejected', reason: 'input' }, 400);
      }
      return respond(await endpoint.execute(caller, input.sessionId, input.requestId, input.command));
    } catch {
      // This includes a response failure after a commit. Never claim a rollback.
      return respond({ outcome: 'unknown' }, 503);
    }
  };
}
