import process from 'node:process';
import console from 'node:console';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkCloudBackend } from './check-cloud-backend.mjs';
import { providerTestOptions } from './provider-test-options.mjs';

const options = providerTestOptions(process.argv.slice(2), process.env);
if (!options.recoveryPath) await checkCloudBackend();
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
      ...process.env,
      MINSKY_TEST_PROVIDER: 'supabase',
      MINSKY_TEST_PROJECT_REF: options.project,
      MINSKY_PROVIDER_JOURNAL: journal,
      MINSKY_PROVIDER_RECOVERY: options.recoveryPath ? 'true' : 'false',
      // Suppress debug modes that can record request headers or arguments.
      DEBUG: '',
      PWDEBUG: '',
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
