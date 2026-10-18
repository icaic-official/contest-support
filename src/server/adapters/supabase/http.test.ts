import { describe, expect, it, vi } from 'vitest';
import { workflowHandler } from './http';

function setup() {
  const authenticate = vi.fn(async (token: string) => token === 'verified' ? { accountId: 'trusted', loginId: 'login' } : undefined);
  const execute = vi.fn(async () => ({ outcome: 'committed' as const, issueId: 'issue' }));
  return { authenticate, execute, handle: workflowHandler({ authenticate, execute, origins: ['https://minsky.example'] }) };
}
function request(body: unknown, token = 'verified', origin = 'https://minsky.example') {
  return new Request('https://endpoint.example', { method: 'POST', headers: {
    authorization: `Bearer ${token}`, origin, 'content-type': 'application/json',
  }, body: JSON.stringify(body) });
}
const input = { sessionId: 'session', requestId: 'request', command: { type: 'claim' } };

describe('trusted workflow HTTP boundary', () => {
  it('takes identity only from the verified bearer and ignores claimed browser identity', async () => {
    const { handle, execute, authenticate } = setup();
    const response = await handle(request({ ...input, accountId: 'victim', roles: ['jury'], loginId: 'forged' }));
    expect(response.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith('verified');
    expect(execute).toHaveBeenCalledWith({ accountId: 'trusted', loginId: 'login' }, 'session', 'request', input.command);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('denies an unverified caller before any privileged operation', async () => {
    const { handle, execute } = setup();
    expect((await handle(request(input, 'forged'))).status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
  it('checks explicit origins before authentication and permits configured preflight', async () => {
    const { handle, authenticate, execute } = setup();
    expect((await handle(request(input, 'verified', 'https://other.example'))).status).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();
    const response = await handle(new Request('https://endpoint.example', { method: 'OPTIONS', headers: { origin: 'https://minsky.example' } }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://minsky.example');
    expect(execute).not.toHaveBeenCalled();
  });
  it('keeps unexpected failures unknown and preserves the request at the caller', async () => {
    const { handle, execute } = setup();
    execute.mockRejectedValueOnce(new Error('Response lost after commit.'));
    const response = await handle(request(input));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ outcome: 'unknown' });
  });
  it('rejects malformed JSON before executing a command', async () => {
    const { handle, execute } = setup();
    expect((await handle(request({ accountId: 'victim' }))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
