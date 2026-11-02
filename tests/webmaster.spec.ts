import { expect, test } from './support/localWorker';

// A webmaster reaches every contest of the shared test database, so the
// contest gets a name of its own before the webmaster picks it.
test.use({ webmaster: 'admin', viewport: { width: 1280, height: 800 } });

test('a promoted webmaster opens its contest as an admin, as before', async ({ page, local }) => {
  const contest = `Webmaster contest ${crypto.randomUUID().slice(0, 8)}`;
  await local.run('UPDATE sessions SET name = ? WHERE id = ?', contest, local.sessions[0]);

  await page.goto('/sign-in');
  await page.getByLabel('Username', { exact: true }).fill('admin');
  await page.getByLabel('Password', { exact: true }).fill(crypto.randomUUID());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /^Contest session: .*\. Change session$/ }).click();
  await page.getByRole('menuitemradio', { name: contest, exact: true }).click();
  await expect(page.getByRole('button', { name: `Contest session: ${contest}. Change session`, exact: true })).toBeVisible();

  const pages = page.getByRole('navigation', { name: 'Console pages' });
  await expect(pages.getByRole('button', { name: 'Accounts', exact: true })).toBeVisible();
  await expect(pages.getByRole('button', { name: 'Award review', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Issue 4 verification Backend', exact: true })).toBeVisible();
  const snapshot = await local.snapshot(local.users.admin, local.sessions[0]);
  expect(snapshot.membership).toMatchObject({ is_admin: true, roles: [] });
  expect(snapshot.members.map((member) => member.person.id)).toContain(local.users.admin);
  const unassigned = await local.snapshot(local.users.admin, local.sessions[1]);
  expect(unassigned.membership).toMatchObject({ team_id: null, is_admin: true, roles: [] });
});
