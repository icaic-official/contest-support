import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { D1Connection, D1Statement } from '../d1/connection';
import { applyMigrations } from '../d1/testFixture';
import { recoverCloudflareAdmin, writeTemporaryPassword, type AdminRecoveryResult } from './adminRecovery';
import { D1AuthenticationService } from './authentication';
import { createBetterAuthIdentity } from './identity';
import { bootstrapInstallation } from './installation';
import { passwordHasher, randomSecret, type PasswordHasher } from './password';

const competition = {
  adminUsername: 'organizer',
  adminName: 'Competition organizer',
  eventName: 'Development event',
  sessionName: 'Morning session',
  categories: ['Devices'],
  teams: [{ name: 'Hall team', location: 'Hall A' }],
};

const fastPasswords: PasswordHasher = {
  hash: async () => 'fictional-test-hash',
  verify: async () => false,
};

function expectFailure(operation: Promise<unknown>) {
  return expect(operation.then(() => undefined)).rejects;
}

function passwordAppearsOnce(lines: string[], password: string): boolean {
  return lines.filter((line) => line === password).length === 1
    && lines.every((line) => line === password || !line.includes(password));
}

describe('Cloudflare admin password recovery', () => {
  let db: D1Connection;
  let dispose: (() => Promise<void>) | undefined;

  beforeEach(async () => {
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

  async function count(table: string): Promise<number> {
    const row = await db.prepare(`SELECT count(*) AS n FROM "${table}"`).first<{ n: number }>();
    return row!.n;
  }

  function bootstrap(passwords: PasswordHasher = fastPasswords) {
    return bootstrapInstallation(db, competition, { passwords });
  }

  async function seedLogin(accountId: string): Promise<void> {
    const identitySessionId = randomUUID();
    await db.batch([
      stmt(`INSERT INTO ba_session (id, expiresAt, token, createdAt, updatedAt, userId)
        VALUES (?, '2099-01-01T00:00:00.000Z', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)`,
      identitySessionId, randomSecret(), accountId),
      stmt(`INSERT INTO logins (id, account_id, expires_at, identity_session_id, csrf)
        VALUES (?, ?, unixepoch() + 3600, ?, ?)`, randomUUID(), accountId, identitySessionId, randomSecret()),
    ]);
  }

  async function operationCount(accountId: string): Promise<number> {
    const row = await stmt('SELECT count(*) AS n FROM account_operations WHERE account_id = ?', accountId).first<{ n: number }>();
    return row!.n;
  }

  it('prints a replacement password once and the old password stops signing in', async () => {
    const installed = await bootstrap(passwordHasher);
    await seedLogin(installed.accountId);
    const identity = createBetterAuthIdentity(db as Parameters<typeof createBetterAuthIdentity>[0], {
      origin: 'http://127.0.0.1:8788', secret: randomSecret(), secureCookies: false,
    });
    const authentication = new D1AuthenticationService(db, identity, passwordHasher);
    const first = await authentication.signIn(installed.adminUsername, installed.temporaryPassword);
    const oldHeaders = new Headers({ cookie: first.cookie.split(';')[0] });
    expect((await authentication.current(oldHeaders))?.user.id).toBe(installed.accountId);
    const before = await stmt('SELECT access_version FROM accounts WHERE id = ?', installed.accountId).first<{ access_version: number }>();
    const lines: string[] = [];
    const consoleLines: string[] = [];
    const methods = ['log', 'info', 'debug', 'warn', 'error'] as const;
    const originals = new Map(methods.map((method) => [method, console[method]]));
    for (const method of methods) {
      console[method] = (...args: unknown[]) => { consoleLines.push(args.map((value) => String(value)).join(' ')); };
    }
    let recovered: AdminRecoveryResult | undefined;
    try {
      recovered = await recoverCloudflareAdmin(db, { username: 'ORGANIZER' });
      writeTemporaryPassword(recovered, (line) => lines.push(line));
    } finally {
      for (const method of methods) console[method] = originals.get(method)!;
    }
    const password = recovered!.temporaryPassword;
    expect(passwordAppearsOnce(lines, password)).toBe(true);
    expect(consoleLines.some((line) => line.includes(password))).toBe(false);
    expect(await authentication.current(oldHeaders)).toBeUndefined();
    expect(await count('ba_session')).toBe(0);
    expect(await stmt('SELECT count(*) AS n FROM logins WHERE account_id = ? AND revoked = 0', installed.accountId).first()).toEqual({ n: 0 });
    await expectFailure(authentication.signIn(installed.adminUsername, installed.temporaryPassword)).toMatchObject({ status: 401 });
    const next = await authentication.signIn(installed.adminUsername, password);
    const headers = new Headers({ cookie: next.cookie.split(';')[0] });
    expect((await authentication.current(headers))?.status.must_change).toBe(true);
    expect(await stmt('SELECT credential_generation, credential_state, must_change FROM accounts WHERE id = ?', installed.accountId).first()).toEqual({
      credential_generation: 2, credential_state: 'ready', must_change: 1,
    });
    const after = await stmt('SELECT access_version FROM accounts WHERE id = ?', installed.accountId).first<{ access_version: number }>();
    expect(after!.access_version).toBeGreaterThan(before!.access_version);
    // created_at stores unixepoch() seconds. Bootstrap and recovery can share one second.
    // rowid selects the later insert when those timestamps tie.
    expect(await stmt(`SELECT action, state, actor, session_id FROM account_operations
      WHERE account_id = ? AND state = 'completed' ORDER BY created_at DESC, rowid DESC LIMIT 1`, installed.accountId).first()).toEqual({
      action: 'reset_password', state: 'completed', actor: installed.accountId, session_id: installed.sessionId,
    });
    expect(await count('command_assertions')).toBe(0);
  }, 180_000);

  it('recovers an admin who is not the installation owner and an owner who is no longer an admin', async () => {
    const installed = await bootstrap();
    const adminId = randomUUID();
    await db.batch([
      stmt(`INSERT INTO accounts (id, name, username, must_change) VALUES (?, 'Duty admin', 'duty_admin', 0)`, adminId),
      stmt('INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, 1)', installed.sessionId, adminId),
      stmt(`INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
        VALUES (?, 'Duty admin', 'duty_admin@accounts.minsky.invalid', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'duty_admin')`, adminId),
    ]);
    await seedLogin(adminId);
    const lines: string[] = [];
    const recovered = await recoverCloudflareAdmin(db, { userId: adminId }, { passwords: fastPasswords });
    writeTemporaryPassword(recovered, (line) => lines.push(line));
    expect(passwordAppearsOnce(lines, recovered.temporaryPassword)).toBe(true);
    expect(recovered.accountId).toBe(adminId);
    expect(recovered.username).toBe('duty_admin');
    expect(await count('ba_session')).toBe(0);
    expect((await stmt('SELECT password FROM ba_account WHERE userId = ?', adminId).first<{ password: string }>())?.password).toBe('fictional-test-hash');
    expect((await stmt('SELECT must_change, credential_generation FROM accounts WHERE id = ?', adminId).first())).toEqual({
      must_change: 1, credential_generation: 2,
    });
    await stmt('UPDATE memberships SET is_admin = 0 WHERE account_id = ?', installed.accountId).run();
    const owner = await recoverCloudflareAdmin(db, { username: installed.adminUsername }, { passwords: fastPasswords });
    expect(owner.accountId).toBe(installed.accountId);
    expect(await operationCount(installed.accountId)).toBe(2);
  });

  it('refuses a non-admin, a disabled admin, an archived-only admin, and an unknown account before hashing', async () => {
    const installed = await bootstrap();
    const contestantId = randomUUID();
    const archivedId = randomUUID();
    const archivedEvent = randomUUID();
    const archivedSession = randomUUID();
    await db.batch([
      stmt(`INSERT INTO accounts (id, name, username, must_change) VALUES (?, 'Contestant', 'contestant', 0)`, contestantId),
      stmt('INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, ?, 0)', installed.sessionId, contestantId, installed.teamIds[0]),
      stmt('INSERT INTO events (id, archived) VALUES (?, 1)', archivedEvent),
      stmt('INSERT INTO sessions (id, event_id) VALUES (?, ?)', archivedSession, archivedEvent),
      stmt(`INSERT INTO accounts (id, name, username, must_change) VALUES (?, 'Former admin', 'former_admin', 0)`, archivedId),
      stmt('INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, 1)', archivedSession, archivedId),
    ]);
    let hashes = 0;
    const passwords: PasswordHasher = {
      hash: async () => { hashes += 1; return 'uncommitted-hash'; },
      verify: async () => false,
    };
    await expect(recoverCloudflareAdmin(db, { username: 'contestant' }, { passwords })).rejects.toThrow('not an admin of an active event');
    await expect(recoverCloudflareAdmin(db, { username: 'former_admin' }, { passwords })).rejects.toThrow('not an admin of an active event');
    await expect(recoverCloudflareAdmin(db, { username: 'missing_admin' }, { passwords })).rejects.toThrow('No account matches that username');
    await expect(recoverCloudflareAdmin(db, { userId: randomUUID() }, { passwords })).rejects.toThrow('No account matches that account ID');
    await stmt('UPDATE accounts SET disabled = 1 WHERE id = ?', installed.accountId).run();
    await expect(recoverCloudflareAdmin(db, { userId: installed.accountId }, { passwords })).rejects.toThrow('disabled');
    expect(hashes).toBe(0);
    expect(await operationCount(contestantId)).toBe(0);
    expect(await operationCount(archivedId)).toBe(0);
    expect(await stmt('SELECT credential_generation, must_change FROM accounts WHERE id = ?', installed.accountId).first()).toEqual({
      credential_generation: 1, must_change: 1,
    });
  });

  it('leaves the previous password in place when the batch fails', async () => {
    const installed = await bootstrap();
    const failing: D1Connection = {
      prepare: (sql) => db.prepare(sql),
      batch: () => Promise.reject(new Error('private SQL and password detail')),
    };
    await expect(recoverCloudflareAdmin(failing, { username: installed.adminUsername }, {
      passwords: { hash: async () => 'replacement-hash', verify: async () => false },
    })).rejects.toThrow('The account was not changed.');
    expect((await stmt('SELECT password FROM ba_account WHERE userId = ?', installed.accountId).first<{ password: string }>())?.password).toBe('fictional-test-hash');
    expect(await stmt('SELECT credential_state, credential_generation FROM accounts WHERE id = ?', installed.accountId).first()).toEqual({
      credential_state: 'ready', credential_generation: 1,
    });
    expect(await count('account_operations')).toBe(1);
  });

  it('does not print a rejected password', () => {
    expect(() => writeTemporaryPassword({ username: 'organizer', temporaryPassword: 'short' }, () => undefined)).toThrow('was not changed');
    const lines: string[] = [];
    writeTemporaryPassword({ username: 'organizer', temporaryPassword: 'fixture-temporary-password' }, (line) => lines.push(line));
    expect(passwordAppearsOnce(lines, 'fixture-temporary-password')).toBe(true);
    expect(lines[0].includes('fixture-temporary-password')).toBe(false);
  });
});
