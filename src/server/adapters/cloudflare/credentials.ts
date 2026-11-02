import type { D1Connection, D1Statement, D1Value } from '../d1/connection';

function statement(db: D1Connection, sql: string, ...values: D1Value[]): D1Statement {
  return db.prepare(sql).bind(...values);
}

/**
 * Start a password replacement.
 * An application reset and the one-batch replacement both use these statements.
 */
export function beginCredentialReset(db: D1Connection, target: string, operationId: string): D1Statement[] {
  return [
    statement(db, `UPDATE account_operations SET state = 'superseded' WHERE account_id = ? AND state = 'pending'`, target),
    statement(db, `UPDATE accounts SET must_change = 1, credential_state = 'pending', credential_operation = ?,
        credential_generation = credential_generation + 1 WHERE id = ?`, operationId, target),
    statement(db, 'UPDATE logins SET revoked = 1 WHERE account_id = ?', target),
    statement(db, 'DELETE FROM ba_session WHERE userId = ?', target),
  ];
}

export interface CredentialAccount {
  id: string;
  name: string;
  username: string;
}

/**
 * Finish a password replacement.
 * The caller supplies a Better Auth password hash. This function does not hash.
 */
export function completeCredentialReset(
  db: D1Connection,
  account: CredentialAccount,
  operationId: string,
  hash: string,
  temporary: boolean,
): D1Statement[] {
  return [
    statement(db, `INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
        VALUES (?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)
        ON CONFLICT(id) DO UPDATE SET username = excluded.username, email = excluded.email, updatedAt = excluded.updatedAt`,
    account.id, account.name, `${account.username}@accounts.minsky.invalid`, account.username),
    statement(db, `INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
        VALUES (?, ?, 'credential', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT(providerId, accountId) DO UPDATE SET password = excluded.password, updatedAt = excluded.updatedAt`,
    crypto.randomUUID(), account.id, account.id, hash),
    statement(db, 'DELETE FROM ba_session WHERE userId = ?', account.id),
    statement(db, 'UPDATE logins SET revoked = 1 WHERE account_id = ?', account.id),
    statement(db, `UPDATE accounts SET credential_state = 'ready', credential_operation = NULL, must_change = ? WHERE id = ?`, Number(temporary), account.id),
    statement(db, `UPDATE account_operations SET state = 'completed', completed_at = unixepoch() WHERE id = ?`, operationId),
  ];
}

/**
 * Replace a password in one batch: begin the reset, record the operation, and
 * complete it. The caller hashes before the batch, so an interrupted issue
 * changes nothing and the old password stays valid. The account_operations
 * insert runs the takeover trigger, so a refused actor rolls back every write.
 */
export function replaceCredentialStatements(
  db: D1Connection,
  account: CredentialAccount,
  hash: string,
  options: { operationId: string; actor: string; temporary: boolean },
): D1Statement[] {
  return [
    ...beginCredentialReset(db, account.id, options.operationId),
    statement(db, `INSERT INTO account_operations (id, account_id, actor, action, state) VALUES (?, ?, ?, 'reset_password', 'pending')`,
      options.operationId, account.id, options.actor),
    ...completeCredentialReset(db, account, options.operationId, hash, options.temporary),
  ];
}
