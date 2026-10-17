import {expect, test} from '@playwright/test';

test('documentation navigation and direct page reload work', async ({page}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.setViewportSize({width: 1440, height: 1000});
  await expect(page.getByRole('heading', {level: 1})).toHaveText('Contest support, explained.');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({path: testInfo.outputPath('docs-desktop.png'), fullPage: true});
  await page.getByRole('link', {name: 'Start using Minsky'}).click();
  await expect(page).toHaveURL(/\/guides\/getting-started\/$/);
  await page.reload();
  await expect(page.getByRole('heading', {level: 1})).toHaveText('Sign in and get access');
  await page.getByRole('link', {name: 'Write and deploy these docs', exact: true}).click();
  await expect(page.getByRole('heading', {level: 1})).toHaveText('Write and deploy these docs');
  expect(errors).toEqual([]);
});

test('search can be opened by keyboard and finds an indexed page', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Search', exact: true}).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', {name: 'Search', exact: true});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', {name: 'Search', exact: true}).fill('handoff');
  const result = dialog.getByRole('link', {name: /Investigate and resolve issues/}).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/\/guides\/staff\//);
  await expect(page.getByRole('heading', {level: 1})).toHaveText('Investigate and resolve issues');
});

test('phone navigation and a missing page remain usable', async ({page}, testInfo) => {
  await page.setViewportSize({width: 320, height: 844});
  await page.goto('/guides/contestants/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', {name: 'Skip to content'})).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('button', {name: 'Menu', exact: true}).click();
  await page.getByRole('link', {name: 'Installation options', exact: true}).click();
  await expect(page.getByRole('heading', {level: 1})).toHaveText('Prepare an independent installation');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('docs-phone.png')});
  const response = await page.goto('/this-page-does-not-exist/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', {level: 1})).toContainText('404');
});
