import { type Browser, expect, type Page, test } from "@playwright/test";
import { createJuryFixture } from "./jury-fixture";

// Real announcement migration, RLS, and transactions in embedded PostgreSQL.
// Only the hosted Auth, HTTP, and Realtime transport is simulated. Image
// transfers are covered by the database, function, and Cloudflare service tests.

type Local = Awaited<ReturnType<typeof createJuryFixture>>;
const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };

async function signIn(
  browser: Browser,
  local: Local,
  name: string,
  viewport = desktop,
): Promise<Page> {
  const context = await browser.newContext({ viewport });
  await local.attach(context);
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

test("members read published titles live and open details with the keyboard", async ({ browser }) => {
  const local = await createJuryFixture();
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
  await local.close();
});

test("slow announcement reads never delay reporting", async ({ browser }) => {
  const local = await createJuryFixture();
  local.delayAnnouncements(4000);
  const contestant = await signIn(browser, local, "contestant");
  await contestant.getByRole("button", { name: "Report an issue" }).first().click();
  await contestant.getByLabel(/Describe|What/).first().fill("Reported while announcements load");
  const submit = contestant.getByRole("button", { name: /^(Send report|Submit|Report)/ }).last();
  await submit.click();
  await expect.poll(() => local.workflowRequests.length, { timeout: 3000 }).toBe(1);
  await local.close();
});

test("removed announcements leave readers and stay with managers", async ({ browser }) => {
  const local = await createJuryFixture();
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
  await local.close();
});

test("a competing edit asks for a review and never overwrites silently", async ({ browser }) => {
  const local = await createJuryFixture();
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
  await local.close();
});

test("the announcement strip fits a phone without horizontal scrolling", async ({ browser }) => {
  const local = await createJuryFixture();
  const admin = await signIn(browser, local, "admin", desktop);
  await publish(admin, "A long announcement title that wraps onto several lines on a narrow phone screen", "Details.");
  const volunteer = await signIn(browser, local, "volunteer", phone);
  await expect(volunteer.getByRole("button", { name: /A long announcement title/ })).toBeVisible();
  const overflow = await volunteer.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await volunteer.getByRole("button", { name: /A long announcement title/ }).click();
  await expect(volunteer.getByText("Details.")).toBeVisible();
  await expect(volunteer.getByRole("button", { name: "New announcement" })).toHaveCount(0);
  await local.close();
});

test("an open announcement form fits on a laptop screen without scrolling inside the strip", async ({ browser }) => {
  const local = await createJuryFixture();
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
  await local.close();
});
