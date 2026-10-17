import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowRejectedError } from '../errors';
import { createServerWorkflowExecutor } from './workflow';

const issueId = '00000000-0000-4000-8000-000000000001';
const command = { type: 'claim' as const, issue_id: issueId, revision: 0 };
function setup(response: () => Promise<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>(response);
  const client = createClient('https://fixture.supabase.co', 'public-fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
  });
  return { execute: createServerWorkflowExecutor(client), fetch };
}

describe('opt-in shared server workflow transport', () => {
  it('sends the original request and command to the deployed function', async () => {
    const { execute, fetch } = setup(async () => Response.json({ outcome: 'committed', issueId }));
    expect(await execute('session', 'request', command)).toBe(issueId);
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ sessionId: 'session', requestId: 'request', command });
  });
  it.each([200, 401, 400])('recognizes an explicit rejection at HTTP %s', async (status) => {
    const { execute } = setup(async () => Response.json({ outcome: 'rejected', reason: 'access' }, { status }));
    await expect(execute('session', 'request', command)).rejects.toBeInstanceOf(WorkflowRejectedError);
  });
  it.each(['transport', 'unknown', 'malformed'])('leaves %s outcomes uncertain', async (failure) => {
    const { execute } = setup(async () => {
      if (failure === 'transport') throw new Error('Lost committed response');
      return Response.json(failure === 'unknown' ? { outcome: 'unknown' } : { issueId: 'invalid' }, { status: failure === 'unknown' ? 503 : 200 });
    });
    const error = await execute('session', 'request', command).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(WorkflowRejectedError);
  });
});
