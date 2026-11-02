import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudflareAuthentication } from './authentication';
import type { EventCode } from '../contracts';

const ORIGIN = 'https://auth.minsky.test';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000002';
const user = { id: ACCOUNT_ID, name: 'Fictional helper' };
const status = { handle: 'helper', must_change: false, session_valid: true };

function json(body: unknown, statusCode = 200) {
  return new Response(JSON.stringify(body), { status: statusCode, headers: { 'Content-Type': 'application/json' } });
}

function setup(reply: (request: Request) => Promise<Response> | Response = () => json({ user, status, csrf: 'fixture-csrf' })) {
  const requests: Request[] = [];
  const events = new EventTarget();
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    return reply(request);
  };
  return { auth: createCloudflareAuthentication({ origin: ORIGIN, fetch: fetcher, eventTarget: events }), requests, events };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Cloudflare browser authentication transport', () => {
  it('rejects cross-origin configuration and nonlocal insecure origins', () => {
    vi.stubGlobal('location', new URL(ORIGIN));
    for (const origin of ['https://preview.minsky.test', 'http://shared.test', `${ORIGIN}/path`, `${ORIGIN}/`]) {
      expect(() => createCloudflareAuthentication({ origin })).toThrow();
    }
    expect(() => createCloudflareAuthentication({ origin: ORIGIN })).not.toThrow();
  });

  it('restores the public identity with same-origin cookies, no cache and no redirects', async () => {
    const { auth, requests } = setup();
    expect(await auth.currentUser()).toEqual(user);
    expect(await auth.accountStatus()).toEqual(status);
    for (const request of requests) {
      expect(request.credentials).toBe('same-origin');
      expect(request.cache).toBe('no-store');
      expect(request.redirect).toBe('error');
      expect(request.headers.has('Authorization')).toBe(false);
      expect(request.url).toBe(`${ORIGIN}/api/auth/session`);
    }
  });

  it('returns no user for expired or revoked sessions and validates server status', async () => {
    const unauthorized = setup(() => json({ error: 'Sign in to continue.' }, 401));
    await expect(unauthorized.auth.currentUser()).resolves.toBeUndefined();
    expect(await unauthorized.auth.accountStatus()).toEqual({ handle: null, must_change: true, session_valid: false });
    const malformed = setup(() => json({ user, status: { ...status, must_change: 'no' }, csrf: 'test' }));
    await expect(malformed.auth.currentUser()).rejects.toThrow();
  });

  it('sends login credentials in the body and notifies only after cookie session verification', async () => {
    const { auth, requests } = setup((request) => request.method === 'POST' ? json({}) : json({ user, status, csrf: 'fresh-csrf' }));
    const changed = vi.fn();
    const stop = auth.subscribe(changed);
    try {
      await auth.signIn({ kind: 'event', code: 'xxxx-2026' as EventCode }, 'helper', 'fictional-password');
      expect(changed).toHaveBeenLastCalledWith(user);
      const login = requests.find((request) => request.method === 'POST');
      expect(await login?.json()).toEqual({ event: 'xxxx-2026', handle: 'helper', password: 'fictional-password' });
      await auth.signIn({ kind: 'site' }, 'webmaster', 'fictional-password');
      const site = requests.filter((request) => request.method === 'POST').at(-1);
      expect(await site?.json()).toEqual({ event: null, handle: 'webmaster', password: 'fictional-password' });
      expect(login?.headers.get('X-Minsky-Request')).toBe('1');
      expect(login?.headers.has('X-CSRF-Token')).toBe(false);
      expect(login?.url).toBe(`${ORIGIN}/api/auth/sign-in`);
    } finally { stop(); }
  });

  it('shows the server refusal of a sign-in, and treats a 401 elsewhere as an ended session', async () => {
    const refusal = 'The event code, username, or password is incorrect.';
    const refused = setup((request) => request.method === 'POST' ? json({ error: refusal }, 401) : json({ user, status, csrf: 'csrf' }));
    await expect(refused.auth.signIn({ kind: 'event', code: 'xxxx-2026' as EventCode }, 'helper', 'wrong')).rejects.toThrow(refusal);
    await expect(refused.auth.signOut()).rejects.toThrow('Sign in to continue.');
  });

  it('reads the CSRF token once and reuses it for later writes', async () => {
    let reads = 0;
    const { auth, requests } = setup((request) => request.method === 'GET'
      ? json({ user, status, csrf: `csrf-${++reads}` })
      : json({ temporaryPassword: 'fictional-temporary-password', signIn: { kind: 'event', code: 'xxxx-2026' } }));
    const command = { action: 'reset_password', userId: ACCOUNT_ID } as const;
    await expect(auth.account(SESSION_ID, command)).resolves
      .toEqual({ temporaryPassword: 'fictional-temporary-password', signIn: { kind: 'event', code: 'xxxx-2026' } });
    await auth.account(SESSION_ID, command);
    const writes = requests.filter((request) => request.method === 'POST');
    expect(writes.map((request) => request.headers.get('X-CSRF-Token'))).toEqual(['csrf-1', 'csrf-1']);
    expect(requests.filter((request) => request.method === 'GET')).toHaveLength(1);
    expect(await writes[0]!.json()).toEqual({ sessionId: SESSION_ID, command });
  });

  const issued = { temporaryPassword: 'fictional-temporary-password', signIn: { kind: 'site' } };

  it('reads a new token after the login changes', async () => {
    let reads = 0;
    const { auth, requests } = setup((request) => request.method === 'GET'
      ? json({ user, status, csrf: `csrf-${++reads}` })
      : json(new URL(request.url).pathname === '/api/accounts' ? issued : {}));
    const command = { action: 'reset_password', userId: ACCOUNT_ID } as const;
    await auth.account(SESSION_ID, command);
    await auth.signOut();
    await auth.account(SESSION_ID, command).catch(() => undefined);
    const tokens = requests.filter((request) => request.method === 'POST').map((request) => request.headers.get('X-CSRF-Token'));
    expect(tokens).toEqual(['csrf-1', 'csrf-1', 'csrf-2']);
  });

  it('does not keep a token from a read that began before a sign-out', async () => {
    const pending: Array<(response: Response) => void> = [];
    let deferReads = false;
    const { auth, requests } = setup((request) => {
      if (request.method === 'POST') return json(new URL(request.url).pathname === '/api/accounts' ? issued : {});
      if (deferReads) return new Promise<Response>((resolve) => { pending.push(resolve); });
      return json({ user, status, csrf: 'csrf-new' });
    });
    deferReads = true;
    const stale = auth.currentUser();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    deferReads = false;
    await auth.signOut().catch(() => undefined);
    pending[0]!(json({ user, status, csrf: 'csrf-old' }));
    await stale;
    await auth.account(SESSION_ID, { action: 'reset_password', userId: ACCOUNT_ID });
    const last = requests.filter((request) => request.method === 'POST').at(-1);
    expect(last?.headers.get('X-CSRF-Token')).toBe('csrf-new');
  });

  it('completes password changes only after the server clears the gate', async () => {
    let changed = false;
    const { auth, requests } = setup((request) => {
      if (request.method === 'POST') { changed = true; return json({}); }
      return json({ user, status: { ...status, must_change: !changed }, csrf: 'fixture-csrf' });
    });
    await auth.changePassword('fictional-old', 'fictional-new');
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/auth/session', '/api/auth/change-password', '/api/auth/session',
    ]);
    expect(await requests[1]!.json()).toEqual({ currentPassword: 'fictional-old', newPassword: 'fictional-new' });
    const restricted = setup((request) => request.method === 'POST' ? json({}) : json({ user, status: { ...status, must_change: true }, csrf: 'test' }));
    await expect(restricted.auth.changePassword('old', 'new')).rejects.toThrow('Sign in again');
  });

  it('reports authorized password rejections without issuing a completion request', async () => {
    const { auth, requests } = setup((request) => request.method === 'POST'
      ? json({ error: 'The current password is incorrect.' }, 403)
      : json({ user, status, csrf: 'test' }));
    await expect(auth.changePassword('wrong', 'new')).rejects.toThrow('current password');
    // A 403 checks for a new token once. The same token does not send the write again.
    expect(requests.map((request) => request.method)).toEqual(['GET', 'POST', 'GET']);
  });

  it('notifies logout after the server revokes the session and rejects stale writes', async () => {
    let signedOut = false;
    const { auth } = setup((request) => {
      if (request.method === 'POST') { signedOut = true; return json({}); }
      return signedOut ? json({}, 401) : json({ user, status, csrf: 'test' });
    });
    const changed = vi.fn();
    const stop = auth.subscribe(changed);
    try {
      await auth.signOut();
      expect(changed).toHaveBeenLastCalledWith(undefined);
      await expect(auth.account(SESSION_ID, { action: 'reset_password', userId: ACCOUNT_ID })).rejects.toThrow('Sign in');
    } finally { stop(); }
  });

  describe.each(['signIn', 'signOut', 'changePassword'] as const)('%s completion', (action) => {
    it.each(['focus', 'poll', 'subscription'] as const)('discards an earlier %s response started during the mutation', async (source) => {
      vi.useFakeTimers();
      const writes: Array<(response: Response) => void> = [];
      const pending: Array<(response: Response) => void> = [];
      let deferReads = false;
      let signedIn = action !== 'signIn';
      const { auth, events } = setup((request) => {
        if (request.method === 'POST') return new Promise<Response>((resolve) => { writes.push(resolve); });
        if (deferReads) return new Promise<Response>((resolve) => { pending.push(resolve); });
        return signedIn ? json({ user, status, csrf: 'test' }) : json({}, 401);
      });
      const changed = vi.fn();
      const stops = [auth.subscribe(changed)];
      try {
        await vi.advanceTimersByTimeAsync(0);
        changed.mockClear();
        const mutations = {
          signIn: () => auth.signIn({ kind: 'site' }, 'helper', 'fictional-password'),
          signOut: () => auth.signOut(),
          changePassword: () => auth.changePassword('fictional-old', 'fictional-new'),
        };
        const mutation = mutations[action]();
        await vi.advanceTimersByTimeAsync(0);
        expect(writes).toHaveLength(1);

        deferReads = true;
        if (source === 'focus') events.dispatchEvent(new Event('focus'));
        if (source === 'poll') await vi.advanceTimersByTimeAsync(60_000);
        if (source === 'subscription') stops.push(auth.subscribe(changed));
        expect(pending).toHaveLength(1);

        deferReads = false;
        signedIn = action !== 'signOut';
        writes[0]!(json({}));
        await mutation;
        expect(changed).toHaveBeenLastCalledWith(signedIn ? user : undefined);
        const completedCalls = changed.mock.calls.slice();
        // An old cookie can also return 401 while password rotation replaces it.
        pending[0]!(action === 'signOut' ? json({ user, status, csrf: 'test' }) : json({}, 401));
        await vi.advanceTimersByTimeAsync(0);
        expect(changed.mock.calls).toEqual(completedCalls);
      } finally {
        for (const stop of stops) stop();
      }
    });
  });

  it.each([401, 503])('discards stale refreshes after logout fails with %i and permits later refreshes', async (statusCode) => {
    vi.useFakeTimers();
    const writes: Array<(response: Response) => void> = [];
    const pending: Array<(response: Response) => void> = [];
    let deferReads = false;
    let revoked = false;
    const { auth, events } = setup((request) => {
      if (request.method === 'POST') return new Promise<Response>((resolve) => { writes.push(resolve); });
      if (deferReads) return new Promise<Response>((resolve) => { pending.push(resolve); });
      return revoked ? json({}, 401) : json({ user, status, csrf: 'test' });
    });
    const changed = vi.fn();
    const stop = auth.subscribe(changed);
    try {
      await vi.advanceTimersByTimeAsync(0);
      const mutation = auth.signOut();
      const rejection = expect(mutation).rejects.toThrow(statusCode === 401 ? 'Sign in' : 'Unavailable');
      await vi.advanceTimersByTimeAsync(0);
      expect(writes).toHaveLength(1);
      deferReads = true;
      events.dispatchEvent(new Event('focus'));
      expect(pending).toHaveLength(1);
      revoked = statusCode === 401;
      writes[0]!(json({ error: 'Unavailable' }, statusCode));
      await rejection;
      expect(changed).toHaveBeenLastCalledWith(revoked ? undefined : user);
      const completedCalls = changed.mock.calls.slice();
      pending[0]!(revoked ? json({ user, status, csrf: 'test' }) : json({}, 401));
      await vi.advanceTimersByTimeAsync(0);
      expect(changed.mock.calls).toEqual(completedCalls);

      deferReads = false;
      events.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
      expect(changed).toHaveBeenCalledTimes(completedCalls.length + 1);
      expect(changed).toHaveBeenLastCalledWith(revoked ? undefined : user);
    } finally { stop(); }
  });

  it('refreshes subscribers after focus and polling, and makes cleanup idempotent', async () => {
    vi.useFakeTimers();
    const { auth, events, requests } = setup();
    const changed = vi.fn();
    const stop = auth.subscribe(changed);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(user));
    changed.mockClear();
    events.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    changed.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(changed).toHaveBeenCalledOnce();
    stop(); stop();
    const count = requests.length;
    changed.mockClear();
    events.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests).toHaveLength(count);
    expect(changed).not.toHaveBeenCalled();
  });

  it('ignores already in-flight restoration and refresh callbacks after cleanup', async () => {
    const pending: Array<(response: Response) => void> = [];
    const { auth, events } = setup(() => new Promise<Response>((resolve) => pending.push(resolve)));
    const changed = vi.fn();
    const stop = auth.subscribe(changed);
    events.dispatchEvent(new Event('focus'));
    expect(pending).toHaveLength(2);
    stop(); stop();
    for (const resolve of pending) resolve(json({ user, status, csrf: 'test' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changed).not.toHaveBeenCalled();
  });

  it('keeps identical subscription callbacks independent', async () => {
    const { auth, events } = setup();
    const changed = vi.fn();
    const first = auth.subscribe(changed);
    const second = auth.subscribe(changed);
    try {
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
      first();
      changed.mockClear();
      events.dispatchEvent(new Event('focus'));
      await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    } finally { first(); second(); }
  });

});
