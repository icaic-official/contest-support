import type { Browser, Page } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";

// The real Worker announcement service and migrations on local D1. Only the
// identity and the live socket are simulated. Image transfers are covered by
// the Cloudflare service tests.

const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };

async function signIn(
  browser: Browser,
  local: LocalWorker,
  name: string,
  viewport = desktop,
  announcementDelay = 0,
): Promise<Page> {
  const context = await browser.newContext({ viewport });
  await local.attach(context);
  if (announcementDelay) {
    await context.route(/\/api\/announcements\?/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, announcementDelay));
      await route.fallback();
    });
  }
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  return page;
}

async function publish(page: Page, title: string, details: string) {
  await page.getByRole("button", { name: "New announcement" }).click();
  const form = page.locator("form").filter({ hasText: "New announcement" });
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Details").fill(details);
  await form.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("button", { name: title })).toBeVisible();
}

test("members read published titles live and open details with the keyboard", async ({ browser, local }) => {
  const admin = await signIn(browser, local, "admin");
  const contestant = await signIn(browser, local, "contestant");
  await expect(contestant.getByRole("heading", { name: "Announcements" })).toHaveCount(0);
  // An open report draft survives a live announcement.
  await contestant.getByRole("button", { name: "Report an issue" }).first().click();
  await contestant.getByLabel(/Describe|What/).first().fill("Draft that must stay");
  await publish(admin, "Lunch moves", "Lunch is at noon.\nUse door B.");
  const title = contestant.getByRole("button", { name: "Lunch moves" });
  await expect(title).toBeVisible();
  await expect(contestant.getByLabel(/Describe|What/).first()).toHaveValue("Draft that must stay");
  await expect(title).toHaveAttribute("aria-expanded", "false");
  await title.focus();
  await contestant.keyboard.press("Enter");
  await expect(title).toHaveAttribute("aria-expanded", "true");
  await expect(contestant.getByText("Use door B.")).toBeVisible();
  await expect(contestant.getByText(/Published by Test admin/)).toBeVisible();
  await expect(contestant.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(contestant.getByRole("button", { name: "New announcement" })).toHaveCount(0);
});

test("slow announcement reads never delay reporting", async ({ browser, local }) => {
  const contestant = await signIn(browser, local, "contestant", desktop, 4000);
  await contestant.getByRole("button", { name: "Report an issue" }).first().click();
  await contestant.getByLabel(/Describe|What/).first().fill("Reported while announcements load");
  const submit = contestant.getByRole("button", { name: /^(Send report|Submit|Report)/ }).last();
  await submit.click();
  await expect.poll(() => local.bodies("/api/workflow").length, { timeout: 3000 }).toBe(1);
});

test("removed announcements leave readers and stay with managers", async ({ browser, local }) => {
  const admin = await signIn(browser, local, "admin");
  const contestant = await signIn(browser, local, "contestant");
  await publish(admin, "Temporary notice", "Short lived.");
  await expect(contestant.getByRole("button", { name: "Temporary notice" })).toBeVisible();
  await admin.getByRole("button", { name: "Temporary notice" }).click();
  await admin.getByRole("button", { name: "Remove", exact: true }).click();
  await admin.getByRole("button", { name: "Confirm removal" }).click();
  await expect(contestant.getByRole("button", { name: "Temporary notice" })).toHaveCount(0);
  await expect(admin.getByRole("button", { name: /Temporary notice/ })).toContainText("Removed");
  await expect(admin.getByText(/Removed by Test admin/)).toBeVisible();
  await expect(admin.getByRole("button", { name: "Edit" })).toHaveCount(0);
});

test("a competing edit asks for a review and never overwrites silently", async ({ browser, local }) => {
  const first = await signIn(browser, local, "admin");
  const second = await signIn(browser, local, "jury");
  await publish(first, "Schedule", "Original details.");
  await second.getByRole("button", { name: "Schedule" }).click();
  await first.getByRole("button", { name: "Schedule" }).click();
  await first.getByRole("button", { name: "Edit", exact: true }).click();
  const draft = first.locator("form").filter({ hasText: "Edit announcement" });
  await draft.getByLabel("Details").fill("My unsent draft.");
  await second.getByRole("button", { name: "Edit", exact: true }).click();
  const other = second.locator("form").filter({ hasText: "Edit announcement" });
  await other.getByLabel("Details").fill("The other manager's text.");
  await other.getByRole("button", { name: "Save changes" }).click();

  const review = first.getByRole("group", { name: "Review the latest version" });
  await expect(review).toContainText("The other manager's text.");
  await expect(draft.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect(draft.getByLabel("Details")).toHaveValue("My unsent draft.");
  await review.getByRole("button", { name: "Keep my draft" }).click();
  await expect(review).toHaveCount(0);
  await expect(draft.getByLabel("Details")).toHaveValue("My unsent draft.");

  // Another change before saving needs another review.
  await second.getByRole("button", { name: "Edit", exact: true }).click();
  const again = second.locator("form").filter({ hasText: "Edit announcement" });
  await again.getByLabel("Details").fill("A third version.");
  await again.getByRole("button", { name: "Save changes" }).click();
  await expect(review).toContainText("A third version.");
  await expect(draft.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await review.getByRole("button", { name: "Load latest text" }).click();
  await expect(draft.getByLabel("Details")).toHaveValue("A third version.");
  await draft.getByLabel("Details").fill("Reviewed final text.");
  await draft.getByRole("button", { name: "Save changes" }).click();
  await expect(first.getByText("Reviewed final text.")).toBeVisible();
  await expect(second.getByText("Reviewed final text.")).toBeVisible();
});

test("the announcement strip fits a phone without horizontal scrolling", async ({ browser, local }) => {
  const admin = await signIn(browser, local, "admin", desktop);
  await publish(admin, "A long announcement title that wraps onto several lines on a narrow phone screen", "Details.");
  const volunteer = await signIn(browser, local, "volunteer", phone);
  await expect(volunteer.getByRole("button", { name: /A long announcement title/ })).toBeVisible();
  const overflow = await volunteer.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await volunteer.getByRole("button", { name: /A long announcement title/ }).click();
  await expect(volunteer.getByText("Details.")).toBeVisible();
  await expect(volunteer.getByRole("button", { name: "New announcement" })).toHaveCount(0);

  // A manager's header has more controls, so it must wrap instead of widening the strip.
  const manager = await signIn(browser, local, "admin", phone);
  const strip = manager.getByRole("region", { name: /^Announcements/ });
  await expect(strip.getByRole("button", { name: "Hide announcements" })).toBeVisible();
  await expect(strip.getByRole("button", { name: "New announcement" })).toBeVisible();
  expect(await strip.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);

  // A hidden strip shows the newest title on one line, so a long title must not widen the page.
  await strip.getByRole("button", { name: "Hide announcements" }).click();
  expect(await manager.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("an open announcement form fits on a laptop screen without scrolling inside the strip", async ({ browser, local }) => {
  const admin = await signIn(browser, local, "admin", { width: 1280, height: 720 });
  await publish(admin, "Room change", "Use room 2.");
  await admin.getByRole("button", { name: "New announcement" }).click();
  const create = admin.locator("form").filter({ hasText: "New announcement" });
  // ratio 1: the strip's own scroll box must not hide any part of the controls.
  await expect(create.getByRole("button", { name: "Publish" })).toBeInViewport({ ratio: 1 });
  await expect(create.getByLabel("Expires (optional)")).toBeInViewport({ ratio: 1 });
  await create.getByRole("button", { name: "Close" }).click();

  await admin.getByRole("button", { name: "Room change" }).click();
  await admin.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = admin.locator("form").filter({ hasText: "Edit announcement" });
  await expect(edit.getByRole("button", { name: "Save changes" })).toBeInViewport({ ratio: 1 });
});

test("the strip lists the two newest announcements and shows the rest on request", async ({ browser, local }) => {
  const admin = await signIn(browser, local, "admin");
  await publish(admin, "First notice", "Oldest.");
  await publish(admin, "Second notice", "Middle.");
  await publish(admin, "Third notice", "Newest.");
  const volunteer = await signIn(browser, local, "volunteer");
  const oldest = volunteer.getByRole("button", { name: "First notice" });
  await expect(volunteer.getByRole("button", { name: "Third notice" })).toBeVisible();
  await expect(volunteer.getByRole("button", { name: "Second notice" })).toBeVisible();
  await expect(oldest).toHaveCount(0);

  const more = volunteer.getByRole("button", { name: "Show 1 more" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(oldest).toBeVisible();
  const fewer = volunteer.getByRole("button", { name: "Show fewer" });
  await expect(fewer).toHaveAttribute("aria-expanded", "true");
  await fewer.click();
  await expect(oldest).toHaveCount(0);
  await expect(more).toBeVisible();
});

test("an announcement that a manager is editing stays listed when a new one pushes it down", async ({ browser, local }) => {
  const admin = await signIn(browser, local, "admin");
  const jury = await signIn(browser, local, "jury");
  await publish(admin, "First notice", "Oldest.");
  await publish(admin, "Second notice", "Middle.");
  await publish(admin, "Third notice", "Newest.");
  await admin.getByRole("button", { name: "Second notice" }).click();
  await admin.getByRole("button", { name: "Edit", exact: true }).click();
  const draft = admin.locator("form").filter({ hasText: "Edit announcement" });
  await draft.getByLabel("Details").fill("My unsent draft.");

  await publish(jury, "Fourth notice", "Pushes the others down.");
  await expect(admin.getByRole("button", { name: "Fourth notice" })).toBeVisible();
  await expect(draft.getByLabel("Details")).toHaveValue("My unsent draft.");
  await expect(admin.getByRole("button", { name: "Show fewer" })).toHaveCount(0);
  await expect(admin.getByRole("button", { name: /Show \d+ more/ })).toHaveCount(0);

  await draft.getByRole("button", { name: "Cancel edit" }).click();
  await expect(admin.getByRole("button", { name: "Second notice" })).toHaveCount(0);
  await expect(admin.getByRole("button", { name: "Show 2 more" })).toBeVisible();
});

test("a member hides the strip, it stays hidden after a refresh, and a new announcement shows it again", async ({ browser, local }) => {
  const admin = await signIn(browser, local, "admin");
  await publish(admin, "Lunch moves", "Lunch is at noon.");
  const volunteer = await signIn(browser, local, "volunteer");
  const lunch = volunteer.getByRole("button", { name: "Lunch moves" });
  await expect(lunch).toBeVisible();

  const hide = volunteer.getByRole("button", { name: "Hide announcements", exact: true });
  const show = volunteer.getByRole("button", { name: "Show announcements", exact: true });
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await hide.click();
  await expect(show).toBeFocused();
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await expect(volunteer.getByRole("heading", { name: "Announcements · Lunch moves" })).toBeVisible();
  await expect(lunch).toBeHidden();

  await volunteer.reload();
  await expect(show).toBeVisible();
  await expect(lunch).toBeHidden();

  // The stored choice covers only the announcements that existed when it was made.
  await publish(admin, "Room change", "Use room 2.");
  await expect(volunteer.getByRole("button", { name: "Room change" })).toBeVisible({ timeout: 15000 });
  await expect(hide).toBeVisible();
  await expect(volunteer.getByRole("heading", { name: "Announcements", exact: true })).toBeVisible();

  // Showing the strip again restores what the member had open.
  await lunch.click();
  await expect(volunteer.getByText("Lunch is at noon.")).toBeVisible();
  await hide.click();
  await expect(lunch).toBeHidden();
  await show.click();
  await expect(hide).toBeFocused();
  await expect(volunteer.getByRole("button", { name: "Room change" })).toBeVisible();
  await expect(lunch).toBeVisible();
  await expect(lunch).toHaveAttribute("aria-expanded", "true");
  await expect(volunteer.getByText("Lunch is at noon.")).toBeVisible();
});

test("a manager can hide the strip and keeps an unsent draft", async ({ browser, local }) => {
  const admin = await signIn(browser, local, "admin");
  await publish(admin, "Room change", "Use room 2.");
  await admin.getByRole("button", { name: "New announcement" }).click();
  const create = admin.locator("form").filter({ hasText: "New announcement" });
  await create.getByLabel("Title").fill("Unsent title");

  await admin.getByRole("button", { name: "Hide announcements", exact: true }).click();
  await expect(create).toBeHidden();
  await expect(admin.getByRole("button", { name: "New announcement" })).toBeHidden();
  await expect(admin.getByRole("heading", { name: "Announcements · Room change" })).toBeVisible();

  await admin.getByRole("button", { name: "Show announcements", exact: true }).click();
  await expect(create.getByLabel("Title")).toHaveValue("Unsent title");
  await expect(admin.getByRole("button", { name: /Room change/ })).toBeVisible();
});
