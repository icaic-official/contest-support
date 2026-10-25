import { expect, test, type Page } from "@playwright/test";
import { openApp, staff, team } from "./support/avatarServer";

/**
 * Screen-reader-only controls are absolutely positioned. A scroll pane that
 * is not positioned does not contain them, so they stretched the document
 * below the fixed-height shell and left a blank area after a long scroll.
 */
async function documentOverflow(page: Page): Promise<number> {
  await page.mouse.move(page.viewportSize()!.width / 2, 300);
  for (let step = 0; step < 20; step++) await page.mouse.wheel(0, 400);
  return page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
}

const admin = { ...staff, is_admin: true };
const accountPages = [
  { name: "organiser desktop", membership: admin, width: 1920, height: 540 },
  { name: "organiser phone", membership: admin, width: 390, height: 500 },
  { name: "contestant desktop", membership: team, width: 1280, height: 540 },
  { name: "contestant phone", membership: team, width: 390, height: 700 },
];

for (const { name, membership, width, height } of accountPages) {
  test(`the ${name} account page scrolls inside the shell`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openApp(page, { membership, startPath: "/account" });
    await expect(page.getByRole("radio", { name: "Device" })).toBeAttached();
    expect(await documentOverflow(page)).toBe(0);
  });
}
