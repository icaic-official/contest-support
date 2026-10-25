import { expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

test("an admin without a support role resolves an open issue without a specialist", async ({
  browser,
  local,
}) => {
  const issueId = await local.act(local.users.volunteer, {
    type: "submit",
    category: "Backend",
    description: "Keyboard stopped responding",
    team_id: local.teams[0],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await local.attach(context);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();

  await page.getByText("Keyboard stopped responding").first().click();
  const progress = page.getByRole("list", { name: "Issue progress" });
  await expect(progress).toContainText("Specialist");
  await expect(progress).toContainText("optional");
  await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await page.getByText("Write a custom summary").click();
  await page
    .getByLabel("Custom resolution summary")
    .fill("Swapped the keyboard");
  await page.getByRole("button", { name: "Resolve issue" }).click();

  await expect(
    page.getByRole("button", { name: "Resolve", exact: true }),
  ).toHaveCount(0);
  const { issue } = await local.snapshot(local.users.admin).then((state) => ({
    issue: state.issues.find((item) => item.id === issueId)!,
  }));
  expect(issue).toMatchObject({
    status: "resolved",
    owner: local.users.admin,
    first_assigned_at: null,
  });
});
