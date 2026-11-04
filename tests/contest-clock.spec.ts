import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";

// The real Worker, schedule, and awards on local D1. Only the identity and the live
// socket are simulated. Each test moves time by writing the schedule relative to now.

const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };

const at = (minutes: number) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${minutes >= 0 ? "+" : ""}${minutes} minutes')`;

/** Puts the primary contest on a schedule that starts and ends `start` and `end` minutes from now. */
async function unconfirmAwards(local: LocalWorker) {
  // The default fixture confirms a five-minute issue award for the contestant's team. These cases start without it.
  await local.run(
    "UPDATE awards SET applied_at = NULL, applied_by = NULL, applied_name = NULL WHERE session_id = ?",
    local.sessions[0],
  );
}

async function schedule(local: LocalWorker, start: number, end: number, grace = 0) {
  await unconfirmAwards(local);
  await local.run(
    `UPDATE sessions SET starts_at = ${at(start)}, ends_at = ${at(end)}, grace_minutes = ?, intake_follows_schedule = 1 WHERE id = ?`,
    grace,
    local.sessions[0],
  );
}

async function signIn(browser: Browser, local: LocalWorker, name: string, viewport = desktop): Promise<Page> {
  const context = await browser.newContext({ viewport });
  await local.attach(context);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
  return page;
}

test.describe("the contestant clock", () => {
  test.describe.configure({ mode: "default" });

  test("says when reporting opens, and keeps the report button closed until then", async ({ browser, local }) => {
    await schedule(local, 120, 240);
    const page = await signIn(browser, local, "contestant");
    const clock = page.getByRole("region", { name: "Contest clock" });
    await expect(clock).toContainText(/^Reporting opens at /);
    await expect(clock).toContainText(/Opens in (1:5\d:\d\d|2:00:0\d)\./);
    await expect(page.getByRole("button", { name: "Report an issue" })).toBeDisabled();
    await expect(page.locator("#report-availability")).toContainText(/^Reporting opens at /);
  });

  test("counts down while the contest runs, and shows the personal end time with confirmed minutes", async ({ browser, local }) => {
    await schedule(local, -30, 90, 10);
    const wide = randomUUID();
    const page = await signIn(browser, local, "contestant");
    const clock = page.getByRole("region", { name: "Contest clock" });
    await expect(clock).toContainText(/Ends in 1:[0-2]\d:\d\d/);
    await expect(clock).toContainText("Reporting stays open 10 minutes after that.");
    await expect(page.getByRole("button", { name: "Report an issue" })).toBeEnabled();
    // Minutes that staff decided but did not confirm change nothing. Confirmed minutes do.
    await local.run(
      `INSERT INTO contest_awards (id, session_id, request_id, minutes, explanation, actor, actor_name, at)
       SELECT ?, ?, 'req-1', 10, 'Network outage', id, name, ${at(0)} FROM accounts WHERE id = ?`,
      wide,
      local.sessions[0],
      local.users.jury,
    );
    await page.reload();
    await expect(page.getByRole("region", { name: "Contest clock" })).not.toContainText("Your end time");
    await local.run(
      `UPDATE contest_awards SET applied_at = ${at(0)}, applied_by = ?, applied_name = 'Test jury', applied_request = 'req-2' WHERE id = ?`,
      local.users.jury,
      wide,
    );
    await page.reload();
    await expect(page.getByRole("region", { name: "Contest clock" })).toContainText(
      /Your end time is .*\. It includes 10 minutes that staff confirmed as applied\./,
    );
  });

  test("explains the closed form after the end, and lets confirmed extra minutes reopen it", async ({ browser, local }) => {
    await schedule(local, -120, -30, 5);
    const page = await signIn(browser, local, "contestant");
    await expect(page.getByRole("region", { name: "Contest clock" })).toContainText(/^Reporting closed at /);
    await expect(page.getByRole("button", { name: "Report an issue" })).toBeDisabled();
    await expect(page.locator("#report-availability")).toContainText(/^Reporting closed at /);
    // The Worker refuses the report as well, because the form is not the gate.
    await local.run(
      `INSERT INTO contest_awards (id, session_id, request_id, minutes, explanation, actor, actor_name, at, applied_at, applied_by, applied_name, applied_request)
       SELECT ?, ?, 'req-3', 60, 'Power cut', id, name, ${at(0)}, ${at(0)}, id, name, 'req-4' FROM accounts WHERE id = ?`,
      randomUUID(),
      local.sessions[0],
      local.users.jury,
    );
    await page.reload();
    await expect(page.getByRole("button", { name: "Report an issue" })).toBeEnabled();
    await expect(page.getByRole("region", { name: "Contest clock" })).toContainText("It includes 60 minutes");
  });

  test("closes by itself at the end, without a reload", async ({ browser, local }) => {
    test.setTimeout(90_000);
    await unconfirmAwards(local);
    await local.run(
      `UPDATE sessions SET starts_at = ${at(-10)}, ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+25 seconds'),
       grace_minutes = 0, intake_follows_schedule = 1 WHERE id = ?`,
      local.sessions[0],
    );
    const page = await signIn(browser, local, "contestant");
    await expect(page.getByRole("button", { name: "Report an issue" })).toBeEnabled();
    // The contest ends 25 seconds after the write, which leaves a slow machine time to sign in.
    // The browser refreshes at the boundary plus up to 15 seconds.
    await expect(page.getByRole("region", { name: "Contest clock" })).toContainText(/^Reporting closed at /, { timeout: 55_000 });
    await expect(page.getByRole("button", { name: "Report an issue" })).toBeDisabled();
  });
});

test.describe("contest-wide time awards", () => {
  test.describe.configure({ mode: "default" });

  test("jury records the decision, a volunteer confirms it on a phone, and contestants gain the minutes", async ({ browser, local }) => {
    test.setTimeout(90_000);
    await schedule(local, -30, 60);
    const jury = await signIn(browser, local, "jury");
    await jury.getByRole("navigation", { name: "Console pages" }).getByRole("button", { name: /^Award review/ }).click();
    const panel = jury.getByRole("region", { name: "Time awards for the whole contest" });
    await panel.getByLabel("Minutes for every contestant").fill("15");
    await panel.getByLabel("Why").fill("Network outage in the hall.");
    await panel.getByRole("button", { name: "Record the decision" }).click();
    await expect(panel.getByRole("list", { name: "Contest-wide awards" })).toContainText("Network outage in the hall.");
    // Nothing changes for a contestant until staff confirm.
    const contestant = await signIn(browser, local, "contestant");
    await expect(contestant.getByRole("region", { name: "Contest clock" })).not.toContainText("Your end time");

    const volunteer = await signIn(browser, local, "volunteer", phone);
    const pending = volunteer.getByRole("region", { name: "Time awards to confirm" });
    await expect(pending).toContainText("15 minutes");
    expect(await volunteer.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await pending.getByRole("button", { name: "Confirm applied externally" }).click();
    await expect(pending).toBeHidden();

    await contestant.reload();
    await expect(contestant.getByRole("region", { name: "Contest clock" })).toContainText("It includes 15 minutes that staff confirmed as applied.");
    // The jury sees the confirmation and cannot confirm twice.
    await jury.reload();
    await jury.getByRole("navigation", { name: "Console pages" }).getByRole("button", { name: /^Award review/ }).click();
    await expect(jury.getByRole("region", { name: "Time awards for the whole contest" })).toContainText("Applied · confirmed by Test volunteer");
  });

  test("a contestant sees no award controls, and the Worker refuses a grant from a contestant", async ({ browser, local }) => {
    await schedule(local, -30, 60);
    const contestant = await signIn(browser, local, "contestant");
    await expect(contestant.getByText("Time awards")).toHaveCount(0);
    const result = await contestant.evaluate(
      async ([sessionId]) => {
        const response = await fetch("/api/contest-awards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, requestId: crypto.randomUUID(), command: { type: "grant", minutes: 5, explanation: "x" } }),
        });
        return response.status;
      },
      [local.sessions[0]],
    );
    expect([401, 403]).toContain(result);
    expect(await local.rows("SELECT id FROM contest_awards WHERE session_id = ?", local.sessions[0])).toEqual([]);
  });
});
