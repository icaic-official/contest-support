import type { D1Connection, D1Statement, D1Value } from '../d1/connection';
import { beginCredentialReset, completeCredentialReset, insertPendingReset } from './credentials';
import { passwordHasher, randomSecret, type PasswordHasher } from './password';

const usernamePattern = /^[a-z0-9][a-z0-9_-]{2,31}$/;
const accountIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AdminRecoverySelector {
  username?: string;
  userId?: string;
}

export interface AdminRecoveryResult {
  accountId: string;
  username: string;
  temporaryPassword: string;
}

interface RecoveryOptions {
  passwords?: PasswordHasher;
}

interface RecoveryTarget {
  id: string;
  name: string;
  username: string;
  disabled: number;
  credential_generation: number;
  session_id: string | null;
}

const adminRoleSql = `SELECT 1 FROM accounts a
  WHERE a.id = ? AND a.disabled = 0 AND a.username = ?
    AND (
      EXISTS (
        SELECT 1 FROM memberships m
        JOIN sessions s ON s.id = m.session_id
        JOIN events e ON e.id = s.event_id
        WHERE m.account_id = a.id AND m.session_id = ? AND m.is_admin = 1 AND e.archived = 0
      )
      OR EXISTS (
        SELECT 1 FROM installation i
        WHERE i.owner_account_id = a.id AND i.session_id = ?
      )
    )`;

function statement(db: D1Connection, sql: string, ...values: D1Value[]): D1Statement {
  return db.prepare(sql).bind(...values);
}

function assertion(db: D1Connection, id: string, sql: string, ...values: D1Value[]): D1Statement {
  return statement(db, `INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN EXISTS (${sql}) THEN 1 ELSE 0 END)`, id, ...values);
}

/** The normalized username or account ID that selects the account. */
interface RecoveryKey {
  byUsername: boolean;
  key: string;
}

function parseSelector({ username, userId }: AdminRecoverySelector): RecoveryKey {
  const oneSelector = 'Provide a username or an account ID. Recovery did not start.';
  if (username !== undefined) {
    if (userId !== undefined) throw new Error(oneSelector);
    const key = username.trim().toLowerCase();
    if (!usernamePattern.test(key)) throw new Error('The username is invalid. Recovery did not start.');
    return { byUsername: true, key };
  }
  if (userId === undefined) throw new Error(oneSelector);
  const key = userId.trim().toLowerCase();
  if (!accountIdPattern.test(key)) throw new Error('The account ID is invalid. Recovery did not start.');
  return { byUsername: false, key };
}

/**
 * Replace one admin password from a maintainer terminal.
 * This is not an HTTP route. The returned password is the only copy.
 */
export async function recoverCloudflareAdmin(
  db: D1Connection,
  selector: AdminRecoverySelector,
  options: RecoveryOptions = {},
): Promise<AdminRecoveryResult> {
  const { byUsername, key } = parseSelector(selector);
  const lookupSql = `SELECT a.id, a.name, a.username, a.disabled, a.credential_generation,
      (
        SELECT session_id FROM (
          SELECT m.session_id AS session_id, 0 AS rank
          FROM memberships m
          JOIN sessions s ON s.id = m.session_id
          JOIN events e ON e.id = s.event_id
          WHERE m.account_id = a.id AND m.is_admin = 1 AND e.archived = 0
          UNION ALL
          SELECT i.session_id, 1 AS rank
          FROM installation i
          WHERE i.owner_account_id = a.id
        )
        ORDER BY rank, session_id
        LIMIT 1
      ) AS session_id
    FROM accounts a
    WHERE ${byUsername ? 'a.username = ?' : 'a.id = ?'}`;
  const target = await statement(db, lookupSql, key).first<RecoveryTarget>();
  if (!target) {
    throw new Error(byUsername
      ? 'No account matches that username. Recovery did not start.'
      : 'No account matches that account ID. Recovery did not start.');
  }
  if (target.disabled) throw new Error('The account is disabled. Recovery did not start.');
  if (!target.username) throw new Error('Set a username before resetting this account. Recovery did not start.');
  if (!target.session_id) {
    throw new Error('The account is not an admin of an active event or the installation owner. Recovery did not start.');
  }
  const password = randomSecret() + 'A9!';
  let hash: string;
  try {
    hash = await (options.passwords ?? passwordHasher).hash(password);
  } catch {
    throw new Error('Password preparation failed. Recovery did not start.');
  }
  const operationId = crypto.randomUUID();
  const assertionId = crypto.randomUUID();
  const generation = target.credential_generation + 1;
  const roleValues = [target.id, target.username, target.session_id, target.session_id];
  try {
    // One batch keeps the revoked sessions, new hash, and operation record together.
    // The statements are the same ones an application reset runs.
    await db.batch([
      assertion(db, assertionId, `${adminRoleSql} AND a.credential_generation = ?`, ...roleValues, target.credential_generation),
      ...beginCredentialReset(db, target.id, operationId),
      insertPendingReset(db, operationId, target.id, target.id, target.session_id),
      assertion(db, `${assertionId}:gate`, `SELECT 1 FROM accounts WHERE id = ? AND credential_operation = ?
        AND credential_generation = ? AND credential_state = 'pending' AND disabled = 0`,
      target.id, operationId, generation),
      ...completeCredentialReset(db, target, operationId, hash, true),
      statement(db, 'DELETE FROM command_assertions WHERE id IN (?, ?)', assertionId, `${assertionId}:gate`),
      assertion(db, `${assertionId}:final`, `SELECT 1 FROM accounts a
        JOIN account_operations o ON o.account_id = a.id
        WHERE a.id = ? AND a.credential_generation = ? AND a.credential_state = 'ready'
          AND a.credential_operation IS NULL AND a.disabled = 0 AND a.must_change = 1
          AND o.id = ? AND o.state = 'completed' AND o.action = 'reset_password'
          AND o.actor = ? AND o.session_id = ? AND EXISTS (${adminRoleSql})`,
      target.id, generation, operationId, target.id, target.session_id, ...roleValues),
      statement(db, 'DELETE FROM command_assertions WHERE id = ?', `${assertionId}:final`),
    ]);
  } catch {
    throw new Error('Admin recovery did not finish. The account was not changed.');
  }
  return { accountId: target.id, username: target.username, temporaryPassword: password };
}

/** Print the temporary password once. The message line does not contain it. */
export function writeTemporaryPassword(
  result: Pick<AdminRecoveryResult, 'username' | 'temporaryPassword'>,
  write: (line: string) => void,
): void {
  if (
    result.temporaryPassword.length < 12
    || /[\r\n]/.test(result.temporaryPassword)
    || result.username.includes(result.temporaryPassword)
  ) {
    throw new Error('Admin recovery did not finish. The account was not changed.');
  }
  write(`Admin recovery completed for ${result.username}. Share this temporary password securely. The next sign-in must change it.`);
  write(result.temporaryPassword);
}
