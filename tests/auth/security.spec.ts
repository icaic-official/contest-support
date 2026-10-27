import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

interface Fixture {
  id: string;
  username: string;
  password: string;
}

const origin = 'https://127.0.0.1:8788';
const hostileOrigin = 'https://localhost:8788';

async function request(page: Page, path: string, body?: object, csrf: 'current' | 'missing' | 'wrong' = 'current') {
  return page.evaluate(async ({ path, body, csrf }) => {
    const headers: Record<string, string> = {};
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['X-Minsky-Request'] = '1';
      if (csrf === 'current') {
        const current = await fetch('/api/auth/session', { cache: 'no-store' });
        if (current.ok) headers['X-CSRF-Token'] = (await current.json() as { csrf: string }).csrf;
      } else if (csrf === 'wrong') headers['X-CSRF-Token'] = 'incorrect-fixture-token';
    }
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : null,
      cache: 'no-store',
    });
    return { status: response.status, body: await response.json() as { user: { id: string }; status: { must_change: boolean } } };
  }, { path, body, csrf });
}

test.describe('Worker authentication browser security', () => {
  let fixture: Fixture;

  test.beforeEach(async ({ page, request: api }) => {
    const id = randomUUID();
    const result = await api.post(`${origin}/__fixture/${id}`, { headers: { 'X-Minsky-Fixture': '1' } });
    expect(result.status()).toBe(201);
    fixture = await result.json() as Fixture;
    await page.goto(origin);
  });

  test.afterEach(async ({ request: api }) => {
    if (!fixture) return;
    const result = await api.delete(`${origin}/__fixture/${fixture.id}`, { headers: { 'X-Minsky-Fixture': '1' } });
    expect(result.status()).toBe(200);
    expect((await result.json() as { remaining: number }).remaining).toBe(0);
  });

  test('keeps cookies private, restores sessions, enforces password changes, and revokes logout', async ({ page, context }) => {
    expect((await request(page, '/api/auth/sign-in', { username: fixture.username, password: fixture.password })).status).toBe(200);
    const cookie = (await context.cookies()).find((value) => value.name === '__Host-minsky-session');
    expect(Boolean(cookie)).toBe(true);
    // Assert individual properties so a failed assertion cannot print the token.
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
    expect(cookie?.path).toBe('/');
    expect(cookie?.domain).toBe('127.0.0.1');
    expect(cookie ? cookie.expires > Date.now() / 1000 : false).toBe(true);
    expect(cookie ? cookie.expires <= Date.now() / 1000 + 12 * 60 * 60 + 10 : false).toBe(true);
    expect(await page.evaluate(() => document.cookie.includes('minsky-session'))).toBe(false);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);

    await page.reload();
    const restored = await request(page, '/api/auth/session');
    expect(restored.status).toBe(200);
    expect(restored.body.user.id).toBe(fixture.id);
    expect(restored.body.status.must_change).toBe(true);

    for (const csrf of ['missing', 'wrong'] as const) {
      expect((await request(page, '/api/auth/sign-out', {}, csrf)).status).toBe(403);
      expect((await request(page, '/api/auth/session')).status).toBe(200);
    }

    const password = `${randomUUID()}Aa9!`;
    expect((await request(page, '/api/auth/change-password', {
      currentPassword: fixture.password, newPassword: password,
    })).status).toBe(200);
    expect((await request(page, '/api/auth/session')).body.status.must_change).toBe(false);
    const priorCookies = await context.cookies();
    expect((await request(page, '/api/auth/sign-out', {})).status).toBe(200);
    expect((await request(page, '/api/auth/session')).status).toBe(401);
    expect((await context.cookies()).some((value) => value.name.includes('minsky-session'))).toBe(false);

    // Replay the prior browser cookie. Logout must also revoke the server record.
    await context.addCookies(priorCookies);
    expect((await request(page, '/api/auth/session')).status).toBe(401);
  });

  test('rejects incorrect and stale passwords and revokes another browser after a password change', async ({ page, browser }) => {
    expect((await request(page, '/api/auth/sign-in', {
      username: fixture.username, password: `${randomUUID()}Wrong!`,
    })).status).toBe(401);
    expect((await request(page, '/api/auth/session')).status).toBe(401);
    expect((await request(page, '/api/auth/sign-in', { username: fixture.username, password: fixture.password })).status).toBe(200);
    const firstPassword = `${randomUUID()}Aa9!`;
    expect((await request(page, '/api/auth/change-password', {
      currentPassword: fixture.password, newPassword: firstPassword,
    })).status).toBe(200);

    const otherContext = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const other = await otherContext.newPage();
      await other.goto(origin);
      expect((await request(other, '/api/auth/sign-in', {
        username: fixture.username, password: fixture.password,
      })).status).toBe(401);
      expect((await request(other, '/api/auth/sign-in', {
        username: fixture.username, password: firstPassword,
      })).status).toBe(200);
      expect((await request(page, '/api/auth/change-password', {
        currentPassword: firstPassword, newPassword: `${randomUUID()}Aa9!`,
      })).status).toBe(200);
      expect((await request(other, '/api/auth/session')).status).toBe(401);
    } finally {
      await otherContext.close();
    }
  });

  test('rejects a preview origin, cross-origin preflight, and forged form writes', async ({ page, context }) => {
    expect((await request(page, '/api/auth/sign-in', { username: fixture.username, password: fixture.password })).status).toBe(200);
    const hostile = await context.newPage();
    await hostile.goto(hostileOrigin);
    expect((await context.cookies(hostileOrigin)).some((value) => value.name.includes('minsky-session'))).toBe(false);
    const preflightRejected = await hostile.evaluate(async (target) => {
      try {
        await fetch(`${target}/api/auth/sign-out`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-Minsky-Request': '1' },
          body: '{}',
        });
        return false;
      } catch (error) { return error instanceof TypeError; }
    }, origin);
    expect(preflightRejected).toBe(true);

    // A form can send a write without a preflight. The API must reject it too.
    const forgedResponse = hostile.waitForResponse((response) => response.url() === `${origin}/api/auth/sign-out`);
    await hostile.evaluate((target) => {
      const frame = document.createElement('iframe');
      frame.name = 'forged-result';
      document.body.append(frame);
      const form = document.createElement('form');
      form.method = 'POST';
      form.enctype = 'text/plain';
      form.action = `${target}/api/auth/sign-out`;
      form.target = frame.name;
      document.body.append(form);
      form.submit();
    }, origin);
    expect((await forgedResponse).status()).toBe(403);
    expect((await request(page, '/api/auth/session')).status).toBe(200);

    // A Worker preview has a distinct origin even when it serves the same code.
    expect((await request(hostile, '/api/auth/sign-in', { username: fixture.username, password: fixture.password })).status).toBe(403);
    expect((await request(hostile, '/api/auth/session')).status).toBe(403);
    await hostile.close();
  });
});
