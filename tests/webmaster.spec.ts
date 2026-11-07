import { expect, test } from './support/localWorker';

// A webmaster reaches every contest of the shared test database, so the
// contest gets a name of its own before the webmaster picks it.
test.use({ webmaster: 'admin', viewport: { width: 1280, height: 800 } });

test('a promoted webmaster opens its contest as an admin, as before', async ({ page, local }) => {
  const contest = `Webmaster contest ${crypto.randomUUID().slice(0, 8)}`;
  await local.run('UPDATE sessions SET name = ? WHERE id = ?', contest, local.sessions[0]);

  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Site sign-in', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill('admin');
  await page.getByLabel('Password', { exact: true }).fill(crypto.randomUUID());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /^Contest session: .*\. Change session$/ }).click();
  await page.getByRole('menuitemradio', { name: contest }).click();
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

test('a webmaster opens another contest from the site calendar and reaches its queue', async ({ page, local }) => {
  const current = `Current ${crypto.randomUUID().slice(0, 8)}`;
  const other = `Calendar ${crypto.randomUUID().slice(0, 8)}`;
  await local.run('UPDATE sessions SET name = ? WHERE id = ?', current, local.sessions[0]);
  await local.run(
    `UPDATE sessions SET name = ?, starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hours'),
      ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+2 hours'), grace_minutes = 0 WHERE id = ?`,
    other,
    local.sessions[1],
  );
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Site sign-in', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill('admin');
  await page.getByLabel('Password', { exact: true }).fill(crypto.randomUUID());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // The site calendar offers Open on the selected contest too, so select another one first.
  await page.getByRole('button', { name: /^Contest session: .*\. Change session$/ }).click();
  await page.getByRole('menuitemradio', { name: current }).click();
  await expect(page.getByRole('button', { name: `Contest session: ${current}. Change session`, exact: true })).toBeVisible();

  await page.getByRole('complementary', { name: 'Console' }).getByRole('link', { name: 'Site', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Site', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: `Open ${other}`, exact: true }).click();

  await expect(page.getByRole('button', { name: `Contest session: ${other}. Change session`, exact: true })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === '/issues' && url.searchParams.get('contest') === local.sessions[1]);
  await expect(page.getByRole('heading', { name: 'Site', level: 1 })).toHaveCount(0);
});

test('a webmaster turns the restriction on, joins a contest, and sees the join in its audit', async ({ page, local }) => {
  // The webmaster holds no membership in the second contest, so only the join opens it.
  const contest = `Join contest ${crypto.randomUUID().slice(0, 8)}`;
  await local.run('UPDATE sessions SET name = ? WHERE id = ?', contest, local.sessions[1]);
  // The setting is one row for the whole shared database, so the test turns it off again.
  try {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Site sign-in', exact: true }).click();
    await page.getByLabel('Username', { exact: true }).fill('admin');
    await page.getByLabel('Password', { exact: true }).fill(crypto.randomUUID());
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('complementary', { name: 'Console' }).getByRole('link', { name: 'Site', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Site', level: 1 })).toBeVisible();
    await expect(page.getByText(/^\d{2}:\d{2}$/)).toBeVisible();
    await expect(page.getByText(Intl.DateTimeFormat().resolvedOptions().timeZone, { exact: true })).toBeVisible();

    const restriction = page.getByRole('switch', { name: 'Webmasters read contest data only after joining' });
    await expect(restriction).not.toBeChecked();
    await restriction.click();
    await expect(restriction).toBeChecked();
    expect((await local.snapshot(local.users.admin, local.sessions[1])).membership).toBeNull();

    const contests = page.getByRole('region', { name: 'Contests to join' });
    await expect(contests.getByText('Join this contest to read its issues and notes.', { exact: false })).toBeVisible();
    await contests.getByRole('button', { name: `Join ${contest}`, exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Console' }).getByText(contest, { exact: true })).toBeVisible();
    expect((await local.snapshot(local.users.admin, local.sessions[1])).audit).toEqual([
      expect.objectContaining({ action: 'webmaster_join', actor: local.users.admin }),
    ]);

    await page.getByRole('navigation', { name: 'Console pages' }).getByRole('button', { name: 'Accounts', exact: true }).click();
    const activity = page.locator('details').filter({ hasText: 'Recent administration activity' });
    await activity.getByText('Recent administration activity').click();
    const join = activity.getByRole('listitem').filter({ hasText: 'Joined to read this contest' });
    await expect(join).toContainText('A webmaster');
    await expect(join).not.toContainText(local.users.admin);
  } finally {
    await local.manage(local.users.admin, { type: 'set_webmaster_reads', restricted: false });
  }
});
