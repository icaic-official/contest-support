import type { Page } from '@playwright/test';
import type { SiteOverview } from '../src/backend/contracts';
import {
  type FakeWorker,
  SESSION_ID,
  TEAM_ID,
  USER_ID,
  expect,
  fixtureAccount,
  sessionSnapshot,
  test,
} from './support/worker';

async function submitCredentials(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Username', { exact: true }).fill('network');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('a sign-in request that cannot reach the server says so', async ({ page, api }) => {
  api.account = fixtureAccount(USER_ID, 'network', 'Network fixture');
  await page.route('**/api/auth/sign-in', (route) => route.abort('failed'));
  await submitCredentials(page);
  await expect(page.getByRole('alert')).toHaveText(
    'Minsky could not reach the server. Check your connection and try again.',
  );
});

const snapshotRequest = /\/api\/snapshot(\?|$)/;

/** Signs in as a contestant. The test routes the snapshot request before it calls this. */
async function signInWithoutSnapshot(page: Page, api: FakeWorker) {
  api.account = fixtureAccount(USER_ID, 'network', 'Network fixture');
  api.snapshots = () => [sessionSnapshot({
    session_id: SESSION_ID, user_id: USER_ID, team_id: TEAM_ID, roles: [], is_admin: false,
  })];
  await submitCredentials(page);
  await expect(page.getByRole('heading', { name: 'Session access', exact: true })).toBeVisible();
}

test('a lost session read blames the connection, not the account', async ({ page, api }) => {
  await page.route(snapshotRequest, (route) => route.abort('failed'));
  await signInWithoutSnapshot(page, api);
  await expect(page.getByText('Minsky could not load your session.'))
    .toBeVisible();
  await expect(page.getByText(/ask an organizer to assign your membership/)).toHaveCount(0);
});

const site: SiteOverview = {
  webmasters: [], restrictWebmasterReads: false, events: [], deletions: [], contestsToJoin: [],
};

test('a webmaster keeps the way to the site page and Sign out when the session read fails', async ({ page, api }) => {
  api.site = site;
  await page.route(snapshotRequest, (route) => route.abort('failed'));
  await signInWithoutSnapshot(page, api);
  await expect(page.getByText('Minsky could not load your session.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the site page', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
});

test('a webmaster whose site restricts reads still sees why the session read failed', async ({ page, api }) => {
  api.site = { ...site, restrictWebmasterReads: true, contestsToJoin: [{ id: SESSION_ID, name: 'Contest to join', eventName: 'Fixture event' }] };
  await page.route(snapshotRequest, (route) => route.abort('failed'));
  await signInWithoutSnapshot(page, api);
  await expect(page.getByText('Minsky could not load your session.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the site page', exact: true })).toBeVisible();
});

test('an account without a membership still gets the organizer hint', async ({ page, api }) => {
  api.account = fixtureAccount(USER_ID, 'network', 'Network fixture');
  api.snapshots = () => [];
  await submitCredentials(page);
  await expect(page.getByText(/ask an organizer to assign your membership/)).toBeVisible();
  await expect(page.getByText(/Check your connection/)).toHaveCount(0);
});

test('the Refresh access button stays disabled while the read runs', async ({ page, api }) => {
  let release = () => {};
  let hold = Promise.resolve();
  await page.route(snapshotRequest, async (route) => {
    await hold;
    await route.abort('failed');
  });
  await signInWithoutSnapshot(page, api);
  const refresh = page.getByRole('button', { name: 'Refresh access', exact: true });
  await expect(refresh).toBeEnabled();
  hold = new Promise<void>((resolve) => { release = resolve; });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  release();
  await expect(refresh).toBeEnabled();
});
