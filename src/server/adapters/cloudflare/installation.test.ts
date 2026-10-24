import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { D1Connection, D1Statement } from '../d1/connection';
import { applyMigrations } from '../d1/testFixture';
import { D1AuthenticationService } from './authentication';
import { createBetterAuthIdentity } from './identity';
import { bootstrapInstallation, recoverInstallationOwner, validateCompetitionConfiguration } from './installation';
import { passwordHasher, randomSecret, type PasswordHasher } from './password';

const competition = {
  adminUsername: 'competition_owner',
  adminName: 'Competition organizer',
  eventName: "Competition $minsky_bootstrap$ '; drop table accounts; --",
  sessionName: 'Morning session',
  categories: ['Devices', 'Problem statement'],
  teams: [{ name: "O'Brien's team", location: 'Hall A \\ Desk 12' }],
};
const fastPasswords: PasswordHasher = {
  hash: async () => 'fictional-test-hash',
  verify: async () => false,
};

// Do not let a failed assertion print a returned password or authentication cookie.
function expectFailure(operation: Promise<unknown>) {
  return expect(operation.then(() => undefined)).rejects;
}

describe('competition configuration from PR #21', () => {
  it('retains competition fields, trims names, and permits an empty roster', () => {
    expect(validateCompetitionConfiguration({
      ...competition, adminUsername: ' COMPETITION_Owner ', adminName: ' Organizer ', teams: [],
    })).toEqual({ ...competition, adminUsername: 'competition_owner', adminName: 'Organizer', teams: [] });
  });

  it('rejects malformed settings, null bytes, duplicate normalized names, and secrets', () => {
    for (const input of [
      null, [], {},
      { ...competition, adminUsername: 'not a username' },
      { ...competition, adminName: ' ' },
      { ...competition, eventName: 'a\0b' },
      { ...competition, sessionName: 'a'.repeat(201) },
      { ...competition, categories: [] },
      { ...competition, categories: ['Devices', ' Devices '] },
      { ...competition, teams: null },
      { ...competition, teams: [{ name: 'A', location: 'Room' }, { name: ' A ', location: 'Room' }] },
      { ...competition, adminUserId: randomUUID() },
      { ...competition, password: 'private-placeholder-value' },
    ]) {
      expect(() => validateCompetitionConfiguration(input)).toThrow('Invalid competition configuration.');
    }
  });
});

describe('trusted Cloudflare installation and owner recovery', () => {
  let db: D1Connection;
  let dispose: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    // Every case owns a fresh local database. These tests cannot select hosted data.
    const platform = await getPlatformProxy<{ DB: D1Connection }>({
      configPath: 'wrangler.auth-ci.jsonc', persist: false, remoteBindings: false, envFiles: [],
    });
    db = platform.env.DB;
    dispose = platform.dispose;
    await applyMigrations(db);
  }, 120_000);

  afterEach(async () => { await dispose?.(); }, 120_000);

  function stmt(sql: string, ...values: Array<string | number | null>): D1Statement {
    return db.prepare(sql).bind(...values);
  }

  function bootstrap(connection = db, passwords = fastPasswords) {
    return bootstrapInstallation(connection, competition, { passwords });
  }

  async function count(table: string): Promise<number> {
    const row = await db.prepare(`SELECT count(*) AS n FROM "${table}"`).first<{ n: number }>();
    return row!.n;
  }

  async function applicationRecords(): Promise<Record<string, unknown[]>> {
    const tables = ['events', 'sessions', 'teams', 'memberships', 'membership_roles', 'issues', 'history', 'resolutions', 'awards', 'installation'];
    return Object.fromEntries(await Promise.all(tables.map(async (table) => [table,
      (await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).results,
    ])));
  }

  async function seedOldLogin(accountId: string): Promise<void> {
    const identitySessionId = randomUUID();
    await db.batch([
      stmt(`INSERT INTO ba_session (id, expiresAt, token, createdAt, updatedAt, userId)
        VALUES (?, '2099-01-01T00:00:00.000Z', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)`,
      identitySessionId, randomSecret(), accountId),
      stmt(`INSERT INTO logins (id, account_id, expires_at, identity_session_id, csrf)
        VALUES (?, ?, unixepoch() + 3600, ?, ?)`, randomUUID(), accountId, identitySessionId, randomSecret()),
    ]);
  }

  it('installs quoted values through current migrations and enforces the temporary-password gate', async () => {
    const result = await bootstrap(db, passwordHasher);
    expect(await stmt('SELECT name FROM events WHERE id = ?', result.eventId).first()).toEqual({ name: competition.eventName });
    expect(await stmt('SELECT name, location FROM teams WHERE id = ?', result.teamIds[0]).first()).toEqual(competition.teams[0]);
    expect(await stmt('SELECT name, categories, intake_open FROM sessions WHERE id = ?', result.sessionId).first()).toEqual({
      name: competition.sessionName, categories: JSON.stringify(competition.categories), intake_open: 0,
    });
    expect(await stmt('SELECT is_admin, team_id FROM memberships WHERE account_id = ?', result.accountId).first()).toEqual({ is_admin: 1, team_id: null });
    expect(await stmt("SELECT action, actor, target FROM admin_audit WHERE action = 'trusted_bootstrap'").first()).toEqual({
      action: 'trusted_bootstrap', actor: result.accountId, target: result.accountId,
    });
    const identity = createBetterAuthIdentity(db as Parameters<typeof createBetterAuthIdentity>[0], {
      origin: 'http://127.0.0.1:8788', secret: randomSecret(), secureCookies: false,
    });
    const authentication = new D1AuthenticationService(db, identity, passwordHasher);
    const signed = await authentication.signIn(result.adminUsername, result.temporaryPassword);
    const headers = new Headers({ cookie: signed.cookie.split(';')[0] });
    const current = await authentication.current(headers);
    expect(current?.user.id).toBe(result.accountId);
    expect(current?.status.must_change).toBe(true);
    await expectFailure(authentication.sessions(headers)).toMatchObject({ status: 403 });
    const changed = await authentication.changePassword(headers, result.temporaryPassword, randomSecret());
    expect(await authentication.current(headers)).toBeUndefined();
    const changedHeaders = new Headers({ cookie: changed.cookie.split(';')[0] });
    expect((await authentication.current(changedHeaders))?.status.must_change).toBe(false);
    const recovered = await recoverInstallationOwner(db, result);
    expect(await authentication.current(changedHeaders)).toBeUndefined();
    const recoveryLogin = await authentication.signIn(recovered.adminUsername, recovered.temporaryPassword);
    const recoveryHeaders = new Headers({ cookie: recoveryLogin.cookie.split(';')[0] });
    expect((await authentication.current(recoveryHeaders))?.status.must_change).toBe(true);
    await expectFailure(authentication.sessions(recoveryHeaders)).toMatchObject({ status: 403 });
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
    expect(await count('installation')).toBe(0);
  });

  it('leaves an empty database unchanged when hashing or the atomic bootstrap fails', async () => {
    await expectFailure(bootstrap(db, { ...fastPasswords, hash: async () => { throw new Error('private provider detail'); } })).toThrow('Password preparation failed.');
    const failing: D1Connection = {
      prepare: (sql) => db.prepare(sql),
      batch: (statements) => db.batch([...statements, stmt('INSERT INTO command_assertions (id, valid) VALUES (?, 0)', randomUUID())]),
    };
    await expectFailure(bootstrap(failing)).toThrow('Installation outcome is unknown.');
    expect(await count('accounts')).toBe(0);
    expect(await count('ba_user')).toBe(0);
    expect(await count('ba_account')).toBe(0);
    expect(await count('account_operations')).toBe(0);
    expect(await count('admin_audit')).toBe(0);
    expect(await count('command_assertions')).toBe(0);
    expect(Object.values(await applicationRecords()).every((rows) => rows.length === 0)).toBe(true);
    await bootstrap();
    expect(await count('installation')).toBe(1);
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
    for (const table of ['accounts', 'ba_user', 'ba_account', 'events', 'sessions', 'teams', 'memberships', 'installation']) {
      expect(await count(table)).toBe(1);
    }
    expect((await stmt('SELECT action FROM admin_audit ORDER BY action').all()).results).toEqual([
      { action: 'create_account' }, { action: 'trusted_bootstrap' },
    ]);
    expect(await count('command_assertions')).toBe(0);
  });

  it('preserves a committed installation after a lost response and permits trusted owner recovery', async () => {
    const lostResponse: D1Connection = {
      prepare: (sql) => db.prepare(sql),
      batch: async (statements) => { await db.batch(statements); throw new Error('lost response'); },
    };
    await expectFailure(bootstrap(lostResponse)).toThrow('Installation outcome is unknown.');
    const marker = await db.prepare('SELECT id AS installationId, owner_account_id AS accountId FROM installation').first<{ installationId: string; accountId: string }>();
    expect(Boolean(marker)).toBe(true);
    await expectFailure(bootstrap()).toThrow('The database is not empty.');
    const result = await recoverInstallationOwner(db, marker!, { passwords: fastPasswords });
    expect(result.accountId).toBe(marker!.accountId);
    expect(Boolean(result.temporaryPassword)).toBe(true);
    expect(await count('installation')).toBe(1);
  });

  it('recovers the sole owner, revokes old sessions, and preserves IDs, memberships, and history', async () => {
    const result = await bootstrap();
    const issueId = randomUUID();
    await db.batch([
      stmt("INSERT INTO issues (id, session_id, team_id, status) VALUES (?, ?, ?, 'open')", issueId, result.sessionId, result.teamIds[0]),
      stmt("INSERT INTO history (id, issue_id, actor, at, text, visibility) VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z', 'History survives recovery', 'public')", randomUUID(), issueId, result.accountId),
    ]);
    await seedOldLogin(result.accountId);
    const before = await applicationRecords();
    const recovered = await recoverInstallationOwner(db, result, { passwords: fastPasswords });
    expect(recovered.accountId).toBe(result.accountId);
    expect(recovered.adminUsername).toBe(result.adminUsername);
    expect(await applicationRecords()).toEqual(before);
    expect(await stmt('SELECT credential_generation, credential_state, must_change FROM accounts WHERE id = ?', result.accountId).first()).toEqual({
      credential_generation: 2, credential_state: 'ready', must_change: 1,
    });
    expect(await stmt('SELECT revoked FROM logins WHERE account_id = ?', result.accountId).first()).toEqual({ revoked: 1 });
    expect(await count('ba_session')).toBe(0);
    expect(await stmt("SELECT count(*) AS n FROM admin_audit WHERE action = 'trusted_owner_recovery' AND actor = ?", result.accountId).first()).toEqual({ n: 1 });
    expect(await count('command_assertions')).toBe(0);
  });

  it('keeps an interrupted recovery restricted and permits another trusted attempt', async () => {
    const result = await bootstrap();
    await seedOldLogin(result.accountId);
    await expectFailure(recoverInstallationOwner(db, result, { passwords: {
      ...fastPasswords, hash: async () => { throw new Error('interrupted hash'); },
    } })).toThrow('Owner recovery did not finish.');
    expect(await stmt('SELECT credential_state, must_change FROM accounts WHERE id = ?', result.accountId).first()).toEqual({ credential_state: 'pending', must_change: 1 });
    expect(await stmt('SELECT revoked FROM logins').first()).toEqual({ revoked: 1 });
    expect(await count('ba_session')).toBe(0);
    await recoverInstallationOwner(db, result, { passwords: fastPasswords });
    expect(await stmt('SELECT credential_state FROM accounts WHERE id = ?', result.accountId).first()).toEqual({ credential_state: 'ready' });
    expect(await stmt("SELECT count(*) AS n FROM account_operations WHERE state = 'superseded'").first()).toEqual({ n: 1 });
  });

  it('rolls back a failed credential completion while retaining the persisted restriction', async () => {
    const result = await bootstrap();
    let batches = 0;
    const failing: D1Connection = {
      prepare: (sql) => db.prepare(sql),
      batch: (statements) => {
        batches += 1;
        return db.batch(batches === 2 ? [...statements, stmt('INSERT INTO command_assertions (id, valid) VALUES (?, 0)', randomUUID())] : statements);
      },
    };
    await expectFailure(recoverInstallationOwner(failing, result, { passwords: {
      ...fastPasswords, hash: async () => 'replacement-fictional-hash',
    } })).toThrow('Owner recovery did not finish.');
    expect(await stmt('SELECT credential_state FROM accounts WHERE id = ?', result.accountId).first()).toEqual({ credential_state: 'pending' });
    expect((await stmt('SELECT password FROM ba_account WHERE userId = ?', result.accountId).first<{ password: string }>())?.password === 'fictional-test-hash').toBe(true);
    expect(await stmt("SELECT count(*) AS n FROM admin_audit WHERE action = 'trusted_owner_recovery'").first()).toEqual({ n: 0 });
    expect(await count('command_assertions')).toBe(0);
  });

  it('recovers again after losing a committed recovery response without changing application records', async () => {
    const result = await bootstrap();
    const before = await applicationRecords();
    let batches = 0;
    const lostResponse: D1Connection = {
      prepare: (sql) => db.prepare(sql),
      batch: async (statements) => {
        batches += 1;
        const committed = await db.batch(statements);
        if (batches === 2) throw new Error('lost response');
        return committed;
      },
    };
    await expectFailure(recoverInstallationOwner(lostResponse, result, { passwords: fastPasswords })).toThrow('Owner recovery did not finish.');
    expect(await stmt('SELECT credential_state, must_change FROM accounts WHERE id = ?', result.accountId).first()).toEqual({ credential_state: 'ready', must_change: 1 });
    await recoverInstallationOwner(db, result, { passwords: fastPasswords });
    expect(await applicationRecords()).toEqual(before);
    expect(await stmt('SELECT credential_generation FROM accounts WHERE id = ?', result.accountId).first()).toEqual({ credential_generation: 3 });
  });

  it('rejects a superseded recovery and retains the later password', async () => {
    const result = await bootstrap();
    let started: () => void = () => undefined;
    let release: () => void = () => undefined;
    const hashing = new Promise<void>((resolve) => { started = resolve; });
    const pause = new Promise<void>((resolve) => { release = resolve; });
    const first = recoverInstallationOwner(db, result, { passwords: { ...fastPasswords, hash: async () => {
      started(); await pause; return 'older-fictional-hash';
    } } });
    const firstRejected = first.then(() => false, () => true);
    await hashing;
    await recoverInstallationOwner(db, result, { passwords: { ...fastPasswords, hash: async () => 'later-fictional-hash' } });
    release();
    expect(await firstRejected).toBe(true);
    expect((await stmt('SELECT password FROM ba_account WHERE userId = ?', result.accountId).first<{ password: string }>())?.password === 'later-fictional-hash').toBe(true);
    expect(await stmt('SELECT credential_generation, credential_state FROM accounts WHERE id = ?', result.accountId).first()).toEqual({ credential_generation: 3, credential_state: 'ready' });
  });

  it('rechecks owner membership after hashing and cannot recover a different or disabled account', async () => {
    const result = await bootstrap();
    await expectFailure(recoverInstallationOwner(db, { installationId: result.installationId, accountId: randomUUID() }, { passwords: fastPasswords })).toThrow('not the active installation owner');
    await stmt('UPDATE accounts SET disabled = 1 WHERE id = ?', result.accountId).run();
    await expectFailure(recoverInstallationOwner(db, result, { passwords: fastPasswords })).toThrow('not the active installation owner');
    await stmt('UPDATE accounts SET disabled = 0 WHERE id = ?', result.accountId).run();
    await expectFailure(recoverInstallationOwner(db, result, { passwords: { ...fastPasswords, hash: async () => {
      await stmt('UPDATE memberships SET is_admin = 0 WHERE account_id = ?', result.accountId).run();
      return 'uncommitted-fictional-hash';
    } } })).toThrow('Owner recovery did not finish.');
    expect(await stmt('SELECT credential_state FROM accounts WHERE id = ?', result.accountId).first()).toEqual({ credential_state: 'pending' });
    expect((await stmt('SELECT password FROM ba_account WHERE userId = ?', result.accountId).first<{ password: string }>())?.password === 'fictional-test-hash').toBe(true);
  });
});
