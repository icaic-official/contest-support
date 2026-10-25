import type { Page } from "@playwright/test";
import {
  type FakeWorker,
  SESSION_ID,
  USER_ID,
  expect,
  fixtureAccount,
  sessionSnapshot,
  test,
} from "./support/worker";

/** Signs a volunteer in on the desktop console against the Worker fixture. */
async function signIn(page: Page, api: FakeWorker) {
  api.account = fixtureAccount(USER_ID, "boundary", "Boundary fixture");
  api.snapshots = () => [
    sessionSnapshot(
      {
        session_id: SESSION_ID,
        user_id: USER_ID,
        team_id: null,
        roles: ["volunteer"],
        is_admin: false,
      },
      { session: { name: "Boundary session" } },
    ),
  ];
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("boundary");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Makes the next render of the organiser UI throw, as a failed render does. */
async function breakNextRender(page: Page) {
  await page.evaluate(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (query.includes("min-width: 1024px")) {
        throw new Error("Forced render error.");
      }
      return original(query);
    };
  });
  // A narrower window changes the media query, so the UI renders again.
  await page.setViewportSize({ width: 600, height: 800 });
}

test("a render error shows a recovery screen, and Reload restores the page", async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, api);
  await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
  await breakNextRender(page);
  const recovery = page.getByRole("alert").filter({
    has: page.getByRole("heading", { name: "Something went wrong" }),
  });
  await expect(recovery).toBeVisible({ timeout: 15_000 });
  await expect(recovery).toContainText("saved on the server");
  // The page chrome outside the failed screen stays on the page.
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeAttached();
  await page.setViewportSize({ width: 1280, height: 800 });
  await recovery.getByRole("button", { name: "Reload" }).click();
  await expect(recovery).toBeHidden();
  await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
});
