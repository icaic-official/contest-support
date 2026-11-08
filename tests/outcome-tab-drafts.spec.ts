import type { Browser } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

const desktop = { width: 1280, height: 800 };

/** A resolved issue that the volunteer handled. Returns its ID. */
async function resolvedIssue(local: LocalWorker): Promise<string> {
  const issueId = await local.act(local.users.volunteer, {
    type: "submit",
    category: "Backend",
    description: "Keyboard stopped responding",
    team_id: local.teams[0],
  });
  for (const type of ["claim", "resolve"] as const) {
    const { revision } = (await local.snapshot()).issues.find(
      (item) => item.id === issueId,
    )!;
    await local.act(
      local.users.volunteer,
      type === "claim"
        ? { type, issue_id: issueId, revision }
        : { type, issue_id: issueId, revision, summary: "Swapped the keyboard" },
    );
  }
  return issueId;
}

async function signInAsJury(browser: Browser, local: LocalWorker) {
  const context = await browser.newContext({ viewport: desktop });
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

test("the award amount and explanation survive a visit to the Activity tab", async ({
  browser,
  local,
}) => {
  await resolvedIssue(local);
  const page = await signInAsJury(browser, local);
  await page
    .getByRole("button", { name: "Keyboard stopped responding", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: /^ISS-1: Keyboard stopped/ });
  await sheet.getByRole("tab", { name: "Outcome & award" }).click();
  await sheet.locator("label").filter({ hasText: /^Other amount$/ }).click();
  await sheet.getByLabel("Custom award minutes").fill("7");
  await sheet
    .getByLabel("Public award explanation")
    .fill("Seven minutes for the keyboard fault.");

  await sheet.getByRole("tab", { name: /^Activity/ }).click();
  await expect(sheet.getByLabel("Public award explanation")).toBeHidden();
  await sheet.getByRole("tab", { name: "Outcome & award" }).click();

  await expect(sheet.getByLabel("Public award explanation")).toHaveValue(
    "Seven minutes for the keyboard fault.",
  );
  await expect(sheet.getByLabel("Custom award minutes")).toHaveValue("7");
  await expect(
    sheet.getByRole("button", { name: "Record 7 minutes" }),
  ).toBeEnabled();
});

test("the external application tick survives a visit to the Activity tab", async ({
  browser,
  local,
}) => {
  const issueId = await resolvedIssue(local);
  const { revision } = (await local.snapshot()).issues.find(
    (item) => item.id === issueId,
  )!;
  await local.act(local.users.jury, {
    type: "award",
    issue_id: issueId,
    revision,
    minutes: 5,
    explanation: "Five minutes for the keyboard fault.",
  });
  const page = await signInAsJury(browser, local);
  await page
    .getByRole("group", { name: "Award lists" })
    .getByRole("button", { name: /^To apply/ })
    .click();
  await page
    .getByRole("button", { name: "Keyboard stopped responding", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: /^ISS-1: Keyboard stopped/ });
  await sheet.getByRole("tab", { name: "Outcome & award" }).click();
  await sheet.getByRole("checkbox", { name: /^I confirm this award/ }).check();

  await sheet.getByRole("tab", { name: /^Activity/ }).click();
  await expect(sheet.getByRole("checkbox", { name: /^I confirm this award/ })).toBeHidden();
  await sheet
    .getByRole("button", { name: "Confirm applied", exact: true })
    .click();
  await expect(
    sheet.getByRole("tab", { name: "Outcome & award" }),
  ).toHaveAttribute("aria-selected", "true");

  await expect(sheet.getByRole("checkbox", { name: /^I confirm this award/ })).toBeChecked();
  await expect(
    sheet.getByRole("button", { name: "Confirm applied externally" }),
  ).toBeEnabled();
});
