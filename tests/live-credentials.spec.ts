import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/localWorker";

test.use({ seedIssues: false, withEventAdmin: true });

/** Set MINSKY_SHOTS to a folder to keep the screens at phone widths. */
const shots = process.env.MINSKY_SHOTS;

async function signIn(page: Page, username: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

async function createLive(page: Page, name: string) {
  await page.getByLabel("Contest name", { exact: true }).fill(name);
  await page.getByLabel("Contest kind", { exact: true }).selectOption("live");
  await page.getByRole("button", { name: "Create contest", exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

async function assign(page: Page, contest: string) {
  await page.getByLabel("Contest", { exact: true }).selectOption({ label: contest });
  await page.getByRole("checkbox", { name: /^Team Orion/ }).check();
  await page.getByRole("checkbox", { name: /^Team Vega/ }).check();
  await page.getByRole("button", { name: "Assign selected entrants (2)", exact: true }).click();
  await expect(page.getByRole("list", { name: `Entrants in ${contest}` }).getByRole("listitem")).toHaveCount(2);
}

test("an organizer issues live passwords from one sheet, and the readiness count reaches zero", async ({ page, local }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "eventadmin");
  await expect(page.locator('[data-ui="organiser-desktop"], [data-ui="organiser-phone"]')).toBeVisible();
  await page.goto("/event");

  await tab(page, "Contests").click();
  await createLive(page, "Live 1");
  await createLive(page, "Live 2");
  await tab(page, "Entrants").click();
  await page.getByLabel("Entrants, one per line: name, username", { exact: true })
    .fill("Team Orion, team-orion\nTeam Vega, team-vega");
  await page.getByRole("button", { name: "Import entrants (2)", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Share these credentials securely" });
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  await tab(page, "Assignments").click();
  await assign(page, "Live 1");
  await assign(page, "Live 2");

  await tab(page, "Contests").click();
  await expect(page.getByText("Waiting for live passwords: 2")).toHaveCount(2);
  await expect(page.getByText("These passwords also open: Live 2.")).toBeVisible();
  if (shots) {
    mkdirSync(shots, { recursive: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.screenshot({ path: `${shots}/live-waiting-${width}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  }

  await page.getByRole("button", { name: "Issue live passwords for Live 1", exact: true }).click();
  await expect(sheet.getByLabel("Password for Team Orion", { exact: true })).toBeVisible();
  await expect(sheet.getByLabel("Password for Team Vega", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Print sheets", exact: true })).toBeEnabled();
  await expect(page.locator("[data-print-sheets] [data-print-card]")).toHaveCount(2);
  await expect(page.locator("[data-print-sheets] [data-print-card]").first()).toContainText(local.eventCode);
  if (shots) {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.screenshot({ path: `${shots}/live-sheet-${width}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  // One issue covers the overlapping contest as well.
  await expect(page.getByText(/^Waiting for live passwords: /)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Issue live passwords/ })).toHaveCount(0);
});

test("a late entrant in a running live contest asks first, and the sheet reopens reporting", async ({ page, local }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "eventadmin");
  await expect(page.locator('[data-ui="organiser-desktop"], [data-ui="organiser-phone"]')).toBeVisible();
  await page.goto("/event");
  await tab(page, "Entrants").click();
  await page.getByLabel("Entrants, one per line: name, username", { exact: true })
    .fill("Team Orion, team-orion\nTeam Vega, team-vega");
  await page.getByRole("button", { name: "Import entrants (2)", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Share these credentials securely" });
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  await tab(page, "Contests").click();
  const name = `Running ${crypto.randomUUID().slice(0, 8)}`;
  await createLive(page, name);
  await local.run("UPDATE sessions SET starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute'), ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+2 hours') WHERE name = ?", name);
  await tab(page, "Assignments").click();
  await page.getByLabel("Contest", { exact: true }).selectOption({ label: name });
  await page.getByRole("checkbox", { name: /^Team Orion/ }).check();
  await page.getByRole("button", { name: "Assign selected entrants (1)", exact: true }).click();
  await tab(page, "Contests").click();
  await page.getByRole("button", { name: `Issue live passwords for ${name}`, exact: true }).click();
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: `Issue live passwords for ${name}`, exact: true })).toHaveCount(0);

  await tab(page, "Assignments").click();
  await page.getByLabel("Contest", { exact: true }).selectOption({ label: name });
  await page.getByRole("checkbox", { name: /^Team Vega/ }).check();
  await page.getByRole("button", { name: "Assign selected entrants (1)", exact: true }).click();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: `Close reporting in ${name}?` }));
  await expect(confirm.getByText("Reporting closes for 1 team until the new sign-ins have passwords.", { exact: false })).toBeVisible();
  await confirm.getByRole("button", { name: "Assign and close reporting", exact: true }).click();
  await expect(sheet.getByLabel("Password for Team Vega", { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  await tab(page, "Contests").click();
  await expect(page.getByRole("button", { name: `Issue live passwords for ${name}`, exact: true })).toHaveCount(0);
});
