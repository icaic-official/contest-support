import { cleanupFixture, createFixture } from './supabase/fixture';
import type { ScenarioData } from './contracts';

interface PreparedFixture {
  data: ScenarioData;
  browserConfiguration: unknown;
}

/** Providers own fixture setup, browser construction, and recovery. */
interface ProviderDriver {
  browserModule: string;
  create(path: string): Promise<PreparedFixture>;
  cleanup(path: string): Promise<void>;
}

const drivers: Record<string, ProviderDriver> = {
  supabase: {
    browserModule: '/tests/providers/supabase/browser.ts',
    async create(path) {
      const { url, publicKey, ...data } = await createFixture(path);
      return { data, browserConfiguration: { url, publicKey } };
    },
    cleanup: cleanupFixture,
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
