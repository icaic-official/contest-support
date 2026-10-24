import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repositoryRoot } from './configuration.mjs';

const migrationDirectory = resolve(repositoryRoot, 'src/server/adapters/d1/migrations');

/**
 * Migrations that remove or rename schema, with the reason each was accepted.
 * Pause minsky-dev publication before you add one: the deploy applies it automatically,
 * and a Worker rollback after it can fail.
 */
export const reviewedDestructiveMigrations = new Map();

export async function currentMigrationNames() {
  return (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
}

/** Find statements that an earlier Worker version cannot run against. Data changes are not checked. */
export function destructiveStatements(sql) {
  // Comments and string literals can contain any words.
  const code = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/g, ' ').replace(/\s+/g, ' ');
  const found = [];
  for (const pattern of [/\bDROP TABLE\b/gi, /\bDROP COLUMN\b/gi, /\bRENAME\b/gi]) {
    for (const match of code.matchAll(pattern)) found.push(match[0].toUpperCase());
  }
  // A dropped trigger, index, or view is accepted when the same file creates it again later.
  const replaceable = /\bDROP (TRIGGER|INDEX|VIEW) (?:IF EXISTS )?([\w".]+)/gi;
  for (const match of code.matchAll(replaceable)) {
    const [statement, kind, name] = match;
    const recreated = new RegExp(`\\bCREATE (?:UNIQUE |TEMP |TEMPORARY )?${kind} (?:IF NOT EXISTS )?${name.replaceAll('.', '\\.')}(?![\\w"])`, 'i');
    if (!recreated.test(code.slice(match.index + statement.length))) {
      found.push(`DROP ${kind.toUpperCase()} ${name} without a replacement`);
    }
  }
  return found;
}

/** Automatic deployment applies migrations, so each one must keep the previous Worker runnable. */
export async function assertAdditiveMigrations({
  names = currentMigrationNames,
  read = (name) => readFile(resolve(migrationDirectory, name), 'utf8'),
  reviewed = reviewedDestructiveMigrations,
} = {}) {
  const problems = [];
  for (const name of await names()) {
    if (reviewed.has(name)) continue;
    for (const statement of destructiveStatements(await read(name))) problems.push(`${name}: ${statement}`);
  }
  if (problems.length) {
    throw new Error(`D1 migrations must only add tables, columns, or indexes. Found: ${problems.join('; ')}. ` +
      'Pause minsky-dev publication and record a reviewed exception before you merge a destructive migration.');
  }
}

/**
 * Require the checkout's complete schema before enabling or changing accounts.
 * With allowExtra, the database may also have migrations that this checkout does not have.
 * Migrations only add schema, so the checkout's code still runs against them.
 */
export async function assertCurrentMigrations(settings, runWrangler, { allowExtra = false } = {}) {
  const expected = await currentMigrationNames();
  let applied;
  try {
    const result = JSON.parse(await runWrangler(['d1', 'execute', settings.databaseName, '--remote', '--json',
      '--command', 'SELECT name FROM d1_migrations ORDER BY id']));
    if (!Array.isArray(result) || result.length !== 1 || result[0].success !== true || !Array.isArray(result[0].results)) {
      throw new Error('Invalid migration metadata');
    }
    applied = result[0].results.map((row) => row.name).sort();
  } catch {
    throw new Error('The hosted migration list could not be confirmed. No operation started.');
  }
  const missing = expected.some((name) => !applied.includes(name));
  if (missing || (!allowExtra && applied.length !== expected.length)) {
    throw new Error('The hosted migrations differ from this checkout. Apply the reviewed migrations before continuing.');
  }
}
