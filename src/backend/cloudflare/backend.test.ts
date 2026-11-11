import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudflareBackend } from './backend';
import type { Backend } from '../contracts';
import { AnnouncementRejectedError, ImageRequestError, RequestRefusedError, WorkflowRejectedError } from '../errors';
import { AVATAR_MAX_BYTES } from '../../connected/imageFile';
import { fixtureRecord } from '../../connected/contestRecordFixture';

const origin = 'https://connector.example';
const sessionId = '49c15a39-79ec-4597-bad6-2b949cfe32b2';
const requestId = '10e98b04-539e-4058-b8c5-c903a28b7005';
const issueId = '2732b785-f5df-4db8-bdc7-873961c2a600';
const command = { type: 'claim' as const, issue_id: issueId, revision: 1 };

const sessionBody = {
  user: { id: issueId }, csrf: 'fresh-token',
  status: { handle: 'fictional', must_change: false, session_valid: true, can_change_handle: true },
};

function transport(result: () => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/auth/session') return Response.json(sessionBody);
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
  describe.each([
    ['workflow', (backend: Backend) =>
      backend.workflows.execute(sessionId, requestId, command)],
    ['manage', (backend: Backend) =>
      backend.manage.execute(requestId, { type: 'set_intake', contestId: sessionId, mode: 'open' })],
    ['image finish', (backend: Backend) =>
      backend.images.finish(sessionId, issueId)],
    ['image upload', (backend: Backend) => backend.images.upload(
      'fixture-path', new Blob(['fixture']), 'image/png', () => undefined,
    )],
  ] as const)('%s session preflight', (_name, mutate) => {
    it.each([
      {
        status: 401, format: 'JSON',
        reply: () => Response.json(
          { error: 'Session expired.' }, { status: 401 },
        ),
        message: 'Sign in to continue.',
      },
      {
        status: 503, format: 'JSON',
        reply: () => Response.json(
          { error: 'Service temporarily unavailable.' }, { status: 503 },
        ),
        message: 'Service temporarily unavailable.',
      },
      {
        status: 503, format: 'non-JSON',
        reply: () => new Response(
          '<html>Unavailable</html>', { status: 503 },
        ),
        message: 'The authentication request failed.',
      },
    ])('reports a $status $format failure without sending a mutation', async ({ reply, message }) => {
      const fetcher = vi.fn<typeof fetch>(async () => reply());
      const backend = createCloudflareBackend({ origin, fetch: fetcher });
      await expect(mutate(backend)).rejects.toThrow(message);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [input, init] = fetcher.mock.calls[0]!;
      const preflight = new Request(input, init);
      expect(new URL(preflight.url).pathname).toBe('/api/auth/session');
      expect(preflight.method).toBe('GET');
      expect(preflight.body).toBeNull();
    });
  });

  it('preserves request identity and sends the request-protection token', async () => {
    const fetcher = transport(() => Response.json({ outcome: 'committed', issueId }));
    const backend = createCloudflareBackend({ origin, fetch: fetcher });
    expect(await backend.workflows.execute(sessionId, requestId, command)).toBe(issueId);
    const [, init] = fetcher.mock.calls[1]!;
    expect(JSON.parse(String(init?.body))).toEqual({ sessionId, requestId, command });
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('fresh-token');
    expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  });

  describe('action round trips', () => {
    const emptySnapshot = {
      session: null, event: null, membership: null, teams: [], issues: [], resolutions: [], history: [],
      awards: [], audit: [], members: [], server_time: '2026-10-25T00:00:00Z',
    };

    function counted(reply: (request: Request, index: number) => Response) {
      const log: string[] = [];
      let tokens = 0;
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        log.push(`${request.method} ${path}${request.headers.get('X-CSRF-Token') ? ` ${request.headers.get('X-CSRF-Token')}` : ''}`);
        if (path === '/api/auth/session') return Response.json({ ...sessionBody, csrf: `token-${++tokens}` });
        return reply(request, log.length);
      });
      return { fetcher, log };
    }

    it('reads the request-protection token once for many actions', async () => {
      const { fetcher, log } = counted(() => Response.json({ outcome: 'committed', issueId }));
      const backend = createCloudflareBackend({ origin, fetch: fetcher });
      for (let action = 0; action < 3; action++) await backend.workflows.execute(sessionId, crypto.randomUUID(), command);
      expect(log).toEqual(['GET /api/auth/session', ...Array<string>(3).fill('POST /api/workflow token-1')]);
    });

    it('returns the changed snapshot with the commit, and drops an invalid one', async () => {
      const valid = counted(() => Response.json({ outcome: 'committed', issueId, snapshot: emptySnapshot }));
      const read = await createCloudflareBackend({ origin, fetch: valid.fetcher }).workflows.executeAndRead!(sessionId, requestId, command);
      expect(read).toMatchObject({ issueId, snapshot: { server_time: emptySnapshot.server_time } });
      expect(valid.log).toHaveLength(2);
      const invalid = counted(() => Response.json({ outcome: 'committed', issueId, snapshot: { issues: 'x' } }));
      const dropped = await createCloudflareBackend({ origin, fetch: invalid.fetcher }).workflows.executeAndRead!(sessionId, requestId, command);
      expect(dropped).toEqual({ issueId, snapshot: undefined });
    });

    it('retries once with a new token after a 403 and the same request ID', async () => {
      const { fetcher, log } = counted((request) => request.headers.get('X-CSRF-Token') === 'token-1'
        ? Response.json({ error: 'The request protection checks failed.' }, { status: 403 })
        : Response.json({ outcome: 'committed', issueId }));
      const backend = createCloudflareBackend({ origin, fetch: fetcher });
      expect(await backend.workflows.execute(sessionId, requestId, command)).toBe(issueId);
      expect(log).toEqual(['GET /api/auth/session', 'POST /api/workflow token-1', 'GET /api/auth/session', 'POST /api/workflow token-2']);
      const bodies = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => String(init?.body));
      expect(bodies[1]).toBe(bodies[0]);
    });

    it('does not send again when a 403 comes with an unchanged token', async () => {
      let tokens = 0;
      const log: string[] = [];
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        const request = new Request(input, init);
        log.push(`${request.method} ${new URL(request.url).pathname}`);
        if (new URL(request.url).pathname === '/api/auth/session') { tokens++; return Response.json(sessionBody); }
        return Response.json({ error: 'Change your temporary password first.' }, { status: 403 });
      });
      const backend = createCloudflareBackend({ origin, fetch: fetcher });
      await expect(backend.workflows.execute(sessionId, requestId, command)).rejects.toThrow();
      expect(tokens).toBe(2);
      expect(log.filter((entry) => entry.startsWith('POST'))).toHaveLength(1);
    });
  });

  it.each([
    ['state', 'This issue changed while you were working. Refresh and try again.'],
    ['access', 'You no longer have access to do this.'],
    ['input', 'Check what you entered and try again.'],
    ['request_id', 'This request was already used. Refresh and try again.'],
  ])('tells the person why the server rejected a command for %s', async (reason, message) => {
    const backend = createCloudflareBackend({ origin, fetch: transport(() => Response.json({ outcome: 'rejected', reason }, { status: 409 })) });
    await expect(backend.workflows.execute(sessionId, requestId, command)).rejects.toThrow(new WorkflowRejectedError(message));
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

  describe('request reference on a 503', () => {
    const readFailure = (body: unknown) => createCloudflareBackend({
      origin, fetch: transport(() => Response.json(body, { status: 503 })) }).workflows.snapshot(sessionId);
    const load = 'Minsky could not load this. Try again in a moment.';

    it('adds the reference to the text of a failed read', async () => {
      await expect(readFailure({ error: load, requestId: 'ray-1' })).rejects.toThrow(`${load} Reference: ray-1.`);
      await expect(readFailure({ error: load })).rejects.toThrow(new Error(load));
    });

    it('adds the reference to an unknown workflow outcome, and keeps it unknown', async () => {
      const backend = createCloudflareBackend({ origin, fetch: transport(() =>
        Response.json({ outcome: 'unknown', requestId: 'ray-4' }, { status: 503 })) });
      const failure = backend.workflows.execute(sessionId, requestId, command);
      await expect(failure).rejects.toThrow('Workflow outcome is unknown. Retry the same request. Reference: ray-4.');
      await expect(failure).rejects.not.toBeInstanceOf(WorkflowRejectedError);
    });

    it('shows no reference that is not a short plain token', async () => {
      for (const unsafe of ['x'.repeat(41), 'ray 1 <b>', '']) {
        await expect(readFailure({ error: load, requestId: unsafe })).rejects.toThrow(new Error(load));
      }
    });
  });

  it('marks a management command refused only when the server answered with a 4xx', async () => {
    const send = (response: () => Response) => createCloudflareBackend({ origin, fetch: transport(response) })
      .manage.execute(requestId, { type: 'set_intake', contestId: sessionId, mode: 'open' });
    await expect(send(() => Response.json({ error: 'That username is taken.' }, { status: 409 })))
      .rejects.toBeInstanceOf(RequestRefusedError);
    for (const response of [
      () => Response.json({ error: 'Database failed.' }, { status: 503 }),
      () => { throw new TypeError('Lost response.'); },
    ]) await expect(send(response)).rejects.not.toBeInstanceOf(RequestRefusedError);
  });

  it('reads the contest record with one same-origin request and parses it at the boundary', async () => {
    const record = fixtureRecord();
    const fetcher = transport(() => Response.json(record));
    const backend = createCloudflareBackend({ origin, fetch: fetcher });
    await expect(backend.manage.contestRecord(sessionId)).resolves.toEqual(record);
    const [url, init] = fetcher.mock.calls.at(-1) ?? [];
    expect(String(url)).toBe(`${origin}/api/contest-record?sessionId=${sessionId}`);
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
    const refused = createCloudflareBackend({ origin, fetch: transport(() => Response.json({ error: 'Only an admin can export a contest.' }, { status: 403 })) });
    await expect(refused.manage.contestRecord(sessionId)).rejects.toThrow('Only an admin can export a contest.');
    const incomplete = createCloudflareBackend({ origin, fetch: transport(() => Response.json({ format: 'minsky-contest-record', version: 1 })) });
    await expect(incomplete.manage.contestRecord(sessionId)).rejects.toThrow();
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
    sockets[0]!.message('change');
    expect(change).not.toHaveBeenCalled();
    sockets[0]!.message('ready');
    expect(connection).toHaveBeenLastCalledWith(true);
    stopFirst();
    stopFirst();
    sockets[0]!.message('change');
    sockets[0]!.disconnect();
    expect(change).not.toHaveBeenCalled();
    sockets[1]!.message('ready');
    sockets[1]!.message('change');
    expect(change).toHaveBeenCalledTimes(1);
    sockets[1]!.disconnect();
    expect(connection).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(3);
    sockets[2]!.message('ready');
    expect(connection).toHaveBeenLastCalledWith(true);
    stopSecond();
    sockets[2]!.message('change');
    vi.advanceTimersByTime(60_000);
    expect(change).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(3);
    expect(factory.mock.calls[0]![0]).toBe(`wss://connector.example/api/updates?sessionId=${sessionId}`);
  });

  describe('announcements', () => {
    const announcementId = 'a8b7eb54-d82c-4f7a-a35c-bf9d4a5fca2d';
    const imageId = '5f9d54ec-40a8-4b32-95c6-2f9a1f8b1f9c';
    const publish = { type: 'publish' as const, title: 'Fictional', details: 'Details.', expires_at: null };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

    it('validates snapshots and passes cancellation to the request', async () => {
      const fetcher = transport(() => Response.json({ announcements: [], images: [], server_time: '2026-10-24T00:00:00.000Z' }));
      const controller = new AbortController();
      const snapshot = await createCloudflareBackend({ origin, fetch: fetcher }).announcements.snapshot(sessionId, controller.signal);
      expect(snapshot.announcements).toEqual([]);
      const request = fetcher.mock.calls.at(-1)!;
      expect(String(request[0])).toBe(`${origin}/api/announcements?sessionId=${sessionId}`);
      expect(request[1]?.signal).toBe(controller.signal);
      const invalid = createCloudflareBackend({ origin, fetch: transport(() => Response.json({ announcements: 'x' })) });
      await expect(invalid.announcements.snapshot(sessionId)).rejects.toThrow();
    });

    it('treats only typed rejections as confirmed and marks revision conflicts', async () => {
      const send = (reply: () => Response) =>
        createCloudflareBackend({ origin, fetch: transport(reply) }).announcements.execute(sessionId, requestId, publish);
      await expect(send(() => Response.json({ outcome: 'committed', id: announcementId }))).resolves.toBe(announcementId);
      const conflict = send(() => Response.json({ outcome: 'rejected', reason: 'conflict', error: 'Announcement changed.' }, { status: 409 }));
      await expect(conflict).rejects.toMatchObject({ conflict: true, message: 'Announcement changed.' });
      await expect(send(() => Response.json({ outcome: 'rejected', reason: 'access', error: 'No.' }, { status: 409 })))
        .rejects.toMatchObject({ conflict: false });
      await expect(send(() => Response.json({ outcome: 'rejected', reason: 'access', error: 'No.' }, { status: 409 })))
        .rejects.toBeInstanceOf(AnnouncementRejectedError);
      for (const unknown of [() => new Response('gateway', { status: 502 }), () => Response.json({ outcome: 'committed' }),
        () => Response.json({}, { status: 503 })]) {
        const failure = send(unknown);
        await expect(failure).rejects.toThrow('outcome is unknown');
        await expect(failure).rejects.not.toBeInstanceOf(WorkflowRejectedError);
      }
    });

    it('adds the request reference to an unknown outcome', async () => {
      const backend = createCloudflareBackend({ origin, fetch: transport(() =>
        Response.json({ error: 'The request could not be completed.', requestId: 'ray-5' }, { status: 503 })) });
      await expect(backend.announcements.execute(sessionId, requestId, publish))
        .rejects.toThrow('Announcement outcome is unknown. Retry the same request. Reference: ray-5.');
    });

    it('reserves, transfers with a SHA-256 digest, then finishes an image', async () => {
      const calls: Array<{ method: string; path: string; headers: Headers; body?: BodyInit | null | undefined }> = [];
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(String(input));
        calls.push({ method: init?.method ?? 'GET', path: url.pathname, headers: new Headers(init?.headers), body: init?.body });
        if (url.pathname === '/api/auth/session') return Response.json(sessionBody);
        if (init?.method === 'PUT') return Response.json({});
        const body = JSON.parse(String(init?.body)) as { action: string };
        return body.action === 'begin' ? Response.json({ id: imageId, path: `${sessionId}/announcements/${announcementId}/${imageId}` }) : Response.json({});
      });
      const progress = vi.fn();
      await createCloudflareBackend({ origin, fetch: fetcher }).announcements.uploadImage({
        sessionId, announcementId, requestId, file: new File([png], 'board.png', { type: 'image/png' }), onProgress: progress,
      });
      const put = calls.find((call) => call.method === 'PUT')!;
      expect(put.path).toBe(`/api/announcement-image/${sessionId}/announcements/${announcementId}/${imageId}`);
      expect(put.headers.get('Content-Type')).toBe('image/png');
      expect(put.headers.get('X-Minsky-Digest')).toMatch(/^[0-9a-f]{64}$/);
      expect(put.headers.get('X-CSRF-Token')).toBe('fresh-token');
      expect(calls.filter((call) => call.path === '/api/announcement-images').map((call) => (JSON.parse(String(call.body)) as { action: string }).action))
        .toEqual(['begin', 'finish']);
      expect(progress).toHaveBeenLastCalledWith(100);
      const rejected = vi.fn<typeof fetch>();
      await expect(createCloudflareBackend({ origin, fetch: rejected }).announcements.uploadImage({
        sessionId, announcementId, requestId, file: new File([new Uint8Array(32)], 'note.txt'), onProgress: progress,
      })).rejects.toMatchObject({ validation: true });
      expect(rejected).not.toHaveBeenCalled();
    });

    it('classifies announcement image failures and downloads through the access-checked route', async () => {
      const failing = createCloudflareBackend({ origin, fetch: transport(() => Response.json(
        { error: 'Upload the image before finishing.', incomplete: true }, { status: 409 })) });
      await expect(failing.announcements.removeImage(sessionId, imageId)).rejects.toBeInstanceOf(ImageRequestError);
      const fetcher = transport(() => new Response(png, { headers: { 'Content-Type': 'image/png' } }));
      const blob = await createCloudflareBackend({ origin, fetch: fetcher }).announcements.downloadImage(
        { id: imageId, session_id: sessionId, announcement_id: announcementId });
      expect(blob.size).toBe(png.byteLength);
      expect(String(fetcher.mock.calls.at(-1)![0])).toBe(
        `${origin}/api/announcement-image/${sessionId}/announcements/${announcementId}/${imageId}`);
    });
  });

  describe('avatars', () => {
    const avatar = { person_id: issueId, avatar_id: 'c4a9f6a2-7d6e-4a8e-9a43-6f1f5d3e2b10' };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

    it('transfers the exact bytes with their SHA-256 digest and returns the stored avatar', async () => {
      const fetcher = transport(() => Response.json(avatar));
      const stored = await createCloudflareBackend({ origin, fetch: fetcher }).avatars.upload({ requestId, file: new Blob([png]) });
      expect(stored).toEqual(avatar);
      const [input, init] = fetcher.mock.calls.at(-1)!;
      expect(String(input)).toBe(`${origin}/api/avatar/${requestId}`);
      expect(init?.method).toBe('PUT');
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Minsky-Digest')).toBe(createHash('sha256').update(png).digest('hex'));
      expect(headers.get('X-CSRF-Token')).toBe('fresh-token');
      expect(headers.get('Content-Type')).toBe('image/png');
      expect(new Uint8Array(await new Response(init?.body).arrayBuffer())).toEqual(png);
    });

    it('rejects a non-image or oversized picture before any request', async () => {
      const fetcher = vi.fn<typeof fetch>();
      const backend = createCloudflareBackend({ origin, fetch: fetcher });
      const large = new Uint8Array(AVATAR_MAX_BYTES + 1);
      large.set(png);
      for (const bytes of [new Uint8Array(32), large]) {
        await expect(backend.avatars.upload({ requestId, file: new Blob([bytes]) })).rejects.toMatchObject({ validation: true });
      }
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('lists, removes, and downloads through the session route with typed failures', async () => {
      const listed = transport(() => Response.json([avatar]));
      expect(await createCloudflareBackend({ origin, fetch: listed }).avatars.list(sessionId)).toEqual([avatar]);
      expect(String(listed.mock.calls.at(-1)![0])).toBe(`${origin}/api/avatars?sessionId=${sessionId}`);
      const invalid = createCloudflareBackend({ origin, fetch: transport(() => Response.json([{ person_id: 'x' }])) });
      await expect(invalid.avatars.list(sessionId)).rejects.toThrow();
      const removed = transport(() => Response.json({}));
      await createCloudflareBackend({ origin, fetch: removed }).avatars.remove();
      const [removeInput, removeInit] = removed.mock.calls.at(-1)!;
      expect(String(removeInput)).toBe(`${origin}/api/avatars`);
      expect(JSON.parse(String(removeInit?.body))).toEqual({ action: 'remove' });
      const downloaded = transport(() => new Response(png, { headers: { 'Content-Type': 'image/png' } }));
      const blob = await createCloudflareBackend({ origin, fetch: downloaded }).avatars.download(sessionId, avatar);
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(png);
      expect(String(downloaded.mock.calls.at(-1)![0])).toBe(`${origin}/api/avatar/${sessionId}/${avatar.avatar_id}`);
      expect(downloaded.mock.calls.at(-1)![1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
      const denied = createCloudflareBackend({ origin, fetch: transport(() => Response.json(
        { error: 'Picture unavailable.', validation: true }, { status: 409 })) });
      const failure = denied.avatars.download(sessionId, avatar);
      await expect(failure).rejects.toBeInstanceOf(ImageRequestError);
      await expect(failure).rejects.toMatchObject({ validation: true });
    });
  });
});
