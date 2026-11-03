import { readInstallationTarget } from '../../../src/server/adapters/cloudflare/tooling/configuration.mjs';
import { confirmTarget, wranglerRunner } from '../../../src/server/adapters/cloudflare/tooling/operations.mjs';
import { resolve } from 'node:path';

export const connectorTarget = {
  accountId: '458ad6a930b0fb717796dfa19ca6a2b1',
  databaseId: 'de43cf95-c024-4e44-860d-8ff179e4e08d',
  databaseName: 'minsky-connector-ci', workerName: 'minsky-connector-ci',
  bucketName: 'minsky-connector-ci-images',
  origin: 'https://minsky-connector-ci.icaic-minsky.workers.dev',
};

/** Accept only the dedicated connector fixture resources and generated entry. */
export async function readFixtureTarget(options) {
  if (options.account !== connectorTarget.accountId || options.database !== connectorTarget.databaseId ||
      options.origin !== connectorTarget.origin || typeof options.config !== 'string' || !options.config) {
    throw new Error('Select the exact isolated Cloudflare connector CI target.');
  }
  const configPath = resolve(options.config);
  const settings = await readInstallationTarget(configPath);
  if (Object.entries(connectorTarget).some(([key, value]) => settings[key] !== value)) {
    throw new Error('The configuration does not identify the isolated Cloudflare connector CI resources.');
  }
  return { ...connectorTarget, configPath };
}

/** Provider commands are read-only. R2 cleanup uses exact keys without a list grant. */
export async function confirmFixtureTarget(target, run = wranglerRunner(target, target.configPath)) {
  await confirmTarget({ account: target.accountId, database: target.databaseId }, target, run);
}

export async function checkCloudflareBackend(options, dependencies = {}) {
  const target = await readFixtureTarget(options);
  await confirmFixtureTarget(target, dependencies.runWrangler ?? wranglerRunner(target, target.configPath));
  const response = await (dependencies.request ?? globalThis.fetch)(new globalThis.URL('/api/contests', target.origin), {
    cache: 'no-store', redirect: 'error', signal: globalThis.AbortSignal.timeout(30_000), headers: { Accept: 'application/json' },
  });
  const body = await response.json().catch(() => undefined);
  if (response.status !== 401 || body?.error !== 'Sign in to continue.' ||
      !response.headers.get('Cache-Control')?.includes('no-store')) {
    throw new Error('The isolated Worker does not expose the expected protected application entry. No fixtures were created.');
  }
  return target;
}
