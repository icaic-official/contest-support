import { expect, type Locator, type Page } from "@playwright/test";
import { fixture } from "./fixture";

/** The UIs that the connected app selects from the membership and viewport. */
export type Ui = "contestant" | "organiser-phone" | "organiser-desktop";

/** The phone viewport for organisers in the hall. */
export const phone = { width: 390, height: 844 };
/** The desktop viewport for contestants and the organiser console. */
export const desktop = { width: 1280, height: 800 };

/** The root element of the selected UI. */
export function uiRoot(page: Page, ui?: Ui): Locator {
  return page.locator(ui ? `[data-ui="${ui}"]` : "[data-ui]");
}

/**
 * Finds an element by its id. Issue ids are UUIDs, which can start with a
 * digit, so a CSS `#id` selector is not safe.
 */
export function byId(page: Page, id: string): Locator {
  return page.locator(`[id="${id}"]`);
}

/** The Live or Reconnecting badge of the selected UI. */
export function liveBadge(page: Page): Locator {
  return uiRoot(page).getByRole("status").filter({ hasText: /^Live$/ });
}

/** Fills and sends the sign-in form. */
export async function submitSignIn(
  page: Page,
  username: string,
  password: string,
) {
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/**
 * Signs in a fixture account from the sign-in page and waits until the
 * selected UI shows Live, so Realtime updates reach this page.
 */
export async function login(page: Page, name: string, ui?: Ui) {
  const details = fixture().accounts[name];
  await page.goto("/sign-in");
  await submitSignIn(page, details.username, details.password);
  await expect(uiRoot(page, ui)).toBeVisible({ timeout: 15000 });
  // Hosted Realtime can take several seconds to join the channel.
  await expect(liveBadge(page)).toBeVisible({ timeout: 15000 });
}

/** Opens a tab of the organiser phone app with the bottom tab bar. */
export async function phoneTab(page: Page, label: string) {
  await page
    .getByRole("navigation", { name: "Organiser sections" })
    .getByRole("button", { name: label, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: label, exact: true }),
  ).toBeVisible();
}

/**
 * A page link of the organiser desktop console sidebar. Its name can end
 * with a count, for example "Queue 3".
 */
export function consoleLink(page: Page, label: string): Locator {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page
    .getByRole("navigation", { name: "Console pages" })
    .getByRole("button", { name: new RegExp(`^${escaped}(?: \\d+)?$`) });
}

/** The issue number button of a desktop issue table row. */
export function issueRow(page: Page, description: string): Locator {
  return page
    .getByRole("row")
    .filter({ hasText: description })
    .getByRole("button", { name: /^Open ISS-\d+$/ });
}

/** The open sheet or dialog. Content outside it is hidden while it is open. */
export function openDialog(page: Page): Locator {
  return page.getByRole("dialog");
}

/**
 * Signs out from any selected UI: the Me tab on a phone, the account page on
 * the desktop console, or the account menu in the contestant UI.
 */
export async function signOut(page: Page) {
  const ui = await uiRoot(page).getAttribute("data-ui");
  if (ui === "organiser-phone") {
    const back = page.getByRole("button", { name: "Back", exact: true });
    if (await back.count()) await back.click();
    await phoneTab(page, "Me");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
  } else if (ui === "organiser-desktop") {
    await page.getByRole("button", { name: /^Account settings for / }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
  } else {
    await page.getByRole("button", { name: /^Account menu for / }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
}

/**
 * Checks a radio button or checkbox that is visually hidden inside a styled
 * label. The label covers the input, so a pointer click cannot reach it.
 * Space on the focused input is what a keyboard user does. A form can stay
 * disabled while the refresh after its last request runs, so wait first.
 */
export async function choose(control: Locator) {
  await expect(control).toBeEnabled();
  if (!(await control.isChecked())) await control.press("Space");
  await expect(control).toBeChecked();
}

/** Whether the page has no horizontal scrolling. */
export async function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth + 1,
  );
}
