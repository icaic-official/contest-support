import { describe, expect, it, vi } from 'vitest';
import { createApplicationHandler, type ApplicationHttpServices } from './http';
import type { Snapshot } from '../../../connected/model';
import { AuthenticationError, type AuthenticationSession } from '../../authentication';
import { ImageRequestError } from '../../../backend/errors';
import { AnnouncementCommandError } from './announcements';

const origin = 'https://connector.example';
const sessionId = '0fb97157-9f3f-45ed-b036-5d0fa2cdb278';
const requestId = '202b3701-33c9-4662-89dd-5c27ca0d12d1';
const identity: AuthenticationSession = {
  caller: { accountId: '3be3c103-e098-4f97-87ec-f2317ec8c67b', loginId: 'bd5a5689-eb24-44e9-8020-06442b2d6038' },
  user: { id: '3be3c103-e098-4f97-87ec-f2317ec8c67b' },
  status: { handle: 'fictional', must_change: false, session_valid: true, can_change_handle: true }, csrf: 'protected-token',
};

function services() {
  return {
    auth: { current: vi.fn<ApplicationHttpServices['auth']['current']>().mockResolvedValue(identity) },
    application: {
      contests: vi.fn<ApplicationHttpServices['application']['contests']>()
        .mockResolvedValue([{ id: sessionId, name: 'Fictional', eventId: requestId, eventName: 'Fictional event', manage: 'none' }]),
      snapshot: vi.fn<ApplicationHttpServices['application']['snapshot']>(),
    },
    workflow: { execute: vi.fn<ApplicationHttpServices['workflow']['execute']>().mockResolvedValue({ outcome: 'committed', issueId: requestId }) },
    manage: {
      site: vi.fn<ApplicationHttpServices['manage']['site']>(),
      event: vi.fn<ApplicationHttpServices['manage']['event']>(),
      execute: vi.fn<ApplicationHttpServices['manage']['execute']>().mockResolvedValue({}),
      issueCredentials: vi.fn<ApplicationHttpServices['manage']['issueCredentials']>().mockResolvedValue([]),
    },
    images: {
      begin: vi.fn<ApplicationHttpServices['images']['begin']>(),
      upload: vi.fn<ApplicationHttpServices['images']['upload']>(),
      finish: vi.fn<ApplicationHttpServices['images']['finish']>(),
      remove: vi.fn<ApplicationHttpServices['images']['remove']>(),
      download: vi.fn<ApplicationHttpServices['images']['download']>(),
    },
    announcements: {
      snapshot: vi.fn<ApplicationHttpServices['announcements']['snapshot']>(),
      execute: vi.fn<ApplicationHttpServices['announcements']['execute']>().mockResolvedValue(requestId),
    },
    announcementImages: {
      begin: vi.fn<ApplicationHttpServices['announcementImages']['begin']>(),
      upload: vi.fn<ApplicationHttpServices['announcementImages']['upload']>(),
      finish: vi.fn<ApplicationHttpServices['announcementImages']['finish']>(),
      remove: vi.fn<ApplicationHttpServices['announcementImages']['remove']>(),
      download: vi.fn<ApplicationHttpServices['announcementImages']['download']>(),
    },
    avatars: {
      list: vi.fn<ApplicationHttpServices['avatars']['list']>().mockResolvedValue([]),
      upload: vi.fn<ApplicationHttpServices['avatars']['upload']>(),
      remove: vi.fn<ApplicationHttpServices['avatars']['remove']>(),
      download: vi.fn<ApplicationHttpServices['avatars']['download']>(),
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
    const body = { requestId, command: { type: 'set_intake', contestId: sessionId, open: true } };
    const rejectedHeaders: Array<Record<string, string>> = [
      { Origin: 'https://attacker.example' }, { 'X-CSRF-Token': 'stale' },
      { 'X-Minsky-Request': '' }, { 'Sec-Fetch-Site': 'cross-site' },
    ];
    for (const headers of rejectedHeaders) {
      expect((await handle(post('/api/manage', body, headers))).status).toBe(403);
    }
    deps.auth.current.mockResolvedValueOnce(undefined);
    expect((await handle(post('/api/manage', body))).status).toBe(401);
    deps.auth.current.mockResolvedValueOnce({ ...identity, status: { ...identity.status, must_change: true } });
    expect((await handle(post('/api/manage', body))).status).toBe(403);
    expect(deps.manage.execute).not.toHaveBeenCalled();
  });

  it('accepts 300 entrants in one management request, and keeps the default limit elsewhere', async () => {
    const deps = services();
    const handle = createApplicationHandler(deps, origin);
    const entrants = Array.from({ length: 300 }, (_, index) => ({
      kind: 'team', name: `Fictional team number ${index + 1}`, handle: `team-${index + 1}` }));
    const command = { type: 'create_entrants', eventId: sessionId, entrants };
    expect((await handle(post('/api/manage', { requestId, command }))).status).toBe(200);
    expect(deps.manage.execute).toHaveBeenCalledWith(identity.caller, requestId, command);
    expect((await handle(post('/api/credentials', { requestId, eventId: null, accountIds: { padding: 'x'.repeat(20_000) } }))).status).toBe(400);
    expect(deps.manage.issueCredentials).not.toHaveBeenCalled();
  });

  it('reads contests and the event console with the trusted caller', async () => {
    const deps = services();
    const handle = createApplicationHandler(deps, origin);
    const get = (path: string) => handle(new Request(`${origin}${path}`, { headers: { Origin: origin } }));
    expect((await get('/api/contests')).status).toBe(200);
    expect(deps.application.contests).toHaveBeenLastCalledWith(identity.caller, undefined);
    expect((await get(`/api/contests?eventId=${requestId}`)).status).toBe(200);
    expect(deps.application.contests).toHaveBeenLastCalledWith(identity.caller, requestId);
    expect((await get('/api/contests?eventId=nope')).status).toBe(400);
    expect((await get('/api/sessions')).status).toBe(404);
    deps.manage.event.mockRejectedValueOnce(new AuthenticationError(403, 'Only an event admin or a webmaster can change this event.'));
    expect((await get(`/api/event?eventId=${requestId}`)).status).toBe(403);
    expect(deps.manage.event).toHaveBeenCalledWith(identity.caller, requestId);
    deps.manage.event.mockRejectedValueOnce(new AuthenticationError(400, 'Choose an event.'));
    expect((await get('/api/event')).status).toBe(400);
    expect(deps.manage.event).toHaveBeenLastCalledWith(identity.caller, undefined);
    expect((await get('/api/event?eventId=nope')).status).toBe(400);
    expect((await handle(post('/api/admin', { action: 'set_intake', sessionId, open: true }))).status).toBe(404);
  });

  it('passes site changes and credential issues with the trusted caller and returns a refusal', async () => {
    const deps = services();
    const handle = createApplicationHandler(deps, origin);
    const command = { type: 'set_webmaster_reads', restricted: true };
    const response = await handle(post('/api/manage', { requestId, command }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(deps.manage.execute).toHaveBeenCalledWith(identity.caller, requestId, command);
    expect((await handle(post('/api/manage', { requestId, command, caller: identity.caller }))).status).toBe(400);
    deps.manage.execute.mockRejectedValueOnce(new AuthenticationError(409, 'The last webmaster cannot be removed.'));
    const refused = await handle(post('/api/manage', { requestId, command: { type: 'remove_webmaster', accountId: requestId } }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'The last webmaster cannot be removed.' });
    expect(deps.manage.execute).toHaveBeenCalledTimes(2);
    expect((await handle(post('/api/credentials', { requestId, eventId: requestId, accountIds: [sessionId] }))).status).toBe(200);
    expect(deps.manage.issueCredentials).toHaveBeenCalledWith(identity.caller, requestId, { eventId: requestId, accountIds: [sessionId] });
    expect((await handle(post('/api/credentials', { requestId, accountIds: [sessionId] }))).status).toBe(400);
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

  describe('workflow response snapshot', () => {
    const snapshot: Snapshot = {
      session: null, event: null, membership: null, teams: [], issues: [], resolutions: [], history: [], attachments: [],
      pending_removals: [], awards: [], members: [], audit: [], server_time: '2026-10-25T00:00:00Z',
    };
    const body = { sessionId, requestId, command: {} };

    it('returns the snapshot read after the commit, for the same caller and session', async () => {
      const deps = services();
      const order: string[] = [];
      deps.workflow.execute.mockImplementation(async () => { order.push('commit'); return { outcome: 'committed', issueId: requestId }; });
      deps.application.snapshot.mockImplementation(async () => { order.push('snapshot'); return snapshot; });
      const response = await createApplicationHandler(deps, origin)(post('/api/workflow', body));
      expect(await response.json()).toEqual({ outcome: 'committed', issueId: requestId, snapshot });
      expect(order).toEqual(['commit', 'snapshot']);
      expect(deps.application.snapshot).toHaveBeenCalledWith(identity.caller, sessionId);
    });

    it('keeps the commit when the snapshot read fails', async () => {
      const deps = services();
      deps.application.snapshot.mockRejectedValue(new Error('Private SQL bound values.'));
      const response = await createApplicationHandler(deps, origin)(post('/api/workflow', body));
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain('Private SQL');
      expect(JSON.parse(await createApplicationHandler(deps, origin)(post('/api/workflow', body)).then((r) => r.text())))
        .toEqual({ outcome: 'committed', issueId: requestId });
    });

    it('reads nothing after a rejected or unknown command', async () => {
      const deps = services();
      const handle = createApplicationHandler(deps, origin);
      deps.workflow.execute.mockResolvedValueOnce({ outcome: 'rejected', reason: 'state' });
      await handle(post('/api/workflow', body));
      deps.workflow.execute.mockResolvedValueOnce({ outcome: 'unknown' });
      await handle(post('/api/workflow', body));
      expect(deps.application.snapshot).not.toHaveBeenCalled();
    });
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

  it('keeps announcement outcomes typed and accepts long multi-byte text within its own bound', async () => {
    const deps = services();
    const handle = createApplicationHandler(deps, origin);
    const command = { type: 'publish', title: 'Fictional', details: '字'.repeat(10_000), expires_at: null };
    const committed = await handle(post('/api/announcements', { sessionId, requestId, command }));
    expect(await committed.json()).toEqual({ outcome: 'committed', id: requestId });
    expect(deps.announcements.execute).toHaveBeenCalledWith(identity.caller, sessionId, requestId, command);
    deps.announcements.execute.mockRejectedValueOnce(new AnnouncementCommandError('conflict', 'Announcement changed.'));
    const conflict = await handle(post('/api/announcements', { sessionId, requestId, command }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ outcome: 'rejected', reason: 'conflict' });
    deps.announcements.execute.mockRejectedValueOnce(new Error('Private SQL bound values.'));
    expect(await (await handle(post('/api/announcements', { sessionId, requestId, command }))).text()).not.toContain('Private SQL');
    const forged = await handle(post('/api/announcements', { sessionId, requestId, command, caller: { accountId: requestId } }));
    expect(await forged.json()).toEqual({ outcome: 'rejected', reason: 'input' });
    const oversized = await handle(post('/api/announcements', { sessionId, requestId, command: { ...command, details: 'x'.repeat(70_000) } }));
    expect(oversized.status).toBe(400);
    expect(deps.announcements.execute).toHaveBeenCalledTimes(3);
  });

  it('routes announcement image transfers to their own service and requires an exact length', async () => {
    const deps = services();
    const handle = createApplicationHandler(deps, origin);
    const headers = { Origin: origin, 'X-Minsky-Request': '1', 'X-CSRF-Token': identity.csrf, 'Content-Length': '3',
      'Content-Type': 'image/png', 'X-Minsky-Digest': 'a'.repeat(64) };
    const request = (extra?: Record<string, string>) => new Request(`${origin}/api/announcement-image/${sessionId}/announcements/a/b`,
      { method: 'PUT', headers: { ...headers, ...extra }, body: new Uint8Array([1, 2, 3]) });
    expect((await handle(request())).status).toBe(200);
    expect(deps.announcementImages.upload).toHaveBeenCalledTimes(1);
    expect(deps.images.upload).not.toHaveBeenCalled();
    const withoutLength = { Origin: origin, 'X-Minsky-Request': '1', 'X-CSRF-Token': identity.csrf };
    expect((await handle(new Request(`${origin}/api/announcement-image/path`, { method: 'PUT', headers: withoutLength }))).status).toBe(411);
    const reservation = { sessionId, requestId, announcementId: requestId, name: 'notice.png', bytes: 3 };
    await handle(post('/api/announcement-images', { action: 'begin', ...reservation }));
    expect(deps.announcementImages.begin).toHaveBeenCalledWith(identity.caller, reservation);
    deps.announcementImages.finish.mockRejectedValueOnce(new ImageRequestError('Upload the image before finishing.', { incomplete: true }));
    const finish = await handle(post('/api/announcement-images', { action: 'finish', sessionId, imageId: requestId }));
    expect(await finish.json()).toMatchObject({ incomplete: true });
  });

  describe('avatars', () => {
    const avatarId = 'c4a9f6a2-7d6e-4a8e-9a43-6f1f5d3e2b10';
    const protection = { Origin: origin, 'X-Minsky-Request': '1', 'X-CSRF-Token': identity.csrf };
    const upload = (headers: Record<string, string>, body = new Uint8Array([0xff, 0xd8, 0xff, 1])) =>
      new Request(`${origin}/api/avatar/${requestId}`, { method: 'PUT', body,
        headers: { 'Content-Length': String(body.byteLength), 'X-Minsky-Digest': 'a'.repeat(64), ...headers } });
    const removal = (headers: Record<string, string>, body: unknown = { action: 'remove' }) =>
      new Request(`${origin}/api/avatars`, { method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', ...headers } });

    it('uploads the exact bytes for the signed-in account and returns its avatar', async () => {
      const deps = services();
      deps.avatars.upload.mockResolvedValueOnce({ person_id: identity.caller.accountId, avatar_id: avatarId });
      const response = await createApplicationHandler(deps, origin)(upload(protection));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ person_id: identity.caller.accountId, avatar_id: avatarId });
      expect(deps.avatars.upload).toHaveBeenCalledWith(identity.caller,
        { requestId, bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]), digest: 'a'.repeat(64) });
    });

    it('requires the same origin and request protection to upload or remove', async () => {
      const deps = services();
      const handle = createApplicationHandler(deps, origin);
      const rejected: Array<Record<string, string>> = [
        { ...protection, Origin: 'https://attacker.example' }, { ...protection, 'X-CSRF-Token': 'stale' },
        { ...protection, 'X-Minsky-Request': '' }, { ...protection, 'Sec-Fetch-Site': 'cross-site' },
        { 'X-Minsky-Request': '1', 'X-CSRF-Token': identity.csrf },
      ];
      for (const headers of rejected) {
        expect((await handle(upload(headers))).status).toBe(403);
        expect((await handle(removal(headers))).status).toBe(403);
      }
      expect(deps.avatars.upload).not.toHaveBeenCalled();
      expect(deps.avatars.remove).not.toHaveBeenCalled();
      expect((await handle(removal(protection))).status).toBe(200);
      expect(deps.avatars.remove).toHaveBeenCalledWith(identity.caller);
      expect((await handle(removal(protection, { action: 'remove', accountId: requestId }))).status).toBe(400);
      expect(deps.avatars.remove).toHaveBeenCalledTimes(1);
    });

    it('rejects a declared body over 256 KiB before reading it', async () => {
      const deps = services();
      const response = await createApplicationHandler(deps, origin)(upload({ ...protection, 'Content-Length': '262145' }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ validation: true });
      expect(deps.avatars.upload).not.toHaveBeenCalled();
    });

    it('lists and downloads for one session with private headers', async () => {
      const deps = services();
      const handle = createApplicationHandler(deps, origin);
      const list = await handle(new Request(`${origin}/api/avatars?sessionId=${sessionId}`));
      expect(list.headers.get('Cache-Control')).toBe('private, no-store');
      expect(deps.avatars.list).toHaveBeenCalledWith(identity.caller, sessionId);
      deps.avatars.download.mockResolvedValueOnce({ body: new Response('bytes').body!, contentType: 'image/webp' });
      const download = await handle(new Request(`${origin}/api/avatar/${sessionId}/${avatarId}`));
      expect(download.status).toBe(200);
      expect(deps.avatars.download).toHaveBeenCalledWith(identity.caller, sessionId, avatarId);
      expect(download.headers.get('Content-Type')).toBe('image/webp');
      expect(download.headers.get('Cache-Control')).toBe('private, no-store');
      expect(download.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect((await handle(new Request(`${origin}/api/avatar/${sessionId}/not-an-avatar`))).status).toBe(400);
      expect((await handle(new Request(`${origin}/api/avatar/${sessionId}/${avatarId}/extra`))).status).toBe(400);
      expect(deps.avatars.download).toHaveBeenCalledTimes(1);
    });
  });
});
