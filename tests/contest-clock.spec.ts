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

async function signIn(
  browser: Browser,
  local: LocalWorker,
  name: string,
  viewport = desktop,
  beforeLoad?: () => void,
): Promise<Page> {
  const context = await browser.newContext({ viewport });
  await local.attach(context);
  if (beforeLoad) await context.addInitScript(beforeLoad);
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

  test("a retry after a lost response and a failed refresh records one award", async ({ browser, local }) => {
    test.setTimeout(90_000);
    await schedule(local, -30, 60);
    // The Worker records the first award, and the browser never sees the response.
    const loseFirstAward = () => {
      const send = window.fetch.bind(window);
      let lost = true;
      window.fetch = async (input, init) => {
        const response = await send(input, init);
        if (lost && String(input instanceof Request ? input.url : input).includes("/api/contest-awards")) {
          lost = false;
          throw new TypeError("Failed to fetch");
        }
        return response;
      };
    };
    const jury = await signIn(browser, local, "jury", desktop, loseFirstAward);
    let blocked = false;
    await jury.route("**/api/snapshot**", (route) => (blocked ? route.fulfill({ status: 403, json: { error: "You have no access to this contest." } }) : route.fallback()));
    const open = async () => {
      await jury.getByRole("navigation", { name: "Console pages" }).getByRole("button", { name: /^Award review/ }).click();
      const panel = jury.getByRole("region", { name: "Time awards for the whole contest" });
      await panel.getByLabel("Minutes for every contestant").fill("15");
      await panel.getByLabel("Why").fill("Network outage in the hall.");
      return panel;
    };
    const panel = await open();
    await panel.getByRole("button", { name: "Record the decision" }).click();
    await expect(panel.locator("p[role=alert]")).toBeVisible();
    expect(await local.rows("SELECT id FROM contest_awards WHERE session_id = ?", local.sessions[0])).toHaveLength(1);
    // A failed refresh removes the console, and with it any state that holds the pending request ID.
    blocked = true;
    await jury.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(jury.getByRole("button", { name: "Refresh access", exact: true })).toBeVisible();
    blocked = false;
    await jury.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(jury.getByRole("navigation", { name: "Console pages" })).toBeVisible();
    const again = await open();
    await again.getByRole("button", { name: "Record the decision" }).click();
    await expect(again.getByRole("list", { name: "Contest-wide awards" })).toBeVisible();
    expect(await local.rows("SELECT id FROM contest_awards WHERE session_id = ?", local.sessions[0])).toHaveLength(1);
  });

  // The Worker records the first award and the browser never sees the response. The browser then loses
  // the request ID, by a reload or by an edit, so the retry is a new request. The Worker must refuse it.
  for (const [name, loseId] of [
    ["a reload", async (jury: Page) => jury.reload()],
    ["an edited explanation", async () => undefined],
  ] as const) {
    test(`a retry after a lost response and ${name} records one award`, async ({ browser, local }) => {
      test.setTimeout(90_000);
      await schedule(local, -30, 60);
      const loseFirstAward = () => {
        const send = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const response = await send(input, init);
          if (!sessionStorage.getItem("lost") && String(input instanceof Request ? input.url : input).includes("/api/contest-awards")) {
            sessionStorage.setItem("lost", "1");
            throw new TypeError("Failed to fetch");
          }
          return response;
        };
      };
      const jury = await signIn(browser, local, "jury", desktop, loseFirstAward);
      const open = async () => {
        await jury.getByRole("navigation", { name: "Console pages" }).getByRole("button", { name: /^Award review/ }).click();
        const panel = jury.getByRole("region", { name: "Time awards for the whole contest" });
        await panel.getByLabel("Minutes for every contestant").fill("15");
        await panel.getByLabel("Why").fill("Network outage in the hall.");
        return panel;
      };
      const panel = await open();
      await panel.getByRole("button", { name: "Record the decision" }).click();
      await expect(panel.locator("p[role=alert]")).toBeVisible();
      expect(await local.rows("SELECT id FROM contest_awards WHERE session_id = ?", local.sessions[0])).toHaveLength(1);
      await loseId(jury);
      const retry = await open();
      if (name === "an edited explanation") await retry.getByLabel("Why").fill("Network outage in the hall, 20 minutes.");
      await retry.getByRole("button", { name: "Record the decision" }).click();
      await expect(retry.locator("p[role=alert]")).toHaveText("An award of this length is waiting for confirmation.");
      // The refusal keeps the typed text and shows the recorded award.
      await expect(retry.getByLabel("Minutes for every contestant")).toHaveValue("15");
      await expect(retry.getByLabel("Why")).toHaveValue(name === "a reload" ? "Network outage in the hall." : "Network outage in the hall, 20 minutes.");
      await expect(retry.getByRole("list", { name: "Contest-wide awards" })).toContainText("Network outage in the hall.");
      expect(await local.rows("SELECT id FROM contest_awards WHERE session_id = ?", local.sessions[0])).toHaveLength(1);
    });
  }

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

test("jury on a phone see the calendar of the event, including a contest with no seat", async ({ browser, local }) => {
  await schedule(local, -30, 90);
  await local.run(
    `UPDATE sessions SET starts_at = ${at(30)}, ends_at = ${at(120)}, intake_follows_schedule = 1 WHERE id = ?`,
    local.sessions[1],
  );
  const hidden = randomUUID();
  await local.run(
    `INSERT INTO sessions (id, event_id, name, starts_at, ends_at, intake_follows_schedule) VALUES (?, ?, 'Closed room', ${at(60)}, ${at(180)}, 1)`,
    hidden,
    local.event,
  );
  const page = await signIn(browser, local, "jury", phone);
  await page.getByRole("navigation", { name: "Organizer sections" }).getByRole("button", { name: /^Me/ }).click();
  const calendar = page.getByRole("region", { name: "Calendar" });
  await expect(calendar).toContainText("Primary");
  await expect(calendar.getByRole("listitem").filter({ hasText: "Primary" })).toContainText("Current");
  await expect(calendar.getByRole("button", { name: "Open Secondary" })).toBeVisible();
  const row = calendar.getByRole("listitem").filter({ hasText: "Closed room" });
  await expect(row).toContainText("You have no seat here");
  await expect(row.getByRole("button")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // The jury account holds a seat in the second contest too, so it is the only other contest that it can open.
  await expect(calendar.getByRole("button", { name: /^Open / })).toHaveCount(1);
});

test.describe("the calendar on the account page", () => {
  test.describe.configure({ mode: "default" });

  test("shows the contestant's personal intake for the open contest, not the contest-wide one", async ({ browser, local }) => {
    await schedule(local, -120, -30, 5);
    await local.run(
      `INSERT INTO contest_awards (id, session_id, request_id, minutes, explanation, actor, actor_name, at, applied_at, applied_by, applied_name, applied_request)
       SELECT ?, ?, 'req-5', 60, 'Power cut', id, name, ${at(0)}, ${at(0)}, id, name, 'req-6' FROM accounts WHERE id = ?`,
      randomUUID(),
      local.sessions[0],
      local.users.jury,
    );
    const page = await signIn(browser, local, "contestant");
    await expect(page.getByRole("button", { name: "Report an issue" })).toBeEnabled();
    await page.goto("/account");
    const row = page.getByRole("region", { name: "Calendar" }).getByRole("listitem").filter({ hasText: "Primary" });
    await expect(row).toContainText("Current");
    await expect(row).not.toContainText("Intake closed");
    await expect(row).toContainText("Intake open");
  });

  test("reads again on a change of schedule, not on every live update", async ({ browser, local }) => {
    await schedule(local, -30, 90);
    const page = await signIn(browser, local, "contestant");
    const reads: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/contests?from=")) reads.push(request.url());
    });
    await page.goto("/account");
    const calendar = page.getByRole("region", { name: "Calendar" });
    await expect(calendar).toContainText("Primary");
    await page.waitForTimeout(1000);
    const first = reads.length;
    expect(first).toBeGreaterThan(0);
    for (const description of ["One", "Two"]) {
      await local.act(local.users.contestant, { type: "submit", category: "Backend", description, team_id: local.teams[0] });
    }
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(reads.length).toBe(first);
  });
});

test.describe("keyboard focus on the organiser console", () => {
  test.describe.configure({ mode: "default" });

  const pageLink = (page: Page, name: RegExp) =>
    page.getByRole("navigation", { name: "Console pages" }).getByRole("button", { name });
  const focusedTag = (page: Page) => page.evaluate(() => document.activeElement?.tagName);

  test("recording an award by keyboard keeps focus on the form", async ({ browser, local }) => {
    await schedule(local, -30, 60);
    const jury = await signIn(browser, local, "jury");
    await pageLink(jury, /^Award review/).click();
    const panel = jury.getByRole("region", { name: "Time awards for the whole contest" });
    await panel.getByLabel("Minutes for every contestant").fill("15");
    await panel.getByLabel("Why").fill("Network outage in the hall.");
    await panel.getByRole("button", { name: "Record the decision" }).focus();
    await jury.keyboard.press("Enter");
    await expect(panel.getByRole("list", { name: "Contest-wide awards" })).toContainText("Network outage in the hall.");
    expect(await focusedTag(jury)).not.toBe("BODY");
  });

  test("confirming an award by keyboard moves focus to the page heading when the button goes", async ({ browser, local }) => {
    await schedule(local, -30, 60);
    await local.run(
      `INSERT INTO contest_awards (id, session_id, request_id, minutes, explanation, actor, actor_name, at)
       SELECT ?, ?, 'req-f', 10, 'Network outage', id, name, ${at(0)} FROM accounts WHERE id = ?`,
      randomUUID(),
      local.sessions[0],
      local.users.jury,
    );
    const jury = await signIn(browser, local, "jury");
    await pageLink(jury, /^Award review/).click();
    const panel = jury.getByRole("region", { name: "Time awards for the whole contest" });
    // A live refresh can replace the button between the focus and the key, so try again until it is confirmed. A repeat is harmless.
    await expect(async () => {
      await panel.getByRole("button", { name: "Confirm applied externally" }).focus({ timeout: 1000 });
      await jury.keyboard.press("Enter");
      await expect(panel).toContainText("Applied · confirmed by", { timeout: 1500 });
    }).toPass({ timeout: 15_000 });
    await expect(jury.getByRole("heading", { level: 1 })).toBeFocused();
  });

  test("changing intake by keyboard keeps focus on the page", async ({ browser, local }) => {
    await schedule(local, -30, 60);
    const admin = await signIn(browser, local, "admin");
    await pageLink(admin, /^Session settings/).click();
    await expect(admin.getByRole("heading", { level: 1, name: "Session settings" })).toBeFocused();
    const intake = admin.getByRole("region", { name: "Contestant intake", exact: true });
    await intake.getByRole("button", { name: "Close now", exact: true }).focus();
    await admin.keyboard.press("Enter");
    await expect(intake).toContainText("set by staff");
    expect(await focusedTag(admin)).not.toBe("BODY");
  });

  test("a quick Back and Forward still focuses the page heading", async ({ browser, local }) => {
    await schedule(local, -30, 60);
    const admin = await signIn(browser, local, "admin");
    await pageLink(admin, /^Session settings/).click();
    await expect(admin.getByRole("heading", { level: 1, name: "Session settings" })).toBeFocused();
    await pageLink(admin, /^Overview/).click();
    // Go forward again after the earlier page's effects ran and before the frame that focuses its heading.
    await admin.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.addEventListener(
            "popstate",
            () => {
              window.addEventListener("popstate", () => resolve(), { once: true });
              // After React ran its effects for the earlier page, and before the next frame.
              window.setTimeout(() => window.history.forward(), 4);
            },
            { once: true },
          );
          window.history.back();
        }),
    );
    await expect(admin.getByRole("heading", { level: 1, name: "Overview" })).toBeFocused();
  });
});
