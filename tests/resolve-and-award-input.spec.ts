import type { Browser, Page } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

async function signIn(
  browser: Browser,
  local: LocalWorker,
  name: string,
  viewport: { width: number; height: number },
): Promise<Page> {
  const context = await browser.newContext({ viewport });
  await local.attach(context);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page
    .getByLabel("Password", { exact: true })
    .fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  return page;
}

function submit(local: LocalWorker): Promise<string> {
  return local.act(local.users.volunteer, {
    type: "submit",
    category: "Backend",
    description: "Keyboard stopped responding",
    team_id: local.teams[0],
  });
}

test("a preset resolution can carry a comment", async ({ browser, local }) => {
  const issueId = await submit(local);
  const page = await signIn(browser, local, "volunteer", {
    width: 1280,
    height: 800,
  });
  await page.getByText("Keyboard stopped responding").first().click();
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Resolve issue" });

  await dialog.getByText("Resolved without comment").click();
  await expect(dialog.getByLabel("Add a comment (optional)")).toHaveCount(0);
  await dialog.getByText("Service restored").click();
  await dialog
    .getByLabel("Add a comment (optional)")
    .fill("Swapped the USB hub.");
  await dialog.getByRole("button", { name: "Resolve issue" }).click();
  await expect(dialog).toHaveCount(0);

  const state = await local.snapshot(local.users.volunteer);
  expect(
    state.resolutions.find((item) => item.issue_id === issueId)?.summary,
  ).toBe("Service restored: Swapped the USB hub.");
});

test("the award form rejects decimal minutes and says why", async ({
  browser,
  local,
}) => {
  const issueId = await submit(local);
  await local.act(local.users.volunteer, {
    type: "claim",
    issue_id: issueId,
    revision: 1,
  });
  await local.act(local.users.volunteer, {
    type: "resolve",
    issue_id: issueId,
    revision: 2,
    summary: "Fixed",
  });
  const jury = await signIn(browser, local, "jury", { width: 390, height: 844 });
  await jury
    .getByRole("navigation", { name: "Organiser sections" })
    .getByRole("button", { name: "Awards", exact: true })
    .click();
  await jury
    .getByRole("list", { name: "To decide" })
    .getByRole("listitem")
    .filter({ hasText: "ISS-1" })
    .getByRole("button", { name: "Decide award" })
    .click();
  const award = jury.getByRole("dialog", { name: "Decide award" });
  await award.locator("label").filter({ hasText: /^Other amount$/ }).click();
  await award.getByLabel("Public award explanation").fill("Fixture reason.");
  const record = award.getByRole("button", { name: /^Record/ });

  await award.getByLabel("Custom award minutes").fill("2.5");
  await expect(award).toContainText("Enter whole minutes");
  await expect(record).toBeDisabled();

  await award.getByLabel("Custom award minutes").fill("3");
  await expect(award).not.toContainText("Enter whole minutes");
  await expect(record).toBeEnabled();
});
