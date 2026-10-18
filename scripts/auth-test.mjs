import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';

const config = JSON.parse(readFileSync(new URL('../wrangler.auth-ci.jsonc', import.meta.url), 'utf8'));
const binding = config.d1_databases[0];
const expected = ['--account=458ad6a930b0fb717796dfa19ca6a2b1', '--database=5d746d29-0a66-4346-96a6-4974126685d7'];
const args = process.argv.slice(2);
const patternPrefix = '--test-name-pattern=';
const patterns = args.filter((arg) => arg.startsWith(patternPrefix));
const targetArgs = args.filter((arg) => !arg.startsWith(patternPrefix));
if (targetArgs.length !== 2 || patterns.length > 1 || patterns.some((arg) => arg.length > 256) ||
    !expected.every((arg) => targetArgs.includes(arg)) ||
    config.account_id !== expected[0].slice('--account='.length) ||
    binding.database_id !== expected[1].slice('--database='.length) ||
    binding.database_name !== 'minsky-auth-ci' || binding.remote !== true) {
  console.error(`Supply the exact isolated authentication target: ${expected.join(' ')}`);
  process.exit(1);
}
console.log('Testing fictional authentication fixtures on isolated hosted minsky-auth-ci.');
const filter = patterns.length ? ['--testNamePattern', patterns[0].slice(patternPrefix.length)] : [];
const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.auth.config.ts', ...filter], {
  stdio: 'inherit', env: { ...process.env, MINSKY_AUTH_REMOTE: '1', WRANGLER_SEND_METRICS: 'false' },
});
process.exit(result.status ?? 1);
