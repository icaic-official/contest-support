import type { Page } from "@playwright/test";
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

/** Signs in as a contestant and opens My account from the account menu. */
async function openAccountPage(page: Page, api: FakeWorker) {
  await page.setViewportSize({ width: 1280, height: 800 });
  api.account = fixtureAccount(USER_ID, "contestant", "Contestant fixture");
  api.snapshots = () => [
    sessionSnapshot({
      session_id: SESSION_ID,
      user_id: USER_ID,
      team_id: TEAM_ID,
      roles: [],
      is_admin: false,
    }),
  ];
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("contestant");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: /^Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "My account" }).click();
  await expect(page).toHaveURL("/account");
  await expect(
    page.getByRole("heading", { name: "My account", exact: true }),
  ).toBeVisible();
}

test("a contestant leaves My account through the Minsky link", async ({
  page,
  api,
}) => {
  await openAccountPage(page, api);
  await expect(
    page.getByRole("complementary", { name: "Your reports" }),
  ).toBeHidden();
  await page.getByRole("link", { name: "Minsky, your reports" }).click();
  await expect(page).toHaveURL("/issues");
  await expect(
    page.getByRole("complementary", { name: "Your reports" }),
  ).toBeVisible();
});

test("the report skip link appears only where the report details show", async ({
  page,
  api,
}) => {
  const skip = page.getByRole("link", { name: "Skip to report details" });
  await openAccountPage(page, api);
  await expect(skip).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL("/issues");
  await expect(skip).toHaveCount(1);
});
