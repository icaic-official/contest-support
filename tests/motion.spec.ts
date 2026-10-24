import { expect, test, type Locator, type Page } from '@playwright/test';
import { defaultIssues, type FixtureIssue, signInConsole } from './support/consoleFixture';

const desktop = { width: 1280, height: 800 };

function statusGroup(page: Page): Locator {
  return page.getByRole('group', { name: 'Filter by status' });
}

function statusTab(page: Page, label: string): Locator {
  return statusGroup(page).getByRole('button', { name: new RegExp(`^${label} \\d+$`) });
}

function marker(list: Locator): Locator {
  return list.locator('[data-slot="sliding-indicator"]');
}

/** The largest difference between the indicator and the tab on the axes that the style fills. */
async function gap(indicator: Locator, tab: Locator, axes: 'box' | 'horizontal'): Promise<number> {
  const [a, b] = await Promise.all([indicator.boundingBox(), tab.boundingBox()]);
  if (!a || !b) return Infinity;
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
  expect(await gap(pill, active, 'box')).toBeLessThan(1.5);
  expect(await pill.evaluate((element) => element.getAnimations().length)).toBe(0);

  await startTrail(pill);
  await waiting.click();
  await expect(waiting).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => gap(pill, waiting, 'box')).toBeLessThan(1.5);
  const trail = await stopTrail(page);

  const start = trail[0];
  const end = trail[trail.length - 1];
  expect(end).toBeGreaterThan(start + 100);
  expect(trail.some((left) => left > start + 2 && left < end - 2), 'a frame shows the indicator on its way').toBe(true);
  expect(trail, 'the indicator never moves back').toEqual([...trail].sort((a, b) => a - b));

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
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(fixture.errors).toEqual([]);
  });
});
