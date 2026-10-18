import { test as base } from '@playwright/test';
import { existsSync } from 'node:fs';
import type { Backend } from '../../src/backend/contracts';
import { type BrowserBackend, createBrowserBackend } from './browser-backend';
import type { ScenarioContext, ScenarioData } from './contracts';
import { providerDriver } from './drivers';

interface PreparedFixture {
  data: ScenarioData;
  module: string;
  configuration: unknown;
  origin: string;
  assetOrigin?: string;
}

export const test = base.extend<
  { provider: ScenarioContext },
  { prepared: PreparedFixture }
>({
  prepared: [async ({ browser }, runTests) => {
    if (!browser.isConnected()) {
      throw new Error('The provider test browser is unavailable.');
    }
    const driver = providerDriver(process.env.MINSKY_TEST_PROVIDER);
    const path = process.env.MINSKY_PROVIDER_JOURNAL;
    if (!path) {
      throw new Error('Run through test:providers to retain recovery IDs.');
    }
    if (existsSync(path)) {
      throw new Error('Recover the previous fixture before another run.');
    }
    try {
      const fixture = await driver.create(path);
      await runTests({
        data: fixture.data,
        module: driver.browserModule,
        configuration: fixture.browserConfiguration,
        origin: driver.browserOrigin ?? 'http://127.0.0.1:4174',
        assetOrigin: driver.assetOrigin,
      });
    } finally {
      if (existsSync(path)) await driver.cleanup(path);
    }
  }, { scope: 'worker', timeout: 180000 }],
  provider: async ({ browser, prepared }, runTest) => {
    const clients = new Map<Backend, BrowserBackend>();
    const context: ScenarioContext = {
      ...prepared.data,
      async connect(actor) {
        const connection = await createBrowserBackend(browser, {
          origin: prepared.origin,
          assetOrigin: prepared.assetOrigin,
          module: prepared.module,
          configuration: prepared.configuration,
        });
        clients.set(connection.backend, connection);
        if (actor) {
          const account = prepared.data.accounts[actor];
          await connection.backend.auth.signIn(
            account.username,
            account.password,
          );
        }
        return connection.backend;
      },
      discardNextWorkflowResponse(backend) {
        const connection = clients.get(backend);
        if (!connection) {
          throw new Error('The backend does not belong to this fixture.');
        }
        connection.discardNextWorkflowResponse();
      },
      async close() {
        const results = await Promise.allSettled(
          [...clients.values()].map((client) => client.close()),
        );
        clients.clear();
        if (results.some((result) => result.status === 'rejected')) {
          throw new Error(
            'A browser client could not close. Server fixture cleanup will still run.',
          );
        }
      },
    };
    try {
      await runTest(context);
    } finally {
      await context.close();
    }
  },
});
