import { test, expect, type Page } from "@playwright/test";
import { account, fixture, anonKey, url, service } from "./fixture";
import { createClient } from "@supabase/supabase-js";

async function login(page: Page, name: string) {
  const details = fixture().accounts[name];
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(details.email);
  await page.getByLabel("Password", { exact: true }).fill(details.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name:
        name === "contestant"
          ? "A little help, right here."
          : "Keep the contest moving.",
    }),
  ).toBeVisible();
}
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
    await staff.getByLabel("Message visibility").selectOption("internal");
    await staff
      .getByLabel("Message", { exact: true })
      .fill("Private diagnostic");
    await staff.getByRole("button", { name: "Send message" }).click();
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

    await staff.getByLabel("Message visibility").selectOption("public");
    await staff.getByLabel("Message", { exact: true }).fill("Public update");
    await staff.getByRole("button", { name: "Send message" }).click();
    await expect(
      contestant.getByText("Public update", { exact: true }),
    ).toBeVisible({ timeout: 7000 });
    await expect(
      contestant.getByText("Private diagnostic", { exact: true }),
    ).toHaveCount(0);
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
    await specialist.getByLabel("Email", { exact: true }).fill(details.email);
    await specialist
      .getByLabel("Password", { exact: true })
      .fill(details.password);
    await specialist
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(
      specialist.getByRole("heading", { name: "Review. Decide. Record." }),
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
      staff.getByRole("heading", { name: "Keep the contest moving." }),
    ).toBeVisible();
    await staff.keyboard.press("Tab");
    await expect(
      staff.getByRole("link", { name: "Skip to main content" }),
    ).toBeFocused();
    await staff.keyboard.press("Enter");
    await expect(staff.locator("#main")).toBeFocused();
    await expect(staff.getByRole("button", { name: "Reset demo" })).toHaveCount(
      0,
    );
    await expect(staff.getByLabel("Demo persona")).toHaveCount(0);
    await staff.screenshot({ path: testInfo.outputPath("support-320.png") });
    await contestant.screenshot({
      path: testInfo.outputPath("contestant-desktop.png"),
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
      action: "recovery",
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
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  const password = crypto.randomUUID() + "A9!";
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Keep the contest moving." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Keep the contest moving." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to Minsky" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Support queue" }),
  ).toHaveCount(0);
  await page
    .getByLabel("Email", { exact: true })
    .fill(fixture().accounts.volunteer.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Keep the contest moving." }),
  ).toBeVisible();
});

test("archived records allow queue navigation and disable writes", async ({
  page,
}) => {
  const { error } = await service()
    .from("events")
    .update({ archived: true })
    .eq("id", fixture().event);
  expect(error).toBeNull();
  await login(page, "specialist");
  await expect(
    page.getByText("This event is archived. Records are read only."),
  ).toBeVisible();
  const filter = page.getByRole("combobox", {
    name: "Status filter",
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
    page.getByRole("button", { name: "Submit issue", exact: true }),
  ).toBeDisabled();
});
