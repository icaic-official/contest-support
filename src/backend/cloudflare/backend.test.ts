import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudflareBackend } from './backend';
import { ImageRequestError, WorkflowRejectedError } from '../errors';

const origin = 'https://connector.example';
const sessionId = '49c15a39-79ec-4597-bad6-2b949cfe32b2';
const requestId = '10e98b04-539e-4058-b8c5-c903a28b7005';
const issueId = '2732b785-f5df-4db8-bdc7-873961c2a600';
const command = { type: 'claim' as const, issue_id: issueId, revision: 1 };

function transport(result: () => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/auth/session') return Response.json({ csrf: 'fresh-token' });
    return result();
  });
}

class Socket {
  onmessage: WebSocket['onmessage'] = null;
  onclose: WebSocket['onclose'] = null;
  onerror: WebSocket['onerror'] = null;
  close = vi.fn();
  message(type: string) { this.onmessage?.call(this as unknown as WebSocket, new MessageEvent('message', { data: JSON.stringify({ type }) })); }
  disconnect() { this.onclose?.call(this as unknown as WebSocket, new Event('close') as CloseEvent); }
}

afterEach(() => vi.useRealTimers());

describe('Cloudflare Backend transport', () => {
  it('preserves request identity and uses a fresh request-protection token', async () => {
    const fetcher = transport(() => Response.json({ outcome: 'committed', issueId }));
    const backend = createCloudflareBackend({ origin, fetch: fetcher });
    expect(await backend.workflows.execute(sessionId, requestId, command)).toBe(issueId);
    const [, init] = fetcher.mock.calls[1];
    expect(JSON.parse(String(init?.body))).toEqual({ sessionId, requestId, command });
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('fresh-token');
    expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  });

  it('distinguishes a confirmed rejection from an unknown outcome', async () => {
    const rejected = createCloudflareBackend({ origin, fetch: transport(() => Response.json({ outcome: 'rejected', reason: 'state' }, { status: 409 })) });
    await expect(rejected.workflows.execute(sessionId, requestId, command)).rejects.toBeInstanceOf(WorkflowRejectedError);
    for (const response of [
      () => Response.json({ outcome: 'committed', issueId: 'invalid' }),
      () => Response.json({ outcome: 'unknown' }),
      () => Response.json({ error: 'Database failed.' }, { status: 503 }),
      () => new Response('unreadable'),
      () => { throw new TypeError('Lost response.'); },
    ]) {
      const backend = createCloudflareBackend({ origin, fetch: transport(response) });
      await expect(backend.workflows.execute(sessionId, requestId, command)).rejects.not.toBeInstanceOf(WorkflowRejectedError);
    }
  });

  it('retains image retry classification and requires authorized uncached downloads', async () => {
    const fetcher = transport(() => Response.json({ error: 'Upload the image before finishing.', incomplete: true }, { status: 409 }));
    const backend = createCloudflareBackend({ origin, fetch: fetcher });
    await expect(backend.images.finish(sessionId, issueId)).rejects.toMatchObject({ incomplete: true, validation: false });
    await expect(backend.images.download(`${sessionId}/${issueId}/${requestId}/original`)).rejects.toBeInstanceOf(ImageRequestError);
    expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
  });

  it('rejects another origin and an incomplete successful snapshot', async () => {
    expect(() => createCloudflareBackend({ origin: 'http://connector.example' })).toThrow();
    const backend = createCloudflareBackend({ origin, fetch: transport(() => Response.json({ issues: [] })) });
    await expect(backend.workflows.snapshot(sessionId)).rejects.toThrow();
  });

  it('isolates subscriptions, reconnects, and suppresses callbacks after cleanup', () => {
    vi.useFakeTimers();
    const sockets: Socket[] = [];
    const factory = vi.fn((url: string) => {
      expect(new URL(url).protocol).toBe('wss:');
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
    const backend = createCloudflareBackend({ origin, webSocket: factory });
    const change = vi.fn();
    const connection = vi.fn();
    const input = { sessionId, userId: issueId, onChange: change, onConnection: connection };
    const stopFirst = backend.updates.subscribe(input);
    const stopSecond = backend.updates.subscribe(input);
    sockets[0].message('change');
    expect(change).not.toHaveBeenCalled();
    sockets[0].message('ready');
    expect(connection).toHaveBeenLastCalledWith(true);
    stopFirst();
    stopFirst();
    sockets[0].message('change');
    sockets[0].disconnect();
    expect(change).not.toHaveBeenCalled();
    sockets[1].message('ready');
    sockets[1].message('change');
    expect(change).toHaveBeenCalledTimes(1);
    sockets[1].disconnect();
    expect(connection).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(3);
    sockets[2].message('ready');
    expect(connection).toHaveBeenLastCalledWith(true);
    stopSecond();
    sockets[2].message('change');
    vi.advanceTimersByTime(60_000);
    expect(change).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(3);
    expect(factory.mock.calls[0][0]).toBe(`wss://connector.example/api/updates?sessionId=${sessionId}`);
  });
});
