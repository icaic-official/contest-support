import { z } from 'zod';
import type { AccountCommand, AccountResult, SessionSummary } from '../../../backend/contracts';
import { AuthenticationError, type AuthenticationService, type AuthenticationSession } from '../../authentication';
import type { D1Connection, D1Statement } from '../d1/connection';
import type { IdentityProvider } from './identity';
import { randomSecret, type PasswordHasher } from './password';

const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{2,31}$/);
const passwordSchema = z.string().min(12).max(128);
const memberSchema = z.object({
  teamId: z.string().uuid().nullable(),
  roles: z.array(z.enum(['volunteer', 'specialist', 'jury'])).max(3),
  isAdmin: z.boolean(),
});
const commandSchema = z.discriminatedUnion('action', [
  memberSchema.extend({ action: z.literal('create_account'), username: usernameSchema, name: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal('set_username'), userId: z.string().uuid(), username: usernameSchema }).strict(),
  z.object({ action: z.literal('reset_password'), userId: z.string().uuid() }).strict(),
]);

interface Account {
  id: string;
  name: string;
  username: string | null;
  must_change: number;
  disabled: number;
  credential_generation: number;
  credential_state: string;
  credential_operation: string | null;
}

interface Login extends Account {
  login_id: string;
  csrf: string;
}

// This query is also evaluated inside each privileged batch. No browser claim
// or earlier permission read grants access to a later credential mutation.
const currentLoginSql = `SELECT a.*, l.id AS login_id, l.csrf
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

  private statement(sql: string, ...values: Array<string | number | null>): D1Statement {
    return this.db.prepare(sql).bind(...values);
  }

  private async guarded(statements: D1Statement[]): Promise<void> {
    try {
      await this.db.batch(statements);
    } catch (error) {
      // Do not expose SQL, password hashes, or provider error text.
      const rollback = error instanceof Error && /(?:CHECK|UNIQUE|FOREIGN KEY|NOT NULL) constraint failed/.test(error.message);
      throw new AuthenticationError(409, rollback
        ? 'Account changed. Check its status before retrying.'
        : 'The account request outcome is unknown. Check its status before retrying.');
    }
  }

  private assertion(id: string, sql: string, ...values: Array<string | number | null>): D1Statement {
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
      status: { username: row.username, must_change: !!row.must_change, session_valid: true },
      csrf: row.csrf,
    };
  }

  private async requireCurrent(headers: Headers, ready = true): Promise<AuthenticationSession> {
    const current = await this.current(headers);
    if (!current) throw new AuthenticationError(401, 'Sign in again.');
    if (ready && current.status.must_change) throw new AuthenticationError(403, 'Change your temporary password first.');
    return current;
  }

  async signIn(username: string, password: string): Promise<{ cookie: string }> {
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success || typeof password !== 'string' || password.length > 128 || password.length < 1) {
      throw new AuthenticationError(401, 'Username or password is incorrect.');
    }
    // Fixed windows bound expensive password verification, including nonexistent
    // usernames. The HTTP Worker adds an IP limit before reaching this method.
    await this.limit(`username:${parsed.data}`, 10);
    return this.createLogin(parsed.data, password);
  }

  private async createLogin(username: string, password: string): Promise<{ cookie: string }> {
    const before = await this.statement('SELECT * FROM accounts WHERE username = ?', username).first<Account>();
    if (before && (before.disabled || before.credential_state !== 'ready')) {
      throw new AuthenticationError(401, 'Username or password is incorrect.');
    }
    const signed = await this.identity.signIn(username, password);
    const loginId = crypto.randomUUID();
    const assertionId = crypto.randomUUID();
    // A reset can race Better Auth password verification. Only the generation
    // captured BEFORE verification can approve the resulting identity session.
    await this.guarded([
      this.assertion(assertionId, `SELECT 1 FROM accounts a JOIN ba_session b ON b.userId = a.id
        WHERE a.id = ? AND a.id = ? AND a.credential_generation = ?
          AND a.disabled = 0 AND a.credential_state = 'ready' AND b.id = ? AND b.expiresAt > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      signed.accountId, before?.id ?? '', before?.credential_generation ?? -1, signed.identitySessionId),
      this.statement(`INSERT INTO logins (id, account_id, expires_at, identity_session_id, credential_generation, csrf)
        SELECT ?, a.id, unixepoch(b.expiresAt), b.id, a.credential_generation, ?
        FROM accounts a JOIN ba_session b ON b.userId = a.id WHERE a.id = ? AND b.id = ?`,
      loginId, randomSecret(), signed.accountId, signed.identitySessionId),
      this.statement('DELETE FROM command_assertions WHERE id = ?', assertionId),
    ]);
    return { cookie: signed.cookie };
  }

  async limit(key: string, maximum: number): Promise<void> {
    const row = await this.statement(`INSERT INTO authentication_limits (key, window_start, attempts)
      VALUES (?, unixepoch(), 1) ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN window_start <= unixepoch() - 900 THEN 1 ELSE attempts + 1 END,
      window_start = CASE WHEN window_start <= unixepoch() - 900 THEN unixepoch() ELSE window_start END
      RETURNING attempts`, key).first<{ attempts: number }>();
    if (!row || row.attempts > maximum) throw new AuthenticationError(429, 'Too many attempts. Try again later.');
  }

  async signOut(headers: Headers): Promise<{ cookie: string }> {
    const identity = await this.identity.session(headers);
    if (identity) {
      await this.statement('UPDATE logins SET revoked = 1 WHERE identity_session_id = ? AND account_id = ?',
        identity.identitySessionId, identity.accountId).run();
    }
    return { cookie: await this.identity.signOut(headers) };
  }

  private adminCondition(sessionId: string, actor: string, target?: string): [string, Array<string | number | null>] {
    let sql = `SELECT 1 FROM memberships m JOIN sessions s ON s.id = m.session_id
      JOIN events e ON e.id = s.event_id
      WHERE m.account_id = ? AND m.session_id = ? AND m.is_admin = 1 AND e.archived = 0`;
    const values: Array<string | number | null> = [actor, sessionId];
    if (target) {
      sql += ` AND EXISTS (SELECT 1 FROM memberships WHERE session_id = m.session_id AND account_id = ?)
        AND NOT EXISTS (SELECT 1 FROM memberships t JOIN sessions ts ON ts.id = t.session_id
          JOIN events te ON te.id = ts.event_id
          WHERE t.account_id = ? AND (te.archived = 1 OR NOT EXISTS
            (SELECT 1 FROM memberships am WHERE am.session_id = t.session_id AND am.account_id = ? AND am.is_admin = 1)))`;
      values.push(target, target, actor);
    }
    return [sql, values];
  }

  private async adminAssertions(headers: Headers, sessionId: string, target?: string): Promise<{
    current: AuthenticationSession; statements: D1Statement[]; assertionId: string;
  }> {
    const current = await this.requireCurrent(headers);
    const identity = await this.identity.session(headers);
    if (!identity) throw new AuthenticationError(401, 'Sign in again.');
    const [sql, values] = this.adminCondition(sessionId, current.user.id, target);
    if (!(await this.statement(sql, ...values).first())) throw new AuthenticationError(403, 'Account changes require admin access to all assigned sessions. Archived accounts cannot be changed.');
    const assertionId = crypto.randomUUID();
    return { current, assertionId, statements: [
      this.assertion(assertionId, `SELECT 1 FROM (${currentLoginSql}) WHERE must_change = 0`, identity.identitySessionId, identity.accountId),
      this.assertion(`${assertionId}:admin`, sql, ...values),
    ] };
  }

  private cleanupAssertions(id: string): D1Statement {
    return this.statement('DELETE FROM command_assertions WHERE id = ? OR id = ?', id, `${id}:admin`);
  }

  async account(headers: Headers, sessionId: string, input: AccountCommand): Promise<AccountResult> {
    const parsed = commandSchema.safeParse(input);
    if (!z.string().uuid().safeParse(sessionId).success || !parsed.success) throw new AuthenticationError(400, 'Invalid account request.');
    const command = parsed.data;
    const target = command.action === 'create_account' ? crypto.randomUUID() : command.userId;
    const gate = await this.adminAssertions(headers, sessionId, command.action === 'create_account' ? undefined : target);
    if (command.action === 'reset_password' && target === gate.current.user.id) throw new AuthenticationError(400, 'Use Change password for your own account.');
    const operationId = crypto.randomUUID();
    if (command.action === 'set_username') {
      await this.guarded([
        ...gate.statements,
        this.assertion(`${operationId}:username`, 'SELECT 1 FROM accounts WHERE id = ? AND (username IS NULL OR username = ?)', target, command.username),
        this.statement('UPDATE accounts SET username = ? WHERE id = ?', command.username, target),
        this.statement(`UPDATE ba_user SET username = ?, email = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`, command.username, `${command.username}@accounts.minsky.invalid`, target),
        this.statement(`INSERT INTO account_operations (id, account_id, actor, session_id, action, state, completed_at)
          VALUES (?, ?, ?, ?, 'set_username', 'completed', unixepoch())`, operationId, target, gate.current.user.id, sessionId),
        this.cleanupAssertions(gate.assertionId),
        this.statement('DELETE FROM command_assertions WHERE id = ?', `${operationId}:username`),
      ]);
      return {};
    }
    if (command.action === 'create_account') {
      if (command.teamId ? command.roles.length > 0 || command.isAdmin : command.roles.length === 0 && !command.isAdmin) {
        throw new AuthenticationError(400, 'Choose a contestant team or staff roles or admin membership.');
      }
      gate.statements.push(
        this.statement(`INSERT INTO accounts (id, name, username, must_change, credential_state, credential_operation)
          VALUES (?, ?, ?, 1, 'pending', ?)`, target, command.name, command.username, operationId),
        this.statement('INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, ?, ?)', sessionId, target, command.teamId, Number(command.isAdmin)),
        ...[...new Set(command.roles)].map((role) => this.statement('INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, ?)', sessionId, target, role)),
      );
    } else {
      // Superseding a failed operation is safe: its final batch checks this ID.
      gate.statements.push(...this.beginOperation(target, operationId));
    }
    gate.statements.push(
      this.statement(`INSERT INTO account_operations (id, account_id, actor, session_id, action, state) VALUES (?, ?, ?, ?, ?, 'pending')`, operationId, target, gate.current.user.id, sessionId, command.action),
      this.cleanupAssertions(gate.assertionId),
    );
    await this.guarded(gate.statements);
    const password = randomSecret() + 'A9!';
    await this.completeCredentials(headers, target, operationId, password, true, sessionId);
    return { temporaryPassword: password };
  }

  private beginOperation(target: string, operationId: string): D1Statement[] {
    return [
      this.statement(`UPDATE account_operations SET state = 'superseded' WHERE account_id = ? AND state = 'pending'`, target),
      this.statement(`UPDATE accounts SET must_change = 1, credential_state = 'pending', credential_operation = ?,
        credential_generation = credential_generation + 1 WHERE id = ?`, operationId, target),
      this.statement('UPDATE logins SET revoked = 1 WHERE account_id = ?', target),
      this.statement('DELETE FROM ba_session WHERE userId = ?', target),
    ];
  }

  private async completeCredentials(headers: Headers, target: string, operationId: string, password: string, temporary: boolean, sessionId?: string, prepared?: { hash: string; statements: D1Statement[] }): Promise<void> {
    // Hash outside the transaction. A failed hash leaves the persisted gate and
    // revoked sessions intact. An organizer can issue another reset.
    const hash = prepared?.hash ?? await this.passwords.hash(password);
    const account = await this.statement('SELECT * FROM accounts WHERE id = ?', target).first<Account>();
    if (!account?.username) throw new AuthenticationError(409, 'Set a username before resetting this account.');
    const assertions: D1Statement[] = prepared?.statements ?? [];
    let adminAssertion: string | undefined;
    if (sessionId) {
      const gate = await this.adminAssertions(headers, sessionId, target);
      assertions.push(...gate.statements);
      adminAssertion = gate.assertionId;
    }
    const assertionId = crypto.randomUUID();
    assertions.push(
      this.assertion(assertionId, `SELECT 1 FROM accounts WHERE id = ? AND credential_operation = ? AND credential_state = 'pending' AND disabled = 0`, target, operationId),
      this.statement(`INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
        VALUES (?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)
        ON CONFLICT(id) DO UPDATE SET username = excluded.username, email = excluded.email, updatedAt = excluded.updatedAt`,
      target, account.name, `${account.username}@accounts.minsky.invalid`, account.username),
      this.statement(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
        VALUES (?, ?, 'credential', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT(providerId, accountId) DO UPDATE SET password = excluded.password, updatedAt = excluded.updatedAt`, crypto.randomUUID(), target, target, hash),
      this.statement('DELETE FROM ba_session WHERE userId = ?', target),
      this.statement('UPDATE logins SET revoked = 1 WHERE account_id = ?', target),
      this.statement(`UPDATE accounts SET credential_state = 'ready', credential_operation = NULL, must_change = ? WHERE id = ?`, Number(temporary), target),
      this.statement(`UPDATE account_operations SET state = 'completed', completed_at = unixepoch() WHERE id = ?`, operationId),
      this.statement('DELETE FROM command_assertions WHERE id = ?', assertionId),
    );
    if (adminAssertion) assertions.push(this.cleanupAssertions(adminAssertion));
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
    const before = await this.statement('SELECT a.*, c.password FROM accounts a JOIN ba_account c ON c.userId = a.id AND c.providerId = \'credential\' WHERE a.id = ?', current.user.id).first<Account & { password: string }>();
    if (!before || !(await this.passwords.verify(currentPassword, before.password))) throw new AuthenticationError(400, 'Current password is incorrect.');
    const operationId = crypto.randomUUID();
    const assertionId = crypto.randomUUID();
    // Self changes have no external identity update. Hash before the atomic
    // batch so a lone organizer can retry a failed change with the old login.
    const hash = await this.passwords.hash(newPassword);
    await this.completeCredentials(headers, current.user.id, operationId, newPassword, false, undefined, { hash, statements: [
      this.assertion(assertionId, `SELECT 1 FROM (${currentLoginSql}) WHERE credential_generation = ?`, identity.identitySessionId, identity.accountId, before.credential_generation),
      ...this.beginOperation(current.user.id, operationId),
      this.statement(`INSERT INTO account_operations (id, account_id, actor, action, state) VALUES (?, ?, ?, 'change_password', 'pending')`, operationId, current.user.id, current.user.id),
      this.statement('DELETE FROM command_assertions WHERE id = ?', assertionId),
    ] });
    // The authenticated change uses its own attempt limit. Replacing the login
    // must also succeed when the public username window is already exhausted.
    return this.createLogin(before.username!, newPassword);
  }

  async sessions(headers: Headers): Promise<SessionSummary[]> {
    const current = await this.requireCurrent(headers);
    const identity = await this.identity.session(headers);
    if (!identity) throw new AuthenticationError(401, 'Sign in again.');
    const result = await this.statement(`SELECT s.id, s.id AS name FROM sessions s JOIN memberships m ON m.session_id = s.id
      JOIN (${currentLoginSql}) c ON c.id = m.account_id WHERE c.must_change = 0`, identity.identitySessionId, current.user.id).all<SessionSummary>();
    return result.results;
  }
}
