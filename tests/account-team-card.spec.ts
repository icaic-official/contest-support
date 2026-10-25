import type { Page } from "@playwright/test";
import { expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

async function openCreateAccount(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Console pages" })
    .getByRole("button", { name: /^Accounts/ })
    .click();
  await page.getByRole("button", { name: "Create account" }).click();
  const dialog = page.getByRole("dialog", { name: "Create account" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("the Team account type is available and described when the session has teams", async ({
  page,
  local,
}) => {
  expect((await local.snapshot()).teams.length).toBeGreaterThan(0);
  const dialog = await openCreateAccount(page);

  const team = dialog.getByRole("radio", { name: /^Team/ });
  await expect(team).toBeEnabled();
  await expect(dialog.getByText("Shared team login")).toBeVisible();
});

test("the Team account type tells an admin to add a team first when the session has none", async ({
  page,
  local,
}) => {
  await local.run(
    "DELETE FROM memberships WHERE session_id = ? AND account_id = ?",
    local.sessions[0],
    local.users.contestant,
  );
  await local.run("DELETE FROM teams WHERE session_id = ?", local.sessions[0]);
  const dialog = await openCreateAccount(page);

  const team = dialog.getByRole("radio", { name: /^Team/ });
  await expect(team).toBeDisabled();
  await expect(dialog.getByText("Add a team first.")).toBeVisible();
  await expect(dialog.getByText("Shared team login")).toHaveCount(0);
});
