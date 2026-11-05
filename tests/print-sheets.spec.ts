import { mkdirSync } from "node:fs";
import { expect, test } from "./support/localWorker";

test.use({ seedIssues: false, withEventAdmin: true });

/** Set MINSKY_SHOTS to a folder to keep the print-media screenshot. */
const shots = process.env.MINSKY_SHOTS;

type PrintWindow = Window & { printCalls: number };

test("Print sheets prints one card per person and leaves no password behind", async ({ page, local }) => {
  const logs: string[] = [];
  page.on("console", (message) => logs.push(message.text()));
  await page.addInitScript(() => {
    (window as unknown as PrintWindow).printCalls = 0;
    window.print = () => { (window as unknown as PrintWindow).printCalls += 1; };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("eventadmin");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.goto("/event");
  await page.getByRole("tab", { name: "Entrants", exact: true }).click();
  await page.getByLabel("Entrants, one per line: name, username", { exact: true })
    .fill("Team Orion, team-orion\nTeam Vega, team-vega");
  await page.getByRole("button", { name: "Import entrants (2)", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Share these credentials securely" });
  await expect(sheet).toBeVisible();
  const password = (await sheet.getByLabel("Password for Team Orion", { exact: true }).textContent()) ?? "";
  expect(password).toMatch(/^[2-9A-HJ-NP-Za-km-np-z]{16}$/);

  await sheet.getByRole("button", { name: "Print sheets", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as PrintWindow).printCalls)).toBe(1);

  await page.emulateMedia({ media: "print" });
  const cards = page.locator("[data-print-sheets] [data-print-card]");
  await expect(cards).toHaveCount(2);
  await expect(page.locator("#root")).toBeHidden();
  await expect(sheet).toBeHidden();
  const orion = cards.filter({ hasText: "Team Orion" });
  await expect(orion).toContainText(`${new URL(page.url()).origin}/?event=${local.eventCode}`);
  await expect(orion).toContainText(local.eventCode);
  await expect(orion).toContainText("team-orion");
  await expect(orion).toContainText(password);
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: `${shots}/print-sheets.png` });
  }
  await page.emulateMedia({ media: "screen" });
  await expect(page.locator("[data-print-sheets]")).toBeHidden();

  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("[data-print-sheets]")).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, location.href]));
  expect(stored).not.toContain(password);
  expect(await page.content()).not.toContain(password);
  expect(logs.join("\n")).not.toContain(password);
});
