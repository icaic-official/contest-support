import type { Page } from "@playwright/test";
import type { Membership } from "../src/connected/model";
import {
  type FakeWorker,
  SESSION_ID,
  TEAM_ID,
  USER_ID,
  expect,
  fixtureAccount,
  sessionSnapshot,
  test,
} from "./support/worker";

/** Signs in with an isolated Worker fixture for one membership. */
async function signIn(
  page: Page,
  api: FakeWorker,
  membership: Membership,
): Promise<void> {
  api.account = fixtureAccount(USER_ID, "selection", "Selection fixture");
  api.snapshots = () => [
    sessionSnapshot(membership, { session: { name: "Selection session" } }),
  ];
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("selection");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("[data-ui]")).toBeVisible();
  // A fresh load starts focus at the document, as the hosted staff check does.
  await page.goto("/");
  await expect(page.locator("[data-ui]")).toBeVisible();
}

/**
 * The hosted failure moved focus to the page heading after Enter. A hash
 * change fires popstate, and that listener focused the heading on the next
 * frame, so #main never stayed active.
 */
async function focusHeadingAfterHash(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.addEventListener("popstate", () => {
      window.requestAnimationFrame(() => {
        const heading = document.querySelector("h1");
        if (!(heading instanceof HTMLElement)) return;
        if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
        heading.focus();
      });
    });
  });
}

/** Presses Enter on the skip link and reads the focused element after paint. */
async function skipTargetIsMain(page: Page): Promise<boolean> {
  const skip = page.getByRole("link", { name: "Skip to main content" });
  // Route navigation focuses the page heading. Reach the skip link from there.
  for (let step = 0; step < 40; step++) {
    if (await skip.evaluate((link) => link === document.activeElement)) break;
    const onHeading = await page.evaluate(() =>
      document.activeElement instanceof HTMLHeadingElement,
    );
    await page.keyboard.press(onHeading || step > 0 ? "Shift+Tab" : "Tab");
  }
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  return page.evaluate(
    () => document.activeElement === document.getElementById("main"),
  );
}

const staff: Membership = {
  session_id: SESSION_ID,
  user_id: USER_ID,
  team_id: null,
  roles: ["volunteer"],
  is_admin: false,
};

test("Enter on the landing skip link focuses the main landmark", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true }))
    .toBeVisible();
  await focusHeadingAfterHash(page);
  expect(await skipTargetIsMain(page)).toBe(true);
});

test("Enter on the staff skip link focuses the main landmark", async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await signIn(page, api, staff);
  await expect(
    page.getByRole("heading", { level: 1, name: "Queue", exact: true }),
  ).toBeVisible();
  await focusHeadingAfterHash(page);
  expect(await skipTargetIsMain(page)).toBe(true);
});

test("Enter on the organiser skip link focuses the main landmark", async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, api, { ...staff, is_admin: true });
  await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
  await focusHeadingAfterHash(page);
  expect(await skipTargetIsMain(page)).toBe(true);
});

test("Enter on the contestant skip link focuses the main landmark", async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, api, { ...staff, roles: [], team_id: TEAM_ID });
  await expect(page.locator('[data-ui="contestant"]')).toBeVisible();
  await focusHeadingAfterHash(page);
  expect(await skipTargetIsMain(page)).toBe(true);
});
