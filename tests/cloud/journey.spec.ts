import { test, expect, type Page } from "@playwright/test";
import { account, fixture, anonKey, url, service, save } from "./fixture";
import {
  byId,
  choose,
  consoleLink,
  desktop,
  fitsWidth,
  issueRow,
  liveBadge,
  login,
  openDialog,
  phone,
  phoneTab,
  signOut,
  submitSignIn,
  uiRoot,
} from "./ui";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("public signup is disabled while organizer-created accounts can log in", async () => {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signUp({
    email: `test-signup-${crypto.randomUUID()}@accounts.minsky.invalid`,
    password: crypto.randomUUID() + "A9!",
  });
  // Clean up an unexpected account before assertions report the misconfiguration.
  if (data.user) {
    const removed = await service().auth.admin.deleteUser(data.user.id);
    if (removed.error) throw removed.error;
  }
  expect(error?.code).toBe("signup_disabled");
  expect(data.user).toBeNull();
  const contestant = await account("contestant");
  const signedOut = await contestant.auth.signOut();
  expect(signedOut.error).toBeNull();
});

test("sign-in stays usable on phones and exposes recovery help by keyboard", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: testInfo.outputPath("sign-in-desktop.png"),
    fullPage: true,
  });
  for (const width of [800, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const username = await page
      .getByLabel("Username", { exact: true })
      .boundingBox();
    expect(username).not.toBeNull();
    expect(username!.x).toBeGreaterThanOrEqual(0);
    expect(username!.x + username!.width).toBeLessThanOrEqual(width);
    expect(username!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(
    page.getByText("Contact your contest organizers.", { exact: true }),
  ).toBeVisible();
  const toggle = page.getByRole("button", {
    name: "Show password",
    exact: true,
  });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.screenshot({
    path: testInfo.outputPath("sign-in-320.png"),
    fullPage: true,
  });
});

/** Opens a contestant report from the report list by its description. */
async function openReport(page: Page, description: string) {
  await page
    .getByRole("navigation", { name: "Reports" })
    .getByRole("button")
    .filter({ hasText: description })
    .click();
  await expect(
    page.getByRole("region", { name: "Your report" }),
  ).toContainText(description);
}

test("organiser navigation follows combined roles on phones and the desktop console", async ({
  page,
}, testInfo) => {
  await page.setViewportSize(phone);
  await login(page, "volunteer", "organiser-phone");
  const tabs = page.getByRole("navigation", { name: "Organiser sections" });
  await expect(tabs.getByRole("button")).toHaveText([
    "Queue",
    "Mine",
    "Find",
    "Me",
  ]);
  const me = tabs.getByRole("button", { name: "Me", exact: true });
  await me.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Me", exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL("/account");
  await expect(me).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByText(fixture().accounts.volunteer.username, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Volunteer", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("organiser-me-390.png"),
    fullPage: true,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const queue = tabs.getByRole("button", { name: "Queue", exact: true });
    await queue.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: "Queue", exact: true }),
    ).toBeFocused();
    await expect(page).toHaveURL("/issues");
    await expect(queue).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Report", exact: true }).click();
    const report = page.getByRole("dialog", { name: "Report for a team" });
    await expect(report).toBeVisible();
    await expect(
      report.getByRole("combobox", { name: "Affected team" }),
    ).toBeVisible();
    await report.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(report).toBeHidden();
    expect(await fitsWidth(page)).toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("organiser-queue-320.png"),
    fullPage: true,
  });
  await page.setViewportSize(desktop);
  await expect(uiRoot(page, "organiser-desktop")).toBeVisible();
  for (const label of ["Queue", "Assigned to me", "Handoffs", "Teams & tables"])
    await expect(consoleLink(page, label)).toBeVisible();
  for (const label of ["Award review", "Overview", "Accounts", "Session settings"])
    await expect(consoleLink(page, label)).toHaveCount(0);
  await expect(consoleLink(page, "Queue")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Issue queue" }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await signOut(page);
  await expect(uiRoot(page)).toHaveCount(0);
  await login(page, "admin", "organiser-desktop");
  for (const label of ["Queue", "Overview", "Accounts", "Session settings"])
    await expect(consoleLink(page, label)).toBeVisible();
  await consoleLink(page, "Accounts").click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Accounts", exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL("/administration/accounts");
  await expect(consoleLink(page, "Accounts")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.screenshot({
    path: testInfo.outputPath("console-accounts-desktop.png"),
    fullPage: true,
  });
  await consoleLink(page, "Queue").click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Accounts", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 1, name: "Issue queue" }),
  ).toBeVisible();
  await page.reload();
  await expect(consoleLink(page, "Queue")).toHaveAttribute(
    "aria-current",
    "page",
    { timeout: 15000 },
  );
  await expect(page).toHaveURL("/issues");
  await page.setViewportSize(phone);
  await expect(tabs.getByRole("button")).toHaveText([
    "Queue",
    "Find",
    "Session",
    "Me",
  ]);
});

test("queue and issue views show timers, handoffs and internal notes on desktop and phones", async ({
  page,
}, testInfo) => {
  const api = await account("volunteer");
  const state = fixture();
  const descriptions = [
    "Printer produces blank pages",
    "IDE settings reset on restart",
    "Unable to access the submission server",
    "Keyboard stops responding",
    "Compiler exits unexpectedly",
  ];
  const categories = [
    "Printing",
    "Environment",
    "Network",
    "Hardware",
    "Software",
  ];
  const configured = await service()
    .from("sessions")
    .update({
      categories: [
        ...categories,
        "Problem statement",
        "Devices",
        "Backend",
        "Other",
      ],
    })
    .eq("id", state.sessions[0]);
  expect(configured.error).toBeNull();
  let selected = "";
  for (let index = 0; index < descriptions.length; index++) {
    const submitted = await api.rpc("workflow", {
      p_session: state.sessions[0],
      p_request: crypto.randomUUID(),
      p_action: {
        type: "submit",
        team_id: state.teams[index % 2],
        category: categories[index],
        description: descriptions[index],
      },
    });
    expect(submitted.error).toBeNull();
    if (index === 2) selected = submitted.data;
    if (index !== 4) {
      const claim = await api.rpc("workflow", {
        p_session: state.sessions[0],
        p_request: crypto.randomUUID(),
        p_action: { type: "claim", issue_id: submitted.data, revision: 0 },
      });
      expect(claim.error).toBeNull();
    }
  }
  for (const [revision, action] of [
    [
      1,
      {
        type: "message",
        text: "Please keep working locally. We are checking the network at your desk.",
        visibility: "public",
      },
    ],
    [
      2,
      {
        type: "message",
        text: "Gateway reachable; submission endpoint times out. Requesting a network specialist.",
        visibility: "internal",
      },
    ],
    [2, { type: "escalate" }],
  ] as const) {
    const result = await api.rpc("workflow", {
      p_session: state.sessions[0],
      p_request: crypto.randomUUID(),
      p_action: { ...action, issue_id: selected, revision },
    });
    expect(result.error).toBeNull();
  }
  await page.setViewportSize({ width: 1505, height: 1045 });
  await login(page, "specialist", "organiser-desktop");
  await expect(issueRow(page, descriptions[2])).toBeVisible();
  await byId(page, `issue-row-${selected}`).click();
  const sheet = openDialog(page);
  await expect(
    sheet.getByRole("button", { name: "Accept handoff", exact: true }),
  ).toBeVisible();
  await expect(
    sheet.getByText(
      "Test volunteer stays responsible until a specialist accepts.",
    ),
  ).toBeVisible();
  await expect(sheet.getByText("after submission")).toBeVisible();
  await expect(
    sheet.getByRole("listitem").filter({ hasText: "Gateway reachable" }),
  ).toContainText("Internal note · staff only");
  await expect(
    sheet.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => document.fonts.ready);
  // The sheet slides in over the right side, so the queue stays in view.
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return box ? Math.round(box.x + box.width) : 0;
    })
    .toBe(1505);
  expect((await sheet.boundingBox())!.x).toBeGreaterThan(0);
  await page.screenshot({
    path: testInfo.outputPath("console-sheet-desktop.png"),
    fullPage: true,
  });
  await sheet.getByRole("button", { name: "Close issue", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(byId(page, `issue-row-${selected}`)).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await fitsWidth(page)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("console-queue-laptop.png"),
    fullPage: true,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(uiRoot(page, "organiser-phone")).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
    const card = byId(page, `issue-card-${selected}`);
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: /^ISS-\d+, / }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Accept handoff", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Internal note · staff only")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`organiser-issue-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(card).toBeFocused();
  }
});

test("real accounts share the journey on phones and desktop, internal notes stay private, and refresh keeps timers", async ({
  browser,
}, testInfo) => {
  const contestantContext = await browser.newContext({ viewport: desktop });
  const staffContext = await browser.newContext({ viewport: phone });
  const specialistContext = await browser.newContext({ viewport: phone });
  const juryContext = await browser.newContext({ viewport: desktop });
  const contestant = await contestantContext.newPage();
  const staff = await staffContext.newPage();
  const specialist = await specialistContext.newPage();
  const jury = await juryContext.newPage();
  const ids = fixture().accounts;
  try {
    await login(contestant, "contestant", "contestant");
    await login(staff, "volunteer", "organiser-phone");
    await login(specialist, "specialist", "organiser-phone");
    const description = `Browser journey ${crypto.randomUUID()}`;
    await contestant
      .getByRole("button", { name: "Report an issue", exact: true })
      .first()
      .click();
    await expect(
      contestant.getByRole("heading", { level: 1, name: "Report an issue" }),
    ).toBeFocused();
    await choose(
      contestant.getByRole("radio", { name: "Network", exact: true }),
    );
    await contestant.getByLabel("What is happening?").fill(description);
    await contestant
      .getByRole("button", { name: "Send report", exact: true })
      .click();
    await expect(
      contestant.getByRole("region", { name: "Your report" }),
    ).toContainText(description);
    const teamClient = await account("contestant");
    const submitted = await teamClient
      .from("issues")
      .select("id")
      .eq("description", description)
      .single();
    expect(submitted.error).toBeNull();
    const issueId = submitted.data!.id as string;
    const issueState = async () => {
      const result = await service()
        .from("issues")
        .select("status,owner,first_assigned_at")
        .eq("id", issueId)
        .single();
      if (result.error) throw result.error;
      return result.data;
    };

    // Volunteers and specialists in the hall open the report on phones.
    const staffCard = byId(staff, `issue-card-${issueId}`);
    await expect(staffCard).toBeVisible({ timeout: 7000 });
    await staffCard.click();
    await expect(
      staff.getByRole("heading", { level: 1, name: /^ISS-\d+, Aurora$/ }),
    ).toBeVisible();
    const specialistCard = byId(specialist, `issue-card-${issueId}`);
    await expect(specialistCard).toBeVisible({ timeout: 7000 });
    await specialistCard.click();
    await staff.getByRole("button", { name: "Claim", exact: true }).click();
    await expect(staff.getByText("You (Test volunteer)")).toBeVisible();
    await expect(staff.getByText("after submission")).toBeVisible();
    const claimed = await issueState();
    expect(claimed.owner).toBe(ids.volunteer.id);
    expect(claimed.first_assigned_at).not.toBeNull();

    const staffSheet = openDialog(staff);
    await staff.getByRole("button", { name: "Reply", exact: true }).click();
    await choose(
      staffSheet.getByRole("radio", { name: "Staff only", exact: true }),
    );
    await staffSheet
      .getByLabel("Internal note", { exact: true })
      .fill("Private diagnostic");
    await staffSheet
      .getByRole("button", { name: "Add internal note", exact: true })
      .click();
    await expect(staffSheet).toBeHidden();
    await expect(
      staff.getByText("Private diagnostic", { exact: true }),
    ).toBeVisible();
    await expect(
      specialist.getByText("Private diagnostic", { exact: true }),
    ).toBeVisible({ timeout: 7000 });
    const ownIssue = await teamClient
      .from("issues")
      .select("id,revision")
      .eq("description", description)
      .single();
    expect(ownIssue.data?.revision).toBe(1);
    expect(
      (
        await teamClient
          .from("history")
          .select("*")
          .eq("issue_id", ownIssue.data?.id)
          .eq("visibility", "internal")
      ).data,
    ).toEqual([]);
    expect((await teamClient.from("staff_changes").select("*")).data).toEqual(
      [],
    );

    await staff.getByRole("button", { name: "Reply", exact: true }).click();
    await choose(
      staffSheet.getByRole("radio", { name: "To the team", exact: true }),
    );
    await staffSheet
      .getByLabel("Message", { exact: true })
      .fill("Public update");
    await staffSheet
      .getByRole("button", { name: "Send to team", exact: true })
      .click();
    await expect(staffSheet).toBeHidden();
    await expect(
      contestant.getByText("Public update", { exact: true }),
    ).toBeVisible({ timeout: 7000 });
    await expect(
      contestant.getByText("Private diagnostic", { exact: true }),
    ).toHaveCount(0);
    const reports = await contestant
      .getByRole("complementary", { name: "Your reports" })
      .boundingBox();
    const details = await contestant
      .getByRole("region", { name: "Report details" })
      .boundingBox();
    expect(reports).not.toBeNull();
    expect(details).not.toBeNull();
    expect(reports!.x + reports!.width).toBeLessThanOrEqual(details!.x);
    // Enter sends a contestant reply. Shift+Enter would add a new line.
    const reply = contestant.getByLabel("Reply to staff", { exact: true });
    await reply.fill("The network light is off");
    await reply.press("Enter");
    await expect(reply).toHaveValue("");
    await expect(
      staff.getByText("The network light is off", { exact: true }),
    ).toBeVisible({ timeout: 7000 });
    await staff.screenshot({
      path: testInfo.outputPath("support-390.png"),
      fullPage: true,
    });

    await staff
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await staffSheet
      .getByRole("button", { name: /^Escalate to a specialist/ })
      .click();
    await staffSheet
      .getByRole("button", { name: "Escalate to specialist", exact: true })
      .click();
    await expect(staffSheet).toBeHidden();
    await expect(
      staff.getByText(
        "Test volunteer stays responsible until a specialist accepts.",
      ),
    ).toBeVisible();
    await expect(
      contestant.getByText(
        "Test volunteer stays responsible until a specialist takes over.",
      ),
    ).toBeVisible({ timeout: 7000 });
    // The owner stays responsible during the handoff.
    expect(await issueState()).toEqual({
      status: "escalated",
      owner: ids.volunteer.id,
      first_assigned_at: claimed.first_assigned_at,
    });
    await specialist
      .getByRole("button", { name: "Accept handoff", exact: true })
      .click();
    await expect(specialist.getByText("You (Test specialist)")).toBeVisible();
    // Acceptance changes the owner, not the first assignment.
    expect(await issueState()).toEqual({
      status: "claimed",
      owner: ids.specialist.id,
      first_assigned_at: claimed.first_assigned_at,
    });
    const specialistSheet = openDialog(specialist);
    await specialist
      .getByRole("button", { name: "Resolve", exact: true })
      .click();
    await specialistSheet
      .getByRole("radio", { name: "Service restored", exact: true })
      .check();
    await specialistSheet
      .getByRole("button", { name: "Resolve issue", exact: true })
      .click();
    await expect(specialistSheet).toBeHidden();
    await expect(
      contestant.getByText("Service restored", { exact: true }),
    ).toBeVisible({ timeout: 7000 });
    // The stopped timer comes from persisted timestamps, so a refresh
    // shows the same value.
    const stopped = contestant.getByText(/^\d{2,}:\d{2}, stopped$/);
    const before = await stopped.textContent();
    expect(before).not.toBe("00:00, stopped");
    await contestant.reload();
    await expect(uiRoot(contestant, "contestant")).toBeVisible({
      timeout: 15000,
    });
    await openReport(contestant, description);
    await expect(stopped).toHaveText(before!);

    // The jury decides on the desktop console.
    await login(jury, "jury", "organiser-desktop");
    await expect(
      jury.getByRole("heading", { level: 1, name: "Award review" }),
    ).toBeVisible();
    const decision = jury
      .getByRole("listitem")
      .filter({ has: byId(jury, `award-issue-${issueId}`) });
    await expect(decision).toContainText("Resolution: Service restored");
    await expect(
      decision.getByRole("button", { name: /^(Claim|Resolve|Reopen)/ }),
    ).toHaveCount(0);
    await choose(decision.getByRole("radio", { name: "0 min", exact: true }));
    await decision
      .getByLabel("Public award explanation")
      .fill("No extra time needed");
    await decision
      .getByRole("button", { name: "Record 0 minutes", exact: true })
      .click();
    await expect(
      contestant.getByRole("heading", { name: /^Time award ?, 0 minutes$/ }),
    ).toBeVisible({ timeout: 7000 });
    await expect(
      contestant.getByText("Not yet applied to your contest time"),
    ).toBeVisible();
    await jury.screenshot({
      path: testInfo.outputPath("award-review-desktop.png"),
      fullPage: true,
    });

    await contestant
      .getByRole("button", { name: "The problem is back? Reopen this issue" })
      .click();
    await contestant.getByLabel("What is still wrong?").fill("Still broken");
    await contestant
      .getByRole("button", { name: "Reopen issue", exact: true })
      .click();
    await expect(staff.getByText(/^Previous resolution ·/)).toBeVisible({
      timeout: 7000,
    });
    // Reopening keeps the prior owner and the pending award.
    expect((await issueState()).owner).toBe(ids.specialist.id);
    await expect(
      staff.getByText(
        "This decision relates to an earlier resolution. One award is allowed per issue.",
      ),
    ).toBeVisible();
    await staff
      .getByRole("button", { name: "Confirm applied", exact: true })
      .click();
    await staffSheet
      .getByRole("checkbox", { name: /I confirm this award was applied/ })
      .check();
    await staffSheet
      .getByRole("button", { name: "Confirm applied externally", exact: true })
      .click();
    await expect(staffSheet).toBeHidden();
    await expect(
      contestant.getByText(/^Applied to your contest time ·/),
    ).toBeVisible({ timeout: 7000 });
    await contestant.reload();
    await expect(uiRoot(contestant, "contestant")).toBeVisible({
      timeout: 15000,
    });
    await openReport(contestant, description);
    await expect(
      contestant.getByRole("heading", { name: /^Time award ?, 0 minutes$/ }),
    ).toBeVisible();
    await expect(
      contestant.getByRole("heading", { name: "Earlier resolutions" }),
    ).toBeVisible();
    await expect(
      contestant.getByText(
        "The jury decided this award for an earlier resolution.",
      ),
    ).toBeVisible();

    await specialist
      .getByRole("button", { name: "Resolve", exact: true })
      .click();
    await specialistSheet
      .getByRole("radio", { name: "Device issue resolved", exact: true })
      .check();
    await specialistSheet
      .getByRole("button", { name: "Resolve issue", exact: true })
      .click();
    await expect(specialistSheet).toBeHidden();
    await staff.getByRole("button", { name: "Reopen", exact: true }).click();
    await staffSheet
      .getByLabel("Public reopening reason")
      .fill("Helper found another failure");
    await staffSheet
      .getByRole("button", { name: "Reopen issue", exact: true })
      .click();
    await expect(staffSheet).toBeHidden();
    await expect(specialist.getByText(/^Previous resolution ·/)).toHaveCount(
      2,
      { timeout: 7000 },
    );
    await specialist
      .getByRole("button", { name: "Resolve", exact: true })
      .click();
    await specialistSheet
      .getByRole("radio", { name: "Problem statement clarified", exact: true })
      .check();
    await specialistSheet
      .getByRole("button", { name: "Resolve issue", exact: true })
      .click();
    await expect(
      contestant.getByText("Problem statement clarified", { exact: true }),
    ).toBeVisible({ timeout: 7000 });
    await contestant.reload();
    await expect(uiRoot(contestant, "contestant")).toBeVisible({
      timeout: 15000,
    });
    await openReport(contestant, description);
    await expect(
      contestant
        .getByRole("region", { name: "Earlier resolutions" })
        .getByRole("listitem"),
    ).toHaveCount(2);
    await expect(
      contestant.getByText(/^Applied to your contest time ·/),
    ).toBeVisible();

    await staff.setViewportSize({ width: 320, height: 740 });
    expect(await fitsWidth(staff)).toBe(true);
    await staff.goto("/");
    await expect(
      staff.getByRole("heading", { level: 1, name: "Queue", exact: true }),
    ).toBeFocused({ timeout: 15000 });
    const skipLink = staff.getByRole("link", { name: "Skip to main content" });
    // Route navigation focuses the heading. Reach the skip link by keyboard.
    for (let step = 0; step < 8; step++) {
      await staff.keyboard.press("Shift+Tab");
      if (await skipLink.evaluate((link) => link === document.activeElement)) break;
    }
    await expect(skipLink).toBeFocused();
    await staff.keyboard.press("Enter");
    await expect(staff.locator("#main")).toBeFocused();
    await expect(staff.getByRole("button", { name: "Reset demo" })).toHaveCount(
      0,
    );
    await expect(staff.getByLabel("Demo persona")).toHaveCount(0);
    await staff.screenshot({
      path: testInfo.outputPath("support-320.png"),
      fullPage: true,
    });
    await contestant.screenshot({
      path: testInfo.outputPath("contestant-desktop.png"),
      fullPage: true,
    });
  } catch (cause) {
    for (const [name, page] of [
      ["contestant", contestant],
      ["staff", staff],
      ["specialist", specialist],
      ["jury", jury],
    ] as const) {
      console.log(
        name,
        await page.getByRole("heading").allTextContents(),
        await page.getByRole("alert").allTextContents(),
      );
    }
    throw cause;
  } finally {
    await contestantContext.close();
    await staffContext.close();
    await specialistContext.close();
    await juryContext.close();
  }
});

test("cloud policies isolate teams/sessions and reject real competing claims/awards", async () => {
  const state = fixture();
  const contestant = await account("contestant");
  const helper = await account("volunteer");
  const specialist = await account("specialist");
  const jury = await account("jury");
  const combined = await account("combined");
  const other = await account("cedar");
  const isolated = await account("isolated");
  const { data: issue, error } = await contestant.rpc("workflow", {
    p_session: state.sessions[0],
    p_request: crypto.randomUUID(),
    p_action: {
      type: "submit",
      category: "Backend",
      description: "Race fixture",
    },
  });
  expect(error).toBeNull();
  const command = { type: "claim", issue_id: issue, revision: 0 };
  const claims = await Promise.all(
    [helper, specialist].map((c) =>
      c.rpc("workflow", {
        p_session: state.sessions[0],
        p_request: crypto.randomUUID(),
        p_action: command,
      }),
    ),
  );
  expect(claims.filter((r) => !r.error)).toHaveLength(1);
  const winner = claims[0].error ? specialist : helper;
  const { error: resolveError } = await winner.rpc("workflow", {
    p_session: state.sessions[0],
    p_request: crypto.randomUUID(),
    p_action: {
      type: "resolve",
      issue_id: issue,
      revision: 1,
      summary: "Fixed",
    },
  });
  expect(resolveError).toBeNull();
  const awards = await Promise.all(
    [jury, combined].map((c) =>
      c.rpc("workflow", {
        p_session: state.sessions[0],
        p_request: crypto.randomUUID(),
        p_action: {
          type: "award",
          issue_id: issue,
          revision: 2,
          minutes: 5,
          explanation: "Race award",
        },
      }),
    ),
  );
  expect(awards.filter((r) => !r.error)).toHaveLength(1);
  for (const c of [other, isolated]) {
    expect((await c.from("issues").select("*").eq("id", issue)).data).toEqual(
      [],
    );
    expect(
      (await c.from("history").select("*").eq("issue_id", issue)).data,
    ).toEqual([]);
    expect(
      (await c.from("awards").select("*").eq("issue_id", issue)).data,
    ).toEqual([]);
  }
  const publicClient = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  const anonymous = await publicClient.from("issues").select("*");
  expect(anonymous.error).not.toBeNull();
  expect(
    (
      await helper.rpc("set_intake", {
        p_session: state.sessions[0],
        p_open: false,
      })
    ).error,
  ).not.toBeNull();
  const deniedAdmin = await helper.functions.invoke("admin", {
    body: {
      action: "reset_password",
      session_id: state.sessions[0],
      user_id: state.accounts.contestant.id,
    },
  });
  expect(deniedAdmin.error).not.toBeNull();
  expect(deniedAdmin.error?.context.status).toBe(403);
});

test("admin intake and current membership revocation apply to existing sessions", async () => {
  const state = fixture();
  const admin = await account("admin");
  const combined = await account("combined");
  const contestant = await account("contestant");
  expect(
    (
      await admin.rpc("set_intake", {
        p_session: state.sessions[0],
        p_open: false,
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await contestant.rpc("workflow", {
        p_session: state.sessions[0],
        p_request: crypto.randomUUID(),
        p_action: {
          type: "submit",
          category: "Backend",
          description: "Closed",
        },
      })
    ).error,
  ).not.toBeNull();
  expect(
    (
      await combined.rpc("workflow", {
        p_session: state.sessions[0],
        p_request: crypto.randomUUID(),
        p_action: {
          type: "submit",
          team_id: state.teams[1],
          category: "Backend",
          description: "Staff bypass intake",
        },
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await admin.rpc("manage_member", {
        p_session: state.sessions[0],
        p_user: state.accounts.combined.id,
        p_remove: true,
      })
    ).error,
  ).toBeNull();
  expect((await combined.from("issues").select("*")).data).toEqual([]);
  expect(
    (
      await combined.rpc("workflow", {
        p_session: state.sessions[0],
        p_request: crypto.randomUUID(),
        p_action: {
          type: "submit",
          team_id: state.teams[1],
          category: "Backend",
          description: "Revoked",
        },
      })
    ).error,
  ).not.toBeNull();
  expect(
    (
      await admin.rpc("manage_member", {
        p_session: state.sessions[0],
        p_user: state.accounts.admin.id,
        p_remove: true,
      })
    ).error?.message,
  ).toContain("last admin");
});

test("admin assigns combined roles on the desktop console; password change, refresh and sign-out work on a phone", async ({
  page,
}, testInfo) => {
  await page.setViewportSize(desktop);
  await login(page, "admin", "organiser-desktop");
  await consoleLink(page, "Accounts").click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Accounts", exact: true }),
  ).toBeVisible();
  await page
    .getByText("Assign an existing account by ID", { exact: true })
    .click();
  await page.getByLabel("Auth user UUID").fill(fixture().accounts.combined.id);
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel("Auth user UUID") });
  for (const role of ["Volunteer", "Specialist", "Jury"])
    await choose(form.getByRole("checkbox", { name: role, exact: true }));
  await form
    .getByRole("button", { name: "Assign membership", exact: true })
    .click();
  const combined = page.getByRole("row").filter({ hasText: "Test combined" });
  for (const role of ["Volunteer", "Specialist", "Jury"])
    await expect(combined.getByText(role, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("admin-desktop.png") });
  await signOut(page);
  await page.setViewportSize(phone);
  await login(page, "volunteer", "organiser-phone");
  await phoneTab(page, "Me");
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Change your password" }),
  ).toBeVisible();
  const password = crypto.randomUUID() + "A9!";
  await page
    .getByLabel("Current password", { exact: true })
    .fill(fixture().accounts.volunteer.password);
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  const me = page.getByRole("heading", {
    level: 1,
    name: "Me",
    exact: true,
  });
  await expect(me).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL("/account");
  // Later cloud tests sign in through the same UUID-scoped fixture accounts.
  const state = fixture();
  state.accounts.volunteer.password = password;
  save(state);
  await page.reload();
  await expect(me).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL("/account");
  await phoneTab(page, "Queue");
  await expect(page).toHaveURL("/issues");
  const queue = page.getByRole("heading", {
    level: 1,
    name: "Queue",
    exact: true,
  });
  await expect(queue).toBeVisible();
  await signOut(page);
  await expect(queue).toHaveCount(0);
  await submitSignIn(page, fixture().accounts.volunteer.username, password);
  await expect(queue).toBeVisible({ timeout: 15000 });
});

test("organizer creates username accounts, mandatory changes and reset invalidate old access", async ({
  browser,
}, testInfo) => {
  const adminContext = await browser.newContext({ viewport: desktop });
  const teamContext = await browser.newContext({ viewport: desktop });
  const page = await adminContext.newPage();
  const team = await teamContext.newPage();
  try {
    await login(page, "admin", "organiser-desktop");
    await consoleLink(page, "Accounts").click();
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    const form = page.getByRole("dialog", { name: "Create account" });
    const username = `new-${crypto.randomUUID().slice(0, 12)}`;
    await choose(form.getByRole("radio", { name: /^Team/ }));
    await form.getByLabel("Contestant team").selectOption(fixture().teams[0]);
    await form
      .getByLabel("Display name", { exact: true })
      .fill("Provisioned team");
    await form.getByLabel("Username", { exact: true }).fill(username);
    await form
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    const credentials = page.getByRole("region", {
      name: "Temporary account credentials",
    });
    await expect(credentials).toBeVisible();
    const temporary = await credentials
      .getByLabel("Temporary password", {
        exact: true,
      })
      .inputValue();
    const state = fixture();
    const record = await service()
      .from("people")
      .select("id")
      .eq("username", username)
      .single();
    expect(record.error).toBeNull();
    const userId = record.data!.id;
    state.accounts.provisioned = {
      id: userId,
      username,
      email: `${username}@accounts.minsky.invalid`,
      password: temporary,
    };
    save(state);
    const api = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signed = await api.auth.signInWithPassword({
      email: state.accounts.provisioned.email,
      password: temporary,
    });
    expect(signed.error).toBeNull();
    expect((await api.from("sessions").select("*")).data).toEqual([]);
    expect((await api.rpc("complete_password_change")).error).not.toBeNull();
    await team.goto("/");
    await submitSignIn(team, username.toUpperCase(), temporary);
    await expect(
      team.getByRole("heading", { name: "Change your temporary password" }),
    ).toBeVisible();
    await expect(
      team.getByRole("button", { name: "Return to dashboard" }),
    ).toHaveCount(0);
    await team.reload();
    await expect(
      team.getByRole("heading", { name: "Change your temporary password" }),
    ).toBeVisible();
    const personal = crypto.randomUUID() + "A9!";
    await team.getByLabel("Current password", { exact: true }).fill(temporary);
    await team.getByLabel("New password", { exact: true }).fill(personal);
    await team.getByLabel("Confirm password", { exact: true }).fill(personal);
    await team
      .getByRole("button", { name: "Save password", exact: true })
      .click();
    await expect(uiRoot(team, "contestant")).toBeVisible({ timeout: 15000 });
    const old = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const oldLogin = await old.auth.signInWithPassword({
      email: state.accounts.provisioned.email,
      password: personal,
    });
    expect(oldLogin.error).toBeNull();
    await credentials.getByRole("button", { name: "Done", exact: true }).click();
    await expect(credentials).toBeHidden();
    await page
      .getByRole("button", { name: "Manage Provisioned team", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Provisioned team" })
      .getByRole("button", { name: "Reset password", exact: true })
      .click();
    // A confirmation dialog replaces the browser confirm prompt.
    await page
      .getByRole("dialog", { name: "Reset Provisioned team's password?" })
      .getByRole("button", { name: "Reset password", exact: true })
      .click();
    await expect(credentials).toBeVisible();
    const replacement = await credentials
      .getByLabel("Temporary password", {
        exact: true,
      })
      .inputValue();
    expect(replacement).not.toBe(temporary);
    expect((await old.from("sessions").select("*")).data).toEqual([]);
    expect(
      (await old.auth.updateUser({ password: crypto.randomUUID() + "A9!" }))
        .error,
    ).not.toBeNull();
    expect((await old.auth.refreshSession()).error).not.toBeNull();
    await team.reload();
    await expect(team.getByRole("heading", { name: /Sign in/ })).toBeVisible();
    if (
      await team.getByRole("button", { name: "Sign out", exact: true }).count()
    ) {
      await team.getByRole("button", { name: "Sign out", exact: true }).click();
    }
    await submitSignIn(team, username, replacement);
    await expect(
      team.getByRole("heading", { name: "Change your temporary password" }),
    ).toBeVisible();
    const final = crypto.randomUUID() + "A9!";
    await team
      .getByLabel("Current password", { exact: true })
      .fill(replacement);
    await team.getByLabel("New password", { exact: true }).fill(final);
    await team.getByLabel("Confirm password", { exact: true }).fill(final);
    await team
      .getByRole("button", { name: "Save password", exact: true })
      .click();
    await expect(uiRoot(team, "contestant")).toBeVisible({ timeout: 15000 });
    await credentials.getByRole("button", { name: "Done", exact: true }).click();
    await expect(credentials).toBeHidden();
    await page.screenshot({
      path: testInfo.outputPath("admin-redesign-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize(phone);
    await expect(uiRoot(page, "organiser-phone")).toBeVisible();
    await phoneTab(page, "Session");
    await expect(
      page.getByRole("button").filter({ hasText: "Provisioned team" }),
    ).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("admin-redesign-phone.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await fitsWidth(page)).toBe(true);
  } finally {
    await adminContext.close();
    await teamContext.close();
  }
});

test("existing email accounts adopt a username without losing identity or password", async ({page}) => {
  const state = fixture();
  const username = `legacy-${crypto.randomUUID().slice(0,12)}`;
  const email = `${username}@example.invalid`;
  const password = crypto.randomUUID()+"A9!";
  const created = await service().auth.admin.createUser({email,password,email_confirm:true,user_metadata:{name:"Legacy staff"}});
  expect(created.error).toBeNull();
  const id = created.data.user!.id;
  state.accounts.legacy = {id,email,password,username:""}; save(state);
  const assigned = await service().from("memberships").insert({session_id:state.sessions[0],user_id:id,roles:["volunteer"]});
  expect(assigned.error).toBeNull();
  await page.setViewportSize(desktop);
  await login(page,"admin","organiser-desktop");
  await consoleLink(page,"Accounts").click();
  await page.getByRole("button",{name:"Manage Legacy staff",exact:true}).click();
  const member = page.getByRole("dialog",{name:"Legacy staff"});
  await member.getByLabel("Assign username",{exact:true}).fill(username);
  await member.getByRole("button",{name:"Set username",exact:true}).click();
  await expect(member).toBeHidden();
  await expect(page.getByRole("row").filter({hasText:"Legacy staff"}).getByText(username,{exact:true})).toBeVisible();
  const updated = await service().from("people").select("id,username").eq("id",id).single();
  expect(updated.data).toEqual({id,username});
  const api = createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const signed = await api.auth.signInWithPassword({email:`${username}@accounts.minsky.invalid`,password});
  expect(signed.error).toBeNull();
  expect(signed.data.user?.id).toBe(id);
  expect((await api.from("memberships").select("*")).data?.[0]?.user_id).toBe(id);
  expect((await api.rpc("account_status")).data.must_change).toBe(false);
});

test("trusted provider recovery restores a locked-out sole admin without email", async () => {
  const state = fixture();
  const old = await account("admin");
  // Capture the private terminal output in memory; never print the temporary password.
  // The recovery script uses its linked project. Give this test its own link,
  // so an environment-selected CI run never queries the developer's project.
  const directory = await mkdtemp(join(tmpdir(), "minsky-recovery-test-"));
  let output: string;
  try {
    const link = join(directory, "supabase", ".temp");
    await mkdir(link, { recursive: true });
    await writeFile(
      join(link, "project-ref"),
      new URL(url).hostname.split(".")[0],
    );
    await symlink(
      resolve("node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    output = execFileSync(
      "node",
      [resolve("scripts/recover-admin.mjs"), "--user", state.accounts.admin.id],
      { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const temporary = output.trim().split("\n").at(-1)!;
  expect((await old.from("sessions").select("*")).data).toEqual([]);
  const restored = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await restored.auth.signInWithPassword({
    email: state.accounts.admin.email,
    password: temporary,
  });
  expect(login.error).toBeNull();
  expect(
    (await restored.rpc("is_session_admin", { p_session: state.sessions[0] }))
      .data,
  ).toBe(false);
  expect((await restored.rpc("complete_password_change")).error).not.toBeNull();
  const personal = crypto.randomUUID() + "A9!";
  expect(
    (
      await restored.auth.updateUser({
        password: personal,
        current_password: temporary,
      })
    ).error,
  ).toBeNull();
  expect((await restored.rpc("complete_password_change")).error).toBeNull();
  expect(
    (await restored.rpc("is_session_admin", { p_session: state.sessions[0] }))
      .data,
  ).toBe(true);
});

test("archived records allow queue navigation and disable writes", async ({
  page,
}) => {
  const event = fixture().event;
  const admin = service();
  const { data: original, error: readError } = await admin
    .from("events")
    .select("archived")
    .eq("id", event)
    .single();
  if (readError) throw readError;
  const { data: bypass, error: issueError } = await admin
    .from("issues")
    .select("id")
    .eq("session_id", fixture().sessions[0])
    .eq("description", "Staff bypass intake")
    .single();
  if (issueError) throw issueError;
  try {
    const { error } = await admin
      .from("events")
      .update({ archived: true })
      .eq("id", event);
    if (error) throw error;
    await page.setViewportSize(desktop);
    await login(page, "specialist", "organiser-desktop");
    await expect(
      page.getByText("This event is archived. Records are read only."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Report for a team", exact: true }),
    ).toBeDisabled();
    const open = page
      .getByRole("group", { name: "Filter by status" })
      .getByRole("button", { name: /^Open \d+$/ });
    await expect(open).toBeEnabled();
    await open.click();
    await expect(open).toHaveAttribute("aria-pressed", "true");
    await byId(page, `issue-row-${bypass.id}`).click();
    const sheet = openDialog(page);
    await expect(
      sheet.getByRole("heading", { name: /Staff bypass intake$/ }),
    ).toBeVisible();
    await expect(
      sheet.getByText("This event is archived. Records are read only."),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", {
        name: /^(Claim|Accept handoff|Resolve|Reopen|Add image)$/,
      }),
    ).toHaveCount(0);
    await expect(sheet.getByRole("textbox")).toHaveCount(0);
    // The phone app keeps the open issue from the shared workflow state.
    await page.setViewportSize({ width: 320, height: 740 });
    await expect(uiRoot(page, "organiser-phone")).toBeVisible();
    await expect(
      page.getByText("This event is archived.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^(Claim|Reply|More actions)$/ }),
    ).toHaveCount(0);
    const back = page.getByRole("button", { name: "Back", exact: true });
    await expect(back).toBeEnabled();
    await back.click();
    await expect(byId(page, `issue-card-${bypass.id}`)).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Report", exact: true }),
    ).toBeDisabled();
    await expect(liveBadge(page)).toBeVisible();
  } finally {
    // Do not leave later tests with a read-only fixture, even on assertion failure.
    const { error } = await admin
      .from("events")
      .update({ archived: original.archived })
      .eq("id", event);
    expect(error, "Restore the fixture event's archive state").toBeNull();
  }
});
