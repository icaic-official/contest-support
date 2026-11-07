import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { seatThreeContests } from "./support/contests";
import { expect, test } from "./support/localWorker";

// `lazyScreens.tsx` and `layouts.ts` load each staff screen on demand, so a
// contestant never downloads the staff code. The dev server that Playwright
// starts serves one module per file, such as `/src/organiser/OrganiserApp.tsx`.
// A production build serves chunks, such as `OrganiserApp-3fa9c1.js`. The
// patterns match both. Other files of `src/organiser`, `src/event` and
// `src/site` are shared with the contestant app on purpose, for example the
// avatar and the account forms, so only the screens count.
const staffScreens = [
  /\/src\/organiser\/(desktop|phone)\//,
  /\/(OrganiserApp|OrganiserDesktopConsole|OrganiserPhoneApp|EventConsole|SiteDashboard)[.-]/,
];

const isStaffScreen = (path: string) => staffScreens.some((pattern) => pattern.test(path));

test.use({ seedIssues: false, viewport: { width: 1280, height: 800 } });

/** The path of every script that the page requests from now on. */
function watchScripts(page: Page) {
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname);
  });
  return scripts;
}

async function signIn(page: Page, username: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
}

test("a contestant with several contests downloads no staff screen", async ({ page, local }) => {
  await seatThreeContests(local, { next: "Alpha", ended: "Delta", running: "Charlie" });
  const scripts = watchScripts(page);
  await signIn(page, "contestant");
  await page.getByRole("button", { name: /^Contest session: .* Change session$/ }).click();
  await expect(page.getByRole("menu").getByRole("menuitemradio")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "My account" }).click();
  await expect(page.getByRole("heading", { name: "My account", exact: true })).toBeVisible();
  expect(scripts.some((path) => /ContestantApp/.test(path)), "the contestant screen was recorded").toBe(true);
  expect(scripts.filter(isStaffScreen)).toEqual([]);
});

test("a staff member downloads the staff screens, so the patterns see them", async ({ page, local }) => {
  await seatThreeContests(local, { next: "Alpha", ended: "Delta", running: "Charlie" });
  const scripts = watchScripts(page);
  await signIn(page, "jury");
  await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
  expect(scripts.filter(isStaffScreen).length).toBeGreaterThan(0);
  expect(scripts.some((path) => /OrganiserDesktopConsole/.test(path))).toBe(true);
  expect(scripts.some((path) => /ContestantApp/.test(path))).toBe(false);
});
