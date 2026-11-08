import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { D1Binding, D1Connection, D1Statement } from '../d1/connection';
import { applyMigrations } from '../d1/testFixture';
import { D1AuthenticationService } from './authentication';
import { createBetterAuthIdentity } from './identity';
import { bootstrapSite, recoverWebmaster, validateSiteConfiguration } from './installation';
import { passwordHasher, randomSecret, type PasswordHasher } from './password';
import { openLocalPlatform } from './tooling/store-database.mjs';

const site = { webmasterHandle: 'site_owner', webmasterName: 'Site webmaster' };
const fastPasswords: PasswordHasher = {
  hash: async () => 'fictional-test-hash',
  verify: async () => false,
};

// Do not let a failed assertion print a returned password or authentication cookie.
function expectFailure(operation: Promise<unknown>) {
  return expect(operation.then(() => undefined)).rejects;
}

describe('site configuration', () => {
  it('trims the name and lowercases the handle', () => {
    expect(validateSiteConfiguration({ webmasterHandle: ' SITE_Owner ', webmasterName: ' Webmaster ' }))
      .toEqual({ webmasterHandle: 'site_owner', webmasterName: 'Webmaster' });
  });

  it('rejects malformed settings, null bytes, event fields, and secrets', () => {
    for (const input of [
      null, [], {},
      { ...site, webmasterHandle: 'not a username' },
      { ...site, webmasterName: ' ' },
      { ...site, webmasterName: 'a\0b' },
      { ...site, webmasterName: 'a'.repeat(201) },
      { ...site, eventName: 'An event' },
      { ...site, teams: [] },
      { ...site, password: 'private-placeholder-value' },
    ]) {
      expect(() => validateSiteConfiguration(input)).toThrow('Invalid site configuration.');
    }
  });
});

describe('trusted Cloudflare site bootstrap and webmaster recovery', () => {
  let db: D1Binding;
  let dispose: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    // Every case owns a fresh local database. These tests cannot select hosted data.
    const platform = await openLocalPlatform<{ DB: D1Binding }>('wrangler.auth-ci.jsonc');
    db = platform.env.DB;
    dispose = platform.dispose;
    await applyMigrations(db);
  }, 120_000);

  afterEach(async () => { await dispose?.(); }, 120_000);

  function stmt(sql: string, ...values: Array<string | number | null>): D1Statement {
    return db.prepare(sql).bind(...values);
  }

  function bootstrap(connection: D1Connection = db, passwords = fastPasswords) {
    return bootstrapSite(connection, site, { passwords });
  }

  async function count(table: string): Promise<number> {
    const row = await db.prepare(`SELECT count(*) AS n FROM "${table}"`).first<{ n: number }>();
    return row!.n;
  }

  /** A webmaster outside every contest, as the Webmasters screen adds one. */
  async function addWebmaster(username: string): Promise<string> {
    const id = randomUUID();
    await db.batch([
      stmt('INSERT INTO accounts (id, name, username, must_change) VALUES (?, ?, ?, 0)', id, 'Fictional webmaster', username),
      stmt(`INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', 'fixture')`, id),
      stmt(`INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
        VALUES (?, 'Fictional webmaster', ?, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)`,
      id, `${username}@accounts.minsky.invalid`, username),
    ]);
    return id;
  }

  it('creates one webmaster and nothing else, and enforces the temporary-password gate', async () => {
    const result = await bootstrap(db, passwordHasher);
    for (const table of ['events', 'sessions', 'teams', 'memberships', 'entrants', 'installation', 'admin_audit', 'account_operations']) {
      expect(await count(table), table).toBe(0);
    }
    for (const table of ['accounts', 'ba_user', 'ba_account', 'grants', 'authority_audit']) {
      expect(await count(table), table).toBe(1);
    }
    expect(await stmt(`SELECT a.event_id, g.granted_by FROM accounts a JOIN grants g ON g.account_id = a.id AND g.scope = 'site'
      WHERE a.id = ?`, result.accountId).first()).toEqual({ event_id: null, granted_by: 'trusted_bootstrap' });
    // The webmaster types the handle. Better Auth knows only the login key.
    expect(await stmt('SELECT username, handle FROM accounts WHERE id = ?', result.accountId).first())
      .toEqual({ username: result.accountId.replaceAll('-', ''), handle: site.webmasterHandle });
    expect(await stmt("SELECT action, actor, target FROM authority_audit").first()).toEqual({
      action: 'trusted_bootstrap', actor: result.accountId, target: result.accountId,
    });
    const identity = createBetterAuthIdentity(db, {
      origin: 'http://127.0.0.1:8788', secret: randomSecret(), secureCookies: false,
    });
    const authentication = new D1AuthenticationService(db, identity, passwordHasher);
    const signed = await authentication.signIn({ kind: 'site' }, result.handle, result.temporaryPassword);
    const headers = new Headers({ cookie: signed.cookie.split(';')[0]! });
    const current = await authentication.current(headers);
    expect(current?.user.id).toBe(result.accountId);
    expect(current?.status.must_change).toBe(true);
    const changed = await authentication.changePassword(headers, result.temporaryPassword, randomSecret());
    expect(await authentication.current(headers)).toBeUndefined();
    const changedHeaders = new Headers({ cookie: changed.cookie.split(';')[0]! });
    expect((await authentication.current(changedHeaders))?.status.must_change).toBe(false);
    await expectFailure(bootstrap()).toThrow('The database is not empty.');
  }, 120_000);

  it.each(['account', 'identity', 'limit'])('rejects partial foreign %s data without deleting it or hashing a password', async (kind) => {
    if (kind === 'account') await stmt('INSERT INTO accounts (id, name) VALUES (?, ?)', randomUUID(), 'Foreign account').run();
    if (kind === 'identity') await stmt(`INSERT INTO ba_verification (id, identifier, value, expiresAt, createdAt, updatedAt)
      VALUES (?, 'foreign', 'foreign', '2099-01-01', '2026-01-01', '2026-01-01')`, randomUUID()).run();
    if (kind === 'limit') await stmt("INSERT INTO authentication_limits (key, window_start, attempts) VALUES ('foreign', 1, 1)").run();
    let hashed = false;
    await expectFailure(bootstrap(db, { ...fastPasswords, hash: async () => { hashed = true; return 'unused'; } })).toThrow('The database is not empty.');
    expect(hashed).toBe(false);
    expect(await count(kind === 'account' ? 'accounts' : kind === 'identity' ? 'ba_verification' : 'authentication_limits')).toBe(1);
    expect(await count('grants')).toBe(0);
  });

  it('leaves an empty database unchanged when hashing or the atomic bootstrap fails', async () => {
    await expectFailure(bootstrap(db, { ...fastPasswords, hash: async () => { throw new Error('private provider detail'); } })).toThrow('Password preparation failed.');
    const failing: D1Connection = {
      prepare: (sql) => db.prepare(sql),
      batch: (statements) => db.batch([...statements, stmt('INSERT INTO command_assertions (id, valid) VALUES (?, 0)', randomUUID())]),
    };
    await expectFailure(bootstrap(failing)).toThrow('Installation outcome is unknown.');
    for (const table of ['accounts', 'ba_user', 'ba_account', 'grants', 'authority_audit', 'command_assertions']) {
      expect(await count(table), table).toBe(0);
    }
    await bootstrap();
    expect(await count('grants')).toBe(1);
  });

  it('commits only one concurrent initialization after both callers read an empty database', async () => {
    let hashing = 0;
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const passwords: PasswordHasher = { ...fastPasswords, hash: async () => {
      hashing += 1;
      if (hashing === 2) release();
      await barrier;
      return 'fictional-concurrent-hash';
    } };
    const outcomes = await Promise.allSettled([bootstrap(db, passwords), bootstrap(db, passwords)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled').length).toBe(1);
    for (const table of ['accounts', 'ba_user', 'ba_account', 'grants', 'authority_audit']) {
      expect(await count(table), table).toBe(1);
    }
    expect(await count('command_assertions')).toBe(0);
  });

  it('preserves a committed installation after a lost response and permits webmaster recovery', async () => {
    const lostResponse: D1Connection = {
      prepare: (sql) => db.prepare(sql),
      batch: async (statements) => { await db.batch(statements); throw new Error('lost response'); },
    };
    await expectFailure(bootstrap(lostResponse)).toThrow('Installation outcome is unknown.');
    expect(await count('grants')).toBe(1);
    await expectFailure(bootstrap()).toThrow('The database is not empty.');
    const result = await recoverWebmaster(db, { handle: site.webmasterHandle }, { passwords: fastPasswords });
    expect(result.handle).toBe(site.webmasterHandle);
    expect(result.temporaryPassword).toMatch(/^[2-9A-HJ-NP-Za-km-np-z]{16}$/);
  });

  it('recovers a webmaster in one batch, and the old password and sessions stop working', async () => {
    const installed = await bootstrap(db, passwordHasher);
    const identity = createBetterAuthIdentity(db, { origin: 'http://127.0.0.1:8788', secret: randomSecret(), secureCookies: false });
    const authentication = new D1AuthenticationService(db, identity, passwordHasher);
    const first = await authentication.signIn({ kind: 'site' }, installed.handle, installed.temporaryPassword);
    const oldHeaders = new Headers({ cookie: first.cookie.split(';')[0]! });
    expect((await authentication.current(oldHeaders))?.user.id).toBe(installed.accountId);
    const recovered = await recoverWebmaster(db, { handle: ' SITE_OWNER ' });
    expect(recovered).toMatchObject({ accountId: installed.accountId, handle: installed.handle });
    expect(await authentication.current(oldHeaders)).toBeUndefined();
    await expectFailure(authentication.signIn({ kind: 'site' }, installed.handle, installed.temporaryPassword)).toMatchObject({ status: 401 });
    const next = await authentication.signIn({ kind: 'site' }, installed.handle, recovered.temporaryPassword);
    expect((await authentication.current(new Headers({ cookie: next.cookie.split(';')[0]! })))?.status.must_change).toBe(true);
    expect(await stmt('SELECT credential_generation, credential_state, must_change FROM accounts WHERE id = ?', installed.accountId).first())
      .toEqual({ credential_generation: 2, credential_state: 'ready', must_change: 1 });
    expect(await stmt(`SELECT action, state, actor, session_id FROM account_operations
      WHERE account_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, installed.accountId).first())
      .toEqual({ action: 'reset_password', state: 'completed', actor: installed.accountId, session_id: null });
    expect(await stmt("SELECT actor, target FROM authority_audit WHERE action = 'trusted_webmaster_recovery'").first())
      .toEqual({ actor: installed.accountId, target: installed.accountId });
    expect(await count('command_assertions')).toBe(0);
  }, 180_000);

  it('recovers a webmaster who holds no contest membership', async () => {
    await bootstrap();
    const webmaster = await addWebmaster('site_only');
    const recovered = await recoverWebmaster(db, { handle: 'site_only' }, { passwords: fastPasswords });
    expect(recovered.accountId).toBe(webmaster);
    expect(await stmt('SELECT password FROM ba_account WHERE userId = ?', webmaster).first()).toEqual({ password: 'fictional-test-hash' });
  });

  it('refuses a contest admin, a removed or disabled webmaster, and an unknown username before hashing', async () => {
    await bootstrap();
    const [event, contest, contestAdmin] = [randomUUID(), randomUUID(), randomUUID()];
    await db.batch([
      stmt("INSERT INTO events (id, name, code) VALUES (?, 'Fictional event', 'fictional-event')", event),
      stmt("INSERT INTO sessions (id, event_id, name) VALUES (?, ?, 'Fictional contest')", contest, event),
      stmt(`INSERT INTO accounts (id, name, username, must_change) VALUES (?, 'Duty admin', 'duty_admin', 0)`, contestAdmin),
      stmt('INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, 1)', contest, contestAdmin),
    ]);
    const removed = await addWebmaster('removed_webmaster');
    await stmt(`DELETE FROM grants WHERE scope = 'site' AND account_id = ?`, removed).run();
    const disabled = await addWebmaster('disabled_webmaster');
    await stmt('UPDATE accounts SET disabled = 1 WHERE id = ?', disabled).run();
    let hashes = 0;
    const passwords: PasswordHasher = { ...fastPasswords, hash: async () => { hashes += 1; return 'uncommitted-hash'; } };
    // A contest admin's handle belongs to its event, not to the site.
    await expectFailure(recoverWebmaster(db, { handle: 'duty_admin' }, { passwords })).toThrow('No account matches that username.');
    await expectFailure(recoverWebmaster(db, { handle: 'removed_webmaster' }, { passwords })).toThrow('The account is not a webmaster.');
    await expectFailure(recoverWebmaster(db, { handle: 'disabled_webmaster' }, { passwords })).toThrow('The account is disabled.');
    await expectFailure(recoverWebmaster(db, { handle: 'missing' }, { passwords })).toThrow('No account matches that username.');
    await expectFailure(recoverWebmaster(db, { handle: 'not a username' }, { passwords })).toThrow('The username is invalid.');
    expect(hashes).toBe(0);
    expect(await stmt("SELECT count(*) AS n FROM account_operations WHERE action = 'reset_password'").first()).toEqual({ n: 0 });
  });

  it('leaves the previous password in place when the recovery batch fails', async () => {
    const installed = await bootstrap();
    const failing: D1Connection = { prepare: (sql) => db.prepare(sql), batch: () => Promise.reject(new Error('private SQL detail')) };
    await expectFailure(recoverWebmaster(failing, { handle: installed.handle }, { passwords: fastPasswords }))
      .toThrow('Webmaster recovery did not finish. The account was not changed.');
    expect(await stmt('SELECT credential_generation, credential_state FROM accounts WHERE id = ?', installed.accountId).first())
      .toEqual({ credential_generation: 1, credential_state: 'ready' });
  });
});
