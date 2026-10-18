import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';

const account = '458ad6a930b0fb717796dfa19ca6a2b1';
const database = '5d746d29-0a66-4346-96a6-4974126685d7';
const origin = 'https://minsky-auth-ci.icaic-minsky.workers.dev';
const configPath = 'wrangler.auth-ci.jsonc';
const config = JSON.parse(readFileSync(new URL('../wrangler.auth-ci.jsonc', import.meta.url), 'utf8'));
const expected = [`--account=${account}`, `--database=${database}`, `--origin=${origin}`];
const args = process.argv.slice(2);
if (args.length !== expected.length || !expected.every((arg) => args.includes(arg)) ||
    config.account_id !== account || config.name !== 'minsky-auth-ci' || config.vars.AUTH_ORIGIN !== origin ||
    config.d1_databases.length !== 1 || config.d1_databases[0].database_id !== database ||
    config.d1_databases[0].database_name !== 'minsky-auth-ci' || config.d1_databases[0].remote !== true) {
  console.error(`Supply the exact isolated hosted HTTP target: ${expected.join(' ')}`);
  process.exit(1);
}

const temporary = mkdtempSync(join(tmpdir(), 'minsky-auth-http-'));
const env = {
  ...process.env,
  MINSKY_AUTH_REMOTE: '1',
  MINSKY_AUTH_HTTP_REMOTE: '1',
  MINSKY_AUTH_HTTP_ORIGIN: origin,
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_LOG_PATH: join(temporary, 'wrangler.log'),
};
try {
  let identity;
  try {
    identity = execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'whoami', '--config', configPath], {
      encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
    });
  } catch {
    throw new Error('Existing Wrangler access could not be checked. Provider output was withheld.');
  }
  if (!identity.includes(account)) throw new Error('Existing Wrangler access does not include the configured CI account.');
  console.log('Testing fictional fixtures through the isolated hosted minsky-auth-ci HTTP Worker.');
  const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.auth-http.config.ts'], { env, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
