import {
  type Browser,
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import { createJuryFixture } from "./jury-fixture";
import { unresolvedTime } from "../src/connected/model";

// One full local journey across authenticated test accounts. Each account
// has its own browser context. The PGlite fixture runs the real migrations,
// RLS and workflow transactions; only the hosted transport is simulated.

const phone = { width: 390, height: 844 };
const desktop = { width: 1280, height: 800 };
type Local = Awaited<ReturnType<typeof createJuryFixture>>;

async function signIn(
  browser: Browser,
  local: Local,
  name: string,
  viewport: typeof phone,
): Promise<Page> {
  const context = await browser.newContext({ viewport });
  await local.attach(context);
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const ui =
    name === "contestant"
      ? "contestant"
      : viewport.width < 1024
        ? "organiser-phone"
        : "organiser-desktop";
  await expect(page.locator(`[data-ui="${ui}"]`)).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  return page;
}

/** Reads a clock such as "04:07" or "1:02:03" as seconds. */
function seconds(clock: string): number {
  return clock
    .trim()
    .split(":")
    .reduce((total, part) => total * 60 + Number(part), 0);
}

/** The contestant's large unresolved timer. */
function contestantTimer(page: Page): Locator {
  return page
    .getByRole("region", { name: "Your report" })
    .locator("p.font-mono");
}

async function timerSeconds(page: Page): Promise<number> {
  const text = await contestantTimer(page).innerText();
  return seconds(text.match(/[\d:]+/)![0]);
}

test("a report travels from the contestant through support, the jury and external application", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const local = await createJuryFixture({ seedIssues: false });
  try {
    const issueFor = async () => {
      const state = await local.snapshot(local.users.admin);
      expect(state.issues).toHaveLength(1);
      return {
        issue: state.issues[0],
        resolutions: state.resolutions,
        state,
      };
    };

    // The contestant reports an issue on the desktop. The timer starts.
    const contestant = await signIn(browser, local, "contestant", desktop);
    await expect(contestant.getByText(/^Build [0-9a-f]{7}$|^Build unknown$/)).toBeVisible();
    await contestant
      .getByRole("complementary", { name: "Your reports" })
      .getByRole("button", { name: "Report an issue" })
      .click();
    await expect(
      contestant.getByRole("heading", { name: "Report an issue" }),
    ).toBeFocused();
    await contestant.getByText("Devices", { exact: true }).click();
    await contestant
      .getByLabel("What is happening?")
      .fill("Keyboard stopped responding after the IDE froze");
    await contestant.getByRole("button", { name: "Send report" }).click();
    await expect(contestant.getByRole("region", { name: "Your report" })).toContainText(
      "Keyboard stopped responding after the IDE froze",
    );
    await expect(contestantTimer(contestant)).toContainText("running");
    const reported = await issueFor();
    expect(reported.issue).toMatchObject({
      status: "open",
      owner: null,
      first_assigned_at: null,
      category: "Devices",
    });

    // A volunteer claims it on the organiser phone, replies, adds an
    // internal note and escalates.
    const volunteer = await signIn(browser, local, "volunteer", phone);
    const card = volunteer.locator(`#issue-card-${reported.issue.id}`);
    await expect(card).toHaveAccessibleName("Open ISS-1, Aurora, A12");
    await expect(
      volunteer.getByRole("listitem").filter({ has: card }),
    ).toContainText("Keyboard stopped responding after the IDE froze");
    await volunteer.getByRole("button", { name: "Claim ISS-1" }).click();
    await expect(card).toBeFocused();
    const claimed = await issueFor();
    expect(claimed.issue.status).toBe("claimed");
    expect(claimed.issue.owner).toBe(local.users.volunteer);
    expect(claimed.issue.first_assigned_at).not.toBeNull();
    await card.click();
    await expect(
      volunteer.getByRole("heading", { level: 1, name: "ISS-1, Aurora" }),
    ).toBeFocused();
    await expect(
      volunteer.getByText("First assignment", { exact: true }),
    ).toBeVisible();

    await volunteer.getByRole("button", { name: "Reply", exact: true }).click();
    let sheet = volunteer.getByRole("dialog", { name: "Reply" });
    await sheet.getByLabel("Message").fill("A helper is on the way to A12.");
    await sheet.getByRole("button", { name: "Send to team" }).click();
    await expect(sheet).toHaveCount(0);
    await volunteer.getByRole("button", { name: "Reply", exact: true }).click();
    sheet = volunteer.getByRole("dialog", { name: "Reply" });
    await sheet.getByText("Staff only", { exact: true }).click();
    await sheet
      .getByLabel("Internal note")
      .fill("USB hub is faulty. Swap the hub before the keyboard.");
    await sheet.getByRole("button", { name: "Add internal note" }).click();
    await expect(sheet).toHaveCount(0);

    await volunteer.getByRole("button", { name: "More actions" }).click();
    await volunteer
      .getByRole("dialog", { name: "More actions" })
      .getByRole("button", { name: /Escalate to a specialist/ })
      .click();
    sheet = volunteer.getByRole("dialog", { name: "Escalate to a specialist?" });
    await sheet.getByRole("button", { name: "Escalate to specialist" }).click();
    await expect(sheet).toHaveCount(0);
    const escalated = await issueFor();
    expect(escalated.issue.status).toBe("escalated");
    // The volunteer stays the owner until a specialist accepts.
    expect(escalated.issue.owner).toBe(local.users.volunteer);
    await expect(contestant.getByText(
      "Test volunteer stays responsible until a specialist takes over.",
    )).toBeVisible();

    // A specialist accepts the handoff and resolves on the desktop console.
    const specialist = await signIn(browser, local, "specialist", desktop);
    await specialist
      .getByRole("navigation", { name: "Console pages" })
      .getByRole("button", { name: /^Handoffs/ })
      .click();
    await expect(
      specialist.getByRole("button", { name: "Open ISS-1", exact: true }),
    ).toBeVisible();
    expect((await issueFor()).issue.owner).toBe(local.users.volunteer);
    await specialist
      .getByRole("button", { name: "Accept handoff for ISS-1" })
      .click();
    await expect(
      specialist.getByRole("button", { name: "Accept handoff for ISS-1" }),
    ).toHaveCount(0);
    const accepted = await issueFor();
    expect(accepted.issue).toMatchObject({
      status: "claimed",
      owner: local.users.specialist,
      // The first assignment stays the volunteer's claim.
      first_assigned_at: claimed.issue.first_assigned_at,
    });

    async function resolveOnDesktop(summary: string) {
      await specialist
        .getByRole("navigation", { name: "Console pages" })
        .getByRole("button", { name: /^Queue/ })
        .click();
      await specialist
        .getByRole("group", { name: "Filter by status" })
        .getByRole("button", { name: /^All/ })
        .click();
      await specialist
        .getByRole("button", { name: "Open ISS-1", exact: true })
        .click();
      const issueSheet = specialist.getByRole("dialog", {
        name: /^ISS-1: Keyboard stopped/,
      });
      await issueSheet.getByRole("button", { name: "Resolve", exact: true }).click();
      const dialog = specialist.getByRole("dialog", { name: "Resolve issue" });
      await dialog.getByRole("radio", { name: "Write a custom summary" }).check();
      await dialog.getByLabel("Custom resolution summary").fill(summary);
      await dialog.getByRole("button", { name: "Resolve issue" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(issueSheet.getByText("Resolved", { exact: true }).first()).toBeVisible();
      await issueSheet.getByRole("button", { name: "Close issue" }).click();
      await expect(issueSheet).toHaveCount(0);
    }
    await resolveOnDesktop("Replaced the USB hub and keyboard");
    const resolved = await issueFor();
    expect(resolved.issue.status).toBe("resolved");

    // The contestant sees the public reply and the resolution, never the
    // internal note. The timer stops and keeps its value after a refresh.
    await expect(
      contestant.getByText("A helper is on the way to A12.", { exact: true }),
    ).toBeVisible();
    await expect(
      contestant.getByRole("region", { name: "Resolution", exact: true }),
    ).toContainText("Replaced the USB hub and keyboard");
    await expect(contestantTimer(contestant)).toContainText("stopped");
    await expect(contestant.getByText(/USB hub is faulty/)).toHaveCount(0);
    const stopped = (await contestantTimer(contestant).textContent())!;
    await contestant.reload();
    await expect(contestant.locator('[data-ui="contestant"]')).toBeVisible();
    await contestant
      .getByRole("navigation", { name: "Reports" })
      .getByRole("button", { name: /ISS-1/ })
      .click();
    await expect(contestantTimer(contestant)).toHaveText(stopped);
    await expect(contestant.getByText(/USB hub is faulty/)).toHaveCount(0);
    const stoppedSeconds = await timerSeconds(contestant);
    // Keep the issue resolved for a few seconds, so the excluded interval is
    // longer than the time that passes after the reopening.
    await contestant.waitForTimeout(4000);
    await expect(contestantTimer(contestant)).toHaveText(stopped);

    // The contestant reopens. Unresolved time resumes without the resolved
    // interval, and the specialist stays the owner.
    await contestant
      .getByRole("button", { name: "The problem is back? Reopen this issue" })
      .click();
    await contestant
      .getByLabel(/What is still wrong\?/)
      .fill("The keyboard stops again after a few minutes.");
    await contestant.getByRole("button", { name: "Reopen issue" }).click();
    await expect(contestantTimer(contestant)).toContainText("running");
    const reopened = await issueFor();
    expect(reopened.issue).toMatchObject({
      status: "claimed",
      owner: local.users.specialist,
      first_assigned_at: claimed.issue.first_assigned_at,
    });
    const first = reopened.resolutions.find(
      (item) => item.issue_id === reopened.issue.id,
    )!;
    expect(first.reopened_at).not.toBeNull();
    const now = Date.parse(first.reopened_at!) + 1000;
    expect(unresolvedTime(reopened.issue, reopened.resolutions, now)).toBe(
      Date.parse(first.at) -
        Date.parse(reopened.issue.created_at) +
        (now - Date.parse(first.reopened_at!)),
    );
    // The display resumes near the stopped value. The time between the
    // resolution and the reopening does not count.
    const resumed = await timerSeconds(contestant);
    const excluded = (Date.parse(first.reopened_at!) - Date.parse(first.at)) / 1000;
    expect(excluded).toBeGreaterThanOrEqual(4);
    expect(resumed).toBeGreaterThanOrEqual(stoppedSeconds);
    expect(resumed - stoppedSeconds).toBeLessThan(3);

    // The helper resolves again. Both resolutions stay in the history.
    await resolveOnDesktop("Replaced the keyboard cable");
    const again = await issueFor();
    expect(
      again.resolutions
        .filter((item) => item.issue_id === again.issue.id)
        .map((item) => item.summary)
        .sort(),
    ).toEqual(["Replaced the USB hub and keyboard", "Replaced the keyboard cable"]);
    await expect(
      contestant.getByRole("region", { name: "Resolution", exact: true }),
    ).toContainText("Replaced the keyboard cable");
    await expect(
      contestant.getByRole("region", { name: "Earlier resolutions" }),
    ).toContainText("Replaced the USB hub and keyboard");

    // The jury records an award on the organiser phone.
    const jury = await signIn(browser, local, "jury", phone);
    await jury
      .getByRole("navigation", { name: "Organiser sections" })
      .getByRole("button", { name: "Awards", exact: true })
      .click();
    const juryRow = jury
      .getByRole("list", { name: "To decide" })
      .getByRole("listitem")
      .filter({ hasText: "ISS-1" });
    await expect(juryRow).toContainText(
      "Resolution: Replaced the keyboard cable",
    );
    await juryRow.getByRole("button", { name: "Decide award" }).click();
    const award = jury.getByRole("dialog", { name: "Decide award" });
    await award.locator("label").filter({ hasText: /^5 min$/ }).click();
    await award
      .getByLabel("Public award explanation")
      .fill("Five minutes for the hardware fault.");
    await award.getByRole("button", { name: "Record 5 minutes" }).click();
    await expect(award).toHaveCount(0);

    // The contestant sees the decision. It is not applied yet.
    const timeAward = contestant.getByRole("region", {
      name: /^Time award\s*, 5 minutes$/,
    });
    await expect(timeAward).toContainText("Decided by the jury");
    await expect(timeAward).toContainText(
      "Not yet applied to your contest time",
    );
    expect((await issueFor()).state.awards[0].applied_at).toBeNull();

    // Staff confirm external application on the desktop console.
    await specialist
      .getByRole("button", { name: "Open ISS-1", exact: true })
      .click();
    const issueSheet = specialist.getByRole("dialog", {
      name: /^ISS-1: Keyboard stopped/,
    });
    await issueSheet
      .getByRole("button", { name: "Confirm applied", exact: true })
      .click();
    await expect(
      issueSheet.getByRole("tab", { name: "Outcome & award" }),
    ).toHaveAttribute("aria-selected", "true");
    await issueSheet.getByRole("checkbox").check();
    await issueSheet
      .getByRole("button", { name: "Confirm applied externally" })
      .click();
    await expect(issueSheet.getByText("Applied externally")).toBeVisible();

    // "Decided" and "Applied" are separate steps for the contestant.
    await expect(timeAward).toContainText("Decided by the jury");
    await expect(timeAward).toContainText("Applied to your contest time");
    await expect(timeAward).not.toContainText("Not yet applied");
    const done = await issueFor();
    expect(done.state.awards).toHaveLength(1);
    expect(done.state.awards[0]).toMatchObject({
      minutes: 5,
      applied_by: local.users.specialist,
    });
    expect(Date.parse(done.state.awards[0].applied_at!)).toBeGreaterThan(
      Date.parse(done.state.awards[0].at),
    );
    // The timer stayed stopped through the award and its application.
    expect(done.issue.resolved_at).toBe(again.issue.resolved_at);
    await expect(contestantTimer(contestant)).toContainText("stopped");
    await expect(contestant.getByText(/USB hub is faulty/)).toHaveCount(0);
  } finally {
    for (const context of browser.contexts()) await context.close();
    await local.close();
  }
});
