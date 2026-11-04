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

test("an event admin adds a volunteer of the event to a contest", async ({ page, local, browser }) => {
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
  await expect(row.getByRole("checkbox", { name: /Volunteer$/ })).toBeChecked();
  await row.getByRole("button", { name: "Assign Sam Lee", exact: true }).click();
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
