import { expect, test, type Locator, type Page } from '@playwright/test';
import { defaultIssues, type FixtureIssue, signInConsole } from './support/consoleFixture';

const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };

function statusGroup(page: Page): Locator {
  return page.getByRole('group', { name: 'Filter by status' });
}

function statusTab(page: Page, label: string): Locator {
  return statusGroup(page).getByRole('button', { name: new RegExp(`^${label} \\d+$`) });
}

function marker(list: Locator): Locator {
  return list.locator('[data-slot="sliding-indicator"]');
}

/**
 * The largest difference between the indicator and the tab on the axes that
 * the style fills. `centre` compares the horizontal centres only.
 */
async function gap(indicator: Locator, tab: Locator, axes: 'box' | 'horizontal' | 'centre'): Promise<number> {
  const [a, b] = await Promise.all([indicator.boundingBox(), tab.boundingBox()]);
  if (!a || !b) return Infinity;
  if (axes === 'centre') return Math.abs(a.x + a.width / 2 - (b.x + b.width / 2));
  const horizontal = [a.x - b.x, a.width - b.width];
  const vertical = [a.y - b.y, a.height - b.height];
  return Math.max(...(axes === 'box' ? [...horizontal, ...vertical] : horizontal).map(Math.abs));
}

/** Records the left edge of an element on every frame, until the page asks for the trail. */
async function startTrail(target: Locator) {
  await target.evaluate((element) => {
    const trail: number[] = [];
    const state = window as unknown as { trail: number[]; trailing: boolean };
    state.trail = trail;
    state.trailing = true;
    const frame = () => {
      trail.push(element.getBoundingClientRect().left);
      if (state.trailing) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function stopTrail(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const state = window as unknown as { trail: number[]; trailing: boolean };
    state.trailing = false;
    return state.trail;
  });
}

/**
 * Stops the running transitions of an element halfway through. A test then
 * reads the in-between state without a race against frame timing.
 */
async function freezeMidway(target: Locator): Promise<void> {
  // Finding and pausing the transition in one page call keeps a slow machine
  // from letting it end between the two steps.
  await target.evaluate(async (element) => {
    const deadline = Date.now() + 5000;
    let running = element.getAnimations();
    while (!running.length && Date.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      running = element.getAnimations();
    }
    if (!running.length) throw new Error('No transition started.');
    for (const animation of running) {
      animation.pause();
      animation.currentTime = Number(animation.effect?.getComputedTiming().duration ?? 0) / 2;
    }
  });
}

async function finishAnimations(target: Locator): Promise<void> {
  await target.evaluate((element) => {
    for (const animation of element.getAnimations()) animation.finish();
  });
}

/** Animations that last longer than a blink. Reduced motion must leave none. */
function longAnimations(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.getAnimations().filter((animation) => {
        const timing = animation.effect?.getComputedTiming();
        return Number(timing?.duration ?? 0) > 1;
      }).length,
  );
}

test('queue tabs: the indicator starts under the selected tab and slides to the next', async ({ page }) => {
  const fixture = await signInConsole(page, desktop);
  const pill = marker(statusGroup(page));
  const active = statusTab(page, 'Active');
  const waiting = statusTab(page, 'Awaiting specialist');

  // First paint: already under Active, with no slide in from the corner.
  await expect.poll(() => gap(pill, active, 'box')).toBeLessThan(1.5);
  expect(await pill.evaluate((element) => element.getAnimations().length)).toBe(0);

  const from = await pill.boundingBox();
  await waiting.click();
  await expect(waiting).toHaveAttribute('aria-pressed', 'true');
  await freezeMidway(pill);
  const midway = await pill.boundingBox();
  const target = await waiting.boundingBox();
  if (!from || !midway || !target) throw new Error('Missing box.');
  expect(midway.x, 'halfway between the old and the new tab').toBeGreaterThan(from.x + 5);
  expect(midway.x).toBeLessThan(target.x - 5);
  expect(midway.width, 'resizing on the way').toBeGreaterThan(Math.min(from.width, target.width));
  await finishAnimations(pill);
  await expect.poll(() => gap(pill, waiting, 'box')).toBeLessThan(1.5);

  // A wider count in an earlier tab pushes the selected tab to the right. The
  // indicator moves with it in one frame, because the selection did not change.
  fixture.setIssues([
    ...defaultIssues,
    ...Array.from({ length: 30 }, (_, index): FixtureIssue => ({
      number: 10 + index,
      status: 'open',
      minutesAgo: 2,
      team: 0,
    })),
  ]);
  await startTrail(pill);
  await fixture.refresh();
  await expect(active).toHaveText(/Active 3\d/);
  await expect.poll(() => gap(pill, waiting, 'box')).toBeLessThan(1.5);
  const shifted = await stopTrail(page);
  expect(shifted[shifted.length - 1]).toBeGreaterThan(shifted[0] + 3);
  expect(
    shifted.filter((left) => left > shifted[0] + 1 && left < shifted[shifted.length - 1] - 1),
    'no frame shows the indicator on its way',
  ).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('queue tabs: Tab and Space move the selection and the indicator follows', async ({ page }) => {
  await signInConsole(page, desktop);
  const pill = marker(statusGroup(page));
  const open = statusTab(page, 'Open');
  await statusTab(page, 'Active').focus();
  await page.keyboard.press('Tab');
  await expect(open).toBeFocused();
  await expect(open).not.toHaveCSS('box-shadow', 'none');
  await page.keyboard.press('Space');
  await expect(open).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => gap(pill, open, 'box')).toBeLessThan(1.5);
});

test('issue sheet tabs: arrow keys move the selection and the underline follows', async ({ page }) => {
  await signInConsole(page, desktop);
  await page.locator('[data-issue-row]').first().click();
  const sheet = page.getByRole('dialog');
  const tabs = sheet.getByRole('tablist');
  const underline = marker(tabs);
  const activity = sheet.getByRole('tab', { name: /^Activity/ });
  const images = sheet.getByRole('tab', { name: /^Images/ });
  const outcome = sheet.getByRole('tab', { name: /^Outcome/ });
  await expect(activity).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => gap(underline, activity, 'horizontal')).toBeLessThan(1.5);

  await activity.focus();
  await page.keyboard.press('ArrowRight');
  await expect(images).toBeFocused();
  await expect(images).toHaveAttribute('aria-selected', 'true');
  await expect(images).not.toHaveCSS('box-shadow', 'none');
  await expect.poll(() => gap(underline, images, 'horizontal')).toBeLessThan(1.5);

  await page.keyboard.press('ArrowRight');
  await expect(outcome).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => gap(underline, outcome, 'horizontal')).toBeLessThan(1.5);
  await page.keyboard.press('Home');
  await expect(activity).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => gap(underline, activity, 'horizontal')).toBeLessThan(1.5);
});

test('a held button presses in, and a held phone queue card shows its pressed state', async ({ page }) => {
  await signInConsole(page, desktop);
  const claim = page.getByRole('button', { name: 'Claim ISS-1', exact: true });
  await claim.hover();
  await page.mouse.down();
  await expect(claim).toHaveCSS('scale', '0.98');
  // Leave the button before release so the press does not claim the issue.
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await expect(claim).toHaveCSS('scale', 'none');

  await page.setViewportSize(phone);
  const card = page.locator('[id^="issue-card-"]').first().locator('xpath=..');
  await expect(card).toBeVisible();
  const resting = await card.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.locator('[id^="issue-card-"]').first().hover({ position: { x: 12, y: 12 } });
  await page.mouse.down();
  await expect.poll(() => card.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(resting);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await expect.poll(() => card.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(resting);
});

test('contestant tracker: a step fills in over a moment when staff claim the report', async ({ page }) => {
  const fixture = await signInConsole(page, desktop, {
    contestant: true,
    issues: [{ number: 4, status: 'open', minutesAgo: 3, team: 0 }],
  });
  const progress = page.getByRole('list', { name: 'Progress' });
  const circle = progress.getByRole('listitem').nth(1).locator('span').first();
  const fill = () => circle.evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(progress).toBeVisible();
  const before = await fill();
  fixture.setIssues([{ number: 4, status: 'claimed', minutesAgo: 3, team: 0 }]);
  await fixture.refresh();
  await freezeMidway(circle);
  const midway = await fill();
  await finishAnimations(circle);
  const after = await fill();
  expect(after).not.toBe(before);
  expect(midway, 'a color between the old and the new').not.toBe(before);
  expect(midway).not.toBe(after);
});

test('phone tab bar: the marker slides along the top edge to the selected tab', async ({ page }) => {
  const fixture = await signInConsole(page, phone);
  const nav = page.getByRole('navigation', { name: 'Organiser sections' });
  const bar = marker(nav.locator('ul'));
  const queue = nav.getByRole('button', { name: 'Queue', exact: true });
  const find = nav.getByRole('button', { name: 'Find', exact: true });
  await expect.poll(() => gap(bar, queue, 'centre')).toBeLessThan(1.5);

  const from = await bar.boundingBox();
  await find.click();
  await expect(find).toHaveAttribute('aria-current', 'page');
  await freezeMidway(bar);
  const midway = await bar.boundingBox();
  const target = await find.boundingBox();
  if (!from || !midway || !target) throw new Error('Missing box.');
  expect(midway.x).toBeGreaterThan(from.x + 5);
  expect(midway.x).toBeLessThan(target.x + 16 - 5);
  await finishAnimations(bar);
  await expect.poll(() => gap(bar, find, 'centre')).toBeLessThan(1.5);
  expect(fixture.errors).toEqual([]);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the indicator and the sheet change state at once', async ({ page }) => {
    const fixture = await signInConsole(page, desktop);
    const pill = marker(statusGroup(page));
    const waiting = statusTab(page, 'Awaiting specialist');
    await startTrail(pill);
    await waiting.click();
    await expect.poll(() => gap(pill, waiting, 'box')).toBeLessThan(1.5);
    await page.waitForTimeout(100);
    const trail = await stopTrail(page);
    const start = trail[0];
    const end = trail[trail.length - 1];
    expect(end).toBeGreaterThan(start + 100);
    expect(trail.filter((left) => left > start + 2 && left < end - 2), 'no frame shows the indicator on its way').toEqual([]);

    await page.locator('[data-issue-row]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await longAnimations(page)).toBe(0);
    await page.getByRole('tab', { name: /^Outcome/ }).click();
    await expect(page.getByRole('tab', { name: /^Outcome/ })).toHaveAttribute('aria-selected', 'true');
    expect(await longAnimations(page)).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(fixture.errors).toEqual([]);
  });
});
