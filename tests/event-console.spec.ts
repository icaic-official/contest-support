import { mkdirSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/localWorker";

// An event admin runs an event through the console of the real Worker over local D1.
// The fixture identity stands in for Better Auth, so `adopt` lets a created account sign in.
test.use({ seedIssues: false, withEventAdmin: true });

const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };
const narrow = { width: 320, height: 740 };
/** Set MINSKY_SHOTS to a folder to keep a screenshot of every console screen. */
const shots = process.env.MINSKY_SHOTS;

async function signIn(page: Page, username: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function openConsole(page: Page) {
  await signIn(page, "eventadmin");
  await expect(page.locator('[data-ui="organiser-desktop"], [data-ui="organiser-phone"]')).toBeVisible();
  await page.goto("/event");
  await expect(page.getByRole("heading", { level: 1, name: "Jury verification" })).toBeVisible();
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

/** The credential sheet's password for one account, read once. */
async function passwordOf(sheet: Locator, name: string): Promise<string> {
  return (await sheet.getByLabel(`Password for ${name}`, { exact: true }).textContent()) ?? "";
}

test("an event admin creates a contest, imports entrants, assigns them, and a contestant opens the contest", async ({ page, local, browser }) => {
  test.setTimeout(60_000);
  await page.setViewportSize(desktop);
  await openConsole(page);

  await tab(page, "Contests").click();
  await page.getByLabel("Contest name", { exact: true }).fill("Spring finals");
  await page.getByLabel("Contest type", { exact: true }).selectOption({ label: "Teams" });
  await page.getByRole("button", { name: "Create contest", exact: true }).click();
  await expect(page.getByText("Spring finals", { exact: true })).toBeVisible();

  await tab(page, "Entrants").click();
  await page.getByLabel("Entrants, one per line: name, username", { exact: true })
    .fill("Team Orion, team-orion\nTeam Vega, team-vega\nTeam Orion, other");
  await expect(page.getByText("Line 3: Same name as line 1.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import entrants/ })).toBeDisabled();
  await page.getByLabel("Entrants, one per line: name, username", { exact: true })
    .fill("Team Orion, team-orion\nTeam Vega, team-vega");
  await page.getByRole("button", { name: "Import entrants (2)", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Share these credentials securely" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(`${new URL(page.url()).origin}/?event=${local.eventCode}`)).toBeVisible();
  expect((await passwordOf(sheet, "Team Orion")).length).toBeGreaterThan(8);
  await expect(sheet.getByText("team-vega", { exact: true })).toBeVisible();
  expect(local.bodies("/api/credentials")).toHaveLength(1);
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  // The fixture already holds three entrants, so the list shows five.
  await expect(page.getByText("Entrants · 5")).toBeVisible();

  await tab(page, "Assignments").click();
  await page.getByLabel("Contest", { exact: true }).selectOption({ label: "Spring finals" });
  await page.getByRole("checkbox", { name: /^Team Orion/ }).check();
  await page.getByRole("checkbox", { name: /^Team Vega/ }).check();
  await page.getByLabel("Location for the selected entrants", { exact: true }).fill("Hall 9");
  await page.getByRole("button", { name: "Assign selected entrants (2)", exact: true }).click();
  await expect(page.getByRole("list", { name: "Entrants in Spring finals" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("Hall 9", { exact: true })).toHaveCount(2);

  // The contestant signs in with the entrant's handle and finds the contest.
  await local.adopt("team-orion");
  const device = await browser.newContext({ viewport: phone });
  await local.attach(device);
  const contestant = await device.newPage();
  await signIn(contestant, "team-orion");
  await expect(contestant.locator('[data-ui="contestant"]')).toBeVisible();
  await expect(contestant.locator('[data-ui="contestant"]')).toContainText("Spring finals");
  await expect(contestant.locator('[data-ui="contestant"]')).toContainText("Team Orion");
  await device.close();
});

test("editing a contest with no schedule saves nothing until an edit, and a rename keeps it unscheduled", async ({ page, local }) => {
  await page.setViewportSize(desktop);
  await openConsole(page);
  await tab(page, "Contests").click();
  await page.getByRole("button", { name: "Edit Primary", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit contest" });
  await expect(dialog.getByRole("button", { name: "Save contest", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Start date", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Name", { exact: true }).fill("Primary round");
  await expect(dialog.getByRole("button", { name: "Save contest", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Save contest", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await local.rows("SELECT name, starts_at, ends_at FROM sessions WHERE id = ?", local.sessions[0]))
    .toEqual([{ name: "Primary round", starts_at: null, ends_at: null }]);
  // "Add a schedule" shows the fields, and Save stays off until they hold a valid schedule that differs.
  await page.getByRole("button", { name: "Edit Primary round", exact: true }).click();
  await dialog.getByRole("button", { name: "Add a schedule", exact: true }).click();
  await expect(dialog.getByLabel("Start date", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save contest", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Save contest", exact: true }).click();
  await expect(dialog).toBeHidden();
  const [row] = await local.rows<{ starts_at: string | null }>("SELECT starts_at FROM sessions WHERE id = ?", local.sessions[0]);
  expect(row?.starts_at).not.toBeNull();
});

test("a rename from a stale Edit contest dialog keeps the schedule that another admin saved", async ({ page, local, browser }) => {
  test.setTimeout(60_000);
  await local.run(
    `UPDATE sessions SET starts_at = '2031-03-03T10:00:00.000Z', ends_at = '2031-03-03T14:00:00.000Z', grace_minutes = 5 WHERE id = ?`,
    local.sessions[0],
  );
  await page.setViewportSize(desktop);
  await openConsole(page);
  await tab(page, "Contests").click();
  await page.getByRole("button", { name: "Edit Primary", exact: true }).click();
  const first = page.getByRole("dialog", { name: "Edit contest" });
  await expect(first.getByLabel("Grace after the end (minutes)", { exact: true })).toHaveValue("5");

  const context = await browser.newContext({ viewport: desktop });
  await local.attach(context);
  const other = await context.newPage();
  await openConsole(other);
  await tab(other, "Contests").click();
  await other.getByRole("button", { name: "Edit Primary", exact: true }).click();
  const second = other.getByRole("dialog", { name: "Edit contest" });
  await second.getByLabel("Grace after the end (minutes)", { exact: true }).fill("20");
  await second.getByRole("button", { name: "Save contest", exact: true }).click();
  await expect(second).toBeHidden();

  await first.getByLabel("Name", { exact: true }).fill("Primary round");
  await first.getByRole("button", { name: "Save contest", exact: true }).click();
  await expect(first).toBeHidden();
  expect(await local.rows("SELECT name, grace_minutes FROM sessions WHERE id = ?", local.sessions[0]))
    .toEqual([{ name: "Primary round", grace_minutes: 20 }]);
  await context.close();
});

test("an event admin adds a volunteer of the event to a contest", async ({ page, local, browser }) => {
  test.setTimeout(60_000);
  await page.setViewportSize(desktop);
  await openConsole(page);

  await tab(page, "People").click();
  await page.getByLabel("People, one per line: name, username", { exact: true }).fill("Sam Lee, sam-lee");
  await page.getByRole("button", { name: "Create people (1)", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Share these credentials securely" });
  await expect(sheet.getByText("sam-lee", { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("list").getByText("sam-lee", { exact: true })).toBeVisible();

  await tab(page, "Assignments").click();
  await page.getByLabel("Contest", { exact: true }).selectOption({ label: "Primary" });
  const row = page.getByRole("listitem").filter({ hasText: "sam-lee" });
  await row.getByRole("checkbox", { name: /Volunteer$/ }).check({ force: true });
  await row.getByRole("button", { name: "Assign Sam Lee as Volunteer", exact: true }).click();
  await expect(row.getByText("Assigned", { exact: true })).toBeVisible();
  const [seat] = await local.rows<{ roles: string }>(
    `SELECT json_group_array(role) AS roles FROM membership_roles WHERE session_id = ? AND account_id =
      (SELECT id FROM accounts WHERE handle = 'sam-lee')`, local.sessions[0]);
  expect(JSON.parse(seat!.roles)).toEqual(["volunteer"]);

  // Sam signs in and opens the contest on a phone.
  await local.adopt("sam-lee");
  const device = await browser.newContext({ viewport: phone });
  await local.attach(device);
  const volunteer = await device.newPage();
  await signIn(volunteer, "sam-lee");
  await expect(volunteer.locator('[data-ui="organiser-phone"]')).toBeVisible();
  await expect(volunteer.locator('[data-ui="organiser-phone"]')).toContainText("Primary");
  await device.close();

  // Removing the seat leaves the person in the event.
  await row.getByRole("button", { name: "Remove Sam Lee from this contest", exact: true }).click();
  await expect(row.getByText("Assigned", { exact: true })).toHaveCount(0);
  await tab(page, "People").click();
  await expect(page.getByText("Sam Lee", { exact: true })).toBeVisible();
});

test("a contest admin reaches no event console", async ({ page, local }) => {
  expect(local.eventCode).not.toBe("");
  await page.setViewportSize(desktop);
  await signIn(page, "admin");
  await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "Event console", exact: true })).toHaveCount(0);
  await page.goto("/event");
  await expect(page.getByText("Only an event admin or a webmaster can change this event.")).toBeVisible();
});

for (const [label, viewport] of [["phone", phone], ["narrow phone", narrow]] as const) {
  test(`every console tab fits a ${label} without sideways scrolling`, async ({ page, local }) => {
    expect(local.eventCode).not.toBe("");
    await page.setViewportSize(viewport);
    await openConsole(page);
    if (shots) mkdirSync(shots, { recursive: true });
    for (const name of ["People", "Entrants", "Contests", "Assignments"]) {
      await tab(page, name).click();
      if (name === "People") {
        await page.getByLabel("People, one per line: name, username", { exact: true })
          .fill(`${"A very long staff name ".repeat(6)}, long-handle-${"x".repeat(12)}\nSecond Person, second-person`);
      }
      if (name === "Entrants") {
        await page.getByLabel("Entrants, one per line: name, username", { exact: true })
          .fill(`${"A very long team name ".repeat(6)}, long-team-${"x".repeat(12)}\nSecond Team, second-team`);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${name} at ${viewport.width}px`).toBeLessThanOrEqual(0);
      if (shots) await page.screenshot({ path: `${shots}/event-${name.toLowerCase()}-${viewport.width}.png`, fullPage: true });
    }
  });
}

test.describe("the site dashboard", () => {
  test.use({ webmaster: "admin", withEventAdmin: false });

  for (const [label, viewport] of [["phone", phone], ["narrow phone", narrow]] as const) {
    test(`lists events and creates one on a ${label}`, async ({ page, local }) => {
      await page.setViewportSize(viewport);
      await page.goto("/sign-in");
      await page.getByRole("button", { name: "Site sign-in", exact: true }).click();
      await page.getByLabel("Username", { exact: true }).fill("admin");
      await page.getByLabel("Password", { exact: true }).fill("fixture-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.goto("/site");
      await expect(page.getByRole("heading", { level: 1, name: "Site" })).toBeVisible();
      // Parallel tests share the database, so several fixture events can hold this name.
      await expect(page.getByRole("link", { name: "Open the console of Jury verification" }).first()).toBeVisible();
      if (shots) {
        mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: `${shots}/site-${viewport.width}.png`, fullPage: true });
      }
      await page.getByRole("button", { name: "Create event", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Create an event" });
      if (shots) await page.screenshot({ path: `${shots}/site-create-${viewport.width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      const code = `spring-${crypto.randomUUID().slice(0, 8)}`;
      await dialog.getByLabel("Event name", { exact: true }).fill("Spring Olympiad");
      await dialog.getByLabel("Event code", { exact: true }).fill(code);
      await dialog.getByLabel("First event admin, name", { exact: true }).fill("Alex Admin");
      await dialog.getByLabel("First event admin, username", { exact: true }).fill(`alex-${code.slice(7)}`);
      await dialog.getByRole("button", { name: "Create event", exact: true }).click();
      const credentials = page.getByRole("dialog", { name: "First event admin of Spring Olympiad" });
      await expect(credentials).toBeVisible();
      await expect(credentials.getByLabel("Sign-in link", { exact: true })).toHaveValue(`${new URL(page.url()).origin}/?event=${code}`);
      await expect(credentials.getByLabel("Temporary password", { exact: true })).not.toHaveValue("");
      expect(local.bodies("/api/credentials")).toHaveLength(1);
    });
  }
});

test.describe("the console's roster editor", () => {
  const box = (page: Page) => page.getByLabel("Entrants, one per line: name, username", { exact: true });
  const count = (page: Page) => page.getByText(/^Entrants · \d+$/);
  const openEntrants = async (page: Page) => {
    await page.setViewportSize(desktop);
    await openConsole(page);
    await tab(page, "Entrants").click();
  };
  const closeSheet = (page: Page) =>
    page.getByRole("dialog", { name: "Share these credentials securely" }).getByRole("button", { name: "Done", exact: true }).click();

  test("adds entrants with the keyboard alone", async ({ page, local }) => {
    expect(local.eventCode).not.toBe("");
    await openEntrants(page);
    await box(page).focus();
    await page.keyboard.type("Team Zeta, team-zeta");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Team Eta, team-eta");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Share these credentials securely" });
    await expect(sheet.getByLabel("Password for Team Zeta", { exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Done", exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(box(page)).toBeFocused();
    await expect(box(page)).toHaveValue("");
  });

  test("names each problem line and blocks the import", async ({ page, local }) => {
    await openEntrants(page);
    await box(page).fill("New one, new-one\nNew one, other\nThird");
    await expect(page.getByRole("list", { name: "Lines with a problem" }).getByRole("listitem")).toHaveCount(2);
    await expect(page.getByText("Line 2: Same name as line 1.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Import entrants/ })).toBeDisabled();
    expect(local.bodies("/api/manage")).toEqual([]);
  });

  test("a rejected import keeps the lines", async ({ page, local }) => {
    await openEntrants(page);
    await box(page).fill("Team Zeta, team-zeta");
    await page.route("**/api/manage", (route) => route.fulfill({ status: 409, json: { error: "That username is taken. Choose another." } }), { times: 1 });
    await page.getByRole("button", { name: "Import entrants (1)", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("taken");
    await expect(box(page)).toHaveValue("Team Zeta, team-zeta");
    expect(local.eventCode).not.toBe("");
  });

  test("a retry after a lost request sends the same request ID", async ({ page, local }) => {
    await openEntrants(page);
    const before = await count(page).textContent();
    const sent: Array<string | null> = [];
    await page.route("**/api/manage", (route) => {
      sent.push(route.request().postData());
      return route.fallback();
    });
    local.loseNext("/api/manage", "request");
    await box(page).fill("Team Zeta, team-zeta");
    await page.getByRole("button", { name: "Import entrants (1)", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(box(page)).toHaveValue("Team Zeta, team-zeta");
    await page.getByRole("button", { name: "Import entrants (1)", exact: true }).click();
    await closeSheet(page);
    expect(await count(page).textContent()).not.toBe(before);
    expect(local.eventCode).not.toBe("");
    expect(new Set(sent).size).toBe(1);
  });

  test("when the answer was lost, a retry clears the box without a second entrant", async ({ page, local }) => {
    await openEntrants(page);
    local.loseNext("/api/manage", "response");
    await box(page).fill("Team Zeta, team-zeta");
    await page.getByRole("button", { name: "Import entrants (1)", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    // The read after the lost answer shows the entrant, so the box clears itself.
    await expect(page.getByText("Entrants · 4")).toBeVisible();
    await expect(box(page)).toHaveValue("");
    expect(await local.rows("SELECT id FROM entrants WHERE name = 'Team Zeta' AND event_id = (SELECT id FROM events WHERE code = ?)", local.eventCode)).toHaveLength(1);
  });

  test("renames with the keyboard, Escape cancels, and focus returns to the button", async ({ page, local }) => {
    expect(local.eventCode).not.toBe("");
    await openEntrants(page);
    await box(page).fill("Team Zeta, team-zeta");
    await page.getByRole("button", { name: "Import entrants (1)", exact: true }).click();
    await closeSheet(page);
    const edit = page.getByRole("button", { name: "Rename Team Zeta", exact: true });
    await edit.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Rename entrant" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(edit).toBeFocused();
    await page.keyboard.press("Enter");
    await dialog.getByLabel("Name", { exact: true }).fill("Team Theta");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Team Theta", { exact: true })).toBeVisible();
  });

  test("refuses a name that another entrant has", async ({ page, local }) => {
    expect(local.eventCode).not.toBe("");
    await openEntrants(page);
    await box(page).fill("Team Zeta, team-zeta\nTeam Eta, team-eta");
    await page.getByRole("button", { name: "Import entrants (2)", exact: true }).click();
    await closeSheet(page);
    await page.getByRole("button", { name: "Rename Team Zeta", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Rename entrant" });
    await dialog.getByLabel("Name", { exact: true }).fill(" team eta ");
    await expect(dialog.getByText("Another entrant has this name.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save name", exact: true })).toBeDisabled();
  });

  test("asks before it resets a team password, and keeps the sheet through a failed read", async ({ page, local }) => {
    expect(local.eventCode).not.toBe("");
    await openEntrants(page);
    await box(page).fill("Team Zeta, team-zeta");
    await page.getByRole("button", { name: "Import entrants (1)", exact: true }).click();
    await closeSheet(page);
    const issued = local.bodies("/api/credentials").length;
    await page.getByRole("button", { name: "Reset password for Team Zeta", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Reset the password of Team Zeta?" });
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(local.bodies("/api/credentials")).toHaveLength(issued);
    await page.getByRole("button", { name: "Reset password for Team Zeta", exact: true }).click();
    await page.route("**/api/event*", (route) => route.abort());
    await confirm.getByRole("button", { name: "Reset password", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Share these credentials securely" });
    await expect(sheet.getByLabel("Password for Team Zeta", { exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(sheet.getByLabel("Password for Team Zeta", { exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByText("This page may be out of date.")).toBeVisible();
    await expect(page.getByText("Team Zeta", { exact: true })).toBeVisible();
    await page.unroute("**/api/event*");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByText("This page may be out of date.")).toHaveCount(0);
  });

  test("a command error stays on its tab, and a toggle retried after a lost answer still applies", async ({ page, local }) => {
    expect(local.eventCode).not.toBe("");
    await page.setViewportSize(desktop);
    await openConsole(page);
    await page.getByLabel("People, one per line: name, username", { exact: true }).fill("Sam Lee, sam-lee");
    await page.getByRole("button", { name: "Create people (1)", exact: true }).click();
    await closeSheet(page);
    const toggle = page.getByRole("switch", { name: "Sam Lee: Event admin" });
    local.loseNext("/api/manage", "response");
    await toggle.click();
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(toggle).toBeChecked();
    await tab(page, "Entrants").click();
    await tab(page, "People").click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
  });

  test("the console reads again when the window regains focus", async ({ page, local }) => {
    expect(local.eventCode).not.toBe("");
    await openEntrants(page);
    const read = page.waitForRequest((request) => request.url().includes("/api/event"));
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
    await read;
  });

  test("a removed entrant passes focus to the next row, and a long name fits a narrow phone", async ({ page, local }) => {
    expect(local.eventCode).not.toBe("");
    await page.setViewportSize(narrow);
    await openConsole(page);
    await tab(page, "Entrants").click();
    await box(page).fill(`${"Long".repeat(40)}, long-team\nTeam Eta, team-eta`);
    await page.getByRole("button", { name: "Import entrants (2)", exact: true }).click();
    await closeSheet(page);
    await tab(page, "Assignments").click();
    await page.getByLabel("Contest", { exact: true }).selectOption({ label: "Primary" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Select all", exact: true }).click();
    await page.getByRole("button", { name: /^Assign selected entrants/ }).click();
    const list = page.getByRole("list", { name: /^Entrants in Primary/ });
    await expect(list.getByText("Team Eta", { exact: true })).toBeVisible();
    const removes = list.getByRole("button", { name: /^Remove / });
    const before = await removes.count();
    await removes.first().focus();
    await page.keyboard.press("Enter");
    await expect(removes).toHaveCount(before - 1);
    await expect(removes.first()).toBeFocused();
  });
});

test.describe("the create-event form", () => {
  test.use({ webmaster: "admin", withEventAdmin: false });

  test("refuses a time zone that does not exist, and focus returns to its button", async ({ page, local }) => {
    expect(local.eventCode).not.toBe("");
    await page.setViewportSize(narrow);
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Site sign-in", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.goto("/site");
    const create = page.getByRole("button", { name: "Create event", exact: true });
    await create.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Create an event" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(create).toBeFocused();
    await page.keyboard.press("Enter");
    await dialog.getByLabel("Event name", { exact: true }).fill("Zone test");
    await dialog.getByLabel("Event code", { exact: true }).fill("zone-test");
    await dialog.getByLabel("Time zone", { exact: true }).fill("Not/AZone");
    await dialog.getByLabel("First event admin, name", { exact: true }).fill("Alex");
    await dialog.getByLabel("First event admin, username", { exact: true }).fill("alex-zone");
    await dialog.getByRole("button", { name: "Create event", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Choose a time zone from the list");
    expect(local.bodies("/api/manage")).toEqual([]);
  });
});
