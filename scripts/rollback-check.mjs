import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import console from 'node:console';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from '../src/server/adapters/cloudflare/tooling/configuration.mjs';
import { safeWranglerEnvironment } from '../src/server/adapters/cloudflare/tooling/safe-environment.mjs';

const usage = `Usage: node scripts/rollback-check.mjs [--base=origin/main]

Runs the previous release's npm run test:d1 against this checkout's migrations.
It checks out the base revision into a temporary Git worktree outside the
repository, installs its packages, and copies this checkout's migration files
into it. The previous release's tests then run their own writes, guards, and
cleanup on the newer schema, as the previous Worker does after a rollback.
It uses only a temporary local database. It never contacts Cloudflare.`;

const migrationPath = 'src/server/adapters/d1/migrations';

/**
 * Migration files to copy into the base worktree. A file that the base release
 * already has must be unchanged, because a deployed migration never runs again.
 */
export function migrationsToCopy(base, head) {
  const changed = [...base.keys()].filter((name) => head.get(name) !== base.get(name));
  if (changed.length) throw new Error(`Released migrations differ from this checkout: ${changed.join(', ')}.`);
  return [...head.keys()].filter((name) => !base.has(name)).sort();
}

async function readMigrations(root) {
  const folder = resolve(root, migrationPath);
  const names = (await readdir(folder)).filter((name) => name.endsWith('.sql'));
  return new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(folder, name), 'utf8')])));
}

function run(command, args, options) {
  console.log(`\n> ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function git(args) {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

/** The local test suite needs no credential. Remove every provider variable before it starts. */
function localEnvironment() {
  const environment = safeWranglerEnvironment();
  for (const key of Object.keys(environment)) {
    if (/^(?:CLOUDFLARE_|MINSKY_CONNECTOR_|MINSKY_AUTH_REMOTE)/.test(key)) delete environment[key];
  }
  return { ...environment, CI: 'true' };
}

async function main() {
  let base = 'origin/main';
  for (const argument of process.argv.slice(2)) {
    const [key, value] = argument.replace(/^--/, '').split('=');
    if (key === 'base' && value) base = value;
    else { console.error(usage); process.exit(1); }
  }
  const revision = git(['rev-parse', '--verify', `${base}^{commit}`]);
  const directory = await mkdtemp(join(tmpdir(), 'minsky-rollback-'));
  let status;
  try {
    git(['worktree', 'add', '--detach', directory, revision]);
    const added = migrationsToCopy(await readMigrations(directory), await readMigrations(repositoryRoot));
    console.log(`Previous release: ${base} at ${revision}.`);
    console.log(`Migrations added by this checkout: ${added.length ? added.join(', ') : 'none'}.`);
    for (const name of added) {
      await copyFile(resolve(repositoryRoot, migrationPath, name), resolve(directory, migrationPath, name));
    }
    const environment = localEnvironment();
    status = run('npm', ['ci', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: directory, env: environment });
    if (status === 0) status = run('npm', ['run', 'test:d1'], { cwd: directory, env: environment });
    console.log(status === 0
      ? `\nThe previous release's test:d1 passed on this checkout's schema.`
      : `\nThe previous release's test:d1 failed on this checkout's schema.`);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', directory], { cwd: repositoryRoot, stdio: 'ignore' });
    spawnSync('git', ['worktree', 'prune'], { cwd: repositoryRoot, stdio: 'ignore' });
    await rm(directory, { recursive: true, force: true });
  }
  process.exit(status);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
