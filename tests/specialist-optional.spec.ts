import { expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

test("a volunteer claims and resolves an issue without a specialist handoff", async ({
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
  await page.getByLabel("Username", { exact: true }).fill("volunteer");
  await page
    .getByLabel("Password", { exact: true })
    .fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();

  await page.getByText("Keyboard stopped responding").first().click();
  const progress = page.getByRole("list", { name: "Issue progress" });
  await expect(progress).toContainText("Specialist");
  await expect(progress).toContainText("optional");
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await page.getByText("Service restored").click();
  await page.getByRole("button", { name: "Resolve issue" }).click();

  await expect(
    page.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
  const state = await local.snapshot(local.users.volunteer);
  expect(state.issues.find((item) => item.id === issueId)).toMatchObject({
    status: "resolved",
    owner: local.users.volunteer,
  });
});
