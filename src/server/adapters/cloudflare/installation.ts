import { z } from 'zod';
import type { Handle, LoginKey } from '../../../backend/contracts';
import type { D1Connection, D1Statement, D1Value } from '../d1/connection';
import { handleSchema, loginKeyFor, replaceCredentialStatements } from './credentials';
import { passwordHasher, randomSecret, type PasswordHasher } from './password';

// The site file names the one webmaster. Credentials belong to the trusted
// operator result, never to the site file.
const text = z.string().max(200).trim().min(1).refine((value) => !value.includes('\0'));
const siteSchema = z.object({
  /** The webmaster's handle, typed with **Site sign-in**. */
  webmasterHandle: handleSchema,
  webmasterName: text,
}).strict();

export type SiteConfiguration = z.infer<typeof siteSchema>;

export interface SiteBootstrapResult {
  accountId: string;
  handle: Handle;
  temporaryPassword: string;
}

interface InstallationOptions {
  passwords?: PasswordHasher;
}

/** Validate public site settings without returning provider diagnostics. */
export function validateSiteConfiguration(input: unknown): SiteConfiguration {
  const parsed = siteSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid site configuration. Check the documented fields.');
  return parsed.data;
}

function statement(db: D1Connection, sql: string, ...values: D1Value[]): D1Statement {
  return db.prepare(sql).bind(...values);
}

function assertion(db: D1Connection, id: string, condition: string, ...values: D1Value[]): D1Statement {
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
 * Trusted provider operation on an empty database. It creates exactly one
 * webmaster and nothing else: no event, contest, or team. The webmaster then
 * creates events on the site page. The caller must confirm its account and
 * database. Never expose this function through a public or first-login HTTP
 * endpoint.
 */
export async function bootstrapSite(
  db: D1Connection,
  input: unknown,
  options: InstallationOptions = {},
): Promise<SiteBootstrapResult> {
  const config = validateSiteConfiguration(input);
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
  const accountId = crypto.randomUUID();
  const assertionId = crypto.randomUUID();
  try {
    await db.batch([
      // The emptiness check runs again inside the atomic batch. Concurrent
      // initializations cannot both commit after an earlier empty read.
      assertion(db, assertionId, empty),
      statement(db, `INSERT INTO accounts (id, name, username, handle, must_change) VALUES (?, ?, ?, ?, 1)`,
        accountId, config.webmasterName, loginKeyFor(accountId), config.webmasterHandle),
      ...identityStatements(db, accountId, hash),
      statement(db, `INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', 'trusted_bootstrap')`, accountId),
      statement(db, `INSERT INTO authority_audit (id, event_id, actor, actor_name, action, target, detail)
        VALUES (?, NULL, ?, ?, 'trusted_bootstrap', ?, '{}')`, crypto.randomUUID(), accountId, config.webmasterName, accountId),
      statement(db, 'DELETE FROM command_assertions WHERE id = ?', assertionId),
    ]);
  } catch {
    // A transport failure can follow a commit. Do not report it as rollback.
    throw new Error('Installation outcome is unknown. Inspect the installation before retrying.');
  }
  return { accountId, handle: config.webmasterHandle, temporaryPassword: password };
}

export interface WebmasterRecoveryResult {
  accountId: string;
  handle: string;
  temporaryPassword: string;
}

/**
 * Trusted terminal recovery of one webmaster, found by site handle. It replaces
 * the password in one batch after hashing, so a failure leaves the old password
 * valid. Never expose it through an HTTP route. The result holds the only copy
 * of the password.
 */
export async function recoverWebmaster(
  db: D1Connection,
  input: { handle: string },
  options: InstallationOptions = {},
): Promise<WebmasterRecoveryResult> {
  const parsed = handleSchema.safeParse(input.handle);
  if (!parsed.success) throw new Error('The username is invalid. Recovery did not start.');
  const found = await statement(db, `SELECT a.id, a.name, a.username AS login_key, a.handle, a.disabled, a.credential_generation,
      EXISTS (SELECT 1 FROM grants g WHERE g.scope = 'site' AND g.account_id = a.id) AS webmaster
    FROM accounts a WHERE a.event_id IS NULL AND a.handle = ?`, parsed.data)
    .first<{ id: string; name: string; login_key: LoginKey; handle: Handle; disabled: number; credential_generation: number; webmaster: number }>();
  if (!found) throw new Error('No account matches that username. Recovery did not start.');
  const target = { ...found, loginKey: found.login_key };
  if (!target.webmaster) throw new Error('The account is not a webmaster. Recovery did not start.');
  if (target.disabled) throw new Error('The account is disabled. Recovery did not start.');
  const password = randomSecret() + 'A9!';
  let hash: string;
  try {
    hash = await (options.passwords ?? passwordHasher).hash(password);
  } catch {
    throw new Error('Password preparation failed. Recovery did not start.');
  }
  const assertionId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  try {
    await db.batch([
      assertion(db, assertionId, `EXISTS (SELECT 1 FROM accounts a JOIN grants g ON g.account_id = a.id AND g.scope = 'site'
        WHERE a.id = ? AND a.disabled = 0 AND a.credential_generation = ?)`, target.id, target.credential_generation),
      // The webmaster acts on the own account, which the takeover trigger allows.
      ...replaceCredentialStatements(db, target, hash, { operationId, actor: target.id, temporary: true }),
      statement(db, `INSERT INTO authority_audit (id, event_id, actor, actor_name, action, target, detail)
        VALUES (?, NULL, ?, ?, 'trusted_webmaster_recovery', ?, ?)`, crypto.randomUUID(), target.id, target.name, target.id,
      JSON.stringify({ operationId })),
      statement(db, 'DELETE FROM command_assertions WHERE id = ?', assertionId),
    ]);
  } catch {
    throw new Error('Webmaster recovery did not finish. The account was not changed.');
  }
  return { accountId: target.id, handle: target.handle, temporaryPassword: password };
}
