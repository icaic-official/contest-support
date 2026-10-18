import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { safeWranglerEnvironment } from '../src/server/adapters/cloudflare/tooling/safe-environment.mjs';
import { uiReport } from '../src/server/adapters/cloudflare/tooling/test-ui.mjs';

if (process.argv.length !== 2) {
  process.stderr.write('This command accepts no targets or filters. It uses only temporary local resources.\n');
  process.exit(1);
}
const directory = await mkdtemp(join(tmpdir(), 'minsky-connector-react-local-'));
const environment = { ...safeWranglerEnvironment(), VITE_BACKEND: 'cloudflare',
  MINSKY_CF_LOCAL_UI: '1', MINSKY_CF_LOCAL_UI_DIRECTORY: directory, MINSKY_CF_UI_OUTPUT: join(directory, 'artifacts'),
  DEBUG: '', PWDEBUG: '', PW_TEST_HTML_REPORT_OPEN: 'never', PLAYWRIGHT_NO_COPY_PROMPT: '1',
};
try {
  const build = spawnSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--outDir', join(directory, 'assets')], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, env: environment,
  });
  if (build.error || build.status !== 0) throw new Error('The temporary Cloudflare frontend build failed.');
  process.stdout.write('Temporary Cloudflare React build complete; the default dist directory is unchanged.\n');
  const result = spawnSync(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.connector-local.config.ts'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8 * 60_000, maxBuffer: 16 * 1024 * 1024, env: environment,
  });
  const summary = uiReport(result.stdout ?? '');
  process.stdout.write(`Local Cloudflare React UI: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped, ${summary.flaky} flaky.\n`);
  for (const phase of summary.phases) process.stdout.write(`Failed UI phase: ${phase}.\n`);
  // Emit only file locations and our own fixed failure labels. Playwright's
  // page snapshots and call arguments stay in this process's memory.
  const locations = new Set((result.stdout ?? '').match(/(?:ui-journey|local-ui(?:-fixture|\.spec)?)\.ts:\d+:\d+/g) ?? []);
  for (const location of locations) process.stdout.write(`Failure location: ${location}.\n`);
  const assertion = /Assertion location (\d+:\d+)\./.exec(result.stdout ?? '');
  if (assertion) process.stdout.write(`Shared UI assertion: ui-journey.ts:${assertion[1]}.\n`);
  const cleanup = /Local UI cleanup left unexpected ([a-z_]+) rows\./.exec(result.stdout ?? '');
  if (cleanup) process.stdout.write(`Local cleanup retained rows in ${cleanup[1]}.\n`);
  const setup = /Local setup phase: ([a-z -]+)\./.exec(result.stdout ?? '');
  if (setup) process.stdout.write(`Local setup phase: ${setup[1]}.\n`);
  if (result.error || result.status !== 0 || summary.passed !== 1 || summary.failed || summary.skipped || summary.flaky || summary.infrastructureErrors) {
    throw new Error('The complete local React UI journey must pass without skips or retries. Browser output was withheld.');
  }
  process.stdout.write('Fixture D1, R2, and Durable Object cleanup verified; unrelated controls survived.\n');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
  process.stdout.write('Temporary frontend, local bindings, and browser artifacts removed.\n');
}
