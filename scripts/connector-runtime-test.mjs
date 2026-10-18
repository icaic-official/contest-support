import { spawnSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { safeWranglerEnvironment } from '../src/server/adapters/cloudflare/tooling/safe-environment.mjs';

if (process.argv.length !== 2) {
  console.error('This command accepts no targets. It uses only temporary local resources.');
  process.exit(1);
}
console.log('Local connector runtime: HTTPS, fictional accounts, D1, R2, and Durable Objects.');
const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.connector-runtime.config.ts'], {
  stdio: 'inherit',
  env: safeWranglerEnvironment(),
});
if (result.error) throw new Error('The local connector runtime runner could not start.');
process.exit(result.status ?? 1);
