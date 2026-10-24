import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { D1Connection } from '../d1/connection';
import { createDiagnostics, readD1AuthFlags, type AuthFlags } from '../../../../tests/providers/cloudflare/diagnostics';
import { applyMigrations } from '../d1/testFixture';

const flags: AuthFlags = { accountExists: true, accountDisabled: false, accountMustChange: false, accountReady: true,
  wrapperCount: 1, wrapperExists: true, wrapperRevoked: false, wrapperUnexpired: true, credentialGenerationMatches: true,
  identityExists: true, identityAccountMatches: true, identityUnexpired: true, identityParsedUnexpired: true, currentLoginValid: true };
const observation = { method: 'GET', url: 'https://fixture.invalid/api/snapshot?sessionId=private-value',
  status: 200, durationMilliseconds: 12.4, hasSessionCookie: true };

it('retains only endpoint enums, status counts, and numeric durations', async () => {
  const secret = 'private-password-cookie-token-value';
  const diagnostics = createDiagnostics();
  await diagnostics.observe({ ...observation, url: `https://${secret}.invalid/api/snapshot?token=${secret}` });
  await diagnostics.observe({ ...observation, status: 503, durationMilliseconds: 30.6 });
  await diagnostics.observe({ ...observation, method: secret, url: `https://fixture.invalid/api/image/${secret}`, status: 409 });
  for (const change of [{ url: `https://fixture.invalid/${secret}` }, { status: -1 }, { status: 600 },
    { durationMilliseconds: NaN }, { durationMilliseconds: -1 }]) await diagnostics.observe({ ...observation, ...change });
  const summary = diagnostics.summary();
  expect(summary.requests[0]).toEqual({ endpoint: 'snapshot', method: 'GET', count: 2,
    totalMilliseconds: 43, maxMilliseconds: 31, statuses: [{ status: 200, count: 1 }, { status: 503, count: 1 }] });
  expect(summary.requests[1]).toMatchObject({ endpoint: 'image', method: 'OTHER', count: 1 });
  expect(JSON.stringify(summary)).not.toContain(secret);
  summary.requests[0].count = 999;
  expect(diagnostics.summary().requests[0].count).toBe(2);
});

it('captures the first resource 401 and waits for its private state read before teardown', async () => {
  const accountId = randomUUID();
  let complete: ((value: AuthFlags) => void) | undefined;
  let calls = 0;
  const diagnostics = createDiagnostics(accountId, async id => {
    expect(id).toBe(accountId);
    calls++;
    return new Promise(resolve => { complete = resolve; });
  });
  for (const path of ['session', 'sign-in', 'sign-out', 'change-password']) {
    await diagnostics.observe({ ...observation, url: `https://fixture.invalid/api/auth/${path}`, status: 401 });
  }
  expect(calls).toBe(0);
  const reading = diagnostics.observe({ ...observation, status: 401 });
  await diagnostics.observe({ ...observation, status: 401, hasSessionCookie: false });
  expect(calls).toBe(1);
  let flushed = false;
  const flushing = diagnostics.flush().then(() => { flushed = true; });
  await Promise.resolve();
  expect(flushed).toBe(false);
  complete!(Object.assign({ secret: 'private-credential' }, flags));
  await Promise.all([reading, flushing]);
  expect(diagnostics.summary().unauthorized).toEqual({ endpoint: 'snapshot', method: 'GET',
    hasSessionCookie: true, authStateRead: 'available', authFlags: flags });
  expect(JSON.stringify(diagnostics.summary())).not.toContain(accountId);
  expect(JSON.stringify(diagnostics.summary())).not.toContain('private-credential');
});

it('handles anonymous requests and unavailable private state without leaking callback errors', async () => {
  const anonymous = createDiagnostics(undefined, async () => { throw new Error('Must not read'); });
  await anonymous.observe({ ...observation, status: 401, hasSessionCookie: false });
  expect(anonymous.summary().unauthorized).toMatchObject({ hasSessionCookie: false, authStateRead: 'not_requested' });
  for (const read of [async () => { throw new Error('private-provider-bound-value'); },
    async () => ({ ...flags, accountReady: 'private-provider-bound-value' } as unknown as AuthFlags)]) {
    const diagnostics = createDiagnostics(randomUUID(), read);
    await diagnostics.observe({ ...observation, status: 401 });
    await diagnostics.flush();
    expect(diagnostics.summary().unauthorized?.authStateRead).toBe('unavailable');
    expect(JSON.stringify(diagnostics.summary())).not.toContain('private-provider');
  }
});

describe('fixture-owned authentication flags with real local D1', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  const accountId = randomUUID();
  const identityId = randomUUID();
  const loginId = randomUUID();
  const owned = new Set([accountId]);
  beforeAll(async () => {
    const platform = await getPlatformProxy<{ DB: D1Connection }>({ configPath: 'wrangler.auth-ci.jsonc',
      persist: false, remoteBindings: false, envFiles: [] });
    db = platform.env.DB;
    dispose = platform.dispose;
    await applyMigrations(db);
    await db.batch([
      db.prepare('INSERT INTO accounts (id, name, must_change) VALUES (?, ?, 0)').bind(accountId, 'Fictional diagnostic account'),
      db.prepare(`INSERT INTO ba_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, '2026-01-01', '2026-01-01')`)
        .bind(accountId, 'Fictional diagnostic account', `${accountId}@fixture.invalid`),
      db.prepare(`INSERT INTO ba_session (id, userId, token, expiresAt, createdAt, updatedAt)
        VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'), '2026-01-01', '2026-01-01')`).bind(identityId, accountId, randomUUID()),
      db.prepare('INSERT INTO logins (id, account_id, identity_session_id, expires_at) VALUES (?, ?, ?, unixepoch() + 3600)').bind(loginId, accountId, identityId),
    ]);
  }, 120_000);
  afterAll(async () => { if (dispose) await dispose(); });

  it('reads valid state without returning account IDs or credential data', async () => {
    expect(await readD1AuthFlags(db, accountId, owned)).toEqual(flags);
    await expect(readD1AuthFlags(db, randomUUID(), owned)).rejects.toThrow('owned by this fixture');
  });

  it('distinguishes revoked wrappers, changed generations, and expired identities', async () => {
    await db.batch([
      db.prepare('UPDATE logins SET revoked = 1 WHERE id = ?').bind(loginId),
      db.prepare('UPDATE accounts SET credential_generation = credential_generation + 1 WHERE id = ?').bind(accountId),
      db.prepare("UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(identityId),
    ]);
    expect(await readD1AuthFlags(db, accountId, owned)).toEqual({ ...flags, wrapperRevoked: true,
      credentialGenerationMatches: false, identityUnexpired: false, identityParsedUnexpired: false, currentLoginValid: false });
  });
});
