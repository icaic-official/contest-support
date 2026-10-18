import { spawnSync } from 'node:child_process';
import { safeWranglerEnvironment } from './safe-environment.mjs';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { checkCloudflareBackend } from '../../../../../tests/providers/cloudflare/target.mjs';
import { repositoryRoot } from './configuration.mjs';

export function uiArguments(arguments_) {
  const options = {};
  for (const argument of arguments_) {
    const match = /^--(account|database|config|origin)=(.+)$/.exec(argument);
    if (!match || Object.hasOwn(options, match[1])) {
      throw new Error('Supply --account, --database, --config, and --origin once. Test filters are forbidden.');
    }
    options[match[1]] = match[2];
  }
  if (Object.keys(options).length !== 4) throw new Error('Select the explicit isolated connector CI configuration, account, database, and origin.');
  return { ...options, config: resolve(options.config) };
}

/** Return counts and a fixed phase label. Never forward browser diagnostics. */
export function uiReport(output) {
  let data;
  try {
    const start = output.search(/^\{/m);
    data = JSON.parse(output.slice(start));
  } catch {
    throw new Error('The hosted UI result could not be read. Browser output was withheld.');
  }
  const keys = ['expected', 'unexpected', 'skipped', 'flaky'];
  if (!data.stats || keys.some((key) => !Number.isInteger(data.stats[key]) || data.stats[key] < 0)) {
    throw new Error('The hosted UI result has invalid test counts.');
  }
  const phases = [];
  function inspect(suites) {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) for (const result of test.results ?? []) {
        const match = /^(?:Error: )?Hosted UI journey failed during ([a-z -]+)\./.exec(result.error?.message ?? '');
        if (match) phases.push(match[1]);
      }
      inspect(suite.suites);
    }
  }
  inspect(data.suites);
  return { passed: data.stats.expected, failed: data.stats.unexpected,
    skipped: data.stats.skipped, flaky: data.stats.flaky, phases,
    infrastructureErrors: Array.isArray(data.errors) ? data.errors.length : 0 };
}

/** Exact isolated target only. This runner never builds, deploys, or migrates. */
export async function runHostedUi(arguments_, dependencies = {}) {
  const options = uiArguments(arguments_);
  await (dependencies.checkBackend ?? checkCloudflareBackend)(options);
  const directory = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'minsky-connector-ui-'));
  const journal = join(directory, 'recovery.json');
  const report = dependencies.report ?? ((message) => process.stdout.write(message + '\n'));
  let summary;
  try {
    const execute = dependencies.execute ?? ((argumentsChild, commandOptions) => spawnSync(process.execPath, argumentsChild, commandOptions));
    const result = await execute([resolve(repositoryRoot, 'node_modules/@playwright/test/cli.js'), 'test',
      '--config', resolve(repositoryRoot, 'playwright.connector.config.ts')], {
      cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 8 * 60_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...safeWranglerEnvironment(),
        MINSKY_CF_TEST_ACCOUNT: options.account, MINSKY_CF_TEST_DATABASE: options.database,
        MINSKY_CF_TEST_CONFIG: options.config, MINSKY_CF_TEST_ORIGIN: options.origin,
        MINSKY_CF_UI_JOURNAL: journal, MINSKY_CF_UI_OUTPUT: join(directory, 'artifacts'),
        DEBUG: '', PWDEBUG: '', PW_TEST_HTML_REPORT_OPEN: 'never',
        PLAYWRIGHT_NO_COPY_PROMPT: '1', WRANGLER_SEND_METRICS: 'false',
      },
    });
    summary = uiReport(result.stdout ?? '');
    report(`Hosted Cloudflare UI: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped, ${summary.flaky} flaky.`);
    for (const phase of summary.phases) report(`Failed UI phase: ${phase}.`);
    if (result.error || result.status !== 0 || summary.passed !== 1 || summary.failed || summary.skipped || summary.flaky || summary.infrastructureErrors) {
      throw new Error('The complete hosted React UI journey must pass without skips or retries. Browser output was withheld.');
    }
  } finally {
    if (existsSync(journal)) report(`Fixture cleanup is incomplete. IDs-only recovery journal: ${journal}`);
    else await rm(directory, { recursive: true, force: true });
  }
  if (existsSync(journal)) throw new Error('Fixture cleanup is unverified. Retain the IDs-only recovery journal.');
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHostedUi(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
