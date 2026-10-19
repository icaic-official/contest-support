import { test, expect, type Page } from "@playwright/test";
import { account, fixture, anonKey, url, service, save } from "./fixture";
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

async function login(page: Page, name: string) {
  const details = fixture().accounts[name];
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(details.username);
  await page.getByLabel("Password", { exact: true }).fill(details.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: name === "contestant" ? "My team’s issues" : "Issue Queue",
    }),
  ).toBeVisible();
  if (name === "admin") {
    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("link", { name: "Administration", exact: true })
      .click();
  }
}

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

test("sidebar navigation respects roles and remains usable by keyboard on phones", async ({
  page,
}, testInfo) => {
  await login(page, "volunteer");
  const navigation = page.getByRole("navigation", {
    name: "Workspace navigation",
  });
  await expect(
    navigation.getByRole("link", { name: "Administration", exact: true }),
  ).toHaveCount(0);
  await navigation
    .getByRole("link", { name: "My account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My account", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".account-details")).toContainText(
    fixture().accounts.volunteer.username,
  );
  await expect(
    navigation.getByRole("link", { name: "My account", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Report an issue" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("sidebar-account-desktop.png"),
    fullPage: true,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(navigation).toBeHidden();
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const issues = navigation.getByRole("link", {
      name: "Issues",
      exact: true,
    });
    await issues.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Issue Queue" }),
    ).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await page
      .getByRole("button", { name: "Report for team", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Report an issue" }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Cancel report", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("sidebar-support-320.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(navigation).toHaveCount(0);
  await login(page, "admin");
  await expect(
    navigation.getByRole("link", { name: "Administration", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Session administration" }),
  ).toBeVisible();
  await navigation.getByRole("link", { name: "Issues", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Session administration" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Issue Queue" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    navigation.getByRole("link", { name: "Issues", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("queue and activity match the reference layout and adapt to phone widths", async ({
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
  await login(page, "specialist");
  await page
    .locator(".issue-card")
    .filter({ hasText: descriptions[2] })
    .click();
  await expect(
    page.getByRole("button", { name: "Accept handoff", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".internal-event")).toContainText(
    "Gateway reachable",
  );
  await expect(page.getByRole("button", {name: "Send reply", exact: true})).toBeDisabled();
  await expect(page.locator(".connection-status")).toContainText("Live");
  await page.evaluate(() => document.fonts.ready);
  const queue = await page.locator(".queue").boundingBox();
  const detail = await page.locator(".detail").boundingBox();
  expect(queue!.x + queue!.width).toBeLessThanOrEqual(detail!.x);
  await page.screenshot({
    path: testInfo.outputPath("workspace-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("workspace-laptop.png"),
    fullPage: true,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const row = page
      .locator(".issue-card")
      .filter({ hasText: descriptions[2] });
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#issue-heading")).toBeFocused();
    await page.getByRole("button", {name: "Back to queue", exact: true}).click();
    await expect(page.locator("#workspace-heading")).toBeFocused();
    await row.click();
    await expect(
      page.getByRole("button", { name: "Accept handoff", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`workspace-${width}.png`),
      fullPage: true,
    });
  }
});

test("real accounts share the journey, private notes stay private, and phone/refresh/keyboard work", async ({
  browser,
}, testInfo) => {
  const contestantContext = await browser.newContext();
  const staffContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const specialistContext = await browser.newContext();
  const contestant = await contestantContext.newPage();
  const staff = await staffContext.newPage();
  const specialist = await specialistContext.newPage();
  try {
    await login(contestant, "contestant");
    await login(staff, "volunteer");
    await login(specialist, "specialist");
    const description = `Browser journey ${crypto.randomUUID()}`;
    await contestant
      .getByRole("button", { name: "Report an issue", exact: true })
      .click();
    await contestant.getByLabel("What’s happening?").fill(description);
    await contestant
      .getByRole("button", { name: "Submit issue", exact: true })
      .click();
    await expect(
      staff.getByRole("button").filter({ hasText: description }),
    ).toBeVisible({ timeout: 7000 });
    await staff.getByRole("button").filter({ hasText: description }).click();
    await expect(
      specialist.getByRole("button").filter({ hasText: description }),
    ).toBeVisible({ timeout: 7000 });
    await specialist
      .getByRole("button")
      .filter({ hasText: description })
      .click();
    await staff
      .getByRole("button", { name: "Claim issue", exact: true })
      .click();
    await staff.getByLabel("Audience").selectOption("internal");
    await staff
      .getByLabel("Message", { exact: true })
      .fill("Private diagnostic");
    await staff.getByRole("button", { name: "Send reply" }).click();
    await expect(
      staff.getByText("Private diagnostic", { exact: true }),
    ).toBeVisible();
    await expect(
      specialist.getByText("Private diagnostic", { exact: true }),
    ).toBeVisible({ timeout: 7000 });
    const teamClient = await account("contestant");
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

    await staff.getByLabel("Audience").selectOption("public");
    await staff.getByLabel("Message", { exact: true }).fill("Public update");
    await staff.getByRole("button", { name: "Send reply" }).click();
    await expect(
      contestant.getByText("Public update", { exact: true }),
    ).toBeVisible({ timeout: 7000 });
    await expect(
      contestant.getByText("Private diagnostic", { exact: true }),
    ).toHaveCount(0);
    const queue = await contestant.locator(".queue").boundingBox();
    const detail = await contestant.locator(".detail").boundingBox();
    expect(queue).not.toBeNull();
    expect(detail).not.toBeNull();
    expect(queue!.x + queue!.width).toBeLessThanOrEqual(detail!.x);
    await staff.screenshot({
      path: testInfo.outputPath("support-390.png"),
      fullPage: true,
    });
    await staff.getByRole("button", { name: "Escalate to specialist" }).click();
    await expect(
      staff.getByText(/Test volunteer remains responsible/),
    ).toBeVisible();
    await specialist
      .getByRole("button")
      .filter({ hasText: description })
      .click();
    await specialist.getByRole("button", { name: "Accept handoff" }).click();
    await specialist
      .getByLabel("Resolution summary · visible to the team")
      .selectOption("Service restored");
    await specialist
      .getByRole("button", { name: "Resolve issue", exact: true })
      .click();
    await expect(
      contestant.getByText("Service restored", { exact: true }),
    ).toBeVisible({ timeout: 7000 });
    await specialist
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    const details = fixture().accounts.jury;
    await specialist
      .getByLabel("Username", { exact: true })
      .fill(details.username);
    await specialist
      .getByLabel("Password", { exact: true })
      .fill(details.password);
    await specialist
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(
      specialist.getByRole("heading", { name: "Award review" }),
    ).toBeVisible();
    await specialist
      .getByRole("combobox", { name: "Award minutes", exact: true })
      .selectOption("0");
    await specialist
      .getByLabel("Public award explanation")
      .fill("No extra time needed");
    await specialist.getByRole("button", { name: "Record award" }).click();
    await expect(
      contestant.getByText("0 minutes awarded", { exact: true }),
    ).toBeVisible({ timeout: 7000 });
    await contestant.getByLabel("Public reopening reason").fill("Still broken");
    await contestant
      .getByRole("button", { name: "Reopen issue", exact: true })
      .click();
    await expect(
      staff.getByRole("heading", { name: "Previous resolution", exact: true }),
    ).toBeVisible({ timeout: 7000 });
    await staff.getByRole("checkbox").check();
    await staff
      .getByRole("button", { name: "Confirm applied externally" })
      .click();
    await expect(
      contestant.getByText("Applied externally", { exact: true }),
    ).toBeVisible({ timeout: 7000 });
    await contestant.reload();
    await expect(
      contestant.getByText("0 minutes awarded", { exact: true }),
    ).toBeVisible();
    await expect(
      contestant.getByText("Previous resolution", { exact: true }),
    ).toBeVisible();
    await specialist
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await login(specialist, "specialist");
    await specialist
      .getByRole("button")
      .filter({ hasText: description })
      .click();
    await specialist
      .getByLabel("Resolution summary · visible to the team")
      .selectOption("Device issue resolved");
    await specialist
      .getByRole("button", { name: "Resolve issue", exact: true })
      .click();
    await staff
      .getByLabel("Public reopening reason")
      .fill("Helper found another failure");
    await staff
      .getByRole("button", { name: "Reopen issue", exact: true })
      .click();
    await expect(
      specialist.getByRole("heading", {
        name: "Previous resolution",
        exact: true,
      }),
    ).toHaveCount(2, { timeout: 7000 });
    await specialist
      .getByLabel("Resolution summary · visible to the team")
      .selectOption("Problem statement clarified");
    await specialist
      .getByRole("button", { name: "Resolve issue", exact: true })
      .click();
    await expect(
      contestant.getByText("Problem statement clarified", { exact: true }),
    ).toBeVisible({ timeout: 7000 });
    await contestant.reload();
    await expect(
      contestant.getByRole("heading", {
        name: "Previous resolution",
        exact: true,
      }),
    ).toHaveCount(2);
    await expect(
      contestant.getByText("Applied externally", { exact: true }),
    ).toBeVisible();
    await staff.setViewportSize({ width: 320, height: 740 });
    expect(
      await staff.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await staff.goto("/");
    await expect(
      staff.getByRole("heading", { name: "Issue Queue" }),
    ).toBeFocused();
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

test("admin UI assigns combined roles; password change, refresh and logout work", async ({
  page,
}, testInfo) => {
  await login(page, "admin");
  await expect(
    page.getByRole("heading", { name: "Session administration" }),
  ).toBeVisible();
  await page
    .getByText("Assign an existing account by ID", { exact: true })
    .click();
  await page.getByLabel("Auth user UUID").fill(fixture().accounts.combined.id);
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel("Auth user UUID") });
  for (const role of ["volunteer", "specialist", "jury"])
    await form.getByRole("checkbox", { name: role, exact: true }).check();
  await form
    .getByRole("button", { name: "Assign membership", exact: true })
    .click();
  await expect(
    page.locator("summary").filter({ hasText: "Test combined" }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("admin-desktop.png") });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "volunteer");
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("link", { name: "My account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  const password = crypto.randomUUID() + "A9!";
  await page
    .getByLabel("Current password", { exact: true })
    .fill(fixture().accounts.volunteer.password);
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My account", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL("/account");
  // Later cloud tests sign in through the same UUID-scoped fixture accounts.
  const state = fixture();
  state.accounts.volunteer.password = password;
  save(state);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "My account", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL("/account");
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("link", { name: "Issues", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Issue Queue" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Issue Queue" })).toHaveCount(
    0,
  );
  await page
    .getByLabel("Username", { exact: true })
    .fill(fixture().accounts.volunteer.username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Issue Queue" }),
  ).toBeVisible();
});

test("organizer creates username accounts, mandatory changes and reset invalidate old access", async ({
  browser,
}, testInfo) => {
  const adminContext = await browser.newContext();
  const teamContext = await browser.newContext();
  const page = await adminContext.newPage();
  const team = await teamContext.newPage();
  try {
    await login(page, "admin");
    const form = page.locator("form").filter({
      has: page.getByRole("button", { name: "Create account", exact: true }),
    });
    const username = `new-${crypto.randomUUID().slice(0, 12)}`;
    await form
      .getByLabel("Display name", { exact: true })
      .fill("Provisioned team");
    await form.getByLabel("Username", { exact: true }).fill(username);
    await form.getByLabel("Contestant team").selectOption(fixture().teams[0]);
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
    await team
      .getByLabel("Username", { exact: true })
      .fill(username.toUpperCase());
    await team.getByLabel("Password", { exact: true }).fill(temporary);
    await team.getByRole("button", { name: "Sign in", exact: true }).click();
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
    await expect(
      team.getByRole("heading", { name: "My team’s issues" }),
    ).toBeVisible();
    const old = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const oldLogin = await old.auth.signInWithPassword({
      email: state.accounts.provisioned.email,
      password: personal,
    });
    expect(oldLogin.error).toBeNull();
    await page.getByRole("button", { name: "Dismiss credentials" }).click();
    const member = page.locator("details").filter({
      has: page.locator("summary").filter({ hasText: "Provisioned team" }),
    });
    await member.locator("summary").click();
    page.once("dialog", (dialog) => dialog.accept());
    await member
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
    await team.getByLabel("Username", { exact: true }).fill(username);
    await team.getByLabel("Password", { exact: true }).fill(replacement);
    await team.getByRole("button", { name: "Sign in", exact: true }).click();
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
    await expect(
      team.getByRole("heading", { name: "My team’s issues" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Dismiss credentials" }).click();
    await page.screenshot({
      path: testInfo.outputPath("admin-redesign-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("admin-redesign-phone.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
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
  await login(page,"admin");
  const member = page.locator("details").filter({has:page.locator("summary").filter({hasText:"Legacy staff"})});
  await member.locator("summary").click();
  await member.getByLabel("Assign username",{exact:true}).fill(username);
  await member.getByRole("button",{name:"Set username",exact:true}).click();
  await expect(member.getByText(username,{exact:true})).toBeVisible();
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
  try {
    const { error } = await admin
      .from("events")
      .update({ archived: true })
      .eq("id", event);
    if (error) throw error;
    await login(page, "specialist");
    await expect(
      page.getByText("This event is archived. Records are read only."),
    ).toBeVisible();
    const filter = page.getByRole("combobox", {
      name: "Status",
      exact: true,
    });
    await expect(filter).toBeEnabled();
    await filter.selectOption("open");
    await page
      .getByRole("button")
      .filter({ hasText: "Staff bypass intake" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Staff bypass intake", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Claim issue", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Report for team", exact: true }),
    ).toBeDisabled();
    await page.setViewportSize({width: 320, height: 740});
    const back = page.getByRole("button", {name: "Back to queue", exact: true});
    await expect(back).toBeEnabled();
    await back.click();
    await expect(page.locator("#workspace-heading")).toBeFocused();
  } finally {
    // Do not leave later tests with a read-only fixture, even on assertion failure.
    const { error } = await admin
      .from("events")
      .update({ archived: original.archived })
      .eq("id", event);
    expect(error, "Restore the fixture event's archive state").toBeNull();
  }
});
