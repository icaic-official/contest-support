import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

const account = '458ad6a930b0fb717796dfa19ca6a2b1';
const database = '5d746d29-0a66-4346-96a6-4974126685d7';
const configPath = 'wrangler.auth-ci.jsonc';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (config.account_id !== account || config.name !== 'minsky-auth-ci' ||
    config.vars.AUTH_ORIGIN !== 'https://minsky-auth-ci.icaic-minsky.workers.dev' ||
    config.main !== 'src/server/adapters/cloudflare/worker.ts' ||
    config.d1_databases.length !== 1 || config.d1_databases[0].database_id !== database ||
    config.d1_databases[0].database_name !== 'minsky-auth-ci' || config.d1_databases[0].remote !== true) {
  throw new Error('The isolated authentication configuration changed. Stop before any mutation.');
}
function wrangler(args) {
  try {
    return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args, '--config', configPath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
    });
  } catch {
    throw new Error('The isolated authentication target could not be checked. Provider output was withheld.');
  }
}
if (!wrangler(['whoami']).includes(account)) throw new Error('Wrangler does not identify the authorized authentication account.');
const info = JSON.parse(wrangler(['d1', 'info', 'minsky-auth-ci', '--json']));
if (info.uuid !== database || info.name !== 'minsky-auth-ci') throw new Error('The hosted authentication database differs. Stop before any mutation.');
console.log('Confirmed the exact isolated authentication account, database, origin, and Worker entry.');
