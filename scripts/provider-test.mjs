import process from 'node:process';
import console from 'node:console';
import { spawnSync } from 'node:child_process';
import { safeWranglerEnvironment } from '../src/server/adapters/cloudflare/tooling/safe-environment.mjs';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { providerTestOptions } from './provider-test-options.mjs';
import { checkCloudflareBackend } from '../tests/providers/cloudflare/target.mjs';

const options = providerTestOptions(process.argv.slice(2));
if (!options.recoveryPath) await checkCloudflareBackend(options);
const directory = options.recoveryPath ? undefined : await mkdtemp(
  join(process.env.RUNNER_TEMP ?? tmpdir(), 'minsky-provider-test-'),
);
const journal = options.recoveryPath ?? join(directory, 'recovery.json');
if (options.recoveryPath && !existsSync(journal)) {
  throw new Error('The recovery journal does not exist.');
}
try {
  const result = spawnSync('node_modules/.bin/playwright', [
    'test',
    '--config=playwright.providers.config.ts',
    ...options.arguments,
  ], {
    stdio: 'inherit',
    env: {
      ...safeWranglerEnvironment(),
      MINSKY_TEST_PROVIDER: options.provider,
      MINSKY_CF_TEST_ACCOUNT: options.account,
      MINSKY_CF_TEST_DATABASE: options.database,
      MINSKY_CF_TEST_CONFIG: options.config,
      MINSKY_CF_TEST_ORIGIN: options.origin,
      MINSKY_PROVIDER_JOURNAL: journal,
      MINSKY_PROVIDER_RECOVERY: options.recoveryPath ? 'true' : 'false',
      // Suppress debug modes that can record request headers or arguments.
      DEBUG: '',
      PWDEBUG: '',
      PLAYWRIGHT_NO_COPY_PROMPT: '1',
    },
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (existsSync(journal)) {
    process.exitCode = 1;
    console.error(
      `Fixture cleanup is incomplete. IDs-only recovery journal: ${journal}`,
    );
  } else if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
}
