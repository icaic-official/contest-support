import { createHmac, randomBytes } from 'node:crypto';
import { open, readFile, rename } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

/**
 * The private fixture file lists the run's accounts and their temporary
 * passwords. After the first sign-in each account uses a password derived from
 * the file's secret, so a crash after a password change loses nothing.
 */
export function derivePassword(secret, username) {
  return createHmac('sha256', secret).update(username).digest('hex').slice(0, 32) + 'A9!';
}

/** `owner` is the private result of `cloudflare:install bootstrap` or `recover`. */
export function newFixtures({ origin, owner }) {
  return {
    version: 1,
    runId: randomBytes(4).toString('hex'),
    secret: randomBytes(32).toString('hex'),
    origin, sessionId: owner.sessionId,
    admin: { username: owner.adminUsername, temporary: owner.temporaryPassword, changed: false },
    accounts: [],
  };
}

export function accountPrefix(fixtures) {
  return `load-${fixtures.runId}-`;
}

export async function readFixtures(path) {
  const fixtures = JSON.parse(await readFile(path, 'utf8'));
  if (fixtures.version !== 1 || !/^[0-9a-f]{8}$/.test(fixtures.runId)) throw new Error('The fixture file has an unknown format.');
  return fixtures;
}

/** Write a new 0600 file beside the old one, then rename it, so a crash never leaves half a file. */
export async function writeFixtures(path, fixtures) {
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = await open(temporary, 'w', 0o600);
  try {
    await handle.writeFile(JSON.stringify(fixtures, null, 2) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

/**
 * Load tests write fictional records that Minsky cannot delete, so they must
 * run on an installation that exists only for testing. Agents may manage
 * Cloudflare resources whose names start with `minsky-preview`.
 */
export function checkTarget(origin, isolatedOrigin) {
  const url = new URL(origin);
  if (url.origin !== origin) throw new Error('Give the exact origin, such as https://minsky-preview-load.example.workers.dev.');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (loopback || url.hostname.split('.')[0].startsWith('minsky-preview') || isolatedOrigin === origin) return;
  throw new Error('Run load tests only against an isolated installation. Use a minsky-preview* Worker, ' +
    'or pass --isolated-origin with the same origin to confirm that the target holds only test data.');
}
