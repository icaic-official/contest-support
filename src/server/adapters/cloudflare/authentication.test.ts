import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy, unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';
import type { D1Connection, D1Statement } from '../d1/connection';
import { D1Fixture } from '../d1/testFixture';
import { D1ApplicationStore } from '../d1/store';
import { D1AuthenticationService } from './authentication';
import { createBetterAuthIdentity, type IdentityProvider } from './identity';
import { passwordHasher, randomSecret, type PasswordHasher } from './password';
import { createAuthenticationHandler } from '../../authenticationHttp';
import { createCloudflareAuthentication } from '../../../backend/cloudflare/authentication';
import { verifyTemporaryAuthentication } from '../../../../tests/providers/scenarios/authentication-lifecycle';

const remote = process.env.MINSKY_AUTH_REMOTE === '1';
const origin = 'http://127.0.0.1:8788';

/** Failed rejection assertions must never print a password or cookie result. */
function expectFailure(operation: Promise<unknown>) {
  return expect(operation.then(() => undefined)).rejects;
}

describe('Cloudflare account authentication', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  let fixture: D1Fixture;
  let identity: IdentityProvider;
  let service: D1AuthenticationService;
  let password: string;
  let username: string;
  let adminHeaders: Headers;
  let extraIds: string[];
  let usernames: string[];
  let created: boolean;

  beforeAll(async () => {
    const platform = await getPlatformProxy<{ DB: D1Connection }>({
      configPath: 'wrangler.auth-ci.jsonc', persist: false, remoteBindings: remote, envFiles: [],
    });
    db = platform.env.DB;
    dispose = platform.dispose;
    if (!remote) {
      const dir = 'src/server/adapters/d1/migrations';
      for (const file of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) {
        await db.batch(splitSqlQuery(readFileSync(`${dir}/${file}`, 'utf8')).map((sql) => db.prepare(sql)));
      }
    }
    identity = createBetterAuthIdentity(db as Parameters<typeof createBetterAuthIdentity>[0], {
      origin, secret: randomSecret(), secureCookies: false,
    });
  }, 120_000);

  afterAll(async () => { if (dispose) await dispose(); }, 120_000);

  function stmt(sql: string, ...values: Array<string | number | null>): D1Statement {
    return db.prepare(sql).bind(...values);
  }

  async function signIn(accountUsername = username, accountPassword = password, instance = service): Promise<Headers> {
    usernames.push(accountUsername.trim().toLowerCase());
    const signed = await instance.signIn(accountUsername, accountPassword);
    return new Headers({ cookie: signed.cookie.split(';')[0] });
  }

  beforeEach(async () => {
    created = false;
    extraIds = [];
    usernames = [];
    fixture = new D1Fixture(db, 'wrangler.auth-ci.jsonc');
    await fixture.create();
    created = true;
    password = randomSecret();
    username = `auth_${fixture.eventId.replaceAll('-', '').slice(0, 20)}`;
    const hash = await passwordHasher.hash(password);
    const now = new Date().toISOString();
    const ids = [fixture.staff.accountId, fixture.contestant.accountId];
    for (const [index, id] of ids.entries()) {
      const name = index === 0 ? `${username}_a` : username;
      await db.batch([
        stmt('UPDATE accounts SET username = ? WHERE id = ?', name, id),
        stmt(`INSERT INTO ba_user (id, name, username, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ?, ?)`, id, 'Fictional account', name, `${name}@accounts.minsky.invalid`, now, now),
        stmt(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)`, randomUUID(), id, id, hash, now, now),
      ]);
    }
    await stmt('UPDATE memberships SET is_admin = 1 WHERE account_id = ?', fixture.staff.accountId).run();
    service = new D1AuthenticationService(db, identity, passwordHasher);
    adminHeaders = await signIn(`${username}_a`);
  }, 120_000);

  afterEach(async () => {
    if (!created) return;
    // Remove only this UUID's identity records. The proof fixture independently
    // checks account markers, event ownership, and all application relationships.
    const extra = await stmt('SELECT id, username FROM accounts WHERE name = ?', `auth-fixture:${fixture.eventId}`).all<{ id: string; username: string }>();
    extraIds = [...new Set([...extraIds, ...extra.results.map((row) => row.id)])];
    usernames.push(...extra.results.map((row) => row.username));
    const ids = [fixture.staff.accountId, fixture.contestant.accountId, ...extraIds];
    await db.batch([
      ...ids.map((id) => stmt('DELETE FROM account_operations WHERE account_id = ?', id)),
      ...extraIds.map((id) => stmt('DELETE FROM accounts WHERE id = ? AND name = ?', id, `auth-fixture:${fixture.eventId}`)),
      ...ids.map((id) => stmt('DELETE FROM ba_user WHERE id = ?', id)),
      stmt('DELETE FROM authentication_limits WHERE key IN (?, ?, ?, ?)', `username:${username}`, `username:${username}_a`, `change:${fixture.staff.accountId}`, `change:${fixture.contestant.accountId}`),
      ...[...new Set(usernames)].map((name) => stmt('DELETE FROM authentication_limits WHERE key = ?', `username:${name}`)),
    ]);
    for (const id of ids) {
      expect((await stmt('SELECT count(*) AS n FROM ba_user WHERE id = ?', id).first<{n: number}>())?.n).toBe(0);
      expect((await stmt('SELECT count(*) AS n FROM ba_session WHERE userId = ?', id).first<{n: number}>())?.n).toBe(0);
      expect((await stmt('SELECT count(*) AS n FROM ba_account WHERE userId = ?', id).first<{n: number}>())?.n).toBe(0);
    }
    for (const name of usernames) expect(await stmt('SELECT key FROM authentication_limits WHERE key = ?', `username:${name}`).first()).toBeNull();
    await fixture.cleanup();
  }, 120_000);

  it('logs in with a normalized username and restores the stable account ID', async () => {
    const headers = await signIn(` ${username.toUpperCase()} `);
    const current = await service.current(headers);
    expect(current?.user.id).toBe(fixture.contestant.accountId);
    expect(current?.status).toMatchObject({ must_change: false, session_valid: true });
    expect((await service.sessions(headers)).map((session) => session.id)).toEqual([fixture.sessionId]);
  });

  it('rejects incorrect passwords and nonexistent usernames', async () => {
    await expectFailure(signIn(username, randomSecret())).toMatchObject({ status: 401 });
    await expectFailure(signIn(`absent_${randomSecret().slice(0, 15)}`)).toMatchObject({ status: 401 });
  });

  it('never verifies an old credential when the captured account is pending', async () => {
    await stmt("UPDATE accounts SET must_change = 1, credential_state = 'pending', credential_generation = credential_generation + 1 WHERE id = ?", fixture.contestant.accountId).run();
    let invoked = false;
    const racing: IdentityProvider = { ...identity, signIn: async (name, value) => {
      invoked = true;
      // This simulates a late identity-session insert after reset completion.
      await stmt("UPDATE accounts SET credential_state = 'ready' WHERE id = ?", fixture.contestant.accountId).run();
      return identity.signIn(name, value);
    } };
    await expectFailure(signIn(username, password, new D1AuthenticationService(db, racing, passwordHasher))).toMatchObject({ status: 401 });
    expect(invoked).toBe(false);
  });

  it('keeps a lone organizer able to retry an interrupted self password change', async () => {
    await stmt('UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.staff.accountId).run();
    const interrupted = new D1AuthenticationService(db, identity, { ...passwordHasher, hash: async () => { throw new Error('Interrupted self hash'); } });
    await expectFailure(interrupted.changePassword(adminHeaders, password, randomSecret())).toThrow('Interrupted self hash');
    expect((await service.current(adminHeaders))?.status.must_change).toBe(true);
    const changed = await service.changePassword(adminHeaders, password, randomSecret());
    expect((await service.current(new Headers({ cookie: changed.cookie.split(';')[0] })))?.status.must_change).toBe(false);
  });

  it('recovers a committed self change after the database response is lost', async () => {
    const headers = await signIn();
    const replacement = randomSecret();
    const lostResponse: D1Connection = { prepare: (sql) => db.prepare(sql), batch: async (statements) => {
      await db.batch(statements);
      throw new Error('Committed response lost');
    } };
    await expectFailure(new D1AuthenticationService(lostResponse, identity, passwordHasher).changePassword(headers, password, replacement)).toMatchObject({ status: 409 });
    expect(await service.current(headers)).toBeUndefined();
    expect((await service.current(await signIn(username, replacement)))?.status.must_change).toBe(false);
  });

  it('leaves an interrupted D1 identity completion restricted and allows organizer recovery', async () => {
    let batches = 0;
    const interruptedDb: D1Connection = {
      prepare: (sql) => db.prepare(sql),
      batch: async (statements) => {
        if (++batches === 2) throw new Error('Interrupted identity commit');
        return db.batch(statements);
      },
    };
    const interrupted = new D1AuthenticationService(interruptedDb, identity, passwordHasher);
    await expectFailure(interrupted.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId })).toMatchObject({ status: 409 });
    await expectFailure(signIn()).toMatchObject({ status: 401 });
    expect((await stmt('SELECT credential_state FROM accounts WHERE id = ?', fixture.contestant.accountId).first<{credential_state: string}>())?.credential_state).toBe('pending');
    const recovered = await service.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId });
    expect((await service.current(await signIn(username, recovered.temporaryPassword!)))?.status.must_change).toBe(true);
  });

  it('rolls back reset initiation when current admin access changes before commit', async () => {
    let called = false;
    const competingDb: D1Connection = { prepare: (sql) => db.prepare(sql), batch: async (statements) => {
      if (!called) {
        called = true;
        await stmt('UPDATE memberships SET is_admin = 0 WHERE account_id = ?', fixture.staff.accountId).run();
      }
      return db.batch(statements);
    } };
    await expectFailure(new D1AuthenticationService(competingDb, identity, passwordHasher).account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId })).toMatchObject({ status: 409 });
    expect((await service.current(await signIn()))?.status.must_change).toBe(false);
    expect((await stmt('SELECT count(*) n FROM account_operations WHERE account_id = ?', fixture.contestant.accountId).first<{n: number}>())?.n).toBe(0);
  });

  it('keeps reset restricted if the organizer loses permission during hashing', async () => {
    const interrupted = new D1AuthenticationService(db, identity, { ...passwordHasher, hash: async (value) => {
      await stmt('UPDATE memberships SET is_admin = 0 WHERE account_id = ?', fixture.staff.accountId).run();
      return passwordHasher.hash(value);
    } });
    await expectFailure(interrupted.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId })).toMatchObject({ status: 403 });
    await expectFailure(signIn()).toMatchObject({ status: 401 });
    await stmt('UPDATE memberships SET is_admin = 1 WHERE account_id = ?', fixture.staff.accountId).run();
    const reset = await service.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId });
    expect((await service.current(await signIn(username, reset.temporaryPassword!)))?.status.must_change).toBe(true);
  });

  it('recovers an interrupted account creation without replacing its account ID', async () => {
    const accountUsername = `create_${randomSecret().slice(0, 20)}`;
    usernames.push(accountUsername);
    const interrupted = new D1AuthenticationService(db, identity, { ...passwordHasher, hash: async () => { throw new Error('Interrupted creation'); } });
    await expectFailure(interrupted.account(adminHeaders, fixture.sessionId, { action: 'create_account', username: accountUsername, name: `auth-fixture:${fixture.eventId}`, teamId: fixture.teamId, roles: [], isAdmin: false })).toThrow('Interrupted creation');
    const row = await stmt('SELECT id, credential_state FROM accounts WHERE username = ?', accountUsername).first<{id: string; credential_state: string}>();
    extraIds.push(row!.id);
    expect(row?.credential_state).toBe('pending');
    const recovered = await service.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: row!.id });
    expect((await service.current(await signIn(accountUsername, recovered.temporaryPassword!)))?.user.id).toBe(row?.id);
  });

  it('blocks reset when a different assigned session is archived', async () => {
    const archivedEvent = randomUUID();
    await db.batch([
      stmt('INSERT INTO events (id, archived) VALUES (?, 1)', archivedEvent),
      stmt('UPDATE sessions SET event_id = ? WHERE id = ?', archivedEvent, fixture.secondSessionId),
      stmt('INSERT INTO memberships (session_id, account_id) VALUES (?, ?)', fixture.secondSessionId, fixture.contestant.accountId),
    ]);
    try {
      await expectFailure(service.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId })).toMatchObject({ status: 403 });
    } finally {
      await db.batch([stmt('UPDATE sessions SET event_id = ? WHERE id = ?', fixture.eventId, fixture.secondSessionId), stmt('DELETE FROM events WHERE id = ?', archivedEvent)]);
    }
  });

  it('bounds password attempts and releases an expired rate window', async () => {
    const key = `username:${username}`;
    await service.limit(key, 2);
    await service.limit(key, 2);
    await expectFailure(service.limit(key, 2)).toMatchObject({ status: 429 });
    await stmt('UPDATE authentication_limits SET window_start = unixepoch() - 901 WHERE key = ?', key).run();
    await service.limit(key, 2);
  });

  it('requires a live identity cookie rather than browser account data', async () => {
    expect(await service.current(new Headers())).toBeUndefined();
    await expectFailure(service.sessions(new Headers({ 'X-Account-Id': fixture.staff.accountId }))).toMatchObject({ status: 401 });
  });

  it('blocks temporary passwords at both session reads and the application store', async () => {
    await stmt('UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.contestant.accountId).run();
    const headers = await signIn();
    const current = await service.current(headers);
    expect(current?.status.must_change).toBe(true);
    await expectFailure(service.sessions(headers)).toMatchObject({ status: 403 });
    expect(await new D1ApplicationStore(db).issue(current!.caller, fixture.sessionId, fixture.issueId)).toBeUndefined();
    await expectFailure(service.account(headers, fixture.sessionId, { action: 'reset_password', userId: fixture.staff.accountId })).toMatchObject({ status: 403 });
  });

  it('changes a temporary password, rotates the cookie, and revokes every older login', async () => {
    await stmt('UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.contestant.accountId).run();
    const first = await signIn();
    const second = await signIn();
    const replacement = randomSecret();
    const result = await service.changePassword(first, password, replacement);
    const fresh = new Headers({ cookie: result.cookie.split(';')[0] });
    expect((await service.current(fresh))?.status.must_change).toBe(false);
    expect(await service.current(first)).toBeUndefined();
    expect(await service.current(second)).toBeUndefined();
    await expectFailure(signIn()).toMatchObject({ status: 401 });
    expect((await service.current(await signIn(username, replacement)))?.user.id).toBe(fixture.contestant.accountId);
  });

  it('rejects incorrect current passwords and unchanged passwords', async () => {
    const headers = await signIn();
    await expectFailure(service.changePassword(headers, randomSecret(), randomSecret())).toMatchObject({ status: 400 });
    await expectFailure(service.changePassword(headers, password, password)).toMatchObject({ status: 400 });
    expect((await service.current(headers))?.status.session_valid).toBe(true);
  });

  it('rejects equivalent Unicode passwords as a mandatory password change', async () => {
    const original = randomSecret() + '\u2460';
    await stmt("UPDATE ba_account SET password = ? WHERE userId = ? AND providerId = 'credential'", await passwordHasher.hash(original), fixture.contestant.accountId).run();
    await stmt('UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.contestant.accountId).run();
    const headers = await signIn(username, original);
    await expectFailure(service.changePassword(headers, original, original.normalize('NFKC'))).toMatchObject({ status: 400 });
    expect((await service.current(headers))?.status.must_change).toBe(true);
  });

  it('logs out and rejects the copied old cookie', async () => {
    const headers = await signIn();
    expect((await service.signOut(headers)).cookie).toContain('Max-Age=0');
    expect(await service.current(headers)).toBeUndefined();
  });

  it.each(['logins', 'ba_session'])('rejects expired %s sessions', async (table) => {
    const headers = await signIn();
    const current = await service.current(headers);
    if (table === 'logins') await stmt('UPDATE logins SET expires_at = unixepoch() - 1 WHERE id = ?', current!.caller.loginId).run();
    else await stmt("UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE userId = ?", current!.user.id).run();
    expect(await service.current(headers)).toBeUndefined();
  });

  it('rejects explicit revocation and disabled accounts with copied cookies', async () => {
    const headers = await signIn();
    const current = await service.current(headers);
    await stmt('UPDATE logins SET revoked = 1 WHERE id = ?', current!.caller.loginId).run();
    expect(await service.current(headers)).toBeUndefined();
    const newHeaders = await signIn();
    await stmt('UPDATE accounts SET disabled = 1 WHERE id = ?', fixture.contestant.accountId).run();
    expect(await service.current(newHeaders)).toBeUndefined();
    await expectFailure(signIn()).toMatchObject({ status: 401 });
  });

  it('requires current admin access in every assigned session for reset', async () => {
    await stmt('INSERT INTO memberships (session_id, account_id) VALUES (?, ?)', fixture.secondSessionId, fixture.contestant.accountId).run();
    await stmt('UPDATE memberships SET is_admin = 0 WHERE session_id = ? AND account_id = ?', fixture.secondSessionId, fixture.staff.accountId).run();
    await expectFailure(service.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId })).toMatchObject({ status: 403 });
    expect((await service.current(await signIn()))?.status.must_change).toBe(false);
  });

  it('resets through the organizer and preserves IDs, membership, and issue history', async () => {
    const oldHeaders = await signIn();
    const caller = (await service.current(oldHeaders))!.caller;
    expect(await new D1ApplicationStore(db).execute(caller, fixture.sessionId, randomUUID(), {
      type: 'message', issue_id: fixture.issueId, revision: 1,
      text: 'Fictional history retained through password reset.', visibility: 'public',
    })).toMatchObject({ outcome: 'committed' });
    const before = await fixture.durableState();
    expect(before.history.length).toBe(1);
    const reset = await service.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId });
    expect(Boolean(reset.temporaryPassword)).toBe(true);
    expect(await service.current(oldHeaders)).toBeUndefined();
    await expectFailure(signIn()).toMatchObject({ status: 401 });
    const newHeaders = await signIn(username, reset.temporaryPassword!);
    const current = await service.current(newHeaders);
    expect(current?.user.id).toBe(fixture.contestant.accountId);
    expect(current?.status.must_change).toBe(true);
    expect(await fixture.durableState()).toEqual(before);
    expect((await stmt('SELECT team_id FROM memberships WHERE account_id = ?', fixture.contestant.accountId).first<{team_id: string}>())?.team_id).toBe(fixture.teamId);
    expect((await stmt("SELECT count(*) n FROM account_operations WHERE account_id = ? AND state = 'completed'", fixture.contestant.accountId).first<{n: number}>())?.n).toBe(1);
  });

  it('rejects self-reset, archived accounts, and replacement of an assigned username', async () => {
    await expectFailure(service.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.staff.accountId })).toMatchObject({ status: 400 });
    await expectFailure(service.account(adminHeaders, fixture.sessionId, { action: 'set_username', userId: fixture.contestant.accountId, username: 'replacement' })).toMatchObject({ status: 409 });
    await stmt('UPDATE events SET archived = 1 WHERE id = ?', fixture.eventId).run();
    await expectFailure(service.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId })).toMatchObject({ status: 403 });
  });

  it('creates a temporary account with stable identity and restricted membership', async () => {
    const accountUsername = `new_${randomSecret().slice(0, 20)}`;
    const result = await service.account(adminHeaders, fixture.sessionId, { action: 'create_account', username: accountUsername, name: `auth-fixture:${fixture.eventId}`, teamId: fixture.teamId, roles: [], isAdmin: false });
    const row = await stmt('SELECT id FROM accounts WHERE username = ?', accountUsername).first<{id: string}>();
    extraIds.push(row!.id);
    const current = await service.current(await signIn(accountUsername, result.temporaryPassword!));
    expect(current?.user.id).toBe(row!.id);
    expect(current?.status.must_change).toBe(true);
  });

  it('leaves a failed password update restricted and recoverable by another reset', async () => {
    const old = await signIn();
    const failed: PasswordHasher = { ...passwordHasher, hash: async () => { throw new Error('Interrupted hash'); } };
    const interrupted = new D1AuthenticationService(db, identity, failed);
    await expectFailure(interrupted.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId })).toThrow('Interrupted hash');
    expect(await service.current(old)).toBeUndefined();
    await expectFailure(signIn()).toMatchObject({ status: 401 });
    const pending = await stmt('SELECT credential_state, must_change FROM accounts WHERE id = ?', fixture.contestant.accountId).first();
    expect(pending).toEqual({ credential_state: 'pending', must_change: 1 });
    const reset = await service.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId });
    expect((await service.current(await signIn(username, reset.temporaryPassword!)))?.status.must_change).toBe(true);
  });

  it('prevents a superseded reset from writing an older password', async () => {
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const pause = new Promise<void>((resolve) => { release = resolve; });
    const hashing = new Promise<void>((resolve) => { started = resolve; });
    const delayed = new D1AuthenticationService(db, identity, { ...passwordHasher, hash: async (value) => { started(); await pause; return passwordHasher.hash(value); } });
    const first = delayed.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId });
    // Attach a rejection handler before another reset supersedes this operation.
    const firstOutcome = first.then(() => false, () => true);
    await hashing;
    const second = await service.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId });
    release();
    expect(await firstOutcome).toBe(true);
    expect((await service.current(await signIn(username, second.temporaryPassword!)))?.status.must_change).toBe(true);
  });

  it('rejects an old password login that races a completed reset', async () => {
    const racingIdentity: IdentityProvider = { ...identity, signIn: async (name, value) => {
      const signed = await identity.signIn(name, value);
      await service.account(adminHeaders, fixture.sessionId, { action: 'reset_password', userId: fixture.contestant.accountId });
      return signed;
    } };
    await expectFailure(signIn(username, password, new D1AuthenticationService(db, racingIdentity, passwordHasher))).toMatchObject({ status: 409 });
  });

  it('passes the same temporary-authentication lifecycle used by the Supabase provider scenario', async () => {
    await stmt('UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.contestant.accountId).run();
    const handle = createAuthenticationHandler(service, { origins: [origin] });
    let cookie = '';
    const auth = createCloudflareAuthentication({
      origin,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (cookie) request.headers.set('Cookie', cookie);
        if (request.method === 'POST') request.headers.set('Origin', origin);
        const response = await handle(request);
        const replacement = response.headers.get('Set-Cookie');
        if (replacement) cookie = replacement.split(';')[0];
        return response;
      },
    });
    await verifyTemporaryAuthentication(auth, { id: fixture.contestant.accountId, username, password }, {
      restricted: async () => { await expectFailure(auth.sessions()).toThrow(); },
      ready: async () => { expect((await auth.sessions()).map((session) => session.id)).toEqual([fixture.sessionId]); },
    });
  });
});
