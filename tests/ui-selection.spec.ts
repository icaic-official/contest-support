import { expect, test, type Page } from "@playwright/test";
import { emptyAnnouncementSnapshot } from "./support/announcementSnapshot";
import type { Membership, Snapshot } from "../src/connected/model";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000100";
const TEAM_ID = "00000000-0000-4000-8000-000000000200";

/** Signs in with isolated Auth and database responses for one membership. */
async function signIn(
  page: Page,
  membership: Membership | null,
  startPath = "/",
) {
  const state: Snapshot = {
    session: {
      id: SESSION_ID,
      event_id: "00000000-0000-4000-8000-000000000090",
      name: "Selection session",
      intake_open: true,
      categories: ["Network"],
      revision: 0,
      max_image_bytes: 10 * 1024 * 1024,
      max_images_per_issue: 20,
      max_image_bytes_per_issue: 120 * 1024 * 1024,
    },
    event: {
      id: "00000000-0000-4000-8000-000000000090",
      name: "Selection event",
      archived: false,
    },
    membership,
    teams: [
      {
        id: TEAM_ID,
        session_id: SESSION_ID,
        name: "Aurora",
        location: "Desk 12",
      },
    ],
    issues: [],
    resolutions: [],
    history: [],
    attachments: [],
    pending_removals: [],
    awards: [],
    audit: [],
    members: [],
    server_time: "2026-10-17T00:00:00Z",
  };
  const user = {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "selection@accounts.minsky.invalid",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: state.server_time,
  };
  await page.routeWebSocket(/supabase\.co/, (socket) => socket.close());
  await page.route("https://example.supabase.co/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const responses: Record<string, unknown> = {
      "/auth/v1/token": {
        access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
          sub: USER_ID,
          exp: expires,
          role: "authenticated",
        })}.fixture`,
        refresh_token: "selection-fixture",
        expires_in: 3600,
        expires_at: expires,
        token_type: "bearer",
        user,
      },
      "/auth/v1/user": user,
      "/rest/v1/rpc/account_status": {
        username: "selection",
        must_change: false,
        session_valid: true,
      },
      "/rest/v1/rpc/complete_password_change": null,
      "/rest/v1/memberships": membership ? [membership] : [],
      "/rest/v1/sessions": membership
        ? [{ id: SESSION_ID, name: "Selection session" }]
        : [],
      "/rest/v1/rpc/session_snapshot": state,
      "/rest/v1/rpc/announcement_snapshot": emptyAnnouncementSnapshot(),
    };
    if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responses[path]),
    });
  });
  await page.goto(startPath);
  await expect(page).toHaveURL(startPath);
  await page.getByLabel("Username", { exact: true }).fill("selection");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

const staff: Membership = {
  session_id: SESSION_ID,
  user_id: USER_ID,
  team_id: null,
  roles: ["jury"],
  is_admin: false,
};

test("a team membership gets the contestant UI", async ({ page }) => {
  await signIn(page, { ...staff, roles: [], team_id: TEAM_ID });
  await expect(page.locator('[data-ui="contestant"]')).toBeVisible();
});

test("a staff membership gets the organiser console on a laptop and the phone app on a phone", async ({
  page,
}) => {
  await signIn(page, staff);
  await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-ui="organiser-phone"]')).toBeVisible();
});

test("an account without a membership sees the session access screen", async ({
  page,
}) => {
  await signIn(page, null);
  await expect(
    page.getByRole("heading", { name: "Session access", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-ui]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh access", exact: true }),
  ).toBeVisible();
});

test("the desktop account menu moves focus to the account heading", async ({
  page,
}) => {
  await signIn(page, { ...staff, roles: ["volunteer"] });
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitem", { name: "My account", exact: true }).click();
  await expect(page).toHaveURL("/account");
  await expect(
    page.getByRole("heading", { name: "My account", exact: true }),
  ).toBeFocused();
});

for (const [path, heading, membership] of [
  ["/administration", "Overview", { ...staff, is_admin: true }],
  ["/administration/accounts", "Accounts", { ...staff, is_admin: true }],
  [
    "/administration/settings",
    "Session settings",
    { ...staff, is_admin: true },
  ],
  ["/jury", "Award review", staff],
] as const) {
  test(`a direct ${path} link survives sign-in and reload`, async ({
    page,
  }) => {
    await signIn(page, membership, path);
    await expect(
      page.getByRole("heading", { level: 1, name: heading, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(path);
    const response = await page.reload();
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: heading, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(path);
  });
}

test("browser history restores the section and heading focus", async ({
  page,
}) => {
  await signIn(page, {
    ...staff,
    roles: ["volunteer", "jury"],
    is_admin: true,
  });
  const pages = page.getByRole("navigation", { name: "Console pages" });
  await pages.getByRole("button", { name: /^Award review/ }).click();
  await expect(page).toHaveURL("/jury");
  await expect(
    page.getByRole("heading", { level: 1, name: "Award review", exact: true }),
  ).toBeFocused();
  await pages.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page).toHaveURL("/administration/accounts");
  await page.goBack();
  await expect(page).toHaveURL("/jury");
  await expect(
    page.getByRole("heading", { level: 1, name: "Award review", exact: true }),
  ).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL("/issues");
  await expect(
    page.getByRole("heading", { level: 1, name: "Issue queue", exact: true }),
  ).toBeFocused();
  await page.goForward();
  await expect(page).toHaveURL("/jury");
  await expect(
    page.getByRole("heading", { level: 1, name: "Award review", exact: true }),
  ).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Awards", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL("/jury");
  await page
    .getByRole("navigation", { name: "Organiser sections" })
    .getByRole("button", { name: "Me", exact: true })
    .click();
  await expect(page).toHaveURL("/account");
  await expect(
    page.getByRole("heading", { level: 1, name: "Me", exact: true }),
  ).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL("/jury");
  await expect(
    page.getByRole("heading", { level: 1, name: "Awards", exact: true }),
  ).toBeFocused();
});

test("protected links return an unauthorized member to their issue queue", async ({
  page,
}) => {
  await signIn(page, { ...staff, roles: ["volunteer"] }, "/administration");
  await expect(page).toHaveURL("/issues");
  const queue = page.getByRole("heading", {
    level: 1,
    name: "Issue queue",
    exact: true,
  });
  await expect(queue).toBeVisible();
  for (const path of [
    "/administration/accounts",
    "/administration/settings",
    "/jury",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL("/issues");
    await expect(queue).toBeVisible();
  }
  await expect(
    page
      .getByRole("navigation", { name: "Console pages" })
      .getByRole("button", {
        name: /^(Award review|Overview|Accounts|Session settings)$/,
      }),
  ).toHaveCount(0);
});

test("an unknown route retains its address and offers a route back to issues", async ({
  page,
}) => {
  await signIn(page, { ...staff, roles: ["volunteer"] }, "/unknown-page");
  await expect(
    page.getByRole("heading", { name: "Page not found", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL("/unknown-page");
  await page.getByRole("link", { name: "Issues", exact: true }).click();
  await expect(page).toHaveURL("/issues");
  await expect(
    page.getByRole("heading", { level: 1, name: "Issue queue", exact: true }),
  ).toBeVisible();
});

test("optional password changes and cancellation retain the account route", async ({
  page,
}) => {
  await signIn(page, staff, "/account");
  const account = page.getByRole("heading", {
    level: 1,
    name: "My account",
    exact: true,
  });
  await expect(account).toBeVisible();
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Change your password", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL("/account");
  await page
    .getByRole("button", { name: "Return to dashboard", exact: true })
    .click();
  await expect(account).toBeVisible();
  await expect(page).toHaveURL("/account");

  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await page
    .getByLabel("Current password", { exact: true })
    .fill("fixture-password");
  await page
    .getByLabel("New password", { exact: true })
    .fill("replacement-password");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("replacement-password");
  await page
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  await expect(account).toBeVisible();
  await expect(page).toHaveURL("/account");
  await page.reload();
  await expect(account).toBeVisible();
  await expect(page).toHaveURL("/account");
});
