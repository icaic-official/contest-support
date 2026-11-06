import { describe, expect, it, vi } from 'vitest';
import { AuthenticationError, type AuthenticationService, type AuthenticationSession } from './authentication';
import { createAuthenticationHandler } from './authenticationHttp';

const ORIGIN = 'https://auth.minsky.test';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000002';
const current: AuthenticationSession = {
  caller: { accountId: ACCOUNT_ID, loginId: 'private-login-id' },
  user: { id: ACCOUNT_ID, name: 'Fictional helper' },
  status: { handle: 'helper', must_change: true, session_valid: true, can_change_handle: true },
  csrf: 'fixture-csrf',
};

function setup() {
  const service = {
    current: vi.fn<AuthenticationService['current']>().mockResolvedValue(current),
    signIn: vi.fn<AuthenticationService['signIn']>().mockResolvedValue({ cookie: 'opaque=fixture; Secure; HttpOnly; SameSite=Strict; Path=/' }),
    signOut: vi.fn<AuthenticationService['signOut']>().mockResolvedValue({ cookie: 'opaque=; Max-Age=0; Path=/' }),
    changePassword: vi.fn<AuthenticationService['changePassword']>().mockResolvedValue({ cookie: 'opaque=changed; Secure; HttpOnly; SameSite=Strict; Path=/' }),
  };
  return { service, handle: createAuthenticationHandler(service, { origins: [ORIGIN] }) };
}

function post(path: string, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Minsky-Request': '1', 'X-CSRF-Token': current.csrf, ...headers },
    body: JSON.stringify(body),
  });
}

describe('authentication HTTP boundary', () => {
  it('returns the public account status with no-store and omits the trusted caller', async () => {
    const { handle } = setup();
    const response = await handle(new Request(`${ORIGIN}/api/auth/session`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: current.user, status: current.status, csrf: current.csrf });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('rejects disallowed request hosts, cross-origin reads and CORS preflight', async () => {
    const { handle, service } = setup();
    for (const request of [
      new Request('https://preview.minsky.test/api/auth/session'),
      new Request(`${ORIGIN}/api/auth/session`, { headers: { Origin: 'https://attacker.test' } }),
      new Request(`${ORIGIN}/api/auth/sign-in`, { method: 'OPTIONS', headers: { Origin: 'https://attacker.test' } }),
    ]) {
      const response = await handle(request);
      expect(response.status).toBe(403);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
    expect(service.current).not.toHaveBeenCalled();
  });

  it('rejects unsafe origin configuration and allows only explicit local HTTP', () => {
    const { service } = setup();
    for (const origin of ['*', 'null', 'http://shared.test', `${ORIGIN}/`, `${ORIGIN}/path`, 'https://name:password@auth.test']) {
      expect(() => createAuthenticationHandler(service, { origins: [origin] })).toThrow();
    }
    expect(() => createAuthenticationHandler(service, { origins: [] })).toThrow();
    expect(() => createAuthenticationHandler(service, { origins: ['http://127.0.0.1:8787'] })).not.toThrow();
  });

  it('protects login without a prior session and never echoes submitted credentials', async () => {
    const { handle, service } = setup();
    const response = await handle(post('/api/auth/sign-in', { event: ' XXXX-2026 ', handle: ' Helper ', password: 'fictional-password' }, { 'X-CSRF-Token': '' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(service.signIn).toHaveBeenCalledExactlyOnceWith({ kind: 'event', code: 'xxxx-2026' }, 'helper', 'fictional-password');
    expect(service.current).not.toHaveBeenCalled();
  });

  it('signs in as a site account when the body names no event', async () => {
    const { handle, service } = setup();
    expect((await handle(post('/api/auth/sign-in', { event: null, handle: 'webmaster', password: 'fictional-password' }))).status).toBe(200);
    expect(service.signIn).toHaveBeenCalledExactlyOnceWith({ kind: 'site' }, 'webmaster', 'fictional-password');
  });

  it('refuses an event code that cannot exist with the refusal of a wrong code', async () => {
    const { handle, service } = setup();
    const response = await handle(post('/api/auth/sign-in', { event: 'no', handle: 'helper', password: 'fictional-password' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'The event code, username, or password is incorrect.' });
    expect(service.signIn).not.toHaveBeenCalled();
  });

  it('refuses a handle that cannot exist with the refusal of a wrong handle, before the service', async () => {
    const { handle, service } = setup();
    const event = await handle(post('/api/auth/sign-in', { event: 'xxxx-2026', handle: 'a b', password: 'fictional-password' }));
    expect(event.status).toBe(401);
    expect(await event.json()).toEqual({ error: 'The event code, username, or password is incorrect.' });
    const site = await handle(post('/api/auth/sign-in', { event: null, handle: 'x', password: 'fictional-password' }));
    expect(site.status).toBe(401);
    expect(await site.json()).toEqual({ error: 'The username or password is incorrect.' });
    expect(service.signIn).not.toHaveBeenCalled();
  });

  it('rejects originless, foreign-origin, form and missing custom-header writes before identity work', async () => {
    const { handle, service } = setup();
    const body = { event: 'xxxx-2026', handle: 'helper', password: 'fictional-password' };
    const originless = post('/api/auth/sign-in', body);
    originless.headers.delete('Origin');
    for (const request of [
      originless,
      post('/api/auth/sign-in', body, { Origin: 'null' }),
      post('/api/auth/sign-in', body, { Origin: 'https://attacker.test' }),
      post('/api/auth/sign-in', body, { 'Content-Type': 'text/plain' }),
      post('/api/auth/sign-in', body, { 'Content-Type': 'application/x-www-form-urlencoded' }),
      post('/api/auth/sign-in', body, { 'X-Minsky-Request': '' }),
      post('/api/auth/sign-in', body, { 'Sec-Fetch-Site': 'cross-site' }),
    ]) expect((await handle(request)).status).toBe(403);
    expect(service.signIn).not.toHaveBeenCalled();
  });

  it('requires the current session CSRF token for every authenticated write', async () => {
    const { handle, service } = setup();
    for (const path of ['/api/auth/sign-out', '/api/auth/change-password']) {
      expect((await handle(post(path, {}, { 'X-CSRF-Token': 'stale-csrf' }))).status).toBe(403);
    }
    expect(service.signOut).not.toHaveBeenCalled();
    expect(service.changePassword).not.toHaveBeenCalled();
    service.current.mockResolvedValue(undefined);
    expect((await handle(post('/api/auth/sign-out'))).status).toBe(401);
  });

  it('passes cookie credentials to the service and permits password change behind the temporary gate', async () => {
    const { handle, service } = setup();
    const request = post('/api/auth/change-password', { currentPassword: 'fictional-old', newPassword: 'fictional-new' }, { Cookie: 'opaque=fixture' });
    const response = await handle(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('changed');
    expect(service.changePassword).toHaveBeenCalledExactlyOnceWith(request.headers, 'fictional-old', 'fictional-new');
    const signedOut = await handle(post('/api/auth/sign-out'));
    expect(signedOut.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('has no account route, because organizers issue passwords through the management routes', async () => {
    const { handle } = setup();
    expect((await handle(post('/api/accounts', { sessionId: SESSION_ID }))).status).toBe(404);
  });

  it('rejects invalid, unknown-field and oversized bodies without identity writes', async () => {
    const { handle, service } = setup();
    const malformed = post('/api/auth/sign-in');
    const invalidJSON = new Request(malformed, { body: '{' });
    for (const request of [
      invalidJSON,
      post('/api/auth/sign-in', { event: 'xxxx-2026', handle: 'helper', password: 'test', isAdmin: true }),
      post('/api/auth/sign-in', { event: 'xxxx-2026', handle: 'helper', password: 'x'.repeat(17_000) }),
      post('/api/auth/sign-in', { username: 'helper', password: 'fictional-password' }),
    ]) expect((await handle(request)).status).toBe(400);
    expect(service.signIn).not.toHaveBeenCalled();
  });

  it('does not expose internal errors or credentials and preserves controlled rejections', async () => {
    const { handle, service } = setup();
    service.signIn.mockRejectedValue(new Error('database password=fictional-private-value'));
    const failure = await handle(post('/api/auth/sign-in', { event: 'xxxx-2026', handle: 'helper', password: 'fictional-password' }));
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain('fictional');
    service.signIn.mockRejectedValue(new AuthenticationError(401, 'The username or password is incorrect.'));
    expect((await handle(post('/api/auth/sign-in', { event: 'xxxx-2026', handle: 'helper', password: 'wrong' }))).status).toBe(401);
  });

  it('rejects unsupported routes and methods', async () => {
    const { handle } = setup();
    expect((await handle(new Request(`${ORIGIN}/api/auth/sessions`))).status).toBe(404);
    expect((await handle(new Request(`${ORIGIN}/api/unknown`))).status).toBe(404);
    expect((await handle(new Request(`${ORIGIN}/api/auth/session`, { method: 'DELETE' }))).status).toBe(405);
  });
});
