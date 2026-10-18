import { expect, test as base, type Page } from "@playwright/test";
import { createJuryFixture } from "./jury-fixture";
import { snapshotSchema } from "../src/connected/model";

const test = base.extend<{
  local: Awaited<ReturnType<typeof createJuryFixture>>;
}>({
  local: async ({ context }, provide) => {
    const local = await createJuryFixture();
    await local.attach(context);
    try {
      await provide(local);
    } finally {
      await local.close();
    }
  },
});
test.describe.configure({ mode: "default" });

async function login(page: Page, name = "jury") {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Workspace navigation" }),
  ).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
}
async function openWorklist(page: Page) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Jury worklist", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Jury worklist", exact: true }),
  ).toBeVisible();
}
function section(page: Page, name: string) {
  return page.getByRole("region", { name: new RegExp(`^${name}`) });
}

test("lists outstanding work across queue filters and returns keyboard focus to the selected row", async ({
  page,
  local,
}) => {
  await login(page, "combined");
  await page.getByLabel("Status").selectOption("resolved");
  await page.getByRole("combobox", { name: "Find a team" }).fill("Aurora");
  await page.getByRole("option", { name: /Aurora/ }).click();
  await page.locator(".issue-card").filter({ hasText: "ISS-3" }).click();
  await expect(page.locator("#issue-heading")).toHaveText("Issue 3 verification");
  const before = await page.locator(".issue-card").allTextContents();
  await openWorklist(page);
  const decisions = section(page, "Needs decision");
  const applications = section(page, "Pending external application");
  await expect(decisions.getByRole("article")).toHaveCount(2);
  await expect(applications.getByRole("article")).toHaveCount(2);
  expect(
    await decisions
      .getByRole("article")
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label"))),
  ).toEqual(["Issue ISS-1", "Issue ISS-2"]);
  await expect(
    applications.getByRole("article", { name: "Issue ISS-3", exact: true }),
  ).toContainText("0 minutes awarded");
  await expect(
    applications.getByRole("article", { name: "Issue ISS-4", exact: true }),
  ).toContainText("Reopened");
  await expect(
    page.getByRole("article", { name: "Issue ISS-5", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "Issue ISS-6", exact: true }),
  ).toHaveCount(0);
  const target = page.getByRole("button", {
    name: "View issue ISS-4",
    exact: true,
  });
  await target.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#issue-heading")).toBeFocused();
  await page.getByRole("button", { name: "Back to jury worklist" }).click();
  await expect(target).toBeFocused();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Issues", exact: true })
    .click();
  await expect(page.getByLabel("Status")).toHaveValue("resolved");
  await expect(page.getByRole("combobox", { name: "Find a team" })).toHaveValue("Aurora");
  await expect(page.locator("#issue-heading")).toHaveText("Issue 3 verification");
  expect(await page.locator(".issue-card").allTextContents()).toEqual(before);
  expect((await local.snapshot()).awards).toHaveLength(3);
});

test("jury-only members record an explicit zero and can confirm a reopened issue's earlier award", async ({
  page,
  local,
}) => {
  await login(page);
  await expect(
    page.locator(".issue-card").filter({ hasText: "ISS-4" }),
  ).toHaveCount(0);
  await openWorklist(page);
  await page
    .getByRole("button", { name: "View issue ISS-1", exact: true })
    .click();
  const time = await page.locator(".elapsed-time").innerText();
  await page.getByLabel("Award minutes").selectOption("0");
  await page
    .getByLabel("Public award explanation")
    .fill("Reviewed: no adjustment required.");
  await page.getByRole("button", { name: "Record award", exact: true }).click();
  await expect(
    page.getByText("0 minutes awarded", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to jury worklist" }).click();
  await expect(
    section(page, "Needs decision").getByRole("heading"),
  ).toBeFocused();
  await expect(
    section(page, "Needs decision").getByRole("article"),
  ).toHaveCount(1);
  await expect(
    section(page, "Pending external application").getByRole("article"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("article", { name: "Issue ISS-1", exact: true }),
  ).toContainText(time);
  expect(
    (await local.snapshot()).awards.find(
      (award) => award.issue_id === local.issues[0],
    )?.applied_at,
  ).toBeNull();
  await page
    .getByRole("button", { name: "View issue ISS-4", exact: true })
    .click();
  await expect(
    page.getByText(
      "This decision relates to an earlier resolution. One award is allowed per issue.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Record award|Reopen issue|Claim issue|Resolve issue/,
    }),
  ).toHaveCount(0);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Confirm applied externally" })
    .click();
  await expect(
    section(page, "Pending external application").getByRole("heading"),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "View issue ISS-4", exact: true }),
  ).toHaveCount(0);
  const current = await local.snapshot();
  expect(
    current.awards.find((award) => award.issue_id === local.issues[3])
      ?.applied_at,
  ).not.toBeNull();
  expect(
    current.issues.find((issue) => issue.id === local.issues[3])?.status,
  ).toBe("claimed");
});

test("two simulated Realtime clients refresh decisions and confirmations without losing an unrelated draft", async ({
  page,
  browser,
  local,
}) => {
  const other = await browser.newContext();
  await local.attach(other);
  const second = await other.newPage();
  try {
    await login(page);
    await login(second, "combined");
    await openWorklist(page);
    await openWorklist(second);
    await page
      .getByRole("button", { name: "View issue ISS-1", exact: true })
      .click();
    const draft = page.getByLabel("Public award explanation");
    await draft.fill("Draft under review");
    await draft.focus();
    await second
      .getByRole("button", { name: "View issue ISS-2", exact: true })
      .click();
    await second.getByLabel("Award minutes").selectOption("5");
    await second
      .getByLabel("Public award explanation")
      .fill("Five minutes approved");
    // Match the other issue's award so an earlier or in-flight read cannot pass.
    const updatedSnapshot = page.waitForResponse(async (response) => {
      if (
        !response.url().endsWith("/rpc/session_snapshot") ||
        !response.ok()
      )
        return false;
      const state = snapshotSchema.parse(await response.json());
      return state.awards.some((award) => award.issue_id === local.issues[1]);
    });
    await second
      .getByRole("button", { name: "Record award", exact: true })
      .click();
    await expect(
      second.getByText("5 minutes awarded", { exact: true }),
    ).toBeVisible();
    await (await updatedSnapshot).finished();
    await expect(draft).toHaveValue("Draft under review");
    await expect(draft).toBeFocused();
    await page.getByRole("button", { name: "Back to jury worklist" }).click();
    await expect(
      section(page, "Needs decision").getByRole("article"),
    ).toHaveCount(1);
    await expect(
      section(page, "Pending external application").getByRole("article"),
    ).toHaveCount(3);
    await page
      .getByRole("button", { name: "View issue ISS-2", exact: true })
      .click();
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Confirm applied externally" })
      .click();
    await expect(
      second.getByRole("button", { name: "View issue ISS-2", exact: true }),
    ).toHaveCount(0);
    await expect(
      section(second, "Pending external application").getByRole("article"),
    ).toHaveCount(2);
  } finally {
    await other.close();
  }
});

test("retry after a lost response uses the original transaction without duplicating the decision", async ({
  page,
  local,
}) => {
  await login(page);
  await openWorklist(page);
  await page
    .getByRole("button", { name: "View issue ISS-1", exact: true })
    .click();
  await page.getByLabel("Award minutes").selectOption("10");
  await page
    .getByLabel("Public award explanation")
    .fill("Ten minutes reviewed");
  local.loseNextResponse();
  await page.getByRole("button", { name: "Record award", exact: true }).click();
  await page.getByRole("button", { name: "Retry last request" }).click();
  await expect(
    page.getByRole("button", { name: "Retry last request" }),
  ).toHaveCount(0);
  const state = await local.snapshot();
  expect(
    state.awards.filter((award) => award.issue_id === local.issues[0]),
  ).toHaveLength(1);
  expect(
    state.history.filter(
      (item) =>
        item.issue_id === local.issues[0] &&
        item.text.startsWith("10 minutes awarded"),
    ),
  ).toHaveLength(1);
  expect(local.workflowRequests).toHaveLength(2);
  expect(local.workflowRequests[1]).toEqual(local.workflowRequests[0]);
  await page.getByRole("button", { name: "Back to jury worklist" }).click();
  await expect(
    section(page, "Pending external application").getByRole("article"),
  ).toHaveCount(3);
});

test("retry after a lost confirmation response preserves one application and history record", async ({
  page,
  local,
}) => {
  await login(page);
  await openWorklist(page);
  await page.getByRole("button", { name: "View issue ISS-4", exact: true }).click();
  await page.getByRole("checkbox").check();
  local.loseNextResponse();
  await page.getByRole("button", { name: "Confirm applied externally" }).click();
  await expect(page.getByRole("button", { name: "Retry last request" })).toBeEnabled();
  const committed = await local.snapshot();
  const applied = committed.awards.find((award) => award.issue_id === local.issues[3]);
  expect(applied?.applied_at).not.toBeNull();
  await page.getByRole("button", { name: "Retry last request" }).click();
  await expect(page.getByRole("button", { name: "Retry last request" })).toHaveCount(0);
  const retried = await local.snapshot();
  expect(retried.awards.find((award) => award.issue_id === local.issues[3])).toEqual(applied);
  expect(retried.history.filter((item) => item.issue_id === local.issues[3])).toEqual(
    committed.history.filter((item) => item.issue_id === local.issues[3]),
  );
  expect(retried.history.filter((item) => item.issue_id === local.issues[3])).toHaveLength(1);
  expect(local.workflowRequests).toHaveLength(2);
  expect(local.workflowRequests[1]).toEqual(local.workflowRequests[0]);
});

test("live reopening removes a decision and re-resolution uses the current evidence", async ({
  page,
  local,
}) => {
  await login(page);
  await openWorklist(page);
  await page.getByRole("button", { name: "View issue ISS-1", exact: true }).click();
  await page.getByLabel("Public award explanation").fill("Do not carry this draft.");
  const issue = (await local.snapshot()).issues.find((item) => item.id === local.issues[0])!;
  await local.act(local.users.volunteer, {
    type: "reopen",
    issue_id: issue.id,
    revision: issue.revision,
    reason: "Failure returned",
  });
  await expect(section(page, "Needs decision").getByRole("heading")).toBeFocused();
  await expect(page.getByRole("button", { name: "View issue ISS-1", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "View issue ISS-2", exact: true }).click();
  await expect(page.getByLabel("Public award explanation")).toHaveValue("");
  await page.getByRole("button", { name: "Back to jury worklist" }).click();
  const reopened = (await local.snapshot()).issues.find((item) => item.id === issue.id)!;
  await local.act(local.users.volunteer, {
    type: "resolve",
    issue_id: issue.id,
    revision: reopened.revision,
    summary: "Replacement service verified",
  });
  await expect(section(page, "Needs decision").getByRole("article")).toHaveCount(2);
  await expect(section(page, "Needs decision").getByRole("article").last()).toHaveAttribute("aria-label", "Issue ISS-1");
  await expect(page.getByRole("article", { name: "Issue ISS-1", exact: true })).toContainText("Replacement service verified");
});

test("existing details retain public and internal separation and team/session isolation", async ({
  page,
  local,
}) => {
  const resolved = (await local.snapshot()).issues.find((item) => item.id === local.issues[0])!;
  await local.act(local.users.volunteer, {
    type: "reopen",
    issue_id: resolved.id,
    revision: resolved.revision,
    reason: "Check conversation visibility while support is active",
  });
  for (const visibility of ["public", "internal"] as const) {
    const issue = (await local.snapshot()).issues.find((item) => item.id === local.issues[0])!;
    await local.act(local.users.volunteer, {
      type: "message",
      issue_id: issue.id,
      revision: issue.revision,
      visibility,
      text: visibility === "public" ? "Public service update" : "Private staff investigation",
    });
  }
  const contestant = await local.snapshot(local.users.contestant);
  expect(contestant.issues.every((issue) => issue.team_id === local.teams[0])).toBe(true);
  expect(contestant.history.some((entry) => entry.text === "Public service update")).toBe(true);
  expect(contestant.history.some((entry) => entry.text === "Private staff investigation")).toBe(false);
  expect((await local.snapshot(local.users.jury, local.sessions[1])).issues).toEqual([]);
  const denied = await local.snapshot(local.users.contestant, local.sessions[1]);
  expect(denied).toMatchObject({
    session: null,
    event: null,
    membership: null,
    teams: [],
    issues: [],
    resolutions: [],
    history: [],
    awards: [],
    attachments: [],
    members: [],
  });

  await login(page, "contestant");
  await page.locator(".issue-card").filter({ hasText: "ISS-1" }).click();
  await expect(page.getByText("Public service update", { exact: true })).toBeVisible();
  await expect(page.getByText("Private staff investigation", { exact: true })).toHaveCount(0);
  await expect(page.locator(".issue-card").filter({ hasText: "ISS-2" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Jury worklist", exact: true })).toHaveCount(0);
});

test("session and role changes clear selection and do not grant other roles a jury entry", async ({
  page,
  browser,
  local,
}) => {
  for (const name of ["admin", "contestant", "volunteer"]) {
    const context = await browser.newContext();
    await local.attach(context);
    const member = await context.newPage();
    await login(member, name);
    await expect(
      member.getByRole("button", { name: "Jury worklist", exact: true }),
    ).toHaveCount(0);
    await context.close();
  }
  await login(page);
  await openWorklist(page);
  await page
    .getByRole("button", { name: "View issue ISS-1", exact: true })
    .click();
  await page.getByLabel("Contest session").selectOption(local.sessions[1]);
  await expect(
    page.getByRole("button", { name: "Jury worklist", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Issue Queue", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#issue-heading")).toHaveCount(0);
  await page.getByLabel("Contest session").selectOption(local.sessions[0]);
  await openWorklist(page);
  await expect(
    page.getByRole("button", { name: "Back to jury worklist" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "View issue ISS-1", exact: true }).click();
  await page.getByLabel("Public award explanation").fill("Role change draft");
  await local.db.query(
    "update public.memberships set roles=array['volunteer'] where user_id=$1 and session_id=$2",
    [local.users.jury, local.sessions[0]],
  );
  local.broadcast();
  await expect(
    page.getByRole("button", { name: "Jury worklist", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Public award explanation")).toHaveCount(0);
  await local.db.query("delete from public.memberships where user_id=$1", [
    local.users.jury,
  ]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Session access" }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("archived details remain readable, while failed reads cannot masquerade as empty lists", async ({
  page,
  local,
}) => {
  await login(page);
  await openWorklist(page);
  await page.getByRole("button", { name: "View issue ISS-1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record award", exact: true })).toBeEnabled();
  await local.db.query("update public.events set archived=true where id=$1", [
    local.event,
  ]);
  local.broadcast();
  await expect(
    page.getByText("This event is archived. Records are read only."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record award", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Back to jury worklist" }).click();
  await page
    .getByRole("button", { name: "View issue ISS-4", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm applied externally" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Back to jury worklist" }).click();
  await page.route("**/rpc/session_snapshot", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "Verification read unavailable" },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText(
    "Verification read unavailable",
  );
  await expect(
    page.getByText("No resolved issues need a decision."),
  ).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("refresh, empty states, desktop, phone layouts and zoom reflow remain usable without app errors", async ({
  page,
  local,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      errors.push(message.text());
  });
  await login(page);
  await openWorklist(page);
  await expect(page).toHaveTitle("Minsky");
  await expect(
    page.getByRole("heading", { name: "Jury worklist", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("jury-desktop.png"),
    fullPage: true,
  });
  for (const width of [390, 320, 720]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "View issue ISS-4", exact: true })
      .click();
    await expect(page.locator("#issue-heading")).toBeFocused();
    await page.getByRole("button", { name: "Back to jury worklist" }).click();
    await expect(
      page.getByRole("button", { name: "View issue ISS-4", exact: true }),
    ).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(`jury-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("jury-css-zoom.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  await page.reload();
  await openWorklist(page);
  await expect(
    section(page, "Needs decision").getByRole("article"),
  ).toHaveCount(2);
  for (const id of local.issues.slice(0, 2)) {
    const issue = (await local.snapshot()).issues.find(
      (issue) => issue.id === id,
    )!;
    await local.act(local.users.jury, {
      type: "award",
      issue_id: id,
      revision: issue.revision,
      minutes: 0,
      explanation: "No adjustment required",
    });
  }
  for (const award of (await local.snapshot()).awards.filter(
    (award) => !award.applied_at,
  )) {
    const issue = (await local.snapshot()).issues.find(
      (issue) => issue.id === award.issue_id,
    )!;
    await local.act(local.users.jury, {
      type: "apply",
      issue_id: issue.id,
      revision: issue.revision,
    });
  }
  await expect(
    page.getByText("No resolved issues need a decision."),
  ).toBeVisible();
  await expect(
    page.getByText("No awards are awaiting external application."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
