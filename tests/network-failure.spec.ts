import { USER_ID, expect, fixtureAccount, test } from './support/worker';

test('a sign-in request that cannot reach the server says so', async ({ page, api }) => {
  api.account = fixtureAccount(USER_ID, 'network', 'Network fixture');
  await page.route('**/api/auth/sign-in', (route) => route.abort('failed'));
  await page.goto('/sign-in');
  await page.getByLabel('Username', { exact: true }).fill('network');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Minsky could not reach the server. Check your connection and try again.',
  );
});
