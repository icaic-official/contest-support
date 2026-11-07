import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { seatThreeContests } from "./support/contests";
import { expect, type LocalWorker, test } from "./support/localWorker";

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

// A person with no authority over the site or an event gets the refusal page that the
// staff screen shows, and that screen's code stays undownloaded.
const refusedPages: Array<{ path: string; heading: string; message: string }> = [
  { path: "/site", heading: "Site", message: "Only a webmaster can open the site page." },
  { path: "/event", heading: "Event console", message: "Only an event admin or a webmaster can change this event." },
  {
    path: `/event/${randomUUID()}`,
    heading: "Event console",
    message: "Only an event admin or a webmaster can change this event.",
  },
];

for (const { path, heading, message } of refusedPages) {
  test(`a contestant who types ${path.replace(/[0-9a-f-]{36}/u, "<id>")} gets the refusal page and downloads no staff screen`, async ({ page, local }) => {
    await seatThreeContests(local, { next: "Alpha", ended: "Delta", running: "Charlie" });
    await signIn(page, "contestant");
    const scripts = watchScripts(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText(message)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
    await page.getByRole("link", { name: "Open contests" }).click();
    await expect(page.getByRole("heading", { name: "Your reports" })).toBeVisible();
    expect(scripts.some((script) => /ContestantApp/.test(script)), "the contestant screen was recorded").toBe(true);
    expect(scripts.filter(isStaffScreen)).toEqual([]);
  });
}

// The first read of the contest list tells a contestant from a webmaster or an event admin.
// Until it ends, the page shows the wait and downloads nothing, whoever the person is. The
// wait has the Sign out button of the wait on /issues, because a read that hangs must leave
// a way out. The snapshot read comes after the list and decides nothing about the level.
const levelScreens = /\/(EventConsole|SiteDashboard)[.-]/;
const wait = /^Loading/;
const siteRefusal = "Only a webmaster can open the site page.";
const eventRefusal = "Only an event admin or a webmaster can change this event.";

/** Holds every request that matches `pattern` until `release` is called. */
async function hold(page: Page, pattern: string) {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(pattern, async (route) => {
    await held;
    await route.fallback();
  });
  return release;
}

const holdContestList = (page: Page) => hold(page, "**/api/contests*");
const holdSnapshot = (page: Page) => hold(page, "**/api/snapshot*");

/** The test must hold the grant that the page checks, or it would pass for the wrong person. */
async function signInWebmaster(page: Page, local: LocalWorker) {
  expect(await local.rows("SELECT 1 FROM grants WHERE scope = 'site' AND account_id = ?", local.users.admin)).toHaveLength(1);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Site sign-in", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('[data-ui="organiser-desktop"], [data-ui="organiser-phone"]')).toBeVisible({ timeout: 15_000 });
}

async function signInEventAdmin(page: Page, local: LocalWorker) {
  expect(await local.rows("SELECT 1 FROM grants WHERE scope = 'event' AND account_id = ?", local.eventAdmin)).toHaveLength(1);
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("eventadmin");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('[data-ui="organiser-desktop"], [data-ui="organiser-phone"]')).toBeVisible({ timeout: 15_000 });
}

/** Only the real site page has this sentence. The refusal page has the same heading. */
async function expectSitePage(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Site" })).toBeVisible();
  await expect(page.getByText("The events, the webmasters, and the site setting.")).toBeVisible();
  await expect(page.getByText(siteRefusal)).toHaveCount(0);
}

async function expectSignOutWhileWaiting(page: Page, path: string, release: () => void) {
  const scripts = watchScripts(page);
  await page.goto(path);
  await expect(page.getByRole("status").filter({ hasText: wait })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(path);
  expect(scripts.filter((script) => levelScreens.test(script))).toEqual([]);
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  release();
}

test.describe("a webmaster", () => {
  test.use({ webmaster: "admin", withEventAdmin: false });

  test("who reloads /site waits for the contest list and then reaches the page", async ({ page, local }) => {
    await signInWebmaster(page, local);
    const release = await holdContestList(page);
    const scripts = watchScripts(page);
    await page.goto("/site");
    await expect(page.getByRole("status").filter({ hasText: wait })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/site");
    expect(scripts.filter((script) => levelScreens.test(script))).toEqual([]);
    release();
    await expectSitePage(page);
    expect(new URL(page.url()).pathname).toBe("/site");
  });

  test("who reloads /site while the snapshot read is held still reaches the page", async ({ page, local }) => {
    await signInWebmaster(page, local);
    const release = await holdSnapshot(page);
    await page.goto("/site");
    await expectSitePage(page);
    release();
  });

  test("who reloads /site while the contest list is held can sign out", async ({ page, local }) => {
    await signInWebmaster(page, local);
    const release = await holdContestList(page);
    await expectSignOutWhileWaiting(page, "/site", release);
  });
});

test.describe("an event admin", () => {
  test.use({ withEventAdmin: true });

  test("who reloads /event waits for the contest list and then reaches the console", async ({ page, local }) => {
    await signInEventAdmin(page, local);
    const release = await holdContestList(page);
    const scripts = watchScripts(page);
    await page.goto("/event");
    await expect(page.getByRole("status").filter({ hasText: wait })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/event");
    expect(scripts.filter((script) => levelScreens.test(script))).toEqual([]);
    release();
    await expect(page.getByRole("heading", { level: 1, name: "Jury verification" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/event");
  });

  for (const path of ["/event", "/event/event-id"]) {
    test(`who reloads ${path.replace("event-id", "<id>")} while the snapshot read is held still reaches the console`, async ({ page, local }) => {
      await signInEventAdmin(page, local);
      const release = await holdSnapshot(page);
      await page.goto(path.replace("event-id", local.event));
      await expect(page.getByRole("heading", { level: 1, name: "Jury verification" })).toBeVisible();
      await expect(page.getByText(eventRefusal)).toHaveCount(0);
      release();
    });
  }

  test("who reloads /event while the contest list is held can sign out", async ({ page, local }) => {
    await signInEventAdmin(page, local);
    const release = await holdContestList(page);
    await expectSignOutWhileWaiting(page, "/event", release);
  });
});

test("a contestant who types /site while the snapshot read is held gets the refusal page and downloads no staff screen", async ({ page, local }) => {
  await seatThreeContests(local, { next: "Alpha", ended: "Delta", running: "Charlie" });
  await signIn(page, "contestant");
  const release = await holdSnapshot(page);
  const scripts = watchScripts(page);
  await page.goto("/site");
  await expect(page.getByRole("heading", { level: 1, name: "Site" })).toBeVisible();
  await expect(page.getByText(siteRefusal)).toBeVisible();
  expect(scripts.filter(isStaffScreen)).toEqual([]);
  release();
});
