import type { Browser, Page } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

async function openAccount(browser: Browser, local: LocalWorker, name: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await local.attach(context);
  const page = await context.newPage();
  await page.goto("/account");
  await page.getByLabel("Event code", { exact: true }).fill(local.eventCode);
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My account", exact: true })).toBeVisible();
  return page;
}

test("a volunteer changes its own username on the account page, and a contestant cannot", async ({ browser, local }) => {
  const volunteer = await openAccount(browser, local, "volunteer");
  const handle = `desk-${crypto.randomUUID().slice(0, 8)}`;
  await volunteer.getByLabel("Change username", { exact: true }).fill(handle);
  await volunteer.getByRole("button", { name: "Change username", exact: true }).click();
  await expect(volunteer.getByRole("status").filter({ hasText: `Username changed. Sign in with ${handle} next time.` })).toBeVisible();
  const { members } = await local.snapshot(local.users.admin, local.sessions[0]);
  expect(members.find((member) => member.person.id === local.users.volunteer)?.person.username).toBe(handle);

  const contestant = await openAccount(browser, local, "contestant");
  await expect(contestant.getByText("Team account", { exact: true }).first()).toBeVisible();
  await expect(contestant.getByLabel("Change username")).toHaveCount(0);
});
