import type { Browser } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

/** A resolved issue that the volunteer handled, with an award when asked. */
async function resolvedIssue(
  local: LocalWorker,
  award: boolean,
): Promise<void> {
  const issueId = await local.act(local.users.volunteer, {
    type: "submit",
    category: "Backend",
    description: "Keyboard stopped responding",
    team_id: local.teams[0],
  });
  const revision = async () =>
    (await local.snapshot()).issues.find((item) => item.id === issueId)!
      .revision;
  await local.act(local.users.volunteer, {
    type: "claim",
    issue_id: issueId,
    revision: await revision(),
  });
  await local.act(local.users.volunteer, {
    type: "resolve",
    issue_id: issueId,
    revision: await revision(),
    summary: "Swapped the keyboard",
  });
  if (!award) return;
  await local.act(local.users.jury, {
    type: "award",
    issue_id: issueId,
    revision: await revision(),
    minutes: 5,
    explanation: "Five minutes for the keyboard fault.",
  });
}

async function openIssueAsJury(browser: Browser, local: LocalWorker) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await local.attach(context);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("jury");
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  return page;
}

test("Decide award moves focus to the award heading", async ({
  browser,
  local,
}) => {
  await resolvedIssue(local, false);
  const page = await openIssueAsJury(browser, local);
  await page
    .getByRole("button", { name: "Keyboard stopped responding", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: /^ISS-1: Keyboard stopped/ });

  await sheet.getByRole("button", { name: "Decide award", exact: true }).click();

  await expect(sheet.getByRole("tab", { name: "Outcome & award" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    sheet.getByRole("heading", { name: "Decide award" }),
  ).toBeFocused();
});

test("Confirm applied moves focus to the external application heading", async ({
  browser,
  local,
}) => {
  await resolvedIssue(local, true);
  const page = await openIssueAsJury(browser, local);
  await page
    .getByRole("group", { name: "Award lists" })
    .getByRole("button", { name: /^To apply/ })
    .click();
  await page
    .getByRole("button", { name: "Keyboard stopped responding", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: /^ISS-1: Keyboard stopped/ });

  await sheet
    .getByRole("button", { name: "Confirm applied", exact: true })
    .click();

  await expect(
    sheet.getByRole("heading", { name: "Confirm external application" }),
  ).toBeFocused();
});
