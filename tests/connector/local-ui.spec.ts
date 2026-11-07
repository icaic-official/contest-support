import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { createTestHarness } from 'wrangler';
import { randomSecret } from '../../src/server/adapters/cloudflare/password';
import { applyMigrations } from '../../src/server/adapters/d1/testFixture';
import { createLocalUiFixture, type LocalUiEnvironment } from './local-ui-fixture';
import type { Actor } from '../providers/contracts';
import { privateFill, runUiJourney, type UiFixture } from './ui-journey';

/**
 * Pages that redirect in the same commit that selects a contest. The redirect and the
 * effect that writes `?contest=` then race. Only a production build shows the race,
 * because development StrictMode runs the redirect's effect a second time.
 */
async function checkContestRedirects(browser: Browser, fixture: UiFixture, db: LocalUiEnvironment['DB']) {
  const write = (sql: string, ...values: string[]) => db.prepare(sql).bind(...values).run();
  const atQueue = (page: Page, contest: string) => expect(page).toHaveURL((url) =>
    url.pathname === '/issues' && url.searchParams.get('contest') === contest);
  async function signIn(actor: Actor): Promise<Page> {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const { target, username, password } = fixture.accounts[actor];
    await page.goto(new URL('/sign-in', fixture.origin).href);
    if (target.kind === 'event') await page.getByLabel('Event code', { exact: true }).fill(target.code);
    await privateFill(page.getByLabel('Username', { exact: true }), username);
    await privateFill(page.getByLabel('Password', { exact: true }), password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('[data-ui]')).toBeVisible({ timeout: 45_000 });
    return page;
  }

  // The isolated team holds a seat in the second contest. This entry adds the first. By name, the second opens first.
  await write(`INSERT INTO teams (id, session_id, name, location, entrant_id)
    SELECT ?, ?, 'Provider team 2', location, entrant_id FROM teams WHERE session_id = ?`,
  randomUUID(), fixture.sessionId, fixture.otherSessionId);
  const contestant = await signIn('isolated');
  for (const search of ['', '?contest=bogus']) {
    await contestant.goto(new URL(`/administration${search}`, fixture.origin).href);
    await atQueue(contestant, fixture.otherSessionId);
    await expect(contestant.getByRole('heading', { name: 'Your reports' })).toBeVisible();
  }
  await contestant.context().close();

  // A third contest keeps the list at two after the loss. Its name sorts last, so nothing opens it.
  const third = randomUUID();
  await write(`INSERT INTO sessions (id, event_id, name, intake_open)
    SELECT ?, event_id, 'Provider zulu', 1 FROM sessions WHERE id = ?`, third, fixture.sessionId);
  const juryId = fixture.accounts.jury.id;
  for (const contest of [fixture.otherSessionId, third]) {
    await write('INSERT INTO memberships (session_id, account_id) VALUES (?, ?)', contest, juryId);
    await write(`INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')`, contest, juryId);
  }
  const jury = await signIn('jury');
  await jury.goto(new URL(`/jury?contest=${fixture.sessionId}`, fixture.origin).href);
  await expect(jury.getByRole('heading', { name: 'Award review', exact: true })).toBeVisible();
  await write('DELETE FROM membership_roles WHERE session_id = ? AND account_id = ?', fixture.sessionId, juryId);
  await write('DELETE FROM memberships WHERE session_id = ? AND account_id = ?', fixture.sessionId, juryId);
  await jury.evaluate(() => window.dispatchEvent(new Event('focus')));
  await atQueue(jury, fixture.otherSessionId);
  await expect(jury.locator('[data-ui="organiser-desktop"]')).toBeVisible();
  await jury.context().close();
}

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
    await checkContestRedirects(browser, fixture, env.DB);
  } catch (error) {
    if (fixture) throw error;
    // eslint-disable-next-line preserve-caught-error -- Configuration errors can contain the in-memory auth secret.
    throw new Error(`Local setup phase: ${phase}. Provider details were withheld.`);
  } finally {
    try { if (fixture) await fixture.close(); }
    finally { await harness.close(); }
  }
});
