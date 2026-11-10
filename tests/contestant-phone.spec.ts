import type { Browser, Locator, Page } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";
import { png, red } from "./support/pictures";

// The contestant app on phones. The real Worker and local D1 run each case.
// Only the identity and the live socket are simulated. Each width runs the
// whole contestant journey: sign-in, the home with the clock, a report sent
// with the keyboard open, replies, images, reopening, awards, the contest
// picker, the account page and the calendar. Set CONTESTANT_PHONE_SHOTS to a
// folder to keep a screenshot of each step.

const shots = process.env.CONTESTANT_PHONE_SHOTS;
const widths = [390, 320] as const;
const heightFor = (width: number) => (width === 390 ? 844 : 640);
// Tall enough to hide the lower part of the page, as an on-screen keyboard does.
const keyboardHeight = 330;

/** Fails when the page scrolls sideways or when anything sticks out of the screen. */
async function expectFits(page: Page, step: string) {
  const problems = await page.evaluate(() => {
    const width = window.innerWidth;
    const found: string[] = [];
    const overflow = document.documentElement.scrollWidth - width;
    if (overflow > 0) found.push(`page scrolls sideways by ${overflow}px`);
    for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
      if (element.closest(".sr-only, [aria-hidden='true'], [hidden]")) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > width + 0.5 || box.left < -0.5) {
        const label = element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30);
        found.push(`${element.tagName.toLowerCase()} "${label}" spans ${Math.round(box.left)} to ${Math.round(box.right)}`);
      }
    }
    return found.slice(0, 5);
  });
  expect(problems, `${step}: layout`).toEqual([]);
}

/** Every control that a finger taps is at least 44 by 44 pixels. */
async function expectTargets(page: Page, step: string) {
  // A menu grows from 95% to 100% when it opens. Measure after it settles.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((item) => item.effect?.getComputedTiming().iterations === Infinity || item.playState === "finished"),
  );
  const small = await page.evaluate(() => {
    const found: string[] = [];
    const selector =
      "button, a[href], select, textarea, input:not([type=hidden]), [role=button], [role=menuitem], [role=menuitemradio], [role=radio], summary, label:has(input)";
    for (const element of document.body.querySelectorAll<HTMLElement>(selector)) {
      if (element.closest("[aria-hidden='true'], [hidden]")) continue;
      // A skip link and a hidden radio show only when focused. Their label is the target.
      if (element.matches(".sr-only") || element.closest(".sr-only")) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.width < 43.5 || box.height < 43.5) {
        const label = element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30);
        found.push(`${element.tagName.toLowerCase()} "${label}" is ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
    }
    return found.slice(0, 8);
  });
  expect(small, `${step}: targets`).toEqual([]);
}

async function check(page: Page, step: string, name: string, shotDir?: string) {
  await expectFits(page, step);
  await expectTargets(page, step);
  if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` });
}

async function expectInView(locator: Locator, step: string) {
  await expect(locator, step).toBeVisible();
  await expect(locator, `${step}: in the viewport`).toBeInViewport({ ratio: 0.98 });
}

/** Shrinks the window by the height of an on-screen keyboard, then restores it. */
async function withKeyboard(page: Page, width: number, body: () => Promise<void>) {
  const full = heightFor(width);
  await page.setViewportSize({ width, height: full - keyboardHeight });
  try {
    await body();
  } finally {
    await page.setViewportSize({ width, height: full });
  }
}

async function signInPage(browser: Browser, local: LocalWorker, name: string, width: number, height: number) {
  const context = await browser.newContext({ viewport: { width, height } });
  await local.attach(context);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
  return page;
}

for (const width of widths) {
  test(`a contestant completes the journey on a ${width} px phone`, async ({ browser, local }, testInfo) => {
    test.setTimeout(150_000);
    const height = heightFor(width);
    const dir = shots ? `${shots}/${width}` : undefined;
    const at = (minutes: number) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${minutes >= 0 ? "+" : ""}${minutes} minutes')`;
    await local.run(
      `UPDATE sessions SET starts_at = ${at(-30)}, ends_at = ${at(95)}, grace_minutes = 0, intake_follows_schedule = 1 WHERE id = ?`,
      local.sessions[0],
    );

    // The sign-in landing.
    const context = await browser.newContext({ viewport: { width, height } });
    await local.attach(context);
    const page = await context.newPage();
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await check(page, "sign-in", "01-sign-in", dir);
    await page.getByLabel("Username", { exact: true }).fill("contestant");
    await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator('[data-ui="contestant"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Live", { exact: true })).toBeVisible();

    // The home shows the clock, its end time and the report button without scrolling.
    const home = page.getByRole("complementary", { name: "Your reports" });
    const clock = page.getByRole("region", { name: "Contest clock" });
    await expectInView(clock, "clock");
    await expect(clock).toContainText(/Your end time is \d/);
    await expectInView(page.getByRole("button", { name: "Report an issue" }), "report button");
    await expect(home.getByRole("navigation", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Report details" })).toHaveCount(0);
    await check(page, "home", "02-home", dir);

    // An announcement shows on the home and opens.
    const admin = await signInPage(browser, local, "admin", 1280, 800);
    await admin.getByRole("button", { name: "New announcement" }).click();
    const form = admin.locator("form").filter({ hasText: "New announcement" });
    await form.getByLabel("Title").fill("Lunch moves");
    await form.getByLabel("Details").fill("Lunch is at noon.\nUse door B.");
    await form.getByRole("button", { name: "Publish" }).click();
    const announcement = page.getByRole("button", { name: "Lunch moves" });
    await expect(announcement).toBeVisible();
    await announcement.click();
    await expect(page.getByText("Use door B.")).toBeVisible();
    await check(page, "announcement", "03-announcement", dir);
    await announcement.click();
    await expect(page.getByText("Use door B.")).toBeHidden();

    // Report an issue with the keyboard open. The text field and Send stay in view.
    await page.getByRole("button", { name: "Report an issue" }).click();
    await expect(page.getByRole("heading", { name: "Report an issue" })).toBeFocused();
    await expectFits(page, "report form");
    await page.getByText("Devices", { exact: true }).click();
    const description = page.getByLabel("What is happening?");
    await withKeyboard(page, width, async () => {
      await description.fill("Keyboard stopped responding after the IDE froze");
      await description.focus();
      // A browser scrolls the focused field into view when the keyboard opens.
      await description.scrollIntoViewIfNeeded();
      if (dir) await page.screenshot({ path: `${dir}/04-report-keyboard.png` });
      await expectInView(description, "description above keyboard");
      await expectInView(page.getByRole("button", { name: "Send report" }), "send above keyboard");
      await expectInView(page.getByRole("button", { name: "Cancel", exact: true }), "cancel above keyboard");
      await expectFits(page, "report form with keyboard");
    });
    await check(page, "report form", "05-report", dir);
    await page.getByRole("button", { name: "Send report" }).click();
    const report = page.getByRole("region", { name: "Your report" });
    await expect(report).toContainText("Keyboard stopped responding after the IDE froze");
    await expect(report.locator("p.font-mono")).toContainText("running");
    await expectInView(report.locator("p.font-mono"), "timer");
    await check(page, "issue", "06-issue", dir);
    const issueId = (await local.snapshot(local.users.admin)).issues.find((item) =>
      item.description.startsWith("Keyboard stopped"),
    )!.id;

    // Staff reply, note and image reach the phone live. The note stays hidden.
    const volunteer = await signInPage(browser, local, "volunteer", 390, 844);
    const card = volunteer.locator(`#issue-card-${issueId}`);
    await volunteer.getByRole("button", { name: /^Claim ISS-/ }).first().click();
    await expect(card).toBeFocused();
    await card.click();
    await volunteer.getByRole("button", { name: "Reply", exact: true }).click();
    let sheet = volunteer.getByRole("dialog", { name: "Reply" });
    await sheet.getByLabel("Message").fill("A helper is on the way to A12.");
    await sheet.getByRole("button", { name: "Send to team" }).click();
    await expect(sheet).toHaveCount(0);
    await volunteer.getByRole("button", { name: "Reply", exact: true }).click();
    sheet = volunteer.getByRole("dialog", { name: "Reply" });
    await sheet.getByText("Staff only", { exact: true }).click();
    await sheet.getByLabel("Internal note").fill("USB hub is faulty. Swap it first.");
    await sheet.getByRole("button", { name: "Add internal note" }).click();
    await expect(sheet).toHaveCount(0);
    await volunteer.getByRole("button", { name: "More actions" }).click();
    await volunteer.getByRole("button", { name: /^Add an image/ }).click();
    sheet = volunteer.getByRole("dialog", { name: "Add an image" });
    await sheet.getByText("Visible to the team", { exact: true }).click();
    await sheet.getByLabel("Image file").setInputFiles({
      name: "hub.png",
      mimeType: "image/png",
      buffer: png(640, 200, () => red),
    });
    await sheet.getByRole("button", { name: "Add image", exact: true }).click();
    await expect(sheet.getByRole("status")).toHaveText("Image added.", { timeout: 15_000 });

    await expect(page.getByText("A helper is on the way to A12.", { exact: true })).toBeVisible();
    await expect(page.getByText(/USB hub is faulty/)).toHaveCount(0);
    const thumb = page.getByRole("button", { name: /^View image uploaded by / });
    await expect(thumb).toBeVisible({ timeout: 15_000 });
    await thumb.scrollIntoViewIfNeeded();
    await check(page, "issue with image", "07-issue-image", dir);
    await thumb.click();
    const viewer = page.getByRole("dialog");
    await expect(viewer.getByRole("img")).toBeVisible();
    await expectFits(page, "image viewer");
    await expectTargets(page, "image viewer");
    if (dir) await page.screenshot({ path: `${dir}/08-image-viewer.png` });
    await viewer.getByRole("button", { name: "Close", exact: true }).click();
    await expect(viewer).toBeHidden();

    // Reply with the keyboard open. The field and Send stay in view.
    const reply = page.getByLabel("Reply to staff");
    await withKeyboard(page, width, async () => {
      await reply.fill("The hub light is blinking.");
      await reply.scrollIntoViewIfNeeded();
      await expectInView(reply, "reply above keyboard");
      await expectInView(page.getByRole("button", { name: "Send", exact: true }), "send reply above keyboard");
      await expectFits(page, "reply with keyboard");
      if (dir) await page.screenshot({ path: `${dir}/09-reply-keyboard.png` });
    });
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("The hub light is blinking.", { exact: true })).toBeVisible();
    await expect(reply).toHaveValue("");

    // Resolve, then reopen with the keyboard open.
    let issue = (await local.snapshot(local.users.admin)).issues.find((item) => item.id === issueId)!;
    await local.act(local.users.volunteer, {
      type: "resolve",
      issue_id: issueId,
      revision: issue.revision,
      summary: "Replaced the USB hub",
    });
    const resolution = page.getByRole("region", { name: "Resolution", exact: true });
    await expect(resolution).toContainText("Replaced the USB hub");
    await expect(report.locator("p.font-mono")).toContainText("stopped");
    await check(page, "resolved", "10-resolved", dir);
    await page.getByRole("button", { name: "The problem is back? Reopen this issue" }).click();
    const reason = page.getByLabel(/What is still wrong\?/);
    await withKeyboard(page, width, async () => {
      await reason.fill("The keyboard stops again after a few minutes.");
      // A browser scrolls the focused field into view when the keyboard opens.
      await reason.scrollIntoViewIfNeeded();
      await expectInView(reason, "reopen reason above keyboard");
      await expectFits(page, "reopen with keyboard");
      if (dir) await page.screenshot({ path: `${dir}/11-reopen-keyboard.png` });
    });
    await page.getByRole("button", { name: "Reopen issue" }).click();
    await expect(report.locator("p.font-mono")).toContainText("running");
    await expect(page.getByText(/USB hub is faulty/)).toHaveCount(0);
    issue = (await local.snapshot(local.users.admin)).issues.find((item) => item.id === issueId)!;
    expect(issue.status).toBe("claimed");

    // The list and an awarded report.
    await tab(page, "My reports").click();
    await expect(page.getByRole("heading", { name: "Your reports" })).toBeFocused();
    const list = page.getByRole("navigation", { name: "Reports" });
    await expect(list.getByRole("button", { name: /Keyboard stopped/ })).toBeVisible();
    await check(page, "list", "12-list", dir);
    await list.getByRole("button", { name: /ISS-5\s*,/ }).click();
    await expect(page.getByRole("region", { name: /award|Award/ }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "5 minutes" })).toBeVisible();
    await check(page, "award", "13-award", dir);
    await tab(page, "My reports").click();

    // The contest picker.
    await local.seatContestantInSecondSession();
    await page.reload();
    const picker = page.getByRole("button", { name: /^Contest session: .* Change session$/ });
    await expect(picker).toBeVisible();
    await expectTargets(page, "picker closed");
    await picker.click();
    await expect(page.getByRole("menu").getByRole("menuitemradio").first()).toBeVisible();
    await check(page, "picker", "14-picker", dir);
    await page.keyboard.press("Escape");

    // The account page and the calendar.
    await page.getByRole("button", { name: /^Account menu for/ }).click();
    await expect(page.getByRole("menuitem", { name: "My account" })).toBeVisible();
    await check(page, "account menu", "15-account-menu", dir);
    await page.getByRole("menuitem", { name: "My account" }).click();
    await expect(page.getByRole("heading", { name: "My account", exact: true })).toBeVisible();
    await check(page, "account", "16-account", dir);
    await page.getByRole("heading", { name: /Calendar|Contests/ }).first().scrollIntoViewIfNeeded().catch(() => undefined);
    await check(page, "account calendar", "17-calendar", dir);
    await page.getByRole("link", { name: "Minsky, your reports" }).click();
    await expect(page.getByRole("button", { name: "Report an issue" })).toBeVisible();

    await admin.context().close();
    await volunteer.context().close();
    testInfo.annotations.push({ type: "width", description: String(width) });
  });
}

const tabs = (page: Page) => page.getByRole("navigation", { name: "Contestant sections" });
const tab = (page: Page, name: string) => tabs(page).getByRole("button", { name, exact: true });

for (const width of widths) {
  test(`the bottom tabs reach reporting in one tap on a ${width} px phone`, async ({ browser, local }, testInfo) => {
    test.setTimeout(90_000);
    const dir = shots ? `${shots}/${width}` : undefined;
    const at = (minutes: number) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${minutes >= 0 ? "+" : ""}${minutes} minutes')`;
    await local.run(
      `UPDATE sessions SET starts_at = ${at(-30)}, ends_at = ${at(95)}, grace_minutes = 0, intake_follows_schedule = 1 WHERE id = ?`,
      local.sessions[0],
    );
    const page = await signInPage(browser, local, "contestant", width, heightFor(width));

    // Three tabs, My reports current on the home, and the content is not behind the bar.
    await expect(tab(page, "My reports")).toHaveAttribute("aria-current", "page");
    await expect(tabs(page).getByRole("button")).toHaveCount(3);
    await expect(tab(page, "Report")).not.toHaveAttribute("aria-current");
    await check(page, "home with tabs", "20-tabs-home", dir);
    const bar = await tabs(page).boundingBox();
    const clock = await page.getByRole("region", { name: "Contest clock" }).boundingBox();
    expect(clock!.y + clock!.height, "clock above the bar").toBeLessThanOrEqual(bar!.y);

    // From Account, one tap opens the report form.
    await tab(page, "Account").click();
    await expect(page.getByRole("heading", { name: "My account", exact: true })).toBeVisible();
    await expect(tab(page, "Account")).toHaveAttribute("aria-current", "page");
    await check(page, "account with tabs", "21-tabs-account", dir);
    await tab(page, "Report").click();
    await expect(page.getByRole("heading", { name: "Report an issue" })).toBeFocused();
    await expect(page.getByLabel("What is happening?")).toBeVisible();
    await expect(tab(page, "Report")).toHaveAttribute("aria-current", "page");
    await check(page, "report with tabs", "22-tabs-report", dir);

    // The bar steps aside while a field has focus, so Send stays free, and returns after.
    const description = page.getByLabel("What is happening?");
    await withKeyboard(page, width, async () => {
      await description.focus();
      await expect(tabs(page)).toBeHidden();
      await expectInView(page.getByRole("button", { name: "Send report" }), "send above keyboard");
    });
    await page.getByRole("heading", { name: "Report an issue" }).focus();
    await expect(tabs(page)).toBeVisible();

    // Back returns to the account page. Enter on a focused tab works.
    await page.goBack();
    await expect(page.getByRole("heading", { name: "My account", exact: true })).toBeVisible();
    await tab(page, "My reports").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("complementary", { name: "Your reports" })).toBeVisible();
    await expect(tab(page, "My reports")).toHaveAttribute("aria-current", "page");

    // A sent report opens as its own screen. My reports returns to the list.
    await tab(page, "Report").click();
    await page.getByText("Devices", { exact: true }).click();
    await description.fill("Mouse is dead");
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByRole("region", { name: "Your report" })).toContainText("Mouse is dead");
    await expect(tab(page, "My reports")).toHaveAttribute("aria-current", "page");
    await tab(page, "My reports").click();
    await expect(page.getByRole("navigation", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Report details" })).toHaveCount(0);

    // Closed intake: Report shows the closed message and clock, with no form.
    await local.run(
      `UPDATE sessions SET starts_at = ${at(30)}, ends_at = ${at(120)}, intake_follows_schedule = 1 WHERE id = ?`,
      local.sessions[0],
    );
    await page.reload();
    await expect(tab(page, "Report")).toBeVisible();
    await tab(page, "Report").click();
    await expect(page.getByRole("heading", { name: "Reporting is closed" })).toBeFocused();
    await expect(page.getByRole("region", { name: "Contest clock" })).toBeVisible();
    await expect(page.getByLabel("What is happening?")).toHaveCount(0);
    await check(page, "report closed", "23-tabs-closed", dir);
    testInfo.annotations.push({ type: "width", description: String(width) });
  });
}

test("Back from the report form, an open report and the closed screen returns to the home", async ({ browser, local }) => {
  test.setTimeout(90_000);
  const at = (minutes: number) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${minutes >= 0 ? "+" : ""}${minutes} minutes')`;
  await local.run(
    `UPDATE sessions SET starts_at = ${at(-30)}, ends_at = ${at(95)}, grace_minutes = 0, intake_follows_schedule = 1 WHERE id = ?`,
    local.sessions[0],
  );
  const page = await signInPage(browser, local, "contestant", 390, 844);
  const reportButton = page.getByRole("button", { name: "Report an issue" });
  const reports = page.getByRole("navigation", { name: "Reports" });
  const origin = new URL(page.url()).origin;

  // The form keeps a typed report while Back goes home.
  await reportButton.click();
  await page.getByText("Devices", { exact: true }).click();
  await page.getByLabel("What is happening?").fill("Mouse is dead");
  await page.goBack();
  expect(new URL(page.url()).origin, "Back stays in the app").toBe(origin);
  await expect(reports).toBeVisible();
  await reportButton.click();
  await expect(page.getByLabel("What is happening?")).toHaveValue("Mouse is dead");

  // A sent report opens as its own screen, and Back returns to the list.
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("region", { name: "Your report" })).toContainText("Mouse is dead");
  await page.goBack();
  expect(new URL(page.url()).origin, "Back stays in the app").toBe(origin);
  await expect(reports).toBeVisible();
  await expect(page.getByRole("region", { name: "Report details" })).toHaveCount(0);

  // A report opened from the list returns the same way.
  await reports.getByRole("button").first().click();
  await expect(page.getByRole("region", { name: "Your report" })).toBeVisible();
  await page.goBack();
  await expect(reports).toBeVisible();

  // The closed screen returns to the home.
  await local.run(
    `UPDATE sessions SET starts_at = ${at(30)}, ends_at = ${at(120)}, intake_follows_schedule = 1 WHERE id = ?`,
    local.sessions[0],
  );
  await page.reload();
  await page.getByRole("navigation", { name: "Contestant sections" }).getByRole("button", { name: "Report", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reporting is closed" })).toBeVisible();
  await page.goBack();
  expect(new URL(page.url()).origin, "Back stays in the app").toBe(origin);
  await expect(reports).toBeVisible();
});
