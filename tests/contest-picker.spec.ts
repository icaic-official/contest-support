import { randomUUID } from "node:crypto";
import type { Locator, Page, Request } from "@playwright/test";
import { contrastOf } from "./support/contrast";
import { addContestAt, addLaterContest, confirmExtraTime, endRunningContest, seatThreeContests } from "./support/contests";
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

const focusEvent = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));

/**
 * The router commits a replace after the address changes. The wait gives the
 * commit a few frames, so that any focus move it causes happens before the check.
 */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 250)))),
  );

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

/**
 * Holds every snapshot read that starts after this call, or only the reads of
 * `only`, until `release` runs. `held` counts the reads that wait.
 */
async function holdSnapshotReads(page: Page, only?: string) {
  let held = 0;
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/snapshot*", async (route) => {
    if (only !== undefined && new URL(route.request().url()).searchParams.get("sessionId") !== only) {
      return route.fallback();
    }
    held++;
    await released;
    await route.fallback();
  });
  return { held: () => held, release };
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

  // Charlie's scheduled end has passed, but staff confirmed extra time for every contestant. The
  // contest's own page says that reporting is open, so the row and the default must agree with it.
  test("opens the contest that confirmed extra time keeps open, and calls it running", async ({ page, local }) => {
    const ids = await three(local);
    await endRunningContest(local, ids.running, 10);
    await confirmExtraTime(local, ids.running, 60);
    await signIn(page);
    await expect(triggerFor(page, "Charlie")).toBeVisible();
    await at(page, "/issues", ids.running);
    await expect(
      page.getByRole("button", { name: "Report an issue", description: "A helper comes to your table." }),
    ).toBeEnabled();
    await trigger(page).click();
    await expect(page.getByRole("menuitemradio", { name: /^Charlie/ })).toHaveAccessibleName(
      /^Charlie \S.*\d{2}:\d{2} · Running now$/,
    );
  });

  // The 2032 contest ends later than the 2031 one. The rule for the next contest
  // opens the earlier of the two, so a rule that picks the contest that ends last
  // opens Yankee and fails these two tests.
  test("opens the next contest when none runs", async ({ page, local }) => {
    const ids = await seatThreeContests(local, { next: "Mike", ended: "Alpha", running: "Zulu" });
    await endRunningContest(local, ids.running);
    await addLaterContest(local, "Yankee");
    await signIn(page);
    await expect(triggerFor(page, "Mike")).toBeVisible();
    await at(page, "/issues", ids.next);
  });

  test("opens the next contest, not a past one that staff hold closed", async ({ page, local }) => {
    const ids = await seatThreeContests(local, { next: "Mike", ended: "Alpha", running: "Zulu" });
    await endRunningContest(local, ids.running);
    await local.run("UPDATE sessions SET intake_follows_schedule = 0, intake_open = 0 WHERE id = ?", ids.ended);
    await addLaterContest(local, "Yankee");
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
    // The page from the sign-in can still start a read, so leave it before counting.
    await page.goto("about:blank");
    const reads = await watchReads(page);
    await page.goto(`/issues?contest=${ids.ended}`);
    await expect(triggerFor(page, "Delta")).toBeVisible();
    expect(new Set(reads.snapshots)).toEqual(new Set([ids.ended]));
  });

  test("falls back to the default contest when the chosen contest is lost, not to the one that the address named", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await page.goto(`/issues?contest=${ids.ended}`);
    await expect(triggerFor(page, "Delta")).toBeVisible();
    await choose(page, "Alpha");
    await at(page, "/issues", ids.next);
    await local.run("DELETE FROM memberships WHERE session_id = ? AND account_id = ?", ids.next, local.users.contestant);
    await focusEvent(page);
    await expect(triggerFor(page, "Charlie")).toBeVisible();
    await at(page, "/issues", ids.running);
  });

  // The list read ends before the snapshot read starts. While the snapshot read is
  // held, the page has the new list but not yet the new contest. The list that the
  // page gets omits the open contest from the moment of the loss, so a read that the
  // live connection started earlier still ends with the open contest and its snapshot.
  // The page still shows the data of the open contest, so the picker still lists it
  // and marks it. The hold takes only the read of the contest that the person falls back to.
  test("marks the open contest while the snapshot of the next contest loads after the open one is lost", async ({ page, local }) => {
    const ids = await three(local);
    let listed: Array<{ id: string }> = [];
    page.on("response", async (response) => {
      if (new URL(response.url()).pathname === "/api/contests") listed = (await response.json()) as typeof listed;
    });
    await signIn(page);
    await at(page, "/issues", ids.running);
    expect(listed).toHaveLength(3);
    let lost = false;
    await page.route("**/api/contests*", (route) =>
      lost ? route.fulfill({ json: listed.filter(({ id }) => id !== ids.running) }) : route.fallback());
    const reads = await holdSnapshotReads(page, ids.next);
    lost = true;
    await focusEvent(page);
    await expect.poll(reads.held).toBeGreaterThan(0);
    await settle(page);
    await trigger(page).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
    await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveAccessibleName(/^Charlie/);
    await page.keyboard.press("Escape");
    reads.release();
    await expect(triggerFor(page, "Alpha")).toBeVisible();
    await at(page, "/issues", ids.next);
  });

  // A read that keeps the open contest publishes its list before its snapshot, so a
  // row that changed does not wait for a slow snapshot read. A read that began before
  // the change must not hold the queue, so the hold starts with the first list that
  // carries the change.
  test("shows a changed note of a contest while the snapshot of the open contest loads", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await at(page, "/issues", ids.running);
    let changed = false;
    let reads: Awaited<ReturnType<typeof holdSnapshotReads>> | undefined;
    await page.route("**/api/contests*", async (route) => {
      if (changed) reads ??= await holdSnapshotReads(page, ids.running);
      await route.fallback();
    });
    await local.run("UPDATE sessions SET intake_follows_schedule = 0, intake_open = 1 WHERE id = ?", ids.ended);
    changed = true;
    await focusEvent(page);
    await expect.poll(() => reads?.held() ?? 0).toBeGreaterThan(0);
    await trigger(page).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitemradio").first()).toHaveAccessibleName(
      /^Delta \S.*17:00 · Intake open \(set by staff\)$/,
    );
    await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveAccessibleName(/^Charlie/);
    await page.keyboard.press("Escape");
    reads?.release();
    await expect(trigger(page)).toBeVisible();
  });

  // The person picks another contest while a list read of the open contest hangs.
  // The read of the picked contest must not wait for it. The held read is stale
  // when its list arrives, so it must read no snapshot of the contest that the
  // person left. The count starts after the picked contest has loaded.
  test("opens the picked contest while a list read hangs, and reads no snapshot of the contest that the person left", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await at(page, "/issues", ids.running);
    const held: Request[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/contests*", async (route) => {
      if (held.length === 0) {
        held.push(route.request());
        await gate;
      }
      await route.fallback();
    });
    const reads = await watchReads(page);
    await focusEvent(page);
    await expect.poll(() => held.length).toBe(1);
    await trigger(page).click();
    await page.getByRole("menuitemradio", { name: /^Alpha/ }).click();
    await expect(triggerFor(page, "Alpha")).toBeVisible();
    await expect(page.getByText("Loading your contest session…")).toBeHidden();
    const before = reads.snapshots.length;
    release();
    await (await held[0]?.response())?.finished();
    await settle(page);
    expect(reads.snapshots.slice(before)).not.toContain(ids.running);
    await expect(triggerFor(page, "Alpha")).toBeVisible();
  });

  // The person picks another contest while a snapshot read of the open contest
  // hangs. The read of the picked contest must not wait for it, and the held
  // read must show nothing when it ends.
  test("opens the picked contest while a snapshot read of the open contest hangs", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await at(page, "/issues", ids.running);
    const reads = await holdSnapshotReads(page, ids.running);
    await focusEvent(page);
    await expect.poll(reads.held).toBeGreaterThan(0);
    await trigger(page).click();
    await page.getByRole("menuitemradio", { name: /^Alpha/ }).click();
    await expect(triggerFor(page, "Alpha")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No reports yet" })).toBeVisible();
    await expect(page.getByText("Loading your contest session…")).toBeHidden();
    await at(page, "/issues", ids.next);
    const stale = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/snapshot" && url.searchParams.get("sessionId") === ids.running;
    });
    reads.release();
    await (await stale).finished();
    await settle(page);
    await expect(triggerFor(page, "Alpha")).toBeVisible();
    await at(page, "/issues", ids.next);
  });

  test("keeps another parameter of the address when it writes the contest", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await page.goto("/issues?utm=1");
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/issues" &&
        url.searchParams.get("utm") === "1" &&
        url.searchParams.get("contest") === ids.running,
    );
  });

  test("takes the server clock, not a device clock that runs behind, when a lost contest sends the person to the default", async ({ page, local }) => {
    // The device clock runs two hours behind the server.
    await page.addInitScript(() => {
      const deviceNow = Date.now;
      Date.now = () => deviceNow() - 2 * 3_600_000;
    });
    const ids = await three(local);
    // Staff hold Delta closed. It ended one hour ago by the server clock, and
    // one hour ahead by the device clock.
    await local.run(
      `UPDATE sessions SET intake_follows_schedule = 0, intake_open = 0,
         starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'),
         ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours') WHERE id = ?`,
      ids.ended,
    );
    await signIn(page);
    await expect(triggerFor(page, "Charlie")).toBeVisible();
    await local.run("DELETE FROM memberships WHERE session_id = ? AND account_id = ?", ids.running, local.users.contestant);
    await focusEvent(page);
    await expect(triggerFor(page, "Alpha")).toBeVisible();
    await at(page, "/issues", ids.next);
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

  // React Router opens a link to the page that is already open by replacing the entry, but only
  // when the link's address equals the current one. The address holds `?contest=`, so a link
  // without it adds an entry per click, and Back lands on the page it left.
  test("adds no history entry when the brand link opens the page that is already open", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await at(page, "/issues", ids.running);
    await settle(page);
    const entries = () => page.evaluate(() => history.length);
    const before = await entries();
    for (let i = 0; i < 3; i++) {
      await page.getByRole("link", { name: "Minsky, your reports" }).click();
      await settle(page);
    }
    expect(await entries()).toBe(before);
    await at(page, "/issues", ids.running);
  });

  test("goes back to the page before, after My account opens the account page again", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await at(page, "/issues", ids.running);
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: /^Account menu for/ }).click();
      await page.getByRole("menuitem", { name: "My account" }).click();
      await expect(page.getByRole("heading", { name: "My account", exact: true })).toBeVisible();
      await at(page, "/account", ids.running);
      await settle(page);
    }
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Your reports" })).toBeVisible();
    await at(page, "/issues", ids.running);
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
    await expect(page).toHaveURL((url) => url.pathname === "/issues" && url.searchParams.get("contest") === ids.next);
  });
});

// The address keeps the choice of the person who made it, and the history entry names that
// account. The next person on the tab starts from the default contest wherever the tab lands:
// on the entry below a phone screen, after Back, after a reload or after a page load. Each test
// first checks that the address still names Delta, so that only the rule can send the next person to Charlie.
test.describe("the next person on a tab", () => {
  const signOut = async (page: Page) => {
    await page.getByRole("button", { name: /^Account menu for/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  };

  const signInHere = async (page: Page, username = "contestant") => {
    await page.getByLabel("Username", { exact: true }).fill(username);
    await page.getByLabel("Password", { exact: true }).fill(randomUUID());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  };

  const signInHeading = (page: Page) => page.getByRole("heading", { name: "Sign in", exact: true });

  // The jury member is seated in every contest, Delta included, so only the rule can keep them out of Delta.
  const nextPersonGetsTheDefault = async (page: Page, running: string, { username = "jury", path = "/issues", hash = "" } = {}) => {
    await signInHere(page, username);
    await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
    await at(page, path, running, hash);
  };

  const skipToMain = async (page: Page) => {
    await page.getByRole("link", { name: "Skip to main content" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  };

  /**
   * The jury member chooses Delta and the session ends. The contestant, who now
   * has only Alpha, signs in on that entry, and the address keeps Delta. The
   * combined staff member joins Delta and Charlie, so only the rule keeps them
   * out of Delta, and Charlie stays their default.
   */
  const oneContestOnTheChoiceBefore = async (page: Page, local: LocalWorker, path = "/issues") => {
    const ids = await three(local);
    await local.run(
      "DELETE FROM teams WHERE entrant_id = ? AND session_id IN (?, ?)",
      local.teams[0],
      ids.ended,
      ids.running,
    );
    for (const contest of [ids.ended, ids.running]) {
      await local.run("INSERT INTO memberships (session_id, account_id) VALUES (?, ?)", contest, local.users.combined);
      await local.run(
        "INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')",
        contest,
        local.users.combined,
      );
    }
    await signIn(page, "jury");
    await choose(page, "Delta");
    if (path === "/account") await page.getByRole("button", { name: /^Account settings for/ }).click();
    await at(page, path, ids.ended);
    await page.context().clearCookies();
    await page.reload();
    await expect(signInHeading(page)).toBeVisible();
    await signInHere(page);
    await expect(page.locator('[data-ui="contestant"]')).toBeVisible({ timeout: 15_000 });
    await expect(trigger(page)).toHaveCount(0);
    await at(page, path, ids.ended);
    return ids;
  };

  const chooseDeltaThenMyAccount = async (page: Page, ids: { ended: string }) => {
    await signIn(page);
    await choose(page, "Delta");
    await at(page, "/issues", ids.ended);
    await page.getByRole("button", { name: /^Account menu for/ }).click();
    await page.getByRole("menuitem", { name: "My account" }).click();
    await at(page, "/account", ids.ended);
  };

  test("opens the default for the next person after a sign-out", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await choose(page, "Delta");
    await at(page, "/issues", ids.ended);
    await signOut(page);
    await at(page, "/issues", ids.ended);
    await nextPersonGetsTheDefault(page, ids.running);
  });

  test("opens the default for the next person after a sign-out and Back", async ({ page, local }) => {
    const ids = await three(local);
    await chooseDeltaThenMyAccount(page, ids);
    await signOut(page);
    await page.goBack();
    await settle(page);
    await at(page, "/issues", ids.ended);
    await nextPersonGetsTheDefault(page, ids.running);
  });

  // A reload ends the page, and Back then loads the older entry as a page load.
  test("opens the default for the next person after a sign-out, a reload and Back", async ({ page, local }) => {
    const ids = await three(local);
    await chooseDeltaThenMyAccount(page, ids);
    await signOut(page);
    await page.reload();
    await expect(signInHeading(page)).toBeVisible();
    await page.goBack();
    await expect(signInHeading(page)).toBeVisible();
    await at(page, "/issues", ids.ended);
    await nextPersonGetsTheDefault(page, ids.running);
  });

  // Some browsers deny page storage, for example with every cookie blocked. The rule must not need it.
  test("opens the default for the next person after a sign-out, a reload and Back when the browser denies page storage", async ({ page, local }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", {
        get() {
          throw new DOMException("Storage is denied.", "SecurityError");
        },
      });
    });
    const ids = await three(local);
    await chooseDeltaThenMyAccount(page, ids);
    await signOut(page);
    await page.reload();
    await expect(signInHeading(page)).toBeVisible();
    await page.goBack();
    await expect(signInHeading(page)).toBeVisible();
    await at(page, "/issues", ids.ended);
    await nextPersonGetsTheDefault(page, ids.running);
  });

  test("opens the default for the next person after a sign-out, a page load and two Back presses", async ({ page, local }) => {
    const ids = await three(local);
    await chooseDeltaThenMyAccount(page, ids);
    await signOut(page);
    await page.goto("/");
    await page.goBack();
    await expect(signInHeading(page)).toBeVisible();
    await page.goBack();
    await expect(signInHeading(page)).toBeVisible();
    await at(page, "/issues", ids.ended);
    await nextPersonGetsTheDefault(page, ids.running);
  });

  // A session can end while the tab waits: it expires, an organizer resets the password, or
  // another tab signs out. The next page load shows the sign-in page on the address of the person before.
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`opens the default for the next person after a page load finds that the session ended, at ${viewport.width} px`, async ({ page, local }) => {
      await page.setViewportSize(viewport);
      const ids = await three(local);
      await signIn(page);
      await choose(page, "Delta");
      await at(page, "/issues", ids.ended);
      await page.context().clearCookies();
      await page.reload();
      await expect(signInHeading(page)).toBeVisible();
      await at(page, "/issues", ids.ended);
      await nextPersonGetsTheDefault(page, ids.running);
    });
  }

  test("opens the person's own contest again after a page load finds that the session ended", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await choose(page, "Delta");
    await at(page, "/issues", ids.ended);
    await page.context().clearCookies();
    await page.reload();
    await expect(signInHeading(page)).toBeVisible();
    await signInHere(page);
    await expect(triggerFor(page, "Delta")).toBeVisible();
    await at(page, "/issues", ids.ended);
  });

  test("keeps the person's own contest when the session restore fails and they sign in again", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await choose(page, "Delta");
    await at(page, "/issues", ids.ended);
    await page.route("**/api/auth/session*", (route) => route.fulfill({ status: 500, json: { error: "Unavailable." } }));
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "Unavailable." })).toBeVisible();
    await expect(signInHeading(page)).toBeVisible();
    await page.unroute("**/api/auth/session*");
    await signInHere(page);
    await expect(triggerFor(page, "Delta")).toBeVisible();
    await at(page, "/issues", ids.ended);
  });

  // The next person signs in, and a page load follows. A jump of two entries, or the long-press
  // menu of Back, then loads an entry of the person before as a page load, with the next person signed in.
  test("opens the default when a page load goes back to an address of the person before", async ({ page, local }) => {
    const ids = await three(local);
    await chooseDeltaThenMyAccount(page, ids);
    await signOut(page);
    await signInHere(page, "jury");
    await at(page, "/account", ids.running);
    await page.goto("/issues");
    await at(page, "/issues", ids.running);
    const landed = page.waitForURL((url) => url.pathname === "/issues" && url.searchParams.get("contest") === ids.ended);
    await page.evaluate(() => window.history.go(-2));
    await landed;
    await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
    await at(page, "/issues", ids.running);
  });

  // Another tab signs out and signs in a different account. This tab learns of the new account at its next session check.
  test("opens the default when another tab changes the account", async ({ page, local, context }) => {
    const ids = await three(local);
    await signIn(page);
    await choose(page, "Delta");
    await at(page, "/issues", ids.ended);
    const other = await context.newPage();
    await other.goto("/issues");
    await expect(other.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
    await signOut(other);
    await signInHere(other, "jury");
    await expect(other.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.bringToFront();
    await focusEvent(page);
    await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
    await at(page, "/issues", ids.running);
  });

  // The skip link writes `#main` without the router. That entry must still name the account that chose Delta.
  test("opens the default for the next person after the skip link, a sign-out and a reload", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await choose(page, "Delta");
    await skipToMain(page);
    await at(page, "/issues", ids.ended, "#main");
    await signOut(page);
    await page.reload();
    await expect(signInHeading(page)).toBeVisible();
    await at(page, "/issues", ids.ended, "#main");
    await nextPersonGetsTheDefault(page, ids.running, { hash: "#main" });
  });

  test("opens the default for the next person after the skip link, My account, a sign-out and Back", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await choose(page, "Delta");
    await skipToMain(page);
    await page.getByRole("button", { name: /^Account menu for/ }).click();
    await page.getByRole("menuitem", { name: "My account" }).click();
    await at(page, "/account", ids.ended);
    await signOut(page);
    await page.goBack();
    await settle(page);
    await at(page, "/issues", ids.ended, "#main");
    await nextPersonGetsTheDefault(page, ids.running, { hash: "#main" });
  });

  test("opens the default for the next person after the skip link and a page load that finds the session ended, at 390 px", async ({ page, local }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ids = await three(local);
    await signIn(page);
    await choose(page, "Delta");
    await skipToMain(page);
    await at(page, "/issues", ids.ended, "#main");
    await page.context().clearCookies();
    await page.reload();
    await expect(signInHeading(page)).toBeVisible();
    await at(page, "/issues", ids.ended, "#main");
    await nextPersonGetsTheDefault(page, ids.running, { hash: "#main" });
  });

  // A person with one contest gets no write from the hook, so each new entry must carry the owner that the entry before named.
  test("opens the default for the next person after a person with one contest opens My account on the choice before", async ({ page, local }) => {
    const ids = await oneContestOnTheChoiceBefore(page, local);
    await page.getByRole("button", { name: /^Account menu for/ }).click();
    await page.getByRole("menuitem", { name: "My account" }).click();
    await at(page, "/account", ids.ended);
    await signOut(page);
    await at(page, "/account", ids.ended);
    await nextPersonGetsTheDefault(page, ids.running, { username: "combined", path: "/account" });
  });

  test("opens the default for the next person after a person with one contest skips to the report details on the choice before", async ({ page, local }) => {
    const ids = await oneContestOnTheChoiceBefore(page, local);
    await page.getByRole("link", { name: "Skip to report details" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#contestant-main")).toBeFocused();
    await at(page, "/issues", ids.ended, "#contestant-main");
    await signOut(page);
    await page.reload();
    await expect(signInHeading(page)).toBeVisible();
    await at(page, "/issues", ids.ended, "#contestant-main");
    await nextPersonGetsTheDefault(page, ids.running, { username: "combined", hash: "#contestant-main" });
  });

  test("opens the default for the next person after a person with one contest follows an account section link on the choice before", async ({ page, local }) => {
    const ids = await oneContestOnTheChoiceBefore(page, local, "/account");
    await page.getByRole("navigation", { name: "Account sections" }).getByRole("link", { name: "Security" }).click();
    await expect(page.locator("#security")).toBeFocused();
    await at(page, "/account", ids.ended, "#security");
    await signOut(page);
    await page.reload();
    await expect(signInHeading(page)).toBeVisible();
    await at(page, "/account", ids.ended, "#security");
    await nextPersonGetsTheDefault(page, ids.running, { username: "combined", path: "/account", hash: "#security" });
  });

  // The report form takes a history entry. A page load leaves the tab on that entry, because no unmount goes back.
  test("opens the default for the next person after a person with one contest opens the report form on the choice before, at 390 px", async ({ page, local }) => {
    const ids = await oneContestOnTheChoiceBefore(page, local);
    await local.run("UPDATE sessions SET intake_follows_schedule = 0, intake_open = 1 WHERE id = ?", ids.next);
    await page.setViewportSize({ width: 390, height: 844 });
    await focusEvent(page);
    await page.getByRole("button", { name: "Report an issue" }).click();
    await expect(page.getByLabel("What is happening?")).toBeVisible();
    await at(page, "/issues", ids.ended);
    await page.context().clearCookies();
    await page.reload();
    await expect(signInHeading(page)).toBeVisible();
    await at(page, "/issues", ids.ended);
    await nextPersonGetsTheDefault(page, ids.running, { username: "combined" });
  });

  // A link has no owner, so it keeps its contest for whoever signs in.
  test("opens the contest of a link that the next person opens in a tab that signed out", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await signOut(page);
    await page.goto(`/issues?contest=${ids.ended}`);
    await expect(signInHeading(page)).toBeVisible();
    await signInHere(page, "jury");
    await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
    await at(page, "/issues", ids.ended);
  });

  // Another tab can sign in after this tab signed out, and the cookie then gives this tab a session.
  test("keeps the contest of a link when another tab has signed in since this tab signed out", async ({ page, local, context }) => {
    const ids = await three(local);
    await signIn(page);
    await signOut(page);
    await signIn(await context.newPage());
    await page.goto(`/issues?contest=${ids.ended}`);
    await expect(triggerFor(page, "Delta")).toBeVisible();
    await at(page, "/issues", ids.ended);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    // Staff hold Delta open, so the person can report in it, and the default stays Charlie.
    async function openReportForm(page: Page, local: LocalWorker) {
      const ids = await three(local);
      await local.run("UPDATE sessions SET intake_follows_schedule = 0, intake_open = 1 WHERE id = ?", ids.ended);
      await signIn(page);
      await choose(page, "Delta");
      await at(page, "/issues", ids.ended);
      await page.getByRole("button", { name: "Report an issue" }).click();
      await expect(page.getByLabel("What is happening?")).toBeVisible();
      return ids;
    }

    // The report form takes a history entry, and its unmount after the sign-out goes back one entry.
    test("opens the default for the next person after a sign-out from the report form", async ({ page, local }) => {
      const ids = await openReportForm(page, local);
      await signOut(page);
      await settle(page);
      await at(page, "/issues", ids.ended);
      await nextPersonGetsTheDefault(page, ids.running);
    });

    test("opens the default for the next person after the session ends with the report form open", async ({ page, local }) => {
      const ids = await openReportForm(page, local);
      await page.route("**/api/auth/session*", (route) => route.fulfill({ status: 401, json: {} }));
      await focusEvent(page);
      await expect(signInHeading(page)).toBeVisible();
      await page.unroute("**/api/auth/session*");
      await settle(page);
      await at(page, "/issues", ids.ended);
      await nextPersonGetsTheDefault(page, ids.running);
    });

    test("opens the default for the next person after a sign-out that follows a sent report", async ({ page, local }) => {
      const ids = await openReportForm(page, local);
      await page.getByText("Devices", { exact: true }).click();
      await page.getByLabel("What is happening?").fill("The keyboard stopped working.");
      await page.getByRole("button", { name: "Send report" }).click();
      await expect(page.getByLabel("What is happening?")).toHaveCount(0);
      await expect(page.getByText("The keyboard stopped working.").first()).toBeVisible();
      await signOut(page);
      await settle(page);
      await at(page, "/issues", ids.ended);
      await nextPersonGetsTheDefault(page, ids.running);
    });

    // The phone password form of staff unmounts the screens, so nothing on the page can rewrite its entry later.
    test("opens the default for the next person after a staff member signs out from the phone password form", async ({ page, local }) => {
      const ids = await three(local);
      await signIn(page, "jury");
      await page.getByRole("navigation", { name: "Organizer sections" }).getByRole("button", { name: "Me", exact: true }).click();
      await page.getByRole("group", { name: "Choose a contest session" }).getByRole("radio", { name: /^Delta/ }).check();
      await at(page, "/account", ids.ended);
      await page.getByRole("button", { name: "Change password" }).click();
      await expect(page.getByLabel("Current password", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(signInHeading(page)).toBeVisible();
      await at(page, "/account", ids.ended);
      await nextPersonGetsTheDefault(page, ids.running, { username: "contestant", path: "/account" });
    });
  });
});

test.describe("the password form on the account page while the contests change", () => {
  async function typeInNewPassword(page: Page) {
    await page.getByRole("button", { name: /^Account menu for/ }).click();
    await page.getByRole("menuitem", { name: "Change password" }).click();
    const current = page.getByLabel("Current password", { exact: true });
    await expect(current).toBeFocused();
    const fresh = page.getByLabel("New password", { exact: true });
    await fresh.click();
    await fresh.pressSequentially("abc");
    return { current, fresh };
  }

  async function typeMore({ current, fresh }: Awaited<ReturnType<typeof typeInNewPassword>>, page: Page) {
    await settle(page);
    await expect(fresh).toBeFocused();
    await page.keyboard.type("XYZ");
    await expect(fresh).toHaveValue("abcXYZ");
    await expect(current).toHaveValue("");
  }

  test("keeps the focus in New password when a second contest adds the contest to the address", async ({ page, local }) => {
    await signIn(page);
    await expect(page).toHaveURL((url) => url.search === "");
    const fields = await typeInNewPassword(page);
    await local.seatContestantInSecondSession();
    await focusEvent(page);
    await expect(page).toHaveURL((url) => url.searchParams.has("contest"));
    await typeMore(fields, page);
  });

  test("keeps the focus in New password when the selected contest is lost and the address changes", async ({ page, local }) => {
    const ids = await three(local);
    await signIn(page);
    await at(page, "/issues", ids.running);
    const fields = await typeInNewPassword(page);
    await local.run("DELETE FROM memberships WHERE session_id = ? AND account_id = ?", ids.running, local.users.contestant);
    await focusEvent(page);
    await at(page, "/account", ids.next, "#security");
    await typeMore(fields, page);
  });

  test("places the focus on the section of a deep link, although the screen arrives after the address is written", async ({ page, local }) => {
    await three(local);
    await signIn(page);
    // The first read ends and writes ?contest= while the contestant screen still downloads.
    await page.route(/\/ContestantApp[.-]/, async (route) => {
      await new Promise((done) => setTimeout(done, 1500));
      await route.fallback();
    });
    await page.goto("/account#security");
    await expect(page.locator("#security")).toBeFocused();
    await expect(page).toHaveURL((url) => url.hash === "#security" && url.searchParams.has("contest"));
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
    await focusEvent(page);
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

// A read that has chosen no contest can already hold the list, so the page has
// several contests and none selected. A select with no matching row shows its
// first row, which is a contest that the person did not choose.
test.describe("the no-access screen while a read has chosen no contest", () => {
  test("offers no contest select on the error screen while a retry reads the snapshot", async ({ page, local }) => {
    await three(local);
    await signIn(page);
    let listFails = true;
    await page.route("**/api/contests*", (route) =>
      listFails ? route.fulfill({ status: 500, json: { error: "Unavailable." } }) : route.fallback());
    await page.goto("/issues");
    const alert = page.getByRole("alert").filter({ hasText: "Unavailable." });
    await expect(alert).toBeVisible();
    listFails = false;
    const reads = await holdSnapshotReads(page);
    await page.getByRole("button", { name: "Refresh access", exact: true }).click();
    await expect.poll(reads.held).toBeGreaterThan(0);
    await settle(page);
    await expect(alert).toBeVisible();
    await expect(page.getByLabel("Contest session", { exact: true })).toHaveCount(0);
    reads.release();
    await expect(trigger(page)).toBeVisible();
  });

  test("offers no contest select after the person regains contests, while the snapshot loads", async ({ page, local }) => {
    await three(local);
    let none = false;
    await page.route("**/api/contests*", (route) => (none ? route.fulfill({ json: [] }) : route.fallback()));
    await signIn(page);
    none = true;
    await focusEvent(page);
    const heading = page.getByRole("heading", { name: "Session access" });
    await expect(heading).toBeVisible();
    none = false;
    const reads = await holdSnapshotReads(page);
    await focusEvent(page);
    await expect.poll(reads.held).toBeGreaterThan(0);
    await settle(page);
    await expect(heading).toBeVisible();
    await expect(page.getByLabel("Contest session", { exact: true })).toHaveCount(0);
    reads.release();
    await expect(trigger(page)).toBeVisible();
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

  test("set the second line of the contest that runs in a heavier weight", async ({ page, local }) => {
    await three(local);
    await signIn(page);
    await trigger(page).click();
    const items = page.getByRole("menuitemradio");
    const weight = (item: Locator, line: RegExp) =>
      item.getByText(line).evaluate((element) => Number(getComputedStyle(element).fontWeight));
    expect(await weight(items.nth(1), /· Running now$/)).toBeGreaterThan(await weight(items.nth(0), /· Ended$/));
  });

  test("set the second line heavier only for the contest that runs, not for a grace period or a staff hold", async ({ page, local }) => {
    const ids = await three(local);
    // Delta is held open by staff. Bravo ended 5 minutes ago and is in its grace period.
    await local.run("UPDATE sessions SET intake_follows_schedule = 0, intake_open = 1 WHERE id = ?", ids.ended);
    await addContestAt(local, "Bravo", -35, -5, 30);
    await signIn(page);
    await trigger(page).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitemradio")).toHaveCount(4);
    const weight = (name: RegExp, line: RegExp) =>
      menu
        .getByRole("menuitemradio", { name })
        .getByText(line)
        .evaluate((element) => Number(getComputedStyle(element).fontWeight));
    const running = await weight(/^Charlie/, /· Running now$/);
    expect(running).toBeGreaterThan(await weight(/^Bravo/, /· Intake open \(grace period\)$/));
    expect(running).toBeGreaterThan(await weight(/^Delta/, /· Intake open \(set by staff\)$/));
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

  test("color the second line only on the focused row, when a click opens the menu", async ({ page, local }) => {
    await three(local);
    await signIn(page);
    await trigger(page).click();
    await expect(page.getByRole("menu")).toBeFocused();
    const row = page.getByRole("menuitemradio").first();
    const color = () => row.getByText(/17:00 · Ended$/).evaluate((line) => getComputedStyle(line).color);
    const unfocused = await color();
    await row.hover();
    await expect(row).toBeFocused();
    await expect.poll(color).not.toBe(unfocused);
  });

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

  test("choose the next phone radio row with the arrow key", async ({ page, local }) => {
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

  test("choose the next contest in the select of the no-access screen with the arrow key", async ({ page, local }) => {
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
