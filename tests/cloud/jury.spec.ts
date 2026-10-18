import { expect, test, type Page } from "@playwright/test";
import { account, fixture } from "./fixture";
import { snapshotSchema } from "../../src/connected/model";

async function login(page: Page, name = "jury") {
  const details = fixture().accounts[name];
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(details.username);
  await page.getByLabel("Password", { exact: true }).fill(details.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".connection-status")).toContainText("Live");
  await page.getByRole("navigation").getByRole("button", { name: "Jury worklist", exact: true }).click();
}

function viewIssue(page: Page, number: number) {
  return page.getByRole("button", { name: `View issue ISS-${number}`, exact: true });
}

async function resolvedIssue(description: string) {
  const support = await account("volunteer");
  const session = fixture().sessions[0];
  const submitted = await support.rpc("workflow", {
    p_session: session,
    p_request: crypto.randomUUID(),
    p_action: { type: "submit", category: "Backend", team_id: fixture().teams[0], description },
  });
  if (submitted.error) throw submitted.error;
  const id = submitted.data as string;
  async function current() {
    const result = await support.from("issues").select("id,number,revision,status").eq("id", id).single();
    if (result.error) throw result.error;
    return result.data;
  }
  async function action(type: string, values: Record<string, unknown> = {}) {
    const issue = await current();
    const result = await support.rpc("workflow", {
      p_session: session,
      p_request: crypto.randomUUID(),
      p_action: { type, issue_id: id, revision: issue.revision, ...values },
    });
    if (result.error) throw result.error;
  }
  await action("claim");
  await action("resolve", { summary: "Connection restored" });
  return { id, number: (await current()).number as number, current, action };
}

// Commit at the real hosted service, then discard only its response. Retrying
// must replay that transaction's receipt, with the same command and request ID.
async function loseNextResponse(page: Page, type: string) {
  const requests: unknown[] = [];
  let lost = false;
  await page.route("**/rpc/workflow", async (route) => {
    const command = route.request().postDataJSON() as { p_action: { type: string } };
    if (command.p_action.type !== type) {
      await route.continue();
      return;
    }
    requests.push(command);
    if (lost) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.ok(), "The hosted command committed before response loss").toBe(true);
    lost = true;
    await route.abort("failed");
  });
  return requests;
}

test("hosted jury worklist preserves zero-minute decisions and retries through reopening and confirmation", async ({ page }) => {
  const issue = await resolvedIssue("Jury worklist hosted retry verification");
  const jury = await account("jury");
  await login(page);
  await viewIssue(page, issue.number).click();
  await expect(page.getByRole("button", { name: /Claim issue|Resolve issue|Reopen issue/ })).toHaveCount(0);
  await page.getByLabel("Award minutes").selectOption("0");
  await page.getByLabel("Public award explanation").fill("No adjustment required after jury review");
  const awardRequests = await loseNextResponse(page, "award");
  await page.getByRole("button", { name: "Record award", exact: true }).click();
  await page.getByRole("button", { name: "Retry last request", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry last request", exact: true })).toHaveCount(0);
  expect(awardRequests).toHaveLength(2);
  expect(awardRequests[1]).toEqual(awardRequests[0]);
  await page.unroute("**/rpc/workflow");
  await expect(page.getByText("0 minutes awarded", { exact: true })).toBeVisible();
  await issue.action("reopen", { reason: "The connection failed again" });
  await expect(page.getByText("This decision relates to an earlier resolution. One award is allowed per issue.")).toBeVisible();
  await page.getByRole("button", { name: "Back to jury worklist" }).click();
  await expect(page.getByRole("article", { name: `Issue ISS-${issue.number}`, exact: true })).toContainText("Reopened");
  await viewIssue(page, issue.number).click();
  await page.getByRole("checkbox").check();
  const applyRequests = await loseNextResponse(page, "apply");
  await page.getByRole("button", { name: "Confirm applied externally" }).click();
  await page.getByRole("button", { name: "Retry last request", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry last request", exact: true })).toHaveCount(0);
  expect(applyRequests).toHaveLength(2);
  expect(applyRequests[1]).toEqual(applyRequests[0]);
  await expect(viewIssue(page, issue.number)).toHaveCount(0);
  await issue.action("resolve", { summary: "Connection restored again" });
  const repeated = await jury.rpc("workflow", {
    p_session: fixture().sessions[0],
    p_request: crypto.randomUUID(),
    p_action: { type: "award", issue_id: issue.id, revision: (await issue.current()).revision, minutes: 5, explanation: "Must reject a second award" },
  });
  expect(repeated.error?.code).toBe("23505");
  const awards = await jury.from("awards").select("minutes,applied_at").eq("issue_id", issue.id);
  if (awards.error) throw awards.error;
  expect(awards.data).toHaveLength(1);
  expect(awards.data[0].minutes).toBe(0);
  expect(awards.data[0].applied_at).not.toBeNull();
  const history = await jury.from("history").select("text").eq("issue_id", issue.id);
  if (history.error) throw history.error;
  expect(history.data.filter((entry) => entry.text.startsWith("0 minutes awarded:"))).toHaveLength(1);
  expect(history.data.filter((entry) => entry.text.startsWith("External application confirmed."))).toHaveLength(1);
});

test("two hosted clients update the ordered worklist while preserving drafts, focus and queue filters", async ({ page, browser }, testInfo) => {
  const first = await resolvedIssue("Earlier hosted jury review");
  const second = await resolvedIssue("Later hosted jury review");
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await login(page, "combined");
    await page.getByRole("navigation").getByRole("button", { name: "Issues", exact: true }).click();
    await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("open");
    const queue = await page.locator(".issue-card .issue-cell strong").allTextContents();
    const selected = await page.locator(".issue-card[aria-pressed=true] .issue-cell strong").allTextContents();
    await page.getByRole("navigation").getByRole("button", { name: "Jury worklist", exact: true }).click();
    const decisions = page.getByRole("region", { name: /^Needs decision/ });
    const order = await decisions.getByRole("article").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));
    expect(order.indexOf(`Issue ISS-${first.number}`)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(`Issue ISS-${first.number}`)).toBeLessThan(order.indexOf(`Issue ISS-${second.number}`));
    await login(other);
    await viewIssue(page, first.number).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#issue-heading")).toBeFocused();
    const draft = page.getByLabel("Public award explanation");
    await draft.fill("Draft retained during hosted updates");
    await draft.focus();
    await viewIssue(other, second.number).click();
    await other.getByLabel("Award minutes").selectOption("5");
    await other.getByLabel("Public award explanation").fill("Five minutes approved");
    const updated = page.waitForResponse(async (response) => {
      if (!response.url().endsWith("/rpc/session_snapshot") || !response.ok()) return false;
      const state = snapshotSchema.parse(await response.json());
      return state.awards.some((award) => award.issue_id === second.id);
    });
    await other.getByRole("button", { name: "Record award", exact: true }).click();
    await expect(other.getByText("5 minutes awarded", { exact: true })).toBeVisible();
    await (await updated).finished();
    await expect(draft).toHaveValue("Draft retained during hosted updates");
    await expect(draft).toBeFocused();
    await page.getByRole("button", { name: "Back to jury worklist" }).click();
    await expect(viewIssue(page, first.number)).toBeFocused();
    await expect(page.getByRole("region", { name: /^Pending external application/ }).getByRole("article", { name: `Issue ISS-${second.number}`, exact: true })).toBeVisible();
    await other.getByRole("checkbox").check();
    await other.getByRole("button", { name: "Confirm applied externally" }).click();
    await expect(viewIssue(page, second.number)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("jury-hosted-desktop.png"), fullPage: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await viewIssue(page, first.number).click();
      await expect(page.locator("#issue-heading")).toBeFocused();
      await page.getByRole("button", { name: "Back to jury worklist" }).click();
      await expect(viewIssue(page, first.number)).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath(`jury-hosted-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("navigation").getByRole("button", { name: "Issues", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("open");
    expect(await page.locator(".issue-card .issue-cell strong").allTextContents()).toEqual(queue);
    expect(await page.locator(".issue-card[aria-pressed=true] .issue-cell strong").allTextContents()).toEqual(selected);
  } finally {
    await context.close();
  }
});
