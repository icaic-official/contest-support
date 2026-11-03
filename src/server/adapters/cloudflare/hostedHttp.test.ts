import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { createCloudflareAuthentication } from '../../../backend/cloudflare/authentication';
import type { EventCode, SignInTarget } from '../../../backend/contracts';
import { verifyTemporaryAuthentication } from '../../../../tests/providers/scenarios/authentication-lifecycle';
import type { D1Connection, D1Statement } from '../d1/connection';
import { D1Fixture } from '../d1/testFixture';
import { passwordHasher, randomSecret } from './password';

const origin = 'https://minsky-auth-ci.icaic-minsky.workers.dev';
const configPath = 'wrangler.auth-ci.jsonc';

async function hostedFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  // A connection can close before a hosted read completes. Retry reads only.
  // A mutation can have committed even when its response did not arrive.
  const attempts = (init?.method ?? 'GET') === 'GET' ? 3 : 1;
  for (let attempt = 1; ; attempt++) {
    try { return await fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }); }
    catch (error) { if (attempt >= attempts) throw error; }
  }
}

/** Provider fixture transport only. Cookie values never leave this closure. */
function cookieClient() {
  let cookie = '';
  let metadata = { secure: false, httpOnly: false, strict: false, hostOnly: false, root: false };
  const statuses = new Map<string, number>();
  const transport: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Origin', origin);
    if (cookie) headers.set('Cookie', cookie);
    const response = await hostedFetch(input, { ...init, headers, redirect: 'error' });
    statuses.set(new URL(input instanceof Request ? input.url : String(input)).pathname, response.status);
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith('__Host-minsky-session='));
    if (setCookie) {
      metadata = {
        secure: /;\s*Secure(?:;|$)/i.test(setCookie),
        httpOnly: /;\s*HttpOnly(?:;|$)/i.test(setCookie),
        strict: /;\s*SameSite=Strict(?:;|$)/i.test(setCookie),
        hostOnly: !/;\s*Domain=/i.test(setCookie),
        root: /;\s*Path=\/(?:;|$)/i.test(setCookie),
      };
      cookie = /;\s*Max-Age=0(?:;|$)/i.test(setCookie) ? '' : setCookie.split(';')[0]!;
    }
    return response;
  };
  const auth = createCloudflareAuthentication({ origin, fetch: transport });
  return {
    auth,
    /** Issues a temporary password through the credential route, as an organizer's browser does. */
    issue: async (accountId: string, eventId: string) => {
      const response = await auth.withCsrf((token) => transport(new URL('/api/credentials', origin), {
        method: 'POST', body: JSON.stringify({ requestId: randomUUID(), eventId, accountIds: [accountId] }),
        headers: { 'Content-Type': 'application/json', 'X-Minsky-Request': '1', 'X-CSRF-Token': token },
      }));
      if (!response.ok) throw new Error('The credential request failed.');
      return (await response.json() as Array<{ temporaryPassword: string | null }>)[0]!;
    },
    metadata: () => metadata,
    status: (path: string) => statuses.get(path),
    // A saved request transport permits a revoked-cookie replay without putting
    // the credential in assertions or error messages.
    capture: () => {
      const captured = cookie;
      return (path: string, init?: RequestInit) => hostedFetch(new URL(path, origin), {
        ...init, redirect: 'error', headers: new Headers({ ...Object.fromEntries(new Headers(init?.headers)), Origin: origin, Cookie: captured }),
      });
    },
  };
}

/** Failed rejection assertions must never print a password or cookie result. */
function expectFailure(operation: Promise<unknown>) {
  return expect(operation.then(() => undefined)).rejects;
}

describe('isolated hosted Cloudflare authentication HTTP', () => {
  let db: D1Connection;
  let dispose: (() => Promise<void>) | undefined;
  let fixture: D1Fixture;
  let created = false;
  const password = randomSecret();
  let username: string;
  let adminUsername: string;
  let event: SignInTarget;

  function stmt(sql: string, ...values: Array<string | number | null>): D1Statement {
    return db.prepare(sql).bind(...values);
  }

  beforeAll(async () => {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      account_id: string; name: string; vars: { AUTH_ORIGIN: string };
      d1_databases: Array<{ database_id: string; remote: boolean }>;
    };
    if (process.env.MINSKY_AUTH_HTTP_REMOTE !== '1' || process.env.MINSKY_AUTH_REMOTE !== '1' ||
        process.env.MINSKY_AUTH_HTTP_ORIGIN !== origin || config.account_id !== '458ad6a930b0fb717796dfa19ca6a2b1' ||
        config.name !== 'minsky-auth-ci' || config.vars.AUTH_ORIGIN !== origin ||
        config.d1_databases[0]!.database_id !== '5d746d29-0a66-4346-96a6-4974126685d7' || config.d1_databases[0]!.remote !== true) {
      throw new Error('Use the guarded hosted HTTP runner with the exact isolated account, database, and origin.');
    }
    const platform = await getPlatformProxy<{ DB: D1Connection }>({
      configPath, persist: false, remoteBindings: true, envFiles: [],
    });
    db = platform.env.DB;
    dispose = platform.dispose;
    fixture = new D1Fixture(db, configPath);
    await fixture.create();
    created = true;
    event = { kind: 'event', code: (await stmt('SELECT code FROM events WHERE id = ?', fixture.eventId).first<{ code: EventCode }>())!.code };
    username = `http_${fixture.eventId.replaceAll('-', '').slice(0, 20)}`;
    adminUsername = `${username}_a`;
    const hash = await passwordHasher.hash(password);
    const now = new Date().toISOString();
    const ids = [fixture.staff.accountId, fixture.contestant.accountId];
    await db.batch([
      stmt('UPDATE memberships SET is_admin = 1 WHERE account_id = ?', fixture.staff.accountId),
      ...ids.flatMap((id, index) => {
        const name = index === 0 ? adminUsername : username;
        return [
          stmt('UPDATE accounts SET username = ?, must_change = ? WHERE id = ?', name, index, id),
          stmt(`INSERT INTO ba_user (id, name, username, email, emailVerified, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, 1, ?, ?)`, id, 'Fictional hosted HTTP fixture', name, `${name}@accounts.minsky.invalid`, now, now),
          stmt(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
            VALUES (?, ?, 'credential', ?, ?, ?, ?)`, randomUUID(), id, id, hash, now, now),
        ];
      }),
    ]);
  });

  afterAll(async () => {
    try {
      if (created) {
        const ids = [fixture.staff.accountId, fixture.contestant.accountId];
        await db.batch([
          ...ids.map((id) => stmt('DELETE FROM account_operations WHERE account_id = ?', id)),
          ...ids.map((id) => stmt('DELETE FROM ba_user WHERE id = ?', id)),
          stmt('DELETE FROM authentication_limits WHERE key IN (?, ?, ?, ?)',
            `handle:${fixture.eventId}:${username}`, `handle:${fixture.eventId}:${adminUsername}`, `change:${fixture.staff.accountId}`, `change:${fixture.contestant.accountId}`),
        ]);
        const checks = await db.batch(ids.map((id) => stmt(`SELECT
            (SELECT count(*) FROM ba_user WHERE id = ?) +
            (SELECT count(*) FROM ba_account WHERE userId = ?) +
            (SELECT count(*) FROM ba_session WHERE userId = ?) +
            (SELECT count(*) FROM account_operations WHERE account_id = ?) AS n`).bind(id, id, id, id))) as Array<{ results: Array<{ n: number }> }>;
        for (const check of checks) expect(check.results).toEqual([{ n: 0 }]);
        await fixture.cleanup();
      }
    } finally {
      await dispose?.();
    }
  });

  it('checks the shared lifecycle, cookie attributes, recovery, current reset permissions, CSRF, and origins over hosted HTTP', async () => {
    const member = cookieClient();
    const unauthorized = await hostedFetch(`${origin}/api/auth/sign-out`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Minsky-Request': '1' }, body: '{}', redirect: 'error',
    });
    expect(unauthorized.status).toBe(401);
    await expectFailure(member.auth.signIn(event, username, randomSecret())).toThrow();
    expect(member.status('/api/auth/sign-in')).toBe(401);
    expect(await member.auth.currentUser()).toBeUndefined();
    await verifyTemporaryAuthentication(member.auth, { id: fixture.contestant.accountId, target: event, username, password }, {
      restricted: async () => { expect((await member.auth.accountStatus()).must_change).toBe(true); },
      ready: async () => { expect(await member.auth.accountStatus()).toMatchObject({ must_change: false, session_valid: true }); },
    });
    expect(member.metadata()).toEqual({ secure: true, httpOnly: true, strict: true, hostOnly: true, root: true });

    const admin = cookieClient();
    await admin.auth.signIn(event, adminUsername, password);
    await admin.issue(fixture.contestant.accountId, fixture.eventId);
    // A fresh authorized reset replaces credentials from a lost reset response.
    const recovered = await admin.issue(fixture.contestant.accountId, fixture.eventId);
    if (!recovered.temporaryPassword) throw new Error('The authorized reset returned no temporary password.');
    await member.auth.signIn(event, username, recovered.temporaryPassword);
    expect((await member.auth.accountStatus()).must_change).toBe(true);
    const stale = member.capture();
    const reset = await admin.issue(fixture.contestant.accountId, fixture.eventId);
    expect((await stale('/api/auth/session')).status).toBe(401);
    await expectFailure(member.auth.signIn(event, username, recovered.temporaryPassword)).toThrow();
    expect(member.status('/api/auth/sign-in')).toBe(401);
    if (!reset.temporaryPassword) throw new Error('The authorized reset returned no temporary password.');
    await member.auth.signIn(event, username, reset.temporaryPassword);
    await member.auth.changePassword(reset.temporaryPassword, randomSecret());

    // Add one membership in this fixture's second session, then remove only the
    // organizer's authority there. Every account-wide reset must now fail.
    await db.batch([
      stmt('INSERT INTO memberships (session_id, account_id, team_id) VALUES (?, ?, ?)', fixture.secondSessionId, fixture.contestant.accountId, fixture.secondSessionTeamId),
      stmt('UPDATE memberships SET is_admin = 0 WHERE session_id = ? AND account_id = ?', fixture.secondSessionId, fixture.staff.accountId),
    ]);
    await expectFailure(admin.issue(fixture.contestant.accountId, fixture.eventId)).toThrow();
    expect(admin.status('/api/credentials')).toBe(403);
    expect((await member.auth.accountStatus()).session_valid).toBe(true);

    const current = member.capture();
    const csrfRejected = await current('/api/auth/sign-out', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minsky-Request': '1', 'X-CSRF-Token': 'wrong-fixture-token' }, body: '{}',
    });
    expect(csrfRejected.status).toBe(403);
    const foreign = await hostedFetch(`${origin}/api/auth/sign-in`, {
      method: 'POST', headers: { Origin: 'https://untrusted-preview.example', 'Content-Type': 'application/json', 'X-Minsky-Request': '1' },
      body: JSON.stringify({ event: null, handle: username, password }), redirect: 'error',
    });
    expect(foreign.status).toBe(403);
    const preflight = await hostedFetch(`${origin}/api/auth/sign-out`, {
      method: 'OPTIONS', headers: { Origin: 'https://untrusted-preview.example', 'Access-Control-Request-Method': 'POST' }, redirect: 'error',
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect((await member.auth.accountStatus()).session_valid).toBe(true);
    await member.auth.signOut();
    expect((await current('/api/auth/session')).status).toBe(401);
    await admin.auth.signOut();
    await admin.auth.signIn(event, adminUsername, password);
    await stmt('UPDATE logins SET expires_at = unixepoch() - 1 WHERE account_id = ? AND revoked = 0', fixture.staff.accountId).run();
    expect(await admin.auth.currentUser()).toBeUndefined();
    expect(admin.status('/api/auth/session')).toBe(401);
  });
});
