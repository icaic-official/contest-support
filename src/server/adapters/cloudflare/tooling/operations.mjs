import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { bundleProviderModule } from './bundle.mjs';
import { readInstallationTarget, readPublicJson, repositoryRoot } from './configuration.mjs';
import { assertCurrentMigrations } from './migrations.mjs';
import { enforceWranglerEnvironment, safeWranglerEnvironment } from './safe-environment.mjs';

/** Capture all provider output. Errors must not disclose its body or arguments. */
export function wranglerRunner(settings, configPath, spawn = spawnSync) {
  return (arguments_, { input } = {}) => {
    const result = spawn(process.execPath, [
      resolve(repositoryRoot, 'node_modules/wrangler/bin/wrangler.js'), ...arguments_, '--config', configPath,
    ], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
      input,
      env: { ...safeWranglerEnvironment(), CLOUDFLARE_ACCOUNT_ID: settings.accountId, CI: '1' },
    });
    if (result.error || result.status !== 0) {
      throw new Error('The Cloudflare command failed. Provider output was withheld.');
    }
    return result.stdout;
  };
}

/** Check explicit IDs and live metadata before any hosted mutation. */
export async function confirmTarget(options, settings, runWrangler) {
  if (options.account !== settings.accountId || options.database !== settings.databaseId) {
    throw new Error('Supply --account and --database that exactly match the selected configuration.');
  }
  let info;
  try {
    const identity = await runWrangler(['whoami']);
    if (!new RegExp(`\\b${settings.accountId}\\b`).test(identity)) throw new Error('Account mismatch');
    info = JSON.parse(await runWrangler(['d1', 'info', settings.databaseName, '--json']));
  } catch {
    throw new Error('The exact Cloudflare account and database could not be confirmed. No operation started.');
  }
  if (info.uuid !== settings.databaseId || info.name !== settings.databaseName) {
    throw new Error('Hosted D1 metadata does not match the selected target. No operation started.');
  }
}

function within(parent, target) {
  const path = relative(parent, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

/** Reserve a new private result before credential changes can start. */
export async function reserveCredentialOutput(path) {
  if (!isAbsolute(path)) throw new Error('Use an absolute path for the private credential output.');
  let parent;
  try {
    parent = await realpath(dirname(path));
  } catch {
    throw new Error('The private credential directory must already exist.');
  }
  if (within(await realpath(repositoryRoot), resolve(parent, basename(path)))) {
    throw new Error('Keep credential output outside the repository checkout.');
  }
  try {
    return await open(join(parent, basename(path)), 'wx', 0o600);
  } catch {
    throw new Error('Create a new private credential output file. Existing files are never replaced.');
  }
}

async function writePrivateResult(handle, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (bytesWritten === 0) throw new Error('Private result could not be saved.');
    offset += bytesWritten;
  }
  await handle.truncate(bytes.length);
  await handle.sync();
}

/** Bundle the installation library. Its preparation failures never start an operation. */
export async function loadInstallationLibrary() {
  try {
    return await bundleProviderModule('src/server/adapters/cloudflare/installation.ts', 'installation-operator-');
  } catch {
    throw new Error('The installation library could not be prepared. No operation started.');
  }
}

async function openRemotePlatform(configPath) {
  enforceWranglerEnvironment();
  const { getPlatformProxy } = await import('wrangler');
  return getPlatformProxy({ configPath, remoteBindings: true, persist: false, envFiles: [] });
}

/**
 * Execute only inside the output-capturing child process in install.mjs.
 * Tests inject provider dependencies and never contact Cloudflare.
 */
export async function runTrustedCommand(options, dependencies = {}) {
  enforceWranglerEnvironment();
  const settings = await readInstallationTarget(options.config);
  const runWrangler = dependencies.runWrangler ?? wranglerRunner(settings, options.config);
  await confirmTarget(options, settings, runWrangler);
  if (options.command !== 'migrate') await assertCurrentMigrations(settings, runWrangler);
  if (options.command === 'secret') {
    let secrets;
    try {
      secrets = JSON.parse(await runWrangler(['secret', 'list', '--format', 'json']));
      if (!Array.isArray(secrets) || secrets.some((entry) => !entry || typeof entry.name !== 'string')) {
        throw new Error('Invalid secret metadata');
      }
    } catch {
      throw new Error('Existing Worker secrets could not be confirmed. Deploy the selected Worker before initial secret creation.');
    }
    if (secrets.some((entry) => entry.name === 'AUTH_SECRET')) {
      throw new Error('AUTH_SECRET already exists. The installation command never rotates an existing authentication secret.');
    }
    // Only the private stdin pipe carries this generated value.
    const secret = randomBytes(32).toString('hex');
    try {
      await runWrangler(['secret', 'put', 'AUTH_SECRET'], { input: secret + '\n' });
    } catch {
      throw new Error('The authentication secret outcome is unknown. Provider output was withheld.');
    }
    return;
  }
  if (options.command === 'migrate') {
    try {
      await runWrangler(['d1', 'migrations', 'apply', settings.databaseName, '--remote']);
    } catch {
      throw new Error('The migration outcome is unknown. Inspect applied versions before retrying.');
    }
    return;
  }
  if (!['bootstrap', 'recover'].includes(options.command)) throw new Error('Select a trusted installation operation.');
  const prepared = await (dependencies.loadLibrary ?? loadInstallationLibrary)();
  let handle;
  let platform;
  let cleanupFailed = false;
  try {
    const input = options.command === 'bootstrap' ? await readPublicJson(options.competition) : undefined;
    if (input !== undefined) prepared.library.validateCompetitionConfiguration(input);
    handle = await reserveCredentialOutput(options.credentials);
    const metadata = { command: options.command, accountId: settings.accountId, databaseId: settings.databaseId };
    await writePrivateResult(handle, { status: 'prepared', ...metadata });
    platform = await (dependencies.openPlatform ?? openRemotePlatform)(options.config);
    await writePrivateResult(handle, { status: 'operation_started', ...metadata });
    const result = options.command === 'bootstrap'
      ? await prepared.library.bootstrapInstallation(platform.env.DB, input)
      : await prepared.library.recoverInstallationOwner(platform.env.DB, { installationId: options.installation, accountId: options.owner });
    await writePrivateResult(handle, { status: 'completed', provider: metadata, ...result });
  } catch {
    // Keep the exclusive 0600 file, including any completed or partial result.
    // Another recovery uses a new file and never overwrites this evidence.
    throw new Error('The operation did not finish normally. Retain and inspect the private result file before recovery.');
  } finally {
    try {
      await handle?.close();
    } catch {
      cleanupFailed = true;
    }
    try {
      await platform?.dispose();
    } catch {
      cleanupFailed = true;
    }
    try {
      await prepared.dispose();
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) throw new Error('Credentials were saved, but local proxy cleanup failed. Retain the private result file.');
}
