import { expect, test } from "@playwright/test";
import { account, fixture } from "./fixture";

test("hosted jury worklist preserves a zero-minute decision through reopening and external confirmation", async ({
  page,
}) => {
  const state = fixture();
  const session = state.sessions[0];
  const support = await account("volunteer");
  const jury = await account("jury");
  const submitted = await support.rpc("workflow", {
    p_session: session,
    p_request: crypto.randomUUID(),
    p_action: {
      type: "submit",
      category: "Backend",
      team_id: state.teams[0],
      description: "Jury worklist cloud verification",
    },
  });
  if (submitted.error) throw submitted.error;
  const id = submitted.data as string;
  async function current() {
    const result = await support
      .from("issues")
      .select("id,number,revision,status")
      .eq("id", id)
      .single();
    if (result.error) throw result.error;
    return result.data;
  }
  async function supportAction(
    type: string,
    values: Record<string, unknown> = {},
  ) {
    const issue = await current();
    const result = await support.rpc("workflow", {
      p_session: session,
      p_request: crypto.randomUUID(),
      p_action: { type, issue_id: id, revision: issue.revision, ...values },
    });
    if (result.error) throw result.error;
  }
  await supportAction("claim");
  await supportAction("resolve", { summary: "Connection restored" });
  const number = (await current()).number;
  const login = state.accounts.jury;
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(login.username);
  await page.getByLabel("Password", { exact: true }).fill(login.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Jury worklist", exact: true })
    .click();
  await page
    .getByRole("button", { name: `View issue ISS-${number}`, exact: true })
    .click();
  await page.getByLabel("Award minutes").selectOption("0");
  await page
    .getByLabel("Public award explanation")
    .fill("No adjustment required after jury review");
  await page.getByRole("button", { name: "Record award", exact: true }).click();
  await expect(
    page.getByText("0 minutes awarded", { exact: true }),
  ).toBeVisible();
  await supportAction("reopen", { reason: "The connection failed again" });
  await expect(
    page.getByText(
      "This decision relates to an earlier resolution. One award is allowed per issue.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to jury worklist" }).click();
  await expect(
    page.getByRole("article", { name: `Issue ISS-${number}`, exact: true }),
  ).toContainText("Reopened");
  await page
    .getByRole("button", { name: `View issue ISS-${number}`, exact: true })
    .click();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Confirm applied externally" })
    .click();
  await expect(
    page.getByRole("button", { name: `View issue ISS-${number}`, exact: true }),
  ).toHaveCount(0);
  await supportAction("resolve", { summary: "Connection restored again" });
  const repeated = await jury.rpc("workflow", {
    p_session: session,
    p_request: crypto.randomUUID(),
    p_action: {
      type: "award",
      issue_id: id,
      revision: (await current()).revision,
      minutes: 5,
      explanation: "Must reject a second award",
    },
  });
  expect(repeated.error?.code).toBe("23505");
  const awards = await jury
    .from("awards")
    .select("minutes,applied_at")
    .eq("issue_id", id);
  if (awards.error) throw awards.error;
  expect(awards.data).toHaveLength(1);
  expect(awards.data?.[0].minutes).toBe(0);
  expect(awards.data?.[0].applied_at).not.toBeNull();
});
