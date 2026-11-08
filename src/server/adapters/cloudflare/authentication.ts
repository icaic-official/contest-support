import { z } from 'zod';
import type { Handle, LoginKey, SignInTarget } from '../../../backend/contracts';
import {
  AuthenticationError, signInRefused, type AuthenticationService, type AuthenticationSession,
} from '../../authentication';
import type { D1Connection, D1Statement, D1Value } from '../d1/connection';
import type { IdentityProvider } from './identity';
import {
  loginAccountColumns, notBeingDeletedSql, ownHandleSql, signInAccountSql,
} from './authority';
import { beginCredentialReset, completeCredentialReset, loginKeyFor } from './credentials';
import { randomSecret, type PasswordHasher } from './password';

/**
 * Owner decision, 2026-10-25. Only failed sign-ins count. A successful sign-in
 * never counts toward any limit, so one venue IP can admit every user. The IP
 * ceiling is 20 times the username limit, so one person cannot cheaply exhaust it.
 */
export const signInFailureLimits = { windowSeconds: 900, perIp: 200, perUsername: 10 } as const;

const passwordSchema = z.string().min(12).max(128);

interface Account {
  id: string;
  name: string;
  /** The login key. Only Better Auth reads it. */
  username: LoginKey | null;
  handle: Handle | null;
  must_change: number;
  disabled: number;
  credential_generation: number;
  credential_state: string;
  credential_operation: string | null;
}

interface Login extends Account {
  login_id: string;
  csrf: string;
  login_expires_at: number;
  identity_expires_at: string;
}

interface SqlCheck {
  sql: string;
  values: D1Value[];
}

/**
 * The account that a sign-in names, read once before the password check
 * (`loginAccountColumns`). Each column is null when no account matches.
 */
interface LoginAccount {
  account_id: string | null;
  login_key: LoginKey | null;
  disabled: number | null;
  credential_state: string | null;
  credential_generation: number | null;
}

/** `event_id` is set for an event code that exists. */
interface SignInRow extends LoginAccount {
  event_id: string | null;
}

/** The failure counter of one handle. The same handle in two events has two counters. */
function signInLimitKey(scope: string, handle: Handle): string {
  return `handle:${scope}:${handle}`;
}

// This query is also evaluated inside each privileged batch. No browser claim
// or earlier permission read grants access to a later credential mutation.
const currentLoginSql = `SELECT a.*, l.id AS login_id, l.csrf,
    l.expires_at AS login_expires_at, b.expiresAt AS identity_expires_at
  FROM accounts a JOIN logins l ON l.account_id = a.id
  JOIN ba_session b ON b.id = l.identity_session_id AND b.userId = a.id
  WHERE b.id = ? AND a.id = ? AND a.disabled = 0
    AND b.expiresAt > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AND l.revoked = 0
    AND l.expires_at > unixepoch() AND l.credential_generation = a.credential_generation
    AND a.credential_state = 'ready'`;

/** The signed-in account's status, with whether it may change its own handle. Binds identitySessionId, accountId. */
export const currentAccountSql = `SELECT t.*, (${ownHandleSql}) AS own_handle FROM (${currentLoginSql}) t`;

/** Better Auth owns authentication. This adapter owns Minsky access and atomic credentials. */
export class D1AuthenticationService implements AuthenticationService {
  constructor(
    private readonly db: D1Connection,
    private readonly identity: IdentityProvider,
    private readonly passwords: PasswordHasher,
  ) {}

  private statement(sql: string, ...values: D1Value[]): D1Statement {
    return this.db.prepare(sql).bind(...values);
  }

  private async guarded(statements: D1Statement[]): Promise<void> {
    try {
      await this.db.batch(statements);
    } catch (error) {
      // Do not expose SQL, password hashes, or provider error text.
      const message = error instanceof Error ? error.message : '';
      if (message.includes('UNIQUE constraint failed: accounts.event_id, accounts.handle')) {
        throw new AuthenticationError(409, 'That username is taken in this event. Choose another.');
      }
      const rollback = /(?:CHECK|UNIQUE|FOREIGN KEY|NOT NULL) constraint failed/.test(message);
      throw new AuthenticationError(409, rollback
        ? 'Account changed. Check its status before retrying.'
        : 'The account request outcome is unknown. Check its status before retrying.');
    }
  }

  private assertion(id: string, sql: string, ...values: D1Value[]): D1Statement {
    return this.statement(`INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN EXISTS (${sql}) THEN 1 ELSE 0 END)`, id, ...values);
  }

  async current(headers: Headers): Promise<AuthenticationSession | undefined> {
    const identity = await this.identity.session(headers);
    if (!identity) return undefined;
    const row = await this.statement(currentAccountSql,
      identity.identitySessionId, identity.accountId).first<Login & { own_handle: number }>();
    if (!row) return undefined;
    return {
      caller: { accountId: row.id, loginId: row.login_id },
      user: { id: row.id, name: row.name },
      status: { handle: row.handle, must_change: !!row.must_change, session_valid: true, can_change_handle: !!row.own_handle },
      csrf: row.csrf,
    };
  }

  private async requireCurrent(headers: Headers, ready = true): Promise<AuthenticationSession> {
    const current = await this.current(headers);
    if (!current) throw new AuthenticationError(401, 'Sign in again.');
    if (ready && current.status.must_change) throw new AuthenticationError(403, 'Change your temporary password first.');
    return current;
  }

  async signIn(target: SignInTarget, handle: Handle, password: string): Promise<{ cookie: string }> {
    if (typeof password !== 'string' || password.length > 128 || password.length < 1) throw signInRefused(target.kind);
    const row = await this.statement(signInAccountSql[target.kind],
      ...(target.kind === 'event' ? [handle, target.code] : [handle])).first<SignInRow>();
    // An unknown event code counts against the typed code. Its refusals then
    // reach the limit as a known code's do, so the limit never shows which
    // codes exist.
    const scope = row?.event_id ?? (target.kind === 'event' ? `code:${target.code}` : 'site');
    // Refuse before the expensive password check when the handle already has
    // its maximum failures. Only a failure adds to the count, so a correct
    // password never uses an attempt. The HTTP Worker adds the IP limit.
    const key = signInLimitKey(scope, handle);
    await this.assertBelowLimit(key, signInFailureLimits.perUsername);
    try {
      return await this.createLogin(row, password);
    } catch (error) {
      if (!(error instanceof AuthenticationError) || error.status !== 401) throw error;
      await this.recordFailure(key);
      throw signInRefused(target.kind);
    }
  }

  private async createLogin(before: LoginAccount | null, password: string): Promise<{ cookie: string }> {
    // Better Auth looks up the text that it receives as a login key, and a
    // legacy login key in another event can equal a typed handle. So an
    // unknown handle never reaches it.
    if (!before?.login_key || before.disabled || before.credential_state !== 'ready') {
      // Better Auth hashes the password for a login key that it does not
      // know. This refusal does the same, so an unknown code, an unknown
      // handle, and a wrong password each cost one password hash or check.
      await this.passwords.hash(password);
      throw new AuthenticationError(401, 'Username or password is incorrect.');
    }
    const signed = await this.identity.signIn(before.login_key, password);
    const loginId = crypto.randomUUID();
    const assertionId = crypto.randomUUID();
    // A reset can race Better Auth password verification. Only the generation
    // captured BEFORE verification can approve the resulting identity session.
    // The fence of a deletion can also commit during verification. It revokes
    // only the logins that exist, so this batch checks it again.
    await this.guarded([
      this.assertion(assertionId, `SELECT 1 FROM accounts a JOIN ba_session b ON b.userId = a.id
        WHERE a.id = ? AND a.id = ? AND a.credential_generation = ?
          AND a.disabled = 0 AND a.credential_state = 'ready' AND b.id = ? AND b.expiresAt > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          AND ${notBeingDeletedSql('a.event_id')}`,
      signed.accountId, before.account_id, before.credential_generation, signed.identitySessionId),
      this.statement(`INSERT INTO logins (id, account_id, expires_at, identity_session_id, credential_generation, csrf)
        SELECT ?, a.id, unixepoch(b.expiresAt), b.id, a.credential_generation, ?
        FROM accounts a JOIN ba_session b ON b.userId = a.id WHERE a.id = ? AND b.id = ?`,
      loginId, randomSecret(), signed.accountId, signed.identitySessionId),
      this.assertion(`${assertionId}:final`, `SELECT 1 FROM (${currentLoginSql}) WHERE login_id = ? AND credential_generation = ?`,
        signed.identitySessionId, signed.accountId, loginId, before.credential_generation),
      this.cleanupAssertions(assertionId),
    ]);
    return { cookie: signed.cookie };
  }

  /** Counts one attempt in the key's fixed window, then refuses when the count passes the maximum. */
  async limit(key: string, maximum: number): Promise<void> {
    if ((await this.recordFailure(key)) > maximum) throw new AuthenticationError(429, 'Too many attempts. Try again later.');
  }

  /** Refuses when the current window already holds the maximum. It does not count. */
  async assertBelowLimit(key: string, maximum: number): Promise<void> {
    const row = await this.statement(
      'SELECT attempts FROM authentication_limits WHERE key = ? AND window_start > unixepoch() - ?',
      key, signInFailureLimits.windowSeconds).first<{ attempts: number }>();
    if (row && row.attempts >= maximum) throw new AuthenticationError(429, 'Too many attempts. Try again later.');
  }

  /** Adds one to the key's fixed window and returns the new count. */
  async recordFailure(key: string): Promise<number> {
    const window = signInFailureLimits.windowSeconds;
    const row = await this.statement(`INSERT INTO authentication_limits (key, window_start, attempts)
      VALUES (?, unixepoch(), 1) ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN window_start <= unixepoch() - ? THEN 1 ELSE attempts + 1 END,
      window_start = CASE WHEN window_start <= unixepoch() - ? THEN unixepoch() ELSE window_start END
      RETURNING attempts`, key, window, window).first<{ attempts: number }>();
    if (!row) throw new AuthenticationError(429, 'Too many attempts. Try again later.');
    return row.attempts;
  }

  async signOut(headers: Headers): Promise<{ cookie: string }> {
    const identity = await this.identity.session(headers);
    if (identity) {
      await this.statement('UPDATE logins SET revoked = 1 WHERE identity_session_id = ? AND account_id = ?',
        identity.identitySessionId, identity.accountId).run();
    }
    return { cookie: await this.identity.signOut(headers) };
  }

  private cleanupAssertions(id: string): D1Statement {
    return this.statement('DELETE FROM command_assertions WHERE id IN (?, ?, ?)', id, `${id}:admin`, `${id}:final`);
  }

  /** Completes the account's own password change. Organizers issue other passwords through D1ManageService. */
  private async completeCredentials(target: string, operationId: string, temporary: boolean, prepared: { hash: string; statements: D1Statement[]; finalCheck: SqlCheck }): Promise<void> {
    const { hash } = prepared;
    const account = await this.statement('SELECT * FROM accounts WHERE id = ?', target).first<Account>();
    if (!account) throw new AuthenticationError(409, 'Account changed. Check its status before retrying.');
    // An account from before usernames gets its login key with its first password.
    const loginKey = account.username ?? loginKeyFor(target);
    const assertions: D1Statement[] = prepared.statements;
    const { finalCheck } = prepared;
    const assertionId = crypto.randomUUID();
    const generation = account.credential_generation + 1;
    assertions.push(
      this.assertion(assertionId, `SELECT 1 FROM accounts WHERE id = ? AND credential_operation = ?
        AND credential_generation = ? AND credential_state = 'pending' AND disabled = 0`, target, operationId, generation),
      ...(account.username ? [] : [this.statement('UPDATE accounts SET username = ? WHERE id = ? AND username IS NULL', loginKey, target)]),
      ...completeCredentialReset(this.db, { id: target, name: account.name, loginKey }, operationId, hash, temporary),
      this.statement('DELETE FROM command_assertions WHERE id = ?', assertionId),
    );
    assertions.push(
      this.assertion(`${assertionId}:final`, `SELECT 1 FROM accounts a JOIN account_operations o ON o.account_id = a.id
        WHERE a.id = ? AND a.credential_generation = ? AND a.credential_state = 'ready'
          AND a.credential_operation IS NULL AND a.disabled = 0 AND a.must_change = ?
          AND o.id = ? AND o.state = 'completed' AND EXISTS (${finalCheck.sql})`,
      target, generation, Number(temporary), operationId, ...finalCheck.values),
      this.cleanupAssertions(assertionId),
    );
    await this.guarded(assertions);
  }

  async changePassword(headers: Headers, currentPassword: string, newPassword: string): Promise<{ cookie: string }> {
    const current = await this.requireCurrent(headers, false);
    if (!passwordSchema.safeParse(newPassword).success || typeof currentPassword !== 'string' || currentPassword.length > 128 ||
        newPassword.normalize('NFKC') === currentPassword.normalize('NFKC')) {
      throw new AuthenticationError(400, 'Use a different password with 12 to 128 characters.');
    }
    await this.limit(`change:${current.user.id}`, 10);
    const identity = await this.identity.session(headers);
    if (!identity) throw new AuthenticationError(401, 'Sign in again.');
    const before = await this.statement(`SELECT l.*, c.password FROM (${currentLoginSql}) l
      JOIN ba_account c ON c.userId = l.id AND c.providerId = 'credential' WHERE l.login_id = ?`,
    identity.identitySessionId, identity.accountId, current.caller.loginId).first<Login & { password: string }>();
    if (!before || !(await this.passwords.verify(currentPassword, before.password))) throw new AuthenticationError(400, 'Current password is incorrect.');
    const { username } = before;
    if (!username) throw new AuthenticationError(409, 'Set a username before changing this password.');
    const operationId = crypto.randomUUID();
    const assertionId = crypto.randomUUID();
    // Self changes have no external identity update. Hash before the atomic
    // batch so a lone organizer can retry a failed change with the old login.
    const hash = await this.passwords.hash(newPassword);
    await this.completeCredentials(current.user.id, operationId, false, { hash, finalCheck: {
      // The change deliberately deletes the old identity session and revokes its
      // login. Retain both original deadlines and verify the old login's exact
      // generation while the final completion check verifies its replacement.
      sql: `SELECT 1 FROM logins WHERE id = ? AND account_id = ? AND identity_session_id = ?
        AND credential_generation = ? AND revoked = 1 AND expires_at > unixepoch()
        AND ? > unixepoch() AND ? > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      values: [current.caller.loginId, current.user.id, identity.identitySessionId,
        before.credential_generation, before.login_expires_at, before.identity_expires_at],
    }, statements: [
      this.assertion(assertionId, `SELECT 1 FROM (${currentLoginSql}) WHERE login_id = ? AND credential_generation = ?`, identity.identitySessionId, identity.accountId, current.caller.loginId, before.credential_generation),
      ...beginCredentialReset(this.db, current.user.id, operationId),
      this.statement(`INSERT INTO account_operations (id, account_id, actor, action, state) VALUES (?, ?, ?, 'change_password', 'pending')`, operationId, current.user.id, current.user.id),
      this.statement('DELETE FROM command_assertions WHERE id = ?', assertionId),
    ] });
    // The authenticated change uses its own attempt limit. Replacing the login
    // must also succeed when the public username window is already exhausted.
    return this.createLogin(await this.statement(`SELECT ${loginAccountColumns} FROM accounts a WHERE a.id = ?`,
      current.user.id).first<LoginAccount>(), newPassword);
  }

}
