import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { createTestHarness } from 'wrangler';
import { randomSecret } from '../../src/server/adapters/cloudflare/password';
import { applyMigrations } from '../../src/server/adapters/d1/testFixture';
import { createLocalUiFixture, type LocalUiEnvironment } from './local-ui-fixture';
import { runUiJourney } from './ui-journey';

test('complete local React UI journey uses real HTTPS, D1, R2, and Durable Objects', async ({ browser }) => {
  const directory = process.env.MINSKY_CF_LOCAL_UI_DIRECTORY;
  if (process.env.MINSKY_CF_LOCAL_UI !== '1' || !directory || process.env.PLAYWRIGHT_NO_COPY_PROMPT !== '1') {
    throw new Error('Use the local UI runner. Only temporary local bindings and credential-safe output are permitted.');
  }
  let origin = 'https://127.0.0.1';
  const secret = randomSecret();
  const config = {
    name: 'minsky-connector-react-local-only', main: resolve('src/server/adapters/cloudflare/applicationWorker.ts'),
    compatibility_date: '2026-10-13', compatibility_flags: ['nodejs_compat'],
    dev: { local_protocol: 'https' as const },
    vars: { AUTH_ORIGIN: origin, AUTH_SECRET: secret },
    assets: { directory: join(directory, 'assets'), binding: 'ASSETS', run_worker_first: true,
      not_found_handling: 'single-page-application' as const },
    d1_databases: [{ binding: 'DB', database_name: 'minsky-connector-react-local-only', database_id: randomUUID() }],
    r2_buckets: [{ binding: 'IMAGES', bucket_name: 'minsky-connector-react-local-only' }],
    durable_objects: { bindings: [{ name: 'LIVE_UPDATES', class_name: 'SessionLiveCoordinator' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['SessionLiveCoordinator'] }],
  };
  const harness = createTestHarness({ workers: [{ config }] });
  let fixture: Awaited<ReturnType<typeof createLocalUiFixture>> | undefined;
  let phase = 'worker startup';
  try {
    const listening = await harness.listen();
    origin = listening.url.origin;
    phase = 'local authentication origin';
    // Wrangler chooses a fresh port for every harness. Set the exact origin in
    // memory after listening; this does not add a setup route to the Worker.
    await harness.update({ workers: [{ config: { ...config, vars: { AUTH_ORIGIN: origin, AUTH_SECRET: secret } } }] });
    expect((await harness.listen()).url.origin).toBe(origin);
    phase = 'worker environment';
    const env = await harness.getWorker<LocalUiEnvironment>().getEnv();
    phase = 'database migrations';
    await applyMigrations(env.DB);
    phase = 'fictional account setup';
    fixture = await createLocalUiFixture(env, origin, secret);
    await runUiJourney(browser, fixture, { ignoreHTTPSErrors: true });
    await fixture.deleteEventInBrowser(browser);
  } catch (error) {
    if (fixture) throw error;
    // eslint-disable-next-line preserve-caught-error -- Configuration errors can contain the in-memory auth secret.
    throw new Error(`Local setup phase: ${phase}. Provider details were withheld.`);
  } finally {
    try { if (fixture) await fixture.close(); }
    finally { await harness.close(); }
  }
});
