import type { Browser, Page } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

const desktop = { width: 1280, height: 800 };

async function signIn(
  browser: Browser,
  local: LocalWorker,
  name: string,
): Promise<Page> {
  const context = await browser.newContext({ viewport: desktop });
  await local.attach(context);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  return page;
}

test("an admin without a support role replies to the team and writes an internal note", async ({
  browser,
  local,
}) => {
  const issueId = await local.act(local.users.volunteer, {
    type: "submit",
    category: "Backend",
    description: "Keyboard stopped responding",
    team_id: local.teams[0],
  });
  const recorded = async () =>
    (await local.snapshot(local.users.admin)).history
      .filter((item) => item.issue_id === issueId && item.actor === local.users.admin)
      .map((item) => [item.text, item.visibility]);

  const admin = await signIn(browser, local, "admin");
  await admin.getByText("Keyboard stopped responding").first().click();
  const sheet = admin.getByRole("dialog", { name: /ISS-1: Keyboard stopped responding/ });
  await expect(sheet.getByRole("button", { name: "Claim" })).toHaveCount(0);

  await sheet.getByRole("textbox", { name: "Message", exact: true }).fill("A helper is on the way.");
  await sheet.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(recorded).toEqual([["A helper is on the way.", "public"]]);

  await sheet
    .getByRole("group", { name: "Audience", exact: true })
    .getByText("Internal note", { exact: true })
    .click();
  await sheet.getByRole("textbox", { name: "Internal note", exact: true }).fill("Swap the USB hub first.");
  await sheet.getByRole("button", { name: "Add note", exact: true }).click();
  await expect.poll(async () => (await recorded()).length).toBe(2);
  expect(await recorded()).toContainEqual(["Swap the USB hub first.", "internal"]);

  const contestant = await signIn(browser, local, "contestant");
  await expect(contestant.getByText("A helper is on the way.", { exact: true })).toBeVisible();
  await expect(contestant.getByText("Swap the USB hub first.")).toHaveCount(0);
});
