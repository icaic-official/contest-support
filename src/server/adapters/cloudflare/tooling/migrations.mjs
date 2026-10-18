import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repositoryRoot } from './configuration.mjs';

export async function currentMigrationNames() {
  const directory = resolve(repositoryRoot, 'src/server/adapters/d1/migrations');
  return (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
}

/** Require the checkout's complete schema before enabling or changing accounts. */
export async function assertCurrentMigrations(settings, runWrangler) {
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
  if (JSON.stringify(applied) !== JSON.stringify(expected)) {
    throw new Error('The hosted migrations differ from this checkout. Apply the reviewed migrations before continuing.');
  }
}
