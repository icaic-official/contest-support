import type { Page } from "@playwright/test";
import { expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

const adminHint =
  "You cannot claim this issue. Claiming needs the Volunteer or Specialist role. Add the Volunteer role to your own account in Accounts to claim it.";

const openOnDesktop = (page: Page) =>
  page.getByText("Keyboard stopped responding").first().click();
const openOnPhone = (page: Page) =>
  page.getByRole("button", { name: /^Open ISS-1,/ }).click();

for (const viewport of [
  {
    name: "desktop issue sheet",
    size: { width: 1280, height: 800 },
    open: openOnDesktop,
  },
  {
    name: "phone issue view",
    size: { width: 390, height: 844 },
    open: openOnPhone,
  },
]) {
  test(`an admin without a support role learns why Claim is missing on the ${viewport.name}`, async ({
    page,
    local,
  }) => {
    await local.act(local.users.volunteer, {
      type: "submit",
      category: "Backend",
      description: "Keyboard stopped responding",
      team_id: local.teams[0],
    });
    await page.setViewportSize(viewport.size);
    await page.goto("/sign-in");
    await page.getByLabel("Username", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Live", { exact: true })).toBeVisible();

    await viewport.open(page);
    await expect(page.getByRole("list", { name: "Issue progress" })).toBeVisible();
    await expect(page.getByText(adminHint)).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);
  });
}

test("a volunteer sees no claim hint on an open issue", async ({ page, local }) => {
  await local.act(local.users.specialist, {
    type: "submit",
    category: "Backend",
    description: "Keyboard stopped responding",
    team_id: local.teams[0],
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("volunteer");
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();

  await openOnDesktop(page);
  await expect(page.getByRole("list", { name: "Issue progress" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim", exact: true })).toBeVisible();
  await expect(page.getByText("You cannot claim this issue.")).toHaveCount(0);
});
