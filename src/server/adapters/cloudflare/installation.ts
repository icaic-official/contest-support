import { z } from 'zod';
import type { D1Connection, D1Statement } from '../d1/connection';
import { passwordHasher, randomSecret, type PasswordHasher } from './password';

// Retain PR #21's competition fields and normalized-name checks. Credentials
// belong to the trusted operator result, never to the competition file.
const text = z.string().max(200).trim().min(1).refine((value) => !value.includes('\0'));
const competitionSchema = z.object({
  adminUsername: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{2,31}$/),
  adminName: text,
  eventName: text,
  sessionName: text,
  categories: z.array(text).min(1),
  teams: z.array(z.object({ name: text, location: text }).strict()),
}).strict().superRefine((input, context) => {
  if (new Set(input.categories).size !== input.categories.length) {
    context.addIssue({ code: 'custom', message: 'Category names must be unique.' });
  }
  if (new Set(input.teams.map((team) => team.name)).size !== input.teams.length) {
    context.addIssue({ code: 'custom', message: 'Team names must be unique.' });
  }
});

export type CompetitionConfiguration = z.infer<typeof competitionSchema>;

export interface InstallationResult {
  installationId: string;
  accountId: string;
  eventId: string;
  sessionId: string;
  teamIds: string[];
  adminUsername: string;
  temporaryPassword: string;
}

interface InstallationOptions {
  passwords?: PasswordHasher;
}

/** Validate public competition settings without returning provider diagnostics. */
export function validateCompetitionConfiguration(input: unknown): CompetitionConfiguration {
  const parsed = competitionSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid competition configuration. Check the documented fields and unique names.');
  return parsed.data;
}

function statement(db: D1Connection, sql: string, ...values: Array<string | number | null>): D1Statement {
  return db.prepare(sql).bind(...values);
}

function assertion(db: D1Connection, id: string, condition: string, ...values: Array<string | number | null>): D1Statement {
  return statement(db, `INSERT INTO command_assertions (id, valid)
    VALUES (?, CASE WHEN ${condition} THEN 1 ELSE 0 END)`, id, ...values);
}

async function emptyDatabaseCondition(db: D1Connection): Promise<string> {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()).results
    .filter(({ name }) => name !== 'd1_migrations' && !name.startsWith('sqlite_') && !name.startsWith('_cf_'));
  if (!tables.some(({ name }) => name === 'installation')) {
    throw new Error('Apply every installation migration before bootstrap.');
  }
  // Inspect every application table, including future tables and partial
  // identity records. Schema names are quoted identifiers, never SQL input.
  return tables.map(({ name }) => `NOT EXISTS (SELECT 1 FROM "${name.replaceAll('"', '""')}")`).join(' AND ');
}

function identityStatements(db: D1Connection, accountId: string, hash: string): D1Statement[] {
  return [
    statement(db, `INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
      SELECT id, name, username || '@accounts.minsky.invalid', 1,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), username
      FROM accounts WHERE id = ?
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, username = excluded.username,
        email = excluded.email, updatedAt = excluded.updatedAt`, accountId),
    statement(db, `INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (?, ?, 'credential', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(providerId, accountId) DO UPDATE SET password = excluded.password, updatedAt = excluded.updatedAt`,
    crypto.randomUUID(), accountId, accountId, hash),
  ];
}

/**
 * Trusted provider operation. The caller must confirm its account and database.
 * Never expose this function through a public or first-login HTTP endpoint.
 */
export async function bootstrapInstallation(
  db: D1Connection,
  input: unknown,
  options: InstallationOptions = {},
): Promise<InstallationResult> {
  const config = validateCompetitionConfiguration(input);
  const empty = await emptyDatabaseCondition(db);
  if (!(await db.prepare(`SELECT 1 AS empty WHERE ${empty}`).first())) {
    throw new Error('The database is not empty. Bootstrap did not start.');
  }
  const password = randomSecret() + 'A9!';
  // Hash before the batch. A failed hash must leave the empty database intact.
  let hash: string;
  try {
    hash = await (options.passwords ?? passwordHasher).hash(password);
  } catch {
    throw new Error('Password preparation failed. Bootstrap did not start.');
  }
  const installationId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const teamIds = config.teams.map(() => crypto.randomUUID());
  const assertionId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  try {
    await db.batch([
      // The emptiness check runs again inside the atomic batch. Concurrent
      // initializations cannot both commit after an earlier empty read.
      assertion(db, assertionId, empty),
      statement(db, `INSERT INTO accounts (id, name, username, must_change) VALUES (?, ?, ?, 1)`,
        accountId, config.adminName, config.adminUsername),
      ...identityStatements(db, accountId, hash),
      statement(db, 'INSERT INTO events (id, name) VALUES (?, ?)', eventId, config.eventName),
      statement(db, 'INSERT INTO sessions (id, event_id, name, categories, intake_open) VALUES (?, ?, ?, ?, 0)',
        sessionId, eventId, config.sessionName, JSON.stringify(config.categories)),
      ...config.teams.map((team, index) => statement(db, 'INSERT INTO teams (id, session_id, name, location) VALUES (?, ?, ?, ?)',
        teamIds[index], sessionId, team.name, team.location)),
      statement(db, 'INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, 1)', sessionId, accountId),
      statement(db, `INSERT INTO account_operations (id, account_id, actor, session_id, action, state, completed_at)
        VALUES (?, ?, ?, ?, 'create_account', 'completed', unixepoch())`, operationId, accountId, accountId, sessionId),
      statement(db, `INSERT INTO admin_audit (id, session_id, actor, action, target)
        VALUES (?, ?, ?, 'trusted_bootstrap', ?)`, crypto.randomUUID(), sessionId, accountId, accountId),
      statement(db, 'INSERT INTO installation (singleton, id, owner_account_id, event_id, session_id) VALUES (1, ?, ?, ?, ?)',
        installationId, accountId, eventId, sessionId),
      statement(db, 'DELETE FROM command_assertions WHERE id = ?', assertionId),
    ]);
  } catch {
    // A transport failure can follow a commit. Do not report it as rollback.
    throw new Error('Installation outcome is unknown. Inspect the installation before retrying.');
  }
  return { installationId, accountId, eventId, sessionId, teamIds, adminUsername: config.adminUsername, temporaryPassword: password };
}

const ownerCondition = `EXISTS (SELECT 1 FROM installation i
  JOIN accounts a ON a.id = i.owner_account_id
  JOIN memberships m ON m.account_id = a.id AND m.session_id = i.session_id
  JOIN sessions s ON s.id = i.session_id JOIN events e ON e.id = s.event_id
  WHERE i.id = ? AND a.id = ? AND a.disabled = 0 AND a.username IS NOT NULL
    AND m.is_admin = 1 AND e.archived = 0)`;

/** Trusted provider recovery preserves the owner ID and every application record. */
export async function recoverInstallationOwner(
  db: D1Connection,
  target: { installationId: string; accountId: string },
  options: InstallationOptions = {},
): Promise<{ accountId: string; adminUsername: string; temporaryPassword: string }> {
  if (!z.object({ installationId: z.string().uuid(), accountId: z.string().uuid() }).safeParse(target).success) {
    throw new Error('Select the installation and owner by UUID.');
  }
  const owner = await statement(db, `SELECT a.username FROM installation i JOIN accounts a ON a.id = i.owner_account_id
    WHERE i.id = ? AND a.id = ? AND ${ownerCondition}`,
  target.installationId, target.accountId, target.installationId, target.accountId).first<{ username: string }>();
  if (!owner) throw new Error('The selected account is not the active installation owner. Recovery did not start.');
  const operationId = crypto.randomUUID();
  const assertionId = crypto.randomUUID();
  try {
    await db.batch([
      assertion(db, assertionId, ownerCondition, target.installationId, target.accountId),
      statement(db, "UPDATE account_operations SET state = 'superseded' WHERE account_id = ? AND state = 'pending'", target.accountId),
      statement(db, `UPDATE accounts SET must_change = 1, credential_state = 'pending', credential_operation = ?,
        credential_generation = credential_generation + 1 WHERE id = ?`, operationId, target.accountId),
      statement(db, 'UPDATE logins SET revoked = 1 WHERE account_id = ?', target.accountId),
      statement(db, 'DELETE FROM ba_session WHERE userId = ?', target.accountId),
      statement(db, `INSERT INTO account_operations (id, account_id, actor, session_id, action, state)
        SELECT ?, owner_account_id, owner_account_id, session_id, 'reset_password', 'pending' FROM installation WHERE id = ?`,
      operationId, target.installationId),
      statement(db, `INSERT INTO admin_audit (id, session_id, actor, action, target, detail)
        SELECT ?, session_id, owner_account_id, 'trusted_owner_recovery_started', owner_account_id, ?
        FROM installation WHERE id = ?`, crypto.randomUUID(), JSON.stringify({ operationId }), target.installationId),
      statement(db, 'DELETE FROM command_assertions WHERE id = ?', assertionId),
    ]);
  } catch {
    throw new Error('Owner recovery outcome is unknown. Inspect the account before retrying.');
  }
  const password = randomSecret() + 'A9!';
  try {
    // Persist restriction and revocation before expensive hashing. An interrupted
    // recovery stays restricted. A later trusted recovery supersedes its ID.
    const hash = await (options.passwords ?? passwordHasher).hash(password);
    await db.batch([
      assertion(db, assertionId, `${ownerCondition} AND EXISTS (SELECT 1 FROM accounts
        WHERE id = ? AND credential_operation = ? AND credential_state = 'pending')`,
      target.installationId, target.accountId, target.accountId, operationId),
      ...identityStatements(db, target.accountId, hash),
      statement(db, 'UPDATE logins SET revoked = 1 WHERE account_id = ?', target.accountId),
      statement(db, 'DELETE FROM ba_session WHERE userId = ?', target.accountId),
      statement(db, "UPDATE accounts SET credential_state = 'ready', credential_operation = NULL, must_change = 1 WHERE id = ?", target.accountId),
      statement(db, "UPDATE account_operations SET state = 'completed', completed_at = unixepoch() WHERE id = ?", operationId),
      statement(db, `INSERT INTO admin_audit (id, session_id, actor, action, target, detail)
        SELECT ?, session_id, owner_account_id, 'trusted_owner_recovery', owner_account_id, ?
        FROM installation WHERE id = ?`, crypto.randomUUID(), JSON.stringify({ operationId }), target.installationId),
      statement(db, 'DELETE FROM command_assertions WHERE id = ?', assertionId),
    ]);
  } catch {
    throw new Error('Owner recovery did not finish. Inspect the account before retrying trusted recovery.');
  }
  return { accountId: target.accountId, adminUsername: owner.username, temporaryPassword: password };
}
