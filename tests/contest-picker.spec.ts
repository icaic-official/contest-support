import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { contrastOf } from "./support/contrast";
import { endRunningContest, seatThreeContests } from "./support/contests";
import { type LocalWorker, expect, test } from "./support/localWorker";

// The contestant sees three contests. One starts in 2031, one ended in 2020,
// and one runs now. The server lists contests by name, so a test of the default
// contest names them so that the contest it expects is not first by name. Then
// the test fails if the hook takes the first contest of the server's list.
test.use({ seedIssues: false, viewport: { width: 1280, height: 800 } });

const three = (local: LocalWorker) =>
  seatThreeContests(local, { next: "Alpha", ended: "Delta", running: "Charlie" });

async function signIn(page: Page, username = "contestant") {
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
}

const trigger = (page: Page) =>
  page.getByRole("button", { name: /^Contest session: .* Change session$/ });
const triggerFor = (page: Page, name: string) =>
  page.getByRole("button", { name: `Contest session: ${name}. Change session`, exact: true });

async function choose(page: Page, name: string) {
  await trigger(page).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).click();
  await expect(triggerFor(page, name)).toBeVisible();
}

/**
 * Every snapshot read and live connection that the page starts after this
 * call. The live route replaces the fixture's route and sends the same
 * ready message, so the page still shows Live.
 */
async function watchReads(page: Page) {
  const snapshots: string[] = [];
  const sockets: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/snapshot") snapshots.push(url.searchParams.get("sessionId") ?? "");
  });
  await page.routeWebSocket(/\/api\/updates\?/, (socket) => {
    sockets.push(socket.url());
    socket.send('{"type":"ready"}');
  });
  return { snapshots, sockets };
}

const at = (page: Page, path: string, contest: string, hash = "") =>
  expect(page).toHaveURL(
    (url) =>
      url.pathname === path &&
      url.hash === hash &&
      [...url.searchParams.keys()].join() === "contest" &&
      url.searchParams.get("contest") === contest,
  );

test.describe("a contestant with several contests", () => {
  test("opens the contest that runs now, not the first name, and writes it to the address", async ({ page, local }) => {
    const ids = await three(local);
    const reads = await watchReads(page);
    await signIn(page);
    await expect(triggerFor(page, "Charlie")).toBeVisible();
    await at(page, "/issues", ids.running);
    expect(new Set(reads.snapshots)).toEqual(new Set([ids.running]));
  });

  test("opens the next contest when none runs", async ({ page, local }) => {
    const ids = await seatThreeContests(local, { next: "Mike", ended: "Alpha", running: "Zulu" });
    await endRunningContest(local, ids.running);
    await signIn(page);
    await expect(triggerFor(page, "Mike")).toBeVisible();
    await at(page, "/issues", ids.next);
  });

  test("opens the next contest, not a past one that staff hold closed", async ({ page, local }) => {
    const ids = await seatThreeContests(local, { next: "Mike", ended: "Alpha", running: "Zulu" });
    await endRunningContest(local, ids.running);
    await local.run("UPDATE sessions SET intake_follows_schedule = 0, intake_open = 0 WHERE id = ?", ids.ended);
    await signIn(page);
    await expect(triggerFor(page, "Mike")).toBeVisible();
    await at(page, "/issues", ids.next);
  });

  test("keeps the choice across a reload and does not read the default contest first", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await choose(page, "Alpha");
    await at(page, "/issues", ids.next);
    const reads = await watchReads(page);
    await page.reload();
    await expect(triggerFor(page, "Alpha")).toBeVisible();
    await at(page, "/issues", ids.next);
    expect(new Set(reads.snapshots)).toEqual(new Set([ids.next]));
    expect(reads.sockets.length).toBeGreaterThan(0);
    expect(reads.sockets.every((url) => url.includes(ids.next) && !url.includes(ids.running))).toBe(true);
  });

  test("opens the contest that the address names", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    const reads = await watchReads(page);
    await page.goto(`/issues?contest=${ids.ended}`);
    await expect(triggerFor(page, "Delta")).toBeVisible();
    expect(new Set(reads.snapshots)).toEqual(new Set([ids.ended]));
  });

  test("keeps the contest when the person goes to another page and back", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await choose(page, "Alpha");
    await page.getByRole("button", { name: /^Account menu for/ }).click();
    await page.getByRole("menuitem", { name: "My account" }).click();
    await expect(page.getByRole("heading", { name: "My account", exact: true })).toBeVisible();
    await at(page, "/account", ids.next);
    await page.getByRole("link", { name: "Minsky, your reports" }).click();
    await expect(page.getByRole("heading", { name: "My account", exact: true })).toHaveCount(0);
    await at(page, "/issues", ids.next);
    await expect(triggerFor(page, "Alpha")).toBeVisible();
  });

  test("keeps the contest for browser Back and Forward", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await at(page, "/issues", ids.running);
    await page.getByRole("button", { name: /^Account menu for/ }).click();
    await page.getByRole("menuitem", { name: "My account" }).click();
    await at(page, "/account", ids.running);
    await choose(page, "Delta");
    await page.goBack();
    await expect(page.getByRole("heading", { name: "My account", exact: true })).toHaveCount(0);
    await at(page, "/issues", ids.ended);
    await expect(triggerFor(page, "Delta")).toBeVisible();
    await page.goForward();
    await at(page, "/account", ids.ended);
    await expect(triggerFor(page, "Delta")).toBeVisible();
  });

  const unlisted = ["6f1c0d1a-2b3c-4d5e-8f90-a1b2c3d4e5f6", "not-a-contest", "x'; DROP TABLE sessions;--"];
  for (const unknown of unlisted) {
    test(`ignores the unlisted contest ${JSON.stringify(unknown)} in the address`, async ({ page, local }) => {
      const ids = await three(local);
      await signIn(page);
      const reads = await watchReads(page);
      await page.goto(`/issues?contest=${encodeURIComponent(unknown)}`);
      await expect(triggerFor(page, "Charlie")).toBeVisible();
      await at(page, "/issues", ids.running);
      expect(new Set(reads.snapshots)).toEqual(new Set([ids.running]));
      const requested = [...reads.snapshots, ...reads.sockets].join(" ");
      expect(requested).not.toContain(encodeURIComponent(unknown));
      expect(reads.sockets.length).toBeGreaterThan(0);
    });
  }

  test("opens the contest that a signed-out visit named, once the person signs in", async ({ page, local }) => {
    const ids = await three(local);
    await page.goto(`/issues?contest=${ids.ended}`);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.getByLabel("Username", { exact: true }).fill("contestant");
    await page.getByLabel("Password", { exact: true }).fill(randomUUID());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(triggerFor(page, "Delta")).toBeVisible();
    await at(page, "/issues", ids.ended);
  });

  test("keeps the hash and the focus request of the account page", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await page.getByRole("button", { name: /^Account menu for/ }).click();
    await page.getByRole("menuitem", { name: "Change password" }).click();
    await at(page, "/account", ids.running, "#security");
    await expect(page.getByLabel("Current password", { exact: true })).toBeFocused();
  });

  test("sends a page that the contestant cannot open to the queue, keeps the contest and focuses the heading", async ({ page, local }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ids = await three(local);
    await signIn(page);
    await page.goto(`/administration?contest=${ids.ended}`);
    await at(page, "/issues", ids.ended);
    await expect(triggerFor(page, "Delta")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your reports" })).toBeFocused();
  });

  for (const search of ["", "?contest=bogus"]) {
    test(`sends a page that the contestant cannot open to the queue from the address /administration${search}`, async ({ page, local }) => {
      const ids = await three(local);
      await signIn(page);
      await page.goto(`/administration${search}`);
      await at(page, "/issues", ids.running);
      await expect(page.getByRole("heading", { name: "Your reports" })).toBeVisible();
    });
  }

  test("keeps the address in step after the skip link writes its fragment", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await at(page, "/issues", ids.running);
    await page.getByRole("link", { name: "Skip to main content" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL((url) => url.hash === "#main");
    await choose(page, "Alpha");
    await at(page, "/issues", ids.next);
  });
});

test.describe("a staff member with several contests", () => {
  test("goes to the queue when a lost contest leaves a page that the next contest cannot open", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page, "jury");
    await page.goto(`/jury?contest=${ids.next}`);
    await expect(page.getByRole("heading", { name: "Award review", exact: true })).toBeVisible();
    await local.run("DELETE FROM membership_roles WHERE session_id = ? AND account_id = ?", ids.next, local.users.jury);
    await local.run("DELETE FROM memberships WHERE session_id = ? AND account_id = ?", ids.next, local.users.jury);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await at(page, "/issues", ids.running);
    await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
  });

  test("keeps the contest through the phone password form", async ({ page, local }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ids = await three(local);
    await signIn(page, "jury");
    await page.getByRole("navigation", { name: "Organizer sections" }).getByRole("button", { name: "Me", exact: true }).click();
    const radios = page.getByRole("group", { name: "Choose a contest session" }).getByRole("radio");
    await radios.nth(2).check();
    await at(page, "/account", ids.next);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByLabel("Current password", { exact: true })).toBeVisible();
    await at(page, "/account", ids.next);
    await page.getByRole("button", { name: "Return to dashboard", exact: true }).click();
    await expect(radios.nth(2)).toBeChecked();
    await at(page, "/account", ids.next);
  });
});

test.describe("a contest in the address whose snapshot fails", () => {
  test("shows the picker on that contest, and the person can leave it", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await page.route("**/api/snapshot*", (route) =>
      new URL(route.request().url()).searchParams.get("sessionId") === ids.ended
        ? route.fulfill({ status: 500, json: { error: "Unavailable." } })
        : route.fallback());
    await page.goto(`/issues?contest=${ids.ended}`);
    await expect(page.getByRole("alert").filter({ hasText: "Unavailable." })).toBeVisible();
    const select = page.getByLabel("Contest session", { exact: true });
    await expect(select).toHaveValue(ids.ended);
    await at(page, "/issues", ids.ended);
    await select.selectOption(ids.running);
    await expect(triggerFor(page, "Charlie")).toBeVisible();
    await at(page, "/issues", ids.running);
  });

  test("keeps the address when the first list read fails, and a retry opens that contest", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    let listFails = true;
    await page.route("**/api/contests*", (route) =>
      listFails ? route.fulfill({ status: 500, json: { error: "Unavailable." } }) : route.fallback());
    await page.goto(`/issues?contest=${ids.ended}`);
    await expect(page.getByRole("alert").filter({ hasText: "Unavailable." })).toBeVisible();
    await expect(page.getByLabel("Contest session", { exact: true })).toHaveCount(0);
    listFails = false;
    await page.getByRole("button", { name: "Refresh access", exact: true }).click();
    await expect(triggerFor(page, "Delta")).toBeVisible();
    await at(page, "/issues", ids.ended);
  });
});

test.describe("a contestant with one contest", () => {
  test("gets no contest parameter in the address", async ({ page, local }) => {
    const seats = await local.rows("SELECT session_id FROM memberships WHERE account_id = ?", local.users.contestant);
    expect(seats).toHaveLength(1);
    await signIn(page);
    await expect(page.getByRole("link", { name: "Minsky, your reports" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Report an issue" }).first()).toBeVisible();
    await expect(trigger(page)).toHaveCount(0);
    await expect(page).toHaveURL((url) => url.pathname === "/issues" && url.search === "");
    await page.getByRole("button", { name: /^Account menu for/ }).click();
    await page.getByRole("menuitem", { name: "My account" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/account" && url.search === "");
  });
});

test.describe("the rows of the picker", () => {
  const ended = /^Delta \S.*17:00 · Ended$/;
  const running = /^Charlie \S.*\d{2}:\d{2} · Running now$/;
  const next = /^Alpha \S.*21:00$/;

  test("list the contests by start time in the event's zone and mark the one that runs now", async ({ page, local }) => {
    await three(local);
    await signIn(page);
    await trigger(page).click();
    const menu = page.getByRole("menu");
    const items = menu.getByRole("menuitemradio");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveAccessibleName(ended);
    await expect(items.nth(1)).toHaveAccessibleName(running);
    await expect(items.nth(2)).toHaveAccessibleName(next);
    await expect(menu.getByText("Running now")).toHaveCount(1);
  });

  test("say Running now only for the contest that runs", async ({ page, local }) => {
    const ids = await three(local);
    await local.run("UPDATE sessions SET intake_follows_schedule = 0, intake_open = 1 WHERE id = ?", ids.ended);
    await signIn(page);
    await trigger(page).click();
    const menu = page.getByRole("menu");
    const items = menu.getByRole("menuitemradio");
    await expect(items.nth(0)).toHaveAccessibleName(/^Delta \S.*17:00 · Intake open \(set by staff\)$/);
    await expect(items.nth(1)).toHaveAccessibleName(running);
    await expect(menu.getByText("Running now")).toHaveCount(1);
  });

  test("say the same in the phone rows and in the select of the no-access screen", async ({ page, local }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await three(local);
    await signIn(page, "jury");
    await page.getByRole("navigation", { name: "Organizer sections" }).getByRole("button", { name: "Me", exact: true }).click();
    const radios = page.getByRole("group", { name: "Choose a contest session" }).getByRole("radio");
    await expect(radios.nth(0)).toHaveAccessibleName(ended);
    await expect(radios.nth(1)).toHaveAccessibleName(running);
    await expect(radios.nth(2)).toHaveAccessibleName(next);
    await expect(radios.nth(1)).toBeChecked();

    await page.route("**/api/snapshot*", (route) => route.fulfill({ status: 500, json: { error: "Unavailable." } }));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const options = page.getByLabel("Contest session", { exact: true }).locator("option");
    await expect(options).toHaveText([
      /^Delta · .*17:00 · Ended$/,
      /^Charlie · .*\d{2}:\d{2} · Running now$/,
      /^Alpha · .*21:00$/,
    ]);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`keep the second line readable on a focused row, in ${scheme} mode`, async ({ page, local }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await three(local);
      await signIn(page);
      await trigger(page).focus();
      await page.keyboard.press("Enter");
      const item = page.getByRole("menuitemradio").first();
      await expect(item).toBeFocused();
      expect(await contrastOf(item.getByText(/17:00 · Ended$/))).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("open, move and choose with the keyboard, and close without a change on Escape", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await at(page, "/issues", ids.running);
    await trigger(page).focus();
    await page.keyboard.press("Enter");
    const items = page.getByRole("menu").getByRole("menuitemradio");
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
    await at(page, "/issues", ids.running);

    await page.keyboard.press("Enter");
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(2)).toBeFocused();
    await expect(items.nth(2)).toHaveAccessibleName(next);
    await page.keyboard.press("Enter");
    await expect(triggerFor(page, "Alpha")).toBeVisible();
    await at(page, "/issues", ids.next);
  });

  test("move through the phone radio rows with the arrow keys", async ({ page, local }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ids = await three(local);
    await signIn(page, "jury");
    await page.getByRole("navigation", { name: "Organizer sections" }).getByRole("button", { name: "Me", exact: true }).click();
    const radios = page.getByRole("group", { name: "Choose a contest session" }).getByRole("radio");
    await radios.nth(1).focus();
    await page.keyboard.press("ArrowDown");
    await expect(radios.nth(2)).toBeChecked();
    await at(page, "/account", ids.next);
  });

  test("move through the select of the no-access screen with the arrow keys", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await page.route("**/api/snapshot*", (route) => route.fulfill({ status: 500, json: { error: "Unavailable." } }));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const select = page.getByLabel("Contest session", { exact: true });
    await expect(select).toHaveValue(ids.running);
    await select.focus();
    await page.keyboard.press("ArrowDown");
    await expect(select).toHaveValue(ids.next);
    await at(page, "/issues", ids.next);
  });
});
