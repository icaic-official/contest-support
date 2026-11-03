import { spawnSync } from 'node:child_process';
import { open } from 'node:fs/promises';
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parseArguments, readPublicJson, renderWranglerConfiguration, validateProviderConfiguration } from './configuration.mjs';
import { safeWranglerEnvironment } from './safe-environment.mjs';

/** Public planning and configuration never connect to a provider. */
export async function runCli(arguments_, dependencies = {}) {
  const options = parseArguments(arguments_);
  const report = dependencies.report ?? ((message) => process.stdout.write(message + '\n'));
  if (['plan', 'configure'].includes(options.command)) {
    const settings = validateProviderConfiguration(await readPublicJson(options.settings), { allowLocal: options.local });
    const configuration = renderWranglerConfiguration(settings, options.config, { allowLocal: options.local });
    if (options.command === 'plan') {
      report(JSON.stringify({
        status: 'plan_only', config: options.config, target: settings,
        bindings: ['DB', 'IMAGES', 'LIVE_UPDATES', 'ASSETS'],
        secret: 'AUTH_SECRET must be created through the explicit secret command.',
        next: ['configure', 'migrate', 'build and deploy the reviewed application', 'bootstrap', 'secret', 'verify the complete hosted application'],
      }, null, 2));
      return;
    }
    let handle;
    try {
      handle = await open(options.config, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(configuration, null, 2) + '\n');
      await handle.sync();
    } catch {
      throw new Error('Configuration could not be created. Existing files are never replaced.');
    } finally {
      await handle?.close();
    }
    report('Created the public Cloudflare configuration. No provider resources changed.');
    return;
  }
  // Wrangler or its proxy can print provider diagnostics. Keep those streams
  // private to this child and expose only a fixed success or failure message.
  const execute = dependencies.execute ?? ((argumentsChild) => (dependencies.spawn ?? spawnSync)(process.execPath, [
    fileURLToPath(new URL('./operation-runner.mjs', import.meta.url)), ...argumentsChild,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...safeWranglerEnvironment(), CLOUDFLARE_ACCOUNT_ID: options.account },
  }));
  const result = await execute(arguments_);
  if (result.error || result.status !== 0) {
    throw new Error('The confirmed-target operation did not finish normally. Provider output was withheld. Inspect any retained private result before recovery.');
  }
  report(options.command === 'bootstrap'
    ? 'The operation completed. Credentials were saved to the requested private file.'
    : 'The operation completed for the confirmed Cloudflare account and database.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch(() => {
    process.stderr.write('Installation command failed. Check public arguments and targets. Retain any private result file. Provider output was withheld.\n');
    process.exitCode = 1;
  });
}
