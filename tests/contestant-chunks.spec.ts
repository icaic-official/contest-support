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

// A contestant who types /site or /event gets the staff screen of that page, because
// the page asks the server before it decides. The queue is the page that a contestant
// opens for any address that the contestant cannot use, as for /administration.
for (const path of ["/site", "/event", `/event/${randomUUID()}`]) {
  test(`a contestant who types ${path.replace(/[0-9a-f-]{36}/u, "<id>")} downloads no staff screen and lands on the queue`, async ({ page, local }) => {
    await seatThreeContests(local, { next: "Alpha", ended: "Delta", running: "Charlie" });
    await signIn(page, "contestant");
    const scripts = watchScripts(page);
    await page.goto(path);
    await expect.soft(page).toHaveURL((url) => url.pathname === "/issues");
    await expect(page.getByRole("heading", { name: "Your reports" })).toBeVisible();
    expect(scripts.some((script) => /ContestantApp/.test(script)), "the contestant screen was recorded").toBe(true);
    expect(scripts.filter(isStaffScreen)).toEqual([]);
  });
}

// The first read of the contest list tells a contestant from a webmaster or an event admin.
// Until it ends, the page shows the wait and downloads nothing, whoever the person is.
const levelScreens = /\/(EventConsole|SiteDashboard)[.-]/;

/** Holds every read of the contest list until `release` is called. */
async function holdContestList(page: Page) {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/contests*", async (route) => {
    await held;
    await route.fallback();
  });
  return release;
}

test.describe("a webmaster", () => {
  test.use({ webmaster: "admin", withEventAdmin: false });

  test("who reloads /site waits for the contest list and then reaches the page", async ({ page, local }) => {
    expect(await local.rows("SELECT 1 FROM grants WHERE scope = 'site' AND account_id = ?", local.users.admin)).toHaveLength(1);
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Site sign-in", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator('[data-ui="organiser-desktop"], [data-ui="organiser-phone"]')).toBeVisible({ timeout: 15_000 });
    const release = await holdContestList(page);
    const scripts = watchScripts(page);
    await page.goto("/site");
    await expect(page.getByRole("status").filter({ hasText: "Loading…" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/site");
    expect(scripts.filter((script) => levelScreens.test(script))).toEqual([]);
    release();
    await expect(page.getByRole("heading", { level: 1, name: "Site" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/site");
  });
});

test.describe("an event admin", () => {
  test.use({ withEventAdmin: true });

  test("who reloads /event waits for the contest list and then reaches the console", async ({ page, local }) => {
    expect(await local.rows("SELECT 1 FROM grants WHERE scope = 'event' AND account_id = ?", local.eventAdmin)).toHaveLength(1);
    await page.goto("/sign-in");
    await page.getByLabel("Username", { exact: true }).fill("eventadmin");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator('[data-ui="organiser-desktop"], [data-ui="organiser-phone"]')).toBeVisible({ timeout: 15_000 });
    const release = await holdContestList(page);
    const scripts = watchScripts(page);
    await page.goto("/event");
    await expect(page.getByRole("status").filter({ hasText: "Loading…" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/event");
    expect(scripts.filter((script) => levelScreens.test(script))).toEqual([]);
    release();
    await expect(page.getByRole("heading", { level: 1, name: "Jury verification" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/event");
  });
});
