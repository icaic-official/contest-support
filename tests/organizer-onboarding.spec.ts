import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";

// Rough spots that a first-time organizer meets, on the real Worker over local D1.

/** Set MINSKY_SHOTS to a folder to keep screenshots. */
const shots = process.env.MINSKY_SHOTS;
const desktop = { width: 1280, height: 800 };
const at = (minutes: number) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${minutes >= 0 ? "+" : ""}${minutes} minutes')`;

async function signInPage(page: Page, name: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function signInAs(browser: Browser, local: LocalWorker, name: string): Promise<Page> {
  const context = await browser.newContext({ viewport: desktop });
  await local.attach(context);
  const page = await context.newPage();
  await signInPage(page, name);
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
  return page;
}

async function scheduleContest(local: LocalWorker, start: number, end: number) {
  await local.run(
    "UPDATE awards SET applied_at = NULL, applied_by = NULL, applied_name = NULL WHERE session_id = ?",
    local.sessions[0],
  );
  await local.run(
    `UPDATE sessions SET starts_at = ${at(start)}, ends_at = ${at(end)}, grace_minutes = 0, intake_follows_schedule = 1 WHERE id = ?`,
    local.sessions[0],
  );
}

test.describe("a webmaster before any event exists", () => {
  test.use({ webmaster: "admin", viewport: desktop });

  test("lands on the site page and never reads an event", async ({ page, local }) => {
    // The fixture seeds the webmaster. The shared test database holds other contests, so a route answers as an empty site does.
    expect(local.users.admin).toBeTruthy();
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Site sign-in", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill(randomUUID());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Console pages" })).toBeVisible();
    await page.route("**/api/contests*", (route) => route.fulfill({ json: [] }));
    const eventReads: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/event") eventReads.push(request.url());
    });
    await page.goto("/issues");
    await expect(page.getByRole("heading", { level: 1, name: "Site", exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/site");
    await expect(page.getByText(/ask an organizer/)).toHaveCount(0);
    expect(eventReads).toEqual([]);
  });

  test("opens an event with no contests on the Contests tab", async ({ page, local }) => {
    const code = `empty-${randomUUID().slice(0, 8)}`;
    await local.manage(local.users.admin, {
      type: "create_event",
      name: "Empty Olympiad",
      code,
      timeZone: "UTC",
      firstAdmin: { handle: `first-${code.slice(6)}`, name: "First Admin" },
    });
    const [event] = await local.rows<{ id: string }>("SELECT id FROM events WHERE code = ?", code);
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Site sign-in", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill(randomUUID());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.goto(`/event/${event!.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Empty Olympiad" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Contests", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Create contest", exact: true })).toBeVisible();
  });
});

test.describe("escalating without a specialist", () => {
  test.use({ seedIssues: false });

  test("warns at the confirm step, and stays quiet when a specialist is assigned", async ({ browser, local }) => {
    await local.act(local.users.volunteer, {
      type: "submit",
      category: "Backend",
      description: "Projector will not start",
      team_id: local.teams[0],
    });
    const open = async (page: Page) => {
      await page.getByText("Projector will not start").first().click();
      const claim = page.getByRole("button", { name: "Claim", exact: true });
      if (await claim.isVisible()) await claim.click();
      await page.getByRole("button", { name: "Escalate to specialist" }).click();
      return page.getByRole("dialog", { name: "Escalate to a specialist?" });
    };
    const withSpecialist = await signInAs(browser, local, "volunteer");
    const first = await open(withSpecialist);
    await expect(first.getByRole("button", { name: "Escalate to specialist" })).toBeVisible();
    await expect(first).not.toContainText("No specialist is assigned to this contest");
    await withSpecialist.context().close();

    await local.run("DELETE FROM membership_roles WHERE session_id = ? AND role = 'specialist'", local.sessions[0]);
    const without = await signInAs(browser, local, "volunteer");
    const warned = await open(without);
    await expect(warned).toContainText("No specialist is assigned to this contest");
    await expect(warned.getByRole("button", { name: "Escalate to specialist" })).toBeVisible();
  });
});

test.describe("a contest that an admin closed by hand", () => {
  test("keeps the contestant's clock, with the closure as a second line", async ({ browser, local }) => {
    await scheduleContest(local, -30, 60);
    await local.manage(local.users.admin, { type: "set_intake", contestId: local.sessions[0], mode: "closed" });
    const page = await signInAs(browser, local, "contestant");
    const clock = page.getByRole("region", { name: "Contest clock" });
    await expect(clock).toContainText(/^Ends in /);
    await expect(clock).toContainText(/The contest ends at /);
    const lines = clock.locator("p");
    await expect(lines.nth(1)).toHaveText("Reporting is closed by the organizers.");
  });

  test("the sidebar toggle says it overrides the schedule and links to Return to schedule", async ({ browser, local }) => {
    await scheduleContest(local, -30, 60);
    const admin = await signInAs(browser, local, "admin");
    const sidebar = admin.getByRole("complementary", { name: "Console" });
    await expect(sidebar).toContainText("Switching this overrides the schedule.");
    await sidebar.getByRole("switch", { name: "Contestant intake" }).click();
    await expect(sidebar).toContainText("Set by hand. This overrides the schedule.");
    await sidebar.getByRole("button", { name: "Return to schedule in settings", exact: true }).click();
    await expect(admin.getByRole("heading", { level: 1, name: "Session settings" })).toBeVisible();
    await admin.getByRole("main").getByRole("button", { name: "Return to schedule", exact: true }).click();
    await expect(sidebar).toContainText("Switching this overrides the schedule.");
  });
});

test.describe("assigning staff", () => {
  test.use({ seedIssues: false, withEventAdmin: true });

  test("ticks no role, names the roles on the button, and explains a disabled button", async ({ page, local }) => {
    const handle = `sam-${randomUUID().slice(0, 8)}`;
    await page.setViewportSize(desktop);
    await signInPage(page, "eventadmin");
    await page.goto("/event");
    await page.getByRole("tab", { name: "People", exact: true }).click();
    await page.getByLabel("People, one per line: name, username", { exact: true }).fill(`Sam Lee, ${handle}`);
    await page.getByRole("button", { name: "Create people (1)", exact: true }).click();
    await page.getByRole("dialog", { name: "Share these credentials securely" }).getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("tab", { name: "Assignments", exact: true }).click();
    await page.getByLabel("Contest", { exact: true }).selectOption({ label: "Primary" });
    const row = page.getByRole("listitem").filter({ hasText: handle });
    await expect(row.getByRole("checkbox", { name: /Volunteer$/ })).not.toBeChecked();
    const assign = row.getByRole("button", { name: "Assign Sam Lee", exact: true });
    await expect(assign).toHaveAttribute("aria-disabled", "true");
    await expect(row).toContainText("Pick at least one role or Contest admin.");
    await row.getByRole("checkbox", { name: /Volunteer$/ }).check({ force: true });
    await row.getByRole("checkbox", { name: /Jury$/ }).check({ force: true });
    const named = row.getByRole("button", { name: "Assign Sam Lee as Volunteer, Jury", exact: true });
    await expect(named).toHaveText("Assign as Volunteer, Jury");
    await named.click();
    await expect(row.getByText("Assigned", { exact: true })).toBeVisible();
    const [seat] = await local.rows<{ roles: string }>(
      `SELECT json_group_array(role) AS roles FROM membership_roles WHERE session_id = ? AND account_id =
        (SELECT id FROM accounts WHERE handle = ? AND event_id = ?)`,
      local.sessions[0],
      handle,
      local.event,
    );
    expect((JSON.parse(seat!.roles) as string[]).sort()).toEqual(["jury", "volunteer"]);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
      if (shots) await page.screenshot({ path: `${shots}/assign-${width}.png`, fullPage: true });
    }
  });
});
