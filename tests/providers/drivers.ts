import type { ScenarioData } from './contracts';
import { cleanupFixture as cleanupCloudflareFixture, createFixture as createCloudflareFixture } from './cloudflare/fixture';
import { createDiagnostics } from './cloudflare/diagnostics';
import { inspectFixtureAuthentication } from './cloudflare/fixture';
import type { BrowserDiagnostics } from './browser-backend';

interface PreparedFixture {
  data: ScenarioData;
  browserConfiguration: unknown;
}

/** Providers own fixture setup, browser construction, and recovery. */
interface ProviderDriver {
  browserModule: string;
  browserOrigin?: string | undefined;
  assetOrigin?: string | undefined;
  create(path: string): Promise<PreparedFixture>;
  cleanup(path: string): Promise<void>;
  diagnostics?(path: string, accountId?: string): BrowserDiagnostics;
}

const drivers: Record<string, ProviderDriver> = {
  cloudflare: {
    assetOrigin: 'http://127.0.0.1:4174',
    browserModule: '/tests/providers/cloudflare/browser.ts',
    get browserOrigin() { return process.env.MINSKY_CF_TEST_ORIGIN; },
    async create(path) {
      const { origin, ...data } = await createCloudflareFixture(path);
      return { data, browserConfiguration: { origin } };
    },
    cleanup: cleanupCloudflareFixture,
    diagnostics: (path, accountId) => createDiagnostics(accountId,
      accountId ? () => inspectFixtureAuthentication(path, accountId) : undefined),
  },
};

export function providerDriver(name: string | undefined): ProviderDriver {
  const selected = name && Object.hasOwn(drivers, name)
    ? drivers[name]
    : undefined;
  if (!selected) {
    throw new Error('Select an implemented provider through test:providers.');
  }
  return selected;
}
