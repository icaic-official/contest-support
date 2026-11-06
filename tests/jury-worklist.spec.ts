import type { Locator, Page } from "@playwright/test";
import { snapshotSchema } from "../src/connected/model";
import { appErrors } from "./support/worker";
import { expect, test } from "./support/localWorker";

// Jury worklist checks for the organiser UIs. The phone Awards
// tab (390 × 844) and the desktop Award review page (1280 × 800) are the
// worklist: "To decide" is the old "Needs decision" list and "To apply" is
// the old "Pending external application" list.

test.describe.configure({ mode: "default" });

const phone = { width: 390, height: 844 };
const desktop = { width: 1280, height: 800 };
type Viewport = typeof phone;
type ListName = "To decide" | "To apply" | "Applied";

/** Signs in a fixture account and waits for its UI and Realtime. */
async function login(page: Page, name = "jury", viewport: Viewport = phone) {
  await page.setViewportSize(viewport);
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const ui =
    name === "contestant"
      ? "contestant"
      : viewport.width < 1024
        ? "organiser-phone"
        : "organiser-desktop";
  // The first snapshot comes from local D1, which can take several seconds on a busy machine.
  await expect(page.locator(`[data-ui="${ui}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
}

function phoneTabs(page: Page) {
  return page.getByRole("navigation", { name: "Organizer sections" });
}

function consolePages(page: Page) {
  return page.getByRole("navigation", { name: "Console pages" });
}

/** Opens the jury worklist: the Awards tab or the Award review page. */
async function openAwards(page: Page) {
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await phoneTabs(page)
      .getByRole("button", { name: "Awards", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Awards", exact: true }),
    ).toBeFocused();
  } else {
    await consolePages(page)
      .getByRole("button", { name: /^Award review/ })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Award review" }),
    ).toBeFocused();
  }
  await expect(page).toHaveURL("/jury");
}

/** The button of an award list, whose text ends with its count. */
function listButton(page: Page, name: ListName) {
  return page
    .getByRole("group", { name: "Award lists" })
    .getByRole("button", { name: new RegExp(`^${name}`) });
}

async function showList(page: Page, name: ListName) {
  await listButton(page, name).click();
  await expect(listButton(page, name)).toHaveAttribute("aria-pressed", "true");
}

/** Checks the count on every list button. */
async function expectCounts(
  page: Page,
  counts: { decide: number; apply: number; done: number },
) {
  await expect(listButton(page, "To decide")).toHaveText(
    new RegExp(`^To decide\\s*${counts.decide}$`),
  );
  await expect(listButton(page, "To apply")).toHaveText(
    new RegExp(`^To apply\\s*${counts.apply}$`),
  );
  await expect(listButton(page, "Applied")).toHaveText(
    new RegExp(`^Applied\\s*${counts.done}$`),
  );
}

/** The rows of the shown award list. */
function rows(page: Page, name: ListName) {
  return page.getByRole("list", { name, exact: true }).getByRole("listitem");
}

/** One row of an award list, found by its issue number. */
function row(page: Page, number: number) {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByText(`ISS-${number}`, { exact: true }) });
}

async function issueNumbers(page: Page, name: ListName) {
  return (await rows(page, name).allInnerTexts()).map(
    (text) => text.match(/ISS-\d+/)?.[0],
  );
}

/** The phone issue view heading, which has focus when the view opens. */
function phoneIssueHeading(page: Page, number: number) {
  return page.getByRole("heading", {
    level: 1,
    name: new RegExp(`^ISS-${number},`),
  });
}

/**
 * Picks award minutes or the custom amount. The radio is visually hidden
 * inside its label.
 */
async function chooseMinutes(scope: Locator, minutes: number | "Other amount") {
  await scope
    .locator("label")
    .filter({
      has: scope.page().getByRole("radio", {
        name: minutes === "Other amount" ? minutes : `${minutes} min`,
        exact: true,
      }),
    })
    .click();
}

function sheet(page: Page, name: string) {
  return page.getByRole("dialog", { name });
}

test("lists outstanding work across queue filters and keeps the filters after review", async ({
  page,
  local,
}) => {
  await login(page, "combined", desktop);
  const filters = page.getByRole("group", { name: "Filter by status" });
  await filters.getByRole("button", { name: /^Resolved/ }).click();
  await page.getByRole("combobox", { name: "Find a team" }).fill("Aurora");
  await page.getByRole("option", { name: /Aurora/ }).click();
  const table = page.getByRole("table", { name: "Issue queue" });
  const before = await table.getByRole("row").allInnerTexts();
  await page.getByRole("button", { name: "Open ISS-3", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "ISS-3: Issue 3 verification" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close issue" }).click();
  await expect(
    page.getByRole("button", { name: "Open ISS-3", exact: true }),
  ).toBeFocused();

  await openAwards(page);
  await expectCounts(page, { decide: 2, apply: 2, done: 1 });
  // Oldest resolution first.
  expect(await issueNumbers(page, "To decide")).toEqual(["ISS-1", "ISS-2"]);
  await expect(row(page, 1)).toContainText("Resolution 1: service restored");
  await expect(row(page, 6)).toHaveCount(0);
  await showList(page, "To apply");
  // Oldest decision first. A zero award and a reopened issue still wait.
  expect(await issueNumbers(page, "To apply")).toEqual(["ISS-3", "ISS-4"]);
  await expect(row(page, 3)).toContainText("No time added");
  await expect(row(page, 4)).toContainText("Reopened · In progress");
  await expect(row(page, 4)).toContainText(
    "This award relates to an earlier resolution.",
  );
  await expect(row(page, 4)).toContainText(
    "Award resolution: Resolution 4: service restored",
  );
  await expect(row(page, 5)).toHaveCount(0);
  await expect(row(page, 6)).toHaveCount(0);
  await showList(page, "Applied");
  expect(await issueNumbers(page, "Applied")).toEqual(["ISS-5"]);
  await expect(row(page, 5)).toContainText("Applied externally");

  // The organiser UIs have no "Back to jury worklist" button. Closing the side sheet
  // returns focus to the award card button that opened it.
  await showList(page, "To apply");
  const target = page.getByRole("button", {
    name: "Issue 4 verification",
    exact: true,
  });
  await target.focus();
  await page.keyboard.press("Enter");
  const issueSheet = page.getByRole("dialog", {
    name: "ISS-4: Issue 4 verification",
  });
  await expect(issueSheet).toBeVisible();
  await expect(
    issueSheet.getByRole("tab", { name: "Outcome & award" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(issueSheet).toHaveCount(0);
  await expect(target).toBeFocused();

  await consolePages(page).getByRole("button", { name: /^Queue/ }).click();
  await expect(filters.getByRole("button", { name: /^Resolved/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("combobox", { name: "Find a team" })).toHaveValue(
    /Aurora/,
  );
  expect(await table.getByRole("row").allInnerTexts()).toEqual(before);
  expect((await local.snapshot()).awards).toHaveLength(3);
});

test("phone Awards tab keeps the queue filter and Back returns focus to the card", async ({
  page,
  local,
}) => {
  await login(page, "combined");
  const chips = page.getByRole("group", { name: "Filter the queue" });
  await chips.getByRole("button", { name: /^Resolved/ }).click();
  await openAwards(page);
  await expectCounts(page, { decide: 2, apply: 2, done: 1 });
  expect(await issueNumbers(page, "To decide")).toEqual(["ISS-1", "ISS-2"]);
  await showList(page, "To apply");
  expect(await issueNumbers(page, "To apply")).toEqual(["ISS-3", "ISS-4"]);
  const card = page.locator(`#issue-card-${local.issues[3]}`);
  await card.click();
  await expect(phoneIssueHeading(page, 4)).toBeFocused();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  // The Awards tab opens on "To decide" again, so focus goes to the heading
  // when the card is in another list.
  await expect(
    page.getByRole("heading", { level: 1, name: "Awards", exact: true }),
  ).toBeFocused();
  await page.locator(`#issue-card-${local.issues[0]}`).click();
  await expect(phoneIssueHeading(page, 1)).toBeFocused();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(`#issue-card-${local.issues[0]}`)).toBeFocused();
  await phoneTabs(page).getByRole("button", { name: "Queue", exact: true }).click();
  await expect(chips.getByRole("button", { name: /^Resolved/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("jury-only members record an explicit zero and can confirm a reopened issue's earlier award", async ({
  page,
  local,
}) => {
  await login(page);
  // Jury-only members see resolved issues only in the ordinary lists.
  await expect(
    phoneTabs(page).getByRole("button", { name: "Queue", exact: true }),
  ).toHaveCount(0);
  await phoneTabs(page).getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("button", { name: /^Cedar/ }).click();
  await expect(page.getByText("ISS-2", { exact: true })).toBeVisible();
  await expect(page.getByText("ISS-4", { exact: true })).toHaveCount(0);
  await expect(page.getByText("ISS-6", { exact: true })).toHaveCount(0);

  await openAwards(page);
  const time = (await row(page, 1).innerText()).match(/\d+:\d\d(:\d\d)?/)?.[0];
  expect(time).toBeTruthy();
  await row(page, 1).getByRole("button", { name: "Decide award" }).click();
  const award = sheet(page, "Decide award");
  await chooseMinutes(award, 0);
  await award
    .getByLabel("Public award explanation")
    .fill("Reviewed: no adjustment required.");
  await award.getByRole("button", { name: "Record no time added" }).click();
  await expect(award).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Time award" })).toContainText(
    "No time added",
  );
  await expect(page.getByRole("region", { name: "Time award" })).toContainText(
    "Pending external application",
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Awards", exact: true }),
  ).toBeFocused();
  await expectCounts(page, { decide: 1, apply: 3, done: 1 });
  await showList(page, "To apply");
  await expect(row(page, 1)).toContainText(time!);
  await expect(row(page, 1)).toContainText("No time added");
  expect(
    (await local.snapshot()).awards.find(
      (item) => item.issue_id === local.issues[0],
    )?.applied_at,
  ).toBeNull();

  await row(page, 4).locator(`#issue-card-${local.issues[3]}`).click();
  await expect(phoneIssueHeading(page, 4)).toBeFocused();
  await expect(page.getByRole("region", { name: "Time award" })).toContainText(
    "This decision relates to an earlier resolution. One award is allowed per issue.",
  );
  await expect(
    page.getByRole("button", {
      name: /^(Decide award|Reopen|Claim|Resolve)$/,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm applied", exact: true }).click();
  const apply = sheet(page, "Confirm external application");
  await apply.getByRole("checkbox").check();
  await apply.getByRole("button", { name: "Confirm applied externally" }).click();
  // The reopened issue leaves the jury-only member's lists, so the view
  // closes with a status message and focus moves to the tab heading.
  await expect(page.getByRole("status").filter({ hasText: "ISS-4 is no longer in your lists." })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Awards", exact: true }),
  ).toBeFocused();
  await expectCounts(page, { decide: 1, apply: 2, done: 1 });
  await showList(page, "To apply");
  await expect(row(page, 4)).toHaveCount(0);
  const current = await local.snapshot();
  expect(
    current.awards.find((item) => item.issue_id === local.issues[3])
      ?.applied_at,
  ).not.toBeNull();
  expect(
    current.issues.find((item) => item.id === local.issues[3])?.status,
  ).toBe("claimed");
});

test("staff read one-minute and zero awards in plain words", async ({
  page,
  local,
}) => {
  await login(page, "jury", desktop);
  await openAwards(page);

  const one = row(page, 1);
  await chooseMinutes(one, "Other amount");
  await one.getByLabel("Custom award minutes").fill("1");
  await one.getByLabel("Public award explanation").fill("One minute lost");
  await one.getByRole("button", { name: "Record 1 minute", exact: true }).click();
  const first = sheet(page, "ISS-1: Issue 1 verification");
  await first.getByRole("tab", { name: "Outcome & award" }).click();
  await expect(
    first.getByRole("region", { name: "Time award" }).getByText("1 minute", { exact: true }),
  ).toBeVisible();
  await first.getByRole("tab", { name: /^Activity/ }).click();
  await expect(
    first.getByText("1 minute awarded: One minute lost", { exact: true }),
  ).toBeVisible();
  await first.getByRole("button", { name: "Close issue" }).click();

  const none = row(page, 2);
  await chooseMinutes(none, 0);
  await none.getByLabel("Public award explanation").fill("No change needed");
  await none.getByRole("button", { name: "Record no time added", exact: true }).click();
  const second = sheet(page, "ISS-2: Issue 2 verification");
  await second.getByRole("tab", { name: "Outcome & award" }).click();
  await expect(
    second.getByRole("region", { name: "Time award" }).getByText("No time added", { exact: true }),
  ).toBeVisible();
  await second.getByRole("tab", { name: /^Activity/ }).click();
  await expect(
    second.getByText("No time added: No change needed", { exact: true }),
  ).toBeVisible();
  await second.getByRole("button", { name: "Close issue" }).click();

  await showList(page, "To apply");
  await expect(row(page, 1).getByText("1 minute", { exact: true })).toBeVisible();
  await expect(row(page, 2).getByText("No time added", { exact: true })).toBeVisible();
  await expect(row(page, 3).getByText("No time added", { exact: true })).toBeVisible();
  await expect(row(page, 4).getByText("5 minutes", { exact: true })).toBeVisible();
  // Only the display changes. The stored history text keeps its form.
  expect(
    (await local.snapshot()).history.map((item) => item.text),
  ).toEqual(
    expect.arrayContaining([
      "1 minutes awarded: One minute lost",
      "0 minutes awarded: No change needed",
    ]),
  );

});

test("the admin overview reads a one-minute total in the singular", async ({
  page,
  local,
}) => {
  await local.run(
    "UPDATE awards SET minutes = CASE WHEN issue_id = ? THEN 1 ELSE 0 END",
    local.issues[3]!,
  );
  await login(page, "admin", desktop);
  await consolePages(page).getByRole("button", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByText("minute decided", { exact: true })).toBeVisible();
});

test("two simulated Realtime clients refresh decisions and confirmations without losing an unrelated draft", async ({
  page,
  browser,
  local,
}) => {
  // Two clients run many steps. Under a full parallel run this takes more
  // than the default 30 seconds.
  test.slow();
  const other = await browser.newContext();
  await local.attach(other);
  const second = await other.newPage();
  try {
    await login(page);
    await login(second, "combined", desktop);
    await openAwards(page);
    await openAwards(second);
    await row(page, 1).getByRole("button", { name: "Decide award" }).click();
    const draft = sheet(page, "Decide award").getByLabel(
      "Public award explanation",
    );
    await draft.fill("Draft under review");
    await draft.focus();
    const card = row(second, 2);
    await chooseMinutes(card, 5);
    await card
      .getByLabel("Public award explanation")
      .fill("Five minutes approved");
    // Match the other issue's award so an earlier or in-flight read cannot pass.
    const updatedSnapshot = page.waitForResponse(async (response) => {
      if (
        new URL(response.url()).pathname !== "/api/snapshot" ||
        !response.ok()
      )
        return false;
      const state = snapshotSchema.parse(await response.json());
      return state.awards.some((award) => award.issue_id === local.issues[1]);
    });
    await card.getByRole("button", { name: "Record 5 minutes" }).click();
    // A recorded command opens its issue in the side sheet.
    const recorded = second.getByRole("dialog", {
      name: "ISS-2: Issue 2 verification",
    });
    await expect(recorded).toContainText("5 minutes awarded");
    await recorded.getByRole("button", { name: "Close issue" }).click();
    await expect(recorded).toHaveCount(0);
    await expect(row(second, 2)).toHaveCount(0);
    await expectCounts(second, { decide: 1, apply: 3, done: 1 });
    await (await updatedSnapshot).finished();
    await expect(draft).toHaveValue("Draft under review");
    await expect(draft).toBeFocused();
    await sheet(page, "Decide award")
      .getByRole("button", { name: "Cancel" })
      .click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expectCounts(page, { decide: 1, apply: 3, done: 1 });
    await showList(page, "To apply");
    await expect(row(page, 2)).toContainText("5 minutes");
    await row(page, 2)
      .getByRole("button", { name: "Confirm applied externally" })
      .click();
    const apply = sheet(page, "Confirm external application");
    await apply.getByRole("checkbox").check();
    await apply
      .getByRole("button", { name: "Confirm applied externally" })
      .click();
    await expect(apply).toHaveCount(0);
    await showList(second, "To apply");
    await expect(row(second, 2)).toHaveCount(0);
    await expectCounts(second, { decide: 1, apply: 2, done: 2 });
    await showList(second, "Applied");
    await expect(row(second, 2)).toContainText("Applied externally");
  } finally {
    await other.close();
  }
});

test("retry after a lost response uses the original transaction without duplicating the decision", async ({
  page,
  local,
}) => {
  await login(page);
  await openAwards(page);
  await row(page, 1).getByRole("button", { name: "Decide award" }).click();
  const award = sheet(page, "Decide award");
  await chooseMinutes(award, 10);
  await award.getByLabel("Public award explanation").fill("Ten minutes reviewed");
  local.loseNext("/api/workflow", "response");
  await award.getByRole("button", { name: "Record 10 minutes" }).click();
  const retry = page.getByRole("button", { name: "Retry last request" });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(retry).toHaveCount(0);
  const state = await local.snapshot();
  expect(
    state.awards.filter((item) => item.issue_id === local.issues[0]),
  ).toHaveLength(1);
  expect(
    state.history.filter(
      (item) =>
        item.issue_id === local.issues[0] &&
        item.text.startsWith("10 minutes awarded"),
    ),
  ).toHaveLength(1);
  expect(local.bodies("/api/workflow")).toHaveLength(2);
  expect(local.bodies("/api/workflow")[1]).toEqual(local.bodies("/api/workflow")[0]);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectCounts(page, { decide: 1, apply: 3, done: 1 });
});

test("retry after a lost confirmation response preserves one application and history record", async ({
  page,
  local,
}) => {
  await login(page);
  await openAwards(page);
  await showList(page, "To apply");
  await row(page, 4)
    .getByRole("button", { name: "Confirm applied externally" })
    .click();
  const apply = sheet(page, "Confirm external application");
  await apply.getByRole("checkbox").check();
  local.loseNext("/api/workflow", "response");
  await apply.getByRole("button", { name: "Confirm applied externally" }).click();
  const retry = page.getByRole("button", { name: "Retry last request" });
  await expect(retry).toBeEnabled();
  const committed = await local.snapshot();
  const applied = committed.awards.find(
    (item) => item.issue_id === local.issues[3],
  );
  expect(applied?.applied_at).not.toBeNull();
  await retry.click();
  await expect(retry).toHaveCount(0);
  const retried = await local.snapshot();
  expect(
    retried.awards.find((item) => item.issue_id === local.issues[3]),
  ).toEqual(applied);
  const history = (state: typeof committed) =>
    state.history.filter((item) => item.issue_id === local.issues[3]);
  expect(history(retried)).toEqual(history(committed));
  expect(history(retried)).toHaveLength(1);
  expect(local.bodies("/api/workflow")).toHaveLength(2);
  expect(local.bodies("/api/workflow")[1]).toEqual(local.bodies("/api/workflow")[0]);
  await expectCounts(page, { decide: 2, apply: 1, done: 1 });
});

test("live reopening removes a decision and re-resolution uses the current evidence", async ({
  page,
  local,
}) => {
  await login(page);
  await openAwards(page);
  await row(page, 1).getByRole("button", { name: "Decide award" }).click();
  await sheet(page, "Decide award")
    .getByLabel("Public award explanation")
    .fill("Do not carry this draft.");
  const issue = (await local.snapshot()).issues.find(
    (item) => item.id === local.issues[0],
  )!;
  await local.act(local.users.volunteer, {
    type: "reopen",
    issue_id: issue.id,
    revision: issue.revision,
    reason: "Failure returned",
  });
  await expect(sheet(page, "Decide award")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "ISS-1 is no longer in your lists." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Awards", exact: true }),
  ).toBeFocused();
  await expect(row(page, 1)).toHaveCount(0);
  await expectCounts(page, { decide: 1, apply: 2, done: 1 });
  await row(page, 2).getByRole("button", { name: "Decide award" }).click();
  await expect(
    sheet(page, "Decide award").getByLabel("Public award explanation"),
  ).toHaveValue("");
  await sheet(page, "Decide award").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const reopened = (await local.snapshot()).issues.find(
    (item) => item.id === issue.id,
  )!;
  await local.act(local.users.volunteer, {
    type: "resolve",
    issue_id: issue.id,
    revision: reopened.revision,
    summary: "Replacement service verified",
  });
  await expectCounts(page, { decide: 2, apply: 2, done: 1 });
  expect(await issueNumbers(page, "To decide")).toEqual(["ISS-2", "ISS-1"]);
  await expect(row(page, 1)).toContainText(
    "Resolution: Replacement service verified",
  );
});

test("existing details retain public and internal separation and team/session isolation", async ({
  page,
  local,
}) => {
  const resolved = (await local.snapshot()).issues.find(
    (item) => item.id === local.issues[0],
  )!;
  await local.act(local.users.volunteer, {
    type: "reopen",
    issue_id: resolved.id,
    revision: resolved.revision,
    reason: "Check conversation visibility while support is active",
  });
  for (const visibility of ["public", "internal"] as const) {
    const issue = (await local.snapshot()).issues.find(
      (item) => item.id === local.issues[0],
    )!;
    await local.act(local.users.volunteer, {
      type: "message",
      issue_id: issue.id,
      revision: issue.revision,
      visibility,
      text:
        visibility === "public"
          ? "Public service update"
          : "Private staff investigation",
    });
  }
  const contestant = await local.snapshot(local.users.contestant);
  expect(
    contestant.issues.every((issue) => issue.team_id === local.teams[0]),
  ).toBe(true);
  expect(
    contestant.history.some((entry) => entry.text === "Public service update"),
  ).toBe(true);
  expect(
    contestant.history.some(
      (entry) => entry.text === "Private staff investigation",
    ),
  ).toBe(false);
  expect(
    (await local.snapshot(local.users.jury, local.sessions[1])).issues,
  ).toEqual([]);
  const denied = await local.snapshot(
    local.users.contestant,
    local.sessions[1],
  );
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

  await login(page, "contestant", desktop);
  const reports = page.getByRole("navigation", { name: "Reports" });
  await reports.getByRole("button", { name: /ISS-1 ·/ }).click();
  await expect(
    page.getByText("Public service update", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Private staff investigation", { exact: true }),
  ).toHaveCount(0);
  await expect(reports.getByRole("button", { name: /ISS-2 ·/ })).toHaveCount(0);
  await expect(page.getByText(/Award review|Awards/)).toHaveCount(0);
});

test("session and role changes clear selection and do not grant other roles a jury entry", async ({
  page,
  browser,
  local,
}) => {
  // The flow takes 29 s of the default 30 s in a full run.
  test.setTimeout(60_000);
  for (const name of ["admin", "contestant", "volunteer"]) {
    const context = await browser.newContext();
    await local.attach(context);
    const member = await context.newPage();
    await login(member, name);
    if (name === "contestant") {
      await expect(member.getByText(/Award review|Awards/)).toHaveCount(0);
    } else {
      await expect(
        phoneTabs(member).getByRole("button", { name: "Awards" }),
      ).toHaveCount(0);
      await member.setViewportSize(desktop);
      await expect(
        member.locator('[data-ui="organiser-desktop"]'),
      ).toBeVisible();
      await expect(
        consolePages(member).getByRole("button", { name: /^Award review/ }),
      ).toHaveCount(0);
    }
    await context.close();
  }

  await login(page);
  await openAwards(page);
  await page.locator(`#issue-card-${local.issues[0]}`).click();
  await expect(phoneIssueHeading(page, 1)).toBeFocused();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await phoneTabs(page).getByRole("button", { name: "Me", exact: true }).click();
  await page.getByRole("radio", { name: "Secondary" }).check();
  // The jury member is a volunteer in the second session.
  await expect(
    phoneTabs(page).getByRole("button", { name: "Awards" }),
  ).toHaveCount(0);
  await phoneTabs(page).getByRole("button", { name: "Queue", exact: true }).click();
  await expect(page.getByText("Reports will appear here when they are submitted.")).toBeVisible();
  await phoneTabs(page).getByRole("button", { name: "Me", exact: true }).click();
  await page.getByRole("radio", { name: "Primary" }).check();
  await openAwards(page);
  await row(page, 1).getByRole("button", { name: "Decide award" }).click();
  await sheet(page, "Decide award")
    .getByLabel("Public award explanation")
    .fill("Role change draft");
  await local.run(
    "UPDATE membership_roles SET role = 'volunteer' WHERE account_id = ? AND session_id = ?",
    local.users.jury,
    local.sessions[0],
  );
  local.notify();
  // The award form closes because the person can no longer decide awards.
  await expect(sheet(page, "Decide award")).toHaveCount(0);
  await expect(page.getByLabel("Public award explanation")).toHaveCount(0);
  await expect(page).toHaveURL("/issues");
  await expect(
    page.getByRole("heading", { level: 1, name: "Queue", exact: true }),
  ).toBeFocused();
  await expect(
    phoneTabs(page).getByRole("button", { name: "Awards" }),
  ).toHaveCount(0);
  await local.run("DELETE FROM memberships WHERE account_id = ?", local.users.jury);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Session access" }),
  ).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(0);
});

test("archived details remain readable, while failed reads cannot masquerade as empty lists", async ({
  page,
  local,
}) => {
  await login(page, "jury", desktop);
  await openAwards(page);
  await expect(
    row(page, 1).getByRole("button", { name: "Record award" }),
  ).toBeVisible();
  await local.run("UPDATE events SET archived = 1 WHERE id = ?", local.event);
  local.notify();
  await expect(
    page.getByText("This event is archived. Records are read only.").first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Record/ })).toHaveCount(0);
  await expect(row(page, 1)).toContainText("Resolution 1: service restored");
  await showList(page, "To apply");
  await expect(row(page, 4)).toContainText("5 minutes");
  await expect(
    page.getByRole("button", { name: "Confirm applied externally" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Issue 4 verification" }).click();
  const issueSheet = page.getByRole("dialog", {
    name: "ISS-4: Issue 4 verification",
  });
  await expect(issueSheet).toContainText("Decision 4 explanation");
  await expect(issueSheet.getByRole("button", { name: "Confirm applied" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close issue" }).click();

  await page.setViewportSize(phone);
  await expect(page.locator('[data-ui="organiser-phone"]')).toBeVisible();
  await openAwards(page);
  await expect(row(page, 1)).toBeVisible();
  await expect(page.getByRole("button", { name: "Decide award" })).toHaveCount(0);
  await page.locator(`#issue-card-${local.issues[0]}`).click();
  await expect(page.getByText("This event is archived.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.route(/\/api\/snapshot\?/, (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Verification read unavailable" },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert").first()).toContainText(
    "Verification read unavailable",
  );
  await expect(page.getByText("Nothing in this list.")).toHaveCount(0);
  await expect(page.getByText(/ISS-\d/)).toHaveCount(0);
});

test("refresh, empty states, desktop, phone layouts and zoom reflow remain usable without app errors", async ({
  page,
  local,
}, testInfo) => {
  const errors = appErrors(page, ["error", "warning"]);
  await login(page, "jury", desktop);
  await openAwards(page);
  await expect(page).toHaveTitle("Minsky");
  await page.screenshot({
    path: testInfo.outputPath("jury-desktop.png"),
    fullPage: true,
  });
  await showList(page, "To apply");
  const award = page.getByRole("button", {
    name: "Issue 4 verification",
    exact: true,
  });
  await award.click();
  await expect(
    page.getByRole("dialog", { name: "ISS-4: Issue 4 verification" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close issue" }).click();
  await expect(award).toBeFocused();

  for (const width of [390, 320, 720]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('[data-ui="organiser-phone"]')).toBeVisible();
    if (width === 390) await openAwards(page);
    await showList(page, "To apply");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const card = page.locator(`#issue-card-${local.issues[3]}`);
    await card.click();
    await expect(phoneIssueHeading(page, 4)).toBeFocused();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Awards", exact: true }),
    ).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(`jury-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
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
  await page.setViewportSize(phone);
  await page.reload();
  await expect(page.locator('[data-ui="organiser-phone"]')).toBeVisible();
  await openAwards(page);
  await expectCounts(page, { decide: 2, apply: 2, done: 1 });
  for (const id of local.issues.slice(0, 2)) {
    const issue = (await local.snapshot()).issues.find(
      (item) => item.id === id,
    )!;
    await local.act(local.users.jury, {
      type: "award",
      issue_id: id,
      revision: issue.revision,
      minutes: 0,
      explanation: "No adjustment required",
    });
  }
  for (const item of (await local.snapshot()).awards.filter(
    (entry) => !entry.applied_at,
  )) {
    const issue = (await local.snapshot()).issues.find(
      (entry) => entry.id === item.issue_id,
    )!;
    await local.act(local.users.jury, {
      type: "apply",
      issue_id: issue.id,
      revision: issue.revision,
    });
  }
  await expectCounts(page, { decide: 0, apply: 0, done: 4 });
  await expect(page.getByText("Nothing in this list.")).toBeVisible();
  await showList(page, "To apply");
  await expect(page.getByText("Nothing in this list.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the desktop list switch slides its indicator to the selected list", async ({
  page,
  local,
}) => {
  void local;
  await login(page, "jury", desktop);
  await openAwards(page);
  const group = page.getByRole("group", { name: "Award lists" });
  const pill = group.locator('[data-slot="sliding-indicator"]');
  const sitsUnder = async (list: Locator) => {
    const [a, b] = await Promise.all([pill.boundingBox(), list.boundingBox()]);
    if (!a || !b) return Infinity;
    return Math.max(
      Math.abs(a.x - b.x),
      Math.abs(a.y - b.y),
      Math.abs(a.width - b.width),
      Math.abs(a.height - b.height),
    );
  };
  await expect
    .poll(() => sitsUnder(listButton(page, "To decide")))
    .toBeLessThan(1.5);
  await showList(page, "Applied");
  await expect
    .poll(() => sitsUnder(listButton(page, "Applied")))
    .toBeLessThan(1.5);
  await showList(page, "To apply");
  await expect
    .poll(() => sitsUnder(listButton(page, "To apply")))
    .toBeLessThan(1.5);
});
