import { z } from 'zod';
import type { AccountCommand, AccountResult, EventCode, Handle, LoginKey, SignInTarget } from '../../../backend/contracts';
import {
  AuthenticationError, signInRefused, type AuthenticationService, type AuthenticationSession,
} from '../../authentication';
import type { D1Connection, D1Statement, D1Value } from '../d1/connection';
import type { IdentityProvider } from './identity';
import {
  authorityCheck, loginAccountColumns, manageAccountBindings, manageAccountSql, reaches, resolveAuthority, signInAccountSql,
} from './authority';
import { beginCredentialReset, completeCredentialReset, handleSchema, loginKeyFor } from './credentials';
import { randomSecret, type PasswordHasher } from './password';

/**
 * Owner decision, 2026-10-25. Only failed sign-ins count. A successful sign-in
 * never counts toward any limit, so one venue IP can admit every user. The IP
 * ceiling is 20 times the username limit, so one person cannot cheaply exhaust it.
 */
export const signInFailureLimits = { windowSeconds: 900, perIp: 200, perUsername: 10 } as const;

const passwordSchema = z.string().min(12).max(128);
const memberSchema = z.object({
  teamId: z.string().uuid().nullable(),
  roles: z.array(z.enum(['volunteer', 'specialist', 'jury'])).max(3),
  isAdmin: z.boolean(),
});
const commandSchema = z.discriminatedUnion('action', [
  memberSchema.extend({ action: z.literal('create_account'), username: handleSchema, name: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal('reset_password'), userId: z.string().uuid() }).strict(),
]);

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
    const row = await this.statement(currentLoginSql, identity.identitySessionId, identity.accountId).first<Login>();
    if (!row) return undefined;
    return {
      caller: { accountId: row.id, loginId: row.login_id },
      user: { id: row.id, name: row.name },
      status: { handle: row.handle, must_change: !!row.must_change, session_valid: true },
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
      // know. This refusal does the same work, so its time does not show
      // whether the event code or the handle exists.
      await this.passwords.hash(password);
      throw new AuthenticationError(401, 'Username or password is incorrect.');
    }
    const signed = await this.identity.signIn(before.login_key, password);
    const loginId = crypto.randomUUID();
    const assertionId = crypto.randomUUID();
    // A reset can race Better Auth password verification. Only the generation
    // captured BEFORE verification can approve the resulting identity session.
    await this.guarded([
      this.assertion(assertionId, `SELECT 1 FROM accounts a JOIN ba_session b ON b.userId = a.id
        WHERE a.id = ? AND a.id = ? AND a.credential_generation = ?
          AND a.disabled = 0 AND a.credential_state = 'ready' AND b.id = ? AND b.expiresAt > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
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

  /**
   * The actor must manage the contest, and a target must hold a seat in it that
   * the actor may manage. The resolver's stamp and the target rule are checked
   * again inside each batch.
   */
  private async adminAssertions(current: AuthenticationSession, sessionId: string, target?: string): Promise<{
    current: AuthenticationSession; statements: D1Statement[]; assertionId: string; finalCheck: SqlCheck;
  }> {
    const refused = () => new AuthenticationError(403, 'Account changes require admin access to all assigned sessions. Archived accounts cannot be changed.');
    const authority = await resolveAuthority(this.db, current.caller, { scope: 'contest', contestId: sessionId });
    if (!authority || !reaches(authority, 'contest') || !authority.writable) throw refused();
    const managed: SqlCheck | undefined = target ? {
      sql: `${manageAccountSql} AND EXISTS (SELECT 1 FROM memberships WHERE session_id = ? AND account_id = t.id)`,
      values: [...manageAccountBindings(current.user.id, target), sessionId],
    } : undefined;
    if (managed && !(await this.statement(managed.sql, ...managed.values).first())) throw refused();
    const check = authorityCheck(authority);
    // Each condition stays at one query level, so the final check that nests
    // this one stays within D1's expression depth limit of 100.
    const finalCheck: SqlCheck = managed
      ? { sql: `${managed.sql} AND EXISTS (${check.sql})`, values: [...managed.values, ...check.values] }
      : check;
    const assertionId = crypto.randomUUID();
    return { current, assertionId, finalCheck, statements: [this.assertion(assertionId, finalCheck.sql, ...finalCheck.values)] };
  }

  private cleanupAssertions(id: string): D1Statement {
    return this.statement('DELETE FROM command_assertions WHERE id IN (?, ?, ?)', id, `${id}:admin`, `${id}:final`);
  }

  async account(headers: Headers, sessionId: string, input: AccountCommand): Promise<AccountResult> {
    const parsed = commandSchema.safeParse(input);
    if (!z.string().uuid().safeParse(sessionId).success || !parsed.success) throw new AuthenticationError(400, 'Invalid account request.');
    const command = parsed.data;
    const target = command.action === 'create_account' ? crypto.randomUUID() : command.userId;
    const current = await this.requireCurrent(headers);
    if (command.action === 'reset_password' && target === current.user.id) throw new AuthenticationError(400, 'Use Change password for your own account.');
    const gate = await this.adminAssertions(current, sessionId, command.action === 'create_account' ? undefined : target);
    const operationId = crypto.randomUUID();
    if (command.action === 'create_account') {
      if (command.teamId ? command.roles.length > 0 || command.isAdmin : command.roles.length === 0 && !command.isAdmin) {
        throw new AuthenticationError(400, 'Choose a contestant team or staff roles or admin membership.');
      }
      gate.statements.push(
        // The account takes the contest's event at once, so its handle never
        // passes through the site namespace inside the batch.
        this.statement(`INSERT INTO accounts (id, name, username, handle, event_id, must_change, credential_state, credential_operation)
          SELECT ?, ?, ?, ?, event_id, 1, 'pending', ? FROM sessions WHERE id = ?`,
        target, command.name, loginKeyFor(target), command.username, operationId, sessionId),
        this.statement('INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, ?, ?)', sessionId, target, command.teamId, Number(command.isAdmin)),
        ...[...new Set(command.roles)].map((role) => this.statement('INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, ?)', sessionId, target, role)),
      );
    } else {
      // Check before the reset begins, so that a refusal leaves the old password valid.
      const named = await this.statement('SELECT handle FROM accounts WHERE id = ?', target).first<{ handle: Handle | null }>();
      if (!named?.handle) throw new AuthenticationError(409, 'Set a username before resetting this account.');
      // Superseding a failed operation is safe: its final batch checks this ID.
      gate.statements.push(...beginCredentialReset(this.db, target, operationId));
    }
    gate.statements.push(
      this.statement(`INSERT INTO account_operations (id, account_id, actor, session_id, action, state) VALUES (?, ?, ?, ?, ?, 'pending')`, operationId, target, gate.current.user.id, sessionId, command.action),
      this.assertion(`${gate.assertionId}:final`, gate.finalCheck.sql, ...gate.finalCheck.values),
      this.cleanupAssertions(gate.assertionId),
    );
    await this.guarded(gate.statements);
    const password = randomSecret() + 'A9!';
    await this.completeCredentials(headers, target, operationId, password, true, sessionId);
    const event = await this.statement(`SELECT e.code FROM accounts a LEFT JOIN events e ON e.id = a.event_id
      WHERE a.id = ?`, target).first<{ code: EventCode | null }>();
    return { temporaryPassword: password, signIn: event?.code ? { kind: 'event', code: event.code } : { kind: 'site' } };
  }

  private async completeCredentials(headers: Headers, target: string, operationId: string, password: string, temporary: boolean, sessionId?: string, prepared?: { hash: string; statements: D1Statement[]; finalCheck: SqlCheck }): Promise<void> {
    // Hash outside the transaction. A failed hash leaves the persisted gate and
    // revoked sessions intact. An organizer can issue another reset.
    const hash = prepared?.hash ?? await this.passwords.hash(password);
    const account = await this.statement('SELECT * FROM accounts WHERE id = ?', target).first<Account>();
    if (!account) throw new AuthenticationError(409, 'Account changed. Check its status before retrying.');
    // An account from before usernames gets its login key with its first password.
    const loginKey = account.username ?? loginKeyFor(target);
    const assertions: D1Statement[] = prepared?.statements ?? [];
    let adminAssertion: string | undefined;
    let finalCheck = prepared?.finalCheck;
    if (sessionId) {
      const gate = await this.adminAssertions(await this.requireCurrent(headers), sessionId, target);
      assertions.push(...gate.statements);
      adminAssertion = gate.assertionId;
      finalCheck = gate.finalCheck;
    }
    if (!finalCheck) throw new AuthenticationError(409, 'Account changed. Check its status before retrying.');
    const assertionId = crypto.randomUUID();
    const generation = account.credential_generation + (prepared ? 1 : 0);
    assertions.push(
      this.assertion(assertionId, `SELECT 1 FROM accounts WHERE id = ? AND credential_operation = ?
        AND credential_generation = ? AND credential_state = 'pending' AND disabled = 0`, target, operationId, generation),
      ...(account.username ? [] : [this.statement('UPDATE accounts SET username = ? WHERE id = ? AND username IS NULL', loginKey, target)]),
      ...completeCredentialReset(this.db, { id: target, name: account.name, loginKey }, operationId, hash, temporary),
      this.statement('DELETE FROM command_assertions WHERE id = ?', assertionId),
    );
    if (adminAssertion) assertions.push(this.cleanupAssertions(adminAssertion));
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
    await this.completeCredentials(headers, current.user.id, operationId, newPassword, false, undefined, { hash, finalCheck: {
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
