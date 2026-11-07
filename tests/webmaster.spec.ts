import type { Locator, Page } from '@playwright/test';
import type { ManageCommand } from '../src/backend/contracts';
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

test.describe('deleting an event', () => {
  async function openSite(page: Page) {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Site sign-in', exact: true }).click();
    await page.getByLabel('Username', { exact: true }).fill('admin');
    await page.getByLabel('Password', { exact: true }).fill(crypto.randomUUID());
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'));
    await page.goto('/site');
    await expect(page.getByRole('heading', { name: 'Site', level: 1 })).toBeVisible();
  }

  const newEvent = async (local: { manage(user: string, command: ManageCommand): Promise<unknown>; users: { admin: string } }, label = 'Doomed event') => {
    const unique = crypto.randomUUID().slice(0, 8);
    const name = `${label} ${unique}`;
    await local.manage(local.users.admin, {
      type: 'create_event', name, code: `doomed-${unique}`, timeZone: 'UTC',
      firstAdmin: { handle: `admin-${unique}`, name: 'Fictional admin' },
    });
    return name;
  };

  const animationsDone = (locator: Locator) => locator.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)).then(() => undefined));

  test('names what is lost, needs the exact name, and shows progress, by keyboard', async ({ page, local }) => {
    const name = await newEvent(local);
    await openSite(page);
    const open = page.getByRole('button', { name: `Delete ${name}`, exact: true });
    await open.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: `Delete ${name}?` });
    await expect(dialog).toContainText('0 contests and 1 account');
    await expect(dialog).toContainText('Every issue, reply, note, award, image, and announcement');
    await expect(dialog).toContainText('You cannot undo this.');
    await expect(dialog).toContainText('Everyone in this event is signed out at once');
    await expect(dialog).toContainText('a running contest stops');
    await expect(dialog).toContainText('name and code stay in the site record');
    const confirm = dialog.getByRole('button', { name: 'Delete event', exact: true });
    const typed = dialog.getByLabel('Type the event name to confirm');
    await expect(confirm).toBeDisabled();
    await expect(typed).toHaveAttribute('autocorrect', 'off');
    await expect(typed).toHaveAttribute('autocapitalize', 'off');
    await expect(typed).toHaveAttribute('spellcheck', 'false');
    await typed.fill(name.toUpperCase());
    await expect(confirm).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();

    await open.click();
    await typed.fill(name);
    await expect(confirm).toBeEnabled();
    await typed.press('Enter');
    const deletions = page.getByRole('region', { name: /^Deletions/ });
    await expect(deletions.getByText(name)).toBeVisible();
    await expect(deletions.getByText('Deleting contests and accounts')).toBeVisible();
    await expect(open).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^Deletions/ })).toBeFocused();
    await expect(page.getByText(`Deleting ${name}. Its progress is under Deletions.`)).toBeVisible();
  });

  test('confirms an unnamed event with its code, and never enables the action on empty input', async ({ page, local }) => {
    const unique = crypto.randomUUID().slice(0, 8);
    const code = `unnamed-${unique}`;
    const { eventId } = await local.manage(local.users.admin, {
      type: 'create_event', name: `Soon unnamed ${unique}`, code, timeZone: 'UTC',
      firstAdmin: { handle: `admin-${unique}`, name: 'Fictional admin' },
    });
    await local.run(`UPDATE events SET name = '' WHERE id = ?`, eventId ?? '');
    await openSite(page);
    await page.getByRole('button', { name: `Delete ${code}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Delete the unnamed event ${code}?` });
    const confirm = dialog.getByRole('button', { name: 'Delete event', exact: true });
    const typed = dialog.getByLabel('Type the event code to confirm');
    await expect(typed).toHaveValue('');
    await expect(confirm).toBeDisabled();
    await typed.press('Enter');
    await expect(dialog).toBeVisible();
    await typed.fill(`${code}x`);
    await expect(confirm).toBeDisabled();
    await typed.fill(code);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    const deletions = page.getByRole('region', { name: /^Deletions/ });
    await expect(deletions.getByText('Unnamed event', { exact: true })).toBeVisible();
    await expect(deletions.getByText(code)).toBeVisible();
  });

  test('stays open while its request runs, so the next Cancel returns focus to its own button', async ({ page, local }) => {
    const first = await newEvent(local);
    const second = await newEvent(local);
    await openSite(page);
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/manage', async (route) => {
      await held;
      await route.fallback();
    });
    await page.getByRole('button', { name: `Delete ${first}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Delete ${first}?` });
    const typed = dialog.getByLabel('Type the event name to confirm');
    await typed.fill(first);
    await typed.press('Enter');
    await expect(dialog.getByRole('button', { name: 'Delete event', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    release();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^Deletions/ })).toBeFocused();
    await page.unroute('**/api/manage');

    const next = page.getByRole('button', { name: `Delete ${second}`, exact: true });
    await next.click();
    await page.getByRole('dialog', { name: `Delete ${second}?` }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(next).toBeFocused();
  });

  for (const width of [320, 390]) {
    test(`keeps a side gutter and wraps a long unbroken name at ${width} pixels`, async ({ page, local }, testInfo) => {
      await page.setViewportSize({ width, height: 720 });
      const name = await newEvent(local, `Long${'x'.repeat(180)}`);
      await openSite(page);
      await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `Delete ${name}?` });
      await animationsDone(dialog);
      await page.screenshot({ path: testInfo.outputPath(`delete-dialog-${width}.png`) });
      const box = await dialog.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(16);
      expect(width - (box?.x ?? 0) - (box?.width ?? 0)).toBeGreaterThanOrEqual(16);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      const title = await dialog.getByRole('heading', { name: `Delete ${name}?` }).boundingBox();
      expect((title?.x ?? 0) + (title?.width ?? 0)).toBeLessThanOrEqual((box?.x ?? 0) + (box?.width ?? 0));
      await dialog.getByLabel('Type the event name to confirm').fill(name);
      await dialog.getByRole('button', { name: 'Delete event', exact: true }).click();
      await expect(page.getByRole('region', { name: /^Deletions/ }).getByText(name)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test(`fits a phone of ${width} pixels`, async ({ page, local }) => {
      await page.setViewportSize({ width, height: 720 });
      const name = await newEvent(local);
      await openSite(page);
      const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(await fits()).toBe(true);
      await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `Delete ${name}?` });
      await dialog.getByLabel('Type the event name to confirm').fill(name);
      expect(await fits()).toBe(true);
      await dialog.getByRole('button', { name: 'Delete event', exact: true }).click();
      await expect(page.getByRole('region', { name: /^Deletions/ }).getByText(name)).toBeVisible();
      expect(await fits()).toBe(true);
    });
  }
});
