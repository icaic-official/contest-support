import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { createTestHarness } from 'wrangler';
import { contestRecordSchema } from '../../src/connected/contestRecord';
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
async function signInAs(browser: Browser, fixture: UiFixture, actor: Actor): Promise<Page> {
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

/**
 * An event admin downloads the primary contest's archive through the real Worker route and image routes.
 * The database after the journey is the expected content.
 */
async function checkContestArchive(browser: Browser, fixture: UiFixture, db: LocalUiEnvironment['DB']) {
  const all = async <T>(sql: string, ...values: string[]) => (await db.prepare(sql).bind(...values).all<T>()).results;
  // A workflow line such as "Image added." can be internal on one image and public on another.
  const notes = await all<{ text: string }>(`SELECT h.text FROM history h JOIN issues i ON i.id = h.issue_id
    WHERE i.session_id = ? AND h.visibility = 'internal' AND NOT EXISTS (SELECT 1 FROM history p
      JOIN issues pi ON pi.id = p.issue_id WHERE pi.session_id = i.session_id AND p.visibility = 'public' AND p.text = h.text)`,
  fixture.sessionId);
  const images = await all<{ id: string; visibility: string; original_digest: string }>(`SELECT id, visibility, original_digest
    FROM issue_images WHERE session_id = ? AND state = 'ready'`, fixture.sessionId);
  const removed = await all<{ id: string }>(`SELECT id FROM issue_images WHERE session_id = ? AND state IN ('deleting', 'deleted')`, fixture.sessionId);
  expect(notes.length, 'the journey wrote an internal note').toBeGreaterThan(0);
  expect(images.length, 'the journey kept a ready image').toBeGreaterThan(0);

  const page = await signInAs(browser, fixture, 'eventAdmin');
  await page.goto(new URL('/event', fixture.origin).href);
  await page.getByRole('tab', { name: 'Contests', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download archive of Provider primary', exact: true }).click();
  const download = await downloaded;
  await expect(page.getByText('Archive downloaded.', { exact: true })).toBeVisible();
  const files = unzipSync(new Uint8Array(await readFile(await download.path())));
  await page.context().close();

  const paths = Object.keys(files);
  const root = paths[0]!.split('/')[0]!;
  const text = (path: string) => strFromU8(files[`${root}/${path}`]!);
  const record = contestRecordSchema.parse(JSON.parse(text('staff-only/record.json')));
  expect(record.contest.id).toBe(fixture.sessionId);
  expect(record.issues.every((issue) => issue.session_id === fixture.sessionId), 'no issue of another contest').toBe(true);
  const manifest = JSON.parse(text('manifest.json')) as { missing: unknown[] };
  expect(manifest.missing, 'every ready image downloaded').toEqual([]);
  const contestantFiles = paths.filter((path) => path.startsWith(`${root}/contestant-visible/`));
  for (const { text: note } of notes) {
    expect(text('staff-only/log.html'), 'the staff log holds the note').toContain(note);
    for (const path of contestantFiles) expect(strFromU8(files[path]!), path).not.toContain(note);
  }
  const digest = (path: string) => createHash('sha256').update(files[path]!).digest('hex');
  for (const image of images) {
    const folder = image.visibility === 'public' ? 'contestant-visible' : 'staff-only';
    const path = paths.find((candidate) => candidate.startsWith(`${root}/${folder}/images/`) && candidate.includes(image.id.slice(0, 8)));
    expect(path, `image ${image.visibility}`).toBeDefined();
    expect(digest(path!), 'the archived bytes match the stored digest').toBe(image.original_digest);
  }
  for (const image of removed) {
    expect(paths.some((path) => path.includes(image.id.slice(0, 8))), 'a removed image has no file').toBe(false);
    expect(record.issue_images.find((row) => row.id === image.id)?.original_path, 'a removed image keeps its row').toBeNull();
  }
}

async function checkContestRedirects(browser: Browser, fixture: UiFixture, db: LocalUiEnvironment['DB']) {
  const write = (sql: string, ...values: string[]) => db.prepare(sql).bind(...values).run();
  const atQueue = (page: Page, contest: string) => expect(page).toHaveURL((url) =>
    url.pathname === '/issues' && url.searchParams.get('contest') === contest);
  const signIn = (actor: Actor) => signInAs(browser, fixture, actor);

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
    await checkContestArchive(browser, fixture, env.DB);
    await checkContestRedirects(browser, fixture, env.DB);
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
