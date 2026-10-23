import { expect, test, type Page } from "@playwright/test";
import { account, fixture } from "./fixture";
import { snapshotSchema } from "../../src/connected/model";
import {
  byId,
  choose,
  consoleLink,
  desktop,
  fitsWidth,
  login,
  openDialog,
  phone,
  phoneTab,
  uiRoot,
} from "./ui";

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

/** The heading of an open phone issue view: "ISS-<number>, <team>". */
function issueHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: /^ISS-\d+, / });
}

test("hosted jury Awards tab preserves zero-minute decisions and retries through reopening and confirmation", async ({ page }) => {
  const issue = await resolvedIssue("Jury worklist hosted retry verification");
  const jury = await account("jury");
  await page.setViewportSize(phone);
  await login(page, "jury", "organiser-phone");
  const awardsHeading = page.getByRole("heading", { level: 1, name: "Awards", exact: true });
  await expect(awardsHeading).toBeVisible();
  await expect(page).toHaveURL("/jury");
  const card = byId(page, `issue-card-${issue.id}`);
  await card.click();
  await expect(issueHeading(page)).toBeFocused();
  await expect(page.getByRole("button", { name: /^(Claim|Resolve|Reopen|Reply)/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Decide award", exact: true }).click();
  const sheet = openDialog(page);
  await choose(sheet.getByRole("radio", { name: "0 min", exact: true }));
  await sheet.getByLabel("Public award explanation").fill("No adjustment required after jury review");
  const awardRequests = await loseNextResponse(page, "award");
  await sheet.getByRole("button", { name: "Record 0 minutes", exact: true }).click();
  // The refresh after the lost response already shows the award, so the
  // award sheet closes and the retry button is in the issue view.
  await expect(sheet).toBeHidden();
  await page.getByRole("button", { name: "Retry last request", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry last request", exact: true })).toHaveCount(0);
  expect(awardRequests).toHaveLength(2);
  expect(awardRequests[1]).toEqual(awardRequests[0]);
  await page.unroute("**/rpc/workflow");
  await expect(page.getByText(/^0 minutes awarded:/)).toBeVisible();
  await expect(page.getByText("Pending external application")).toBeVisible();
  await issue.action("reopen", { reason: "The connection failed again" });
  // A jury-only member keeps the reopened issue open while its award waits.
  await expect(page.getByText("This decision relates to an earlier resolution. One award is allowed per issue.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm applied", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(awardsHeading).toBeVisible();
  const lists = page.getByRole("group", { name: "Award lists" });
  await lists.getByRole("button", { name: /^To apply/ }).click();
  const pending = page.getByRole("listitem").filter({ has: card });
  await expect(pending).toContainText("Reopened · In progress");
  await expect(pending).toContainText("This award relates to an earlier resolution.");
  await pending.getByRole("button", { name: "Confirm applied externally", exact: true }).click();
  await sheet.getByRole("checkbox", { name: /I confirm this award was applied/ }).check();
  const applyRequests = await loseNextResponse(page, "apply");
  await sheet.getByRole("button", { name: "Confirm applied externally", exact: true }).click();
  // The refresh after the lost response already shows the applied award, so
  // the reopened issue closes and the retry button is on the Awards tab.
  await page.getByRole("button", { name: "Retry last request", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry last request", exact: true })).toHaveCount(0);
  expect(applyRequests).toHaveLength(2);
  expect(applyRequests[1]).toEqual(applyRequests[0]);
  await page.unroute("**/rpc/workflow");
  // The applied award leaves the jury lists, so the reopened issue closes.
  await expect(awardsHeading).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^ISS-\d+ is no longer in your lists\.$/ })).toBeVisible();
  await lists.getByRole("button", { name: /^To apply/ }).click();
  await expect(card).toHaveCount(0);
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

test("two hosted clients update the award lists while preserving drafts, focus and queue filters", async ({ page, browser }, testInfo) => {
  const first = await resolvedIssue("Earlier hosted jury review");
  const second = await resolvedIssue("Later hosted jury review");
  const context = await browser.newContext({ viewport: phone });
  const other = await context.newPage();
  try {
    await page.setViewportSize(desktop);
    await login(page, "combined", "organiser-desktop");
    const open = page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /^Open \d+$/ });
    await open.click();
    await expect(open).toHaveAttribute("aria-pressed", "true");
    const rows = page.locator("[data-issue-row]");
    const queue = await rows.allTextContents();
    await consoleLink(page, "Award review").click();
    await expect(page.getByRole("heading", { level: 1, name: "Award review" })).toBeFocused();
    await expect(page).toHaveURL("/jury");
    await expect(byId(page, `award-issue-${first.id}`)).toBeVisible();
    await expect(byId(page, `award-issue-${second.id}`)).toBeVisible();
    const order = await page.locator('[id^="award-issue-"]').evaluateAll((buttons) => buttons.map((button) => button.id));
    expect(order.indexOf(`award-issue-${first.id}`)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(`award-issue-${first.id}`)).toBeLessThan(order.indexOf(`award-issue-${second.id}`));
    await login(other, "jury", "organiser-phone");
    await byId(page, `award-issue-${first.id}`).focus();
    await page.keyboard.press("Enter");
    const sheet = openDialog(page);
    await expect(sheet.getByRole("tab", { name: "Outcome & award" })).toHaveAttribute("aria-selected", "true");
    const draft = sheet.getByLabel("Public award explanation");
    await draft.fill("Draft retained during hosted updates");
    await draft.focus();
    await byId(other, `issue-card-${second.id}`).click();
    await other.getByRole("button", { name: "Decide award", exact: true }).click();
    const otherSheet = openDialog(other);
    await choose(otherSheet.getByRole("radio", { name: "5 min", exact: true }));
    await otherSheet.getByLabel("Public award explanation").fill("Five minutes approved");
    const updated = page.waitForResponse(async (response) => {
      if (!response.url().endsWith("/rpc/session_snapshot") || !response.ok()) return false;
      const state = snapshotSchema.parse(await response.json());
      return state.awards.some((award) => award.issue_id === second.id);
    });
    await otherSheet.getByRole("button", { name: "Record 5 minutes", exact: true }).click();
    await expect(otherSheet).toBeHidden();
    await expect(other.getByText("+5 min", { exact: true })).toBeVisible();
    await (await updated).finished();
    await expect(draft).toHaveValue("Draft retained during hosted updates");
    await expect(draft).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(byId(page, `award-issue-${first.id}`)).toBeFocused();
    const lists = page.getByRole("group", { name: "Award lists" });
    await lists.getByRole("button", { name: /^To apply/ }).click();
    await expect(byId(page, `award-issue-${second.id}`)).toBeVisible();
    await other.getByRole("button", { name: "Confirm applied", exact: true }).click();
    await otherSheet.getByRole("checkbox", { name: /I confirm this award was applied/ }).check();
    await otherSheet.getByRole("button", { name: "Confirm applied externally", exact: true }).click();
    await expect(byId(page, `award-issue-${second.id}`)).toHaveCount(0);
    await lists.getByRole("button", { name: /^Applied/ }).click();
    await expect(byId(page, `award-issue-${second.id}`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("jury-hosted-desktop.png"), fullPage: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(uiRoot(page, "organiser-phone")).toBeVisible();
      expect(await fitsWidth(page)).toBe(true);
      await phoneTab(page, "Awards");
      const card = byId(page, `issue-card-${first.id}`);
      await card.focus();
      await page.keyboard.press("Enter");
      await expect(issueHeading(page)).toBeFocused();
      await expect(page.getByRole("button", { name: "Decide award", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(card).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath(`jury-hosted-${width}.png`), fullPage: true });
    }
    // The shared status filter survives the change between layouts.
    await page.setViewportSize(desktop);
    await expect(uiRoot(page, "organiser-desktop")).toBeVisible();
    await consoleLink(page, "Queue").click();
    await expect(page).toHaveURL("/issues");
    await expect(open).toHaveAttribute("aria-pressed", "true");
    expect(await rows.allTextContents()).toEqual(queue);
  } finally {
    await context.close();
  }
});
