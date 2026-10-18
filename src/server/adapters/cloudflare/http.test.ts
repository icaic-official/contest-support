import { describe, expect, it, vi } from 'vitest';
import { createApplicationHandler, type ApplicationHttpServices } from './http';
import type { AuthenticationSession } from '../../authentication';
import { ImageRequestError } from '../../../backend/errors';

const origin = 'https://connector.example';
const sessionId = '0fb97157-9f3f-45ed-b036-5d0fa2cdb278';
const requestId = '202b3701-33c9-4662-89dd-5c27ca0d12d1';
const identity: AuthenticationSession = {
  caller: { accountId: '3be3c103-e098-4f97-87ec-f2317ec8c67b', loginId: 'bd5a5689-eb24-44e9-8020-06442b2d6038' },
  user: { id: '3be3c103-e098-4f97-87ec-f2317ec8c67b' },
  status: { username: 'fictional', must_change: false, session_valid: true }, csrf: 'protected-token',
};

function services() {
  return {
    auth: { current: vi.fn<ApplicationHttpServices['auth']['current']>().mockResolvedValue(identity) },
    application: {
      sessions: vi.fn<ApplicationHttpServices['application']['sessions']>().mockResolvedValue([{ id: sessionId, name: 'Fictional' }]),
      snapshot: vi.fn<ApplicationHttpServices['application']['snapshot']>(),
      setIntake: vi.fn<ApplicationHttpServices['application']['setIntake']>(),
      setImageLimits: vi.fn<ApplicationHttpServices['application']['setImageLimits']>(),
      saveMember: vi.fn<ApplicationHttpServices['application']['saveMember']>(),
      removeMember: vi.fn<ApplicationHttpServices['application']['removeMember']>(),
    },
    workflow: { execute: vi.fn<ApplicationHttpServices['workflow']['execute']>().mockResolvedValue({ outcome: 'committed', issueId: requestId }) },
    images: {
      begin: vi.fn<ApplicationHttpServices['images']['begin']>(),
      upload: vi.fn<ApplicationHttpServices['images']['upload']>(),
      finish: vi.fn<ApplicationHttpServices['images']['finish']>(),
      remove: vi.fn<ApplicationHttpServices['images']['remove']>(),
      download: vi.fn<ApplicationHttpServices['images']['download']>(),
    },
    connect: vi.fn<ApplicationHttpServices['connect']>().mockResolvedValue(new Response(null)),
  } satisfies ApplicationHttpServices;
}

function post(path: string, body: unknown, headers?: HeadersInit) {
  return new Request(`${origin}${path}`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
      'X-Minsky-Request': '1', 'X-CSRF-Token': identity.csrf, ...headers }, body: JSON.stringify(body),
  });
}

describe('Cloudflare application HTTP boundary', () => {
  it('uses trusted identity and rejects caller fields supplied in the body', async () => {
    const deps = services();
    const handle = createApplicationHandler(deps, origin);
    const command = { type: 'submit', category: 'Other', description: 'Fictional report' };
    const response = await handle(post('/api/workflow', { sessionId, requestId, command }));
    expect(response.status).toBe(200);
    expect(deps.workflow.execute).toHaveBeenCalledWith(identity.caller, sessionId, requestId, command);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const forged = await handle(post('/api/workflow', { sessionId, requestId, command, caller: { accountId: requestId } }));
    expect(await forged.json()).toEqual({ outcome: 'rejected', reason: 'input' });
    expect(deps.workflow.execute).toHaveBeenCalledTimes(1);
  });

  it('checks login, temporary-password state, origin, token, and fetch metadata before mutation', async () => {
    const deps = services();
    const handle = createApplicationHandler(deps, origin);
    const body = { sessionId, open: true, action: 'set_intake' };
    const rejectedHeaders: Array<Record<string, string>> = [
      { Origin: 'https://attacker.example' }, { 'X-CSRF-Token': 'stale' },
      { 'X-Minsky-Request': '' }, { 'Sec-Fetch-Site': 'cross-site' },
    ];
    for (const headers of rejectedHeaders) {
      expect((await handle(post('/api/admin', body, headers))).status).toBe(403);
    }
    deps.auth.current.mockResolvedValueOnce(undefined);
    expect((await handle(post('/api/admin', body))).status).toBe(401);
    deps.auth.current.mockResolvedValueOnce({ ...identity, status: { ...identity.status, must_change: true } });
    expect((await handle(post('/api/admin', body))).status).toBe(403);
    expect(deps.application.setIntake).not.toHaveBeenCalled();
  });

  it('bounds UTF-8 JSON bodies before invoking a command', async () => {
    const deps = services();
    const response = await createApplicationHandler(deps, origin)(post('/api/workflow', { text: 'x'.repeat(17_000) }));
    expect(response.status).toBe(400);
    expect(deps.workflow.execute).not.toHaveBeenCalled();
  });

  it('preserves typed workflow outcomes and withholds internal error text', async () => {
    const deps = services();
    const handle = createApplicationHandler(deps, origin);
    const body = { sessionId, requestId, command: {} };
    deps.workflow.execute.mockResolvedValueOnce({ outcome: 'rejected', reason: 'state' });
    expect((await handle(post('/api/workflow', body))).status).toBe(409);
    deps.workflow.execute.mockResolvedValueOnce({ outcome: 'unknown' });
    expect(await (await handle(post('/api/workflow', body))).json()).toEqual({ outcome: 'unknown' });
    deps.workflow.execute.mockRejectedValueOnce(new Error('Private SQL bound values.'));
    expect(await (await handle(post('/api/workflow', body))).text()).not.toContain('Private SQL');
  });

  it('requires same-origin WebSocket upgrades and does not accept a query identity', async () => {
    const deps = services();
    const handle = createApplicationHandler(deps, origin);
    const path = `${origin}/api/updates?sessionId=${sessionId}&accountId=${requestId}`;
    expect((await handle(new Request(path, { headers: { Upgrade: 'websocket' } }))).status).toBe(403);
    await handle(new Request(path, { headers: { Origin: origin, Upgrade: 'websocket' } }));
    expect(deps.connect).toHaveBeenCalledWith(expect.any(Request), identity.caller, sessionId);
  });

  it('retains image retry classifications and rejects transfers without known length', async () => {
    const deps = services();
    const handle = createApplicationHandler(deps, origin);
    deps.images.finish.mockRejectedValueOnce(new ImageRequestError('Upload the image before finishing.', { incomplete: true }));
    const response = await handle(post('/api/images', { action: 'finish', sessionId, attachmentId: requestId }));
    expect(await response.json()).toMatchObject({ incomplete: true });
    const headers = { Origin: origin, 'X-Minsky-Request': '1', 'X-CSRF-Token': identity.csrf };
    expect((await handle(new Request(`${origin}/api/image/path`, { method: 'PUT', headers }))).status).toBe(411);
    expect(deps.images.upload).not.toHaveBeenCalled();
  });
});
