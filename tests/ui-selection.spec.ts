import type { Page } from "@playwright/test";
import type { Membership } from "../src/connected/model";
import {
  type FakeWorker,
  SESSION_ID,
  TEAM_ID,
  USER_ID,
  expect,
  fixtureAccount,
  sessionSnapshot,
  test,
} from "./support/worker";

/** Signs in with an isolated Worker fixture for one membership. */
async function signIn(
  page: Page,
  api: FakeWorker,
  membership: Membership | null,
  startPath = "/",
) {
  api.account = fixtureAccount(USER_ID, "selection", "Selection fixture");
  api.snapshots = () => [
    sessionSnapshot(membership, {
      session: { name: "Selection session" },
      event: { id: "00000000-0000-4000-8000-000000000090", name: "Selection event", archived: false },
    }),
  ];
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

test("a team membership gets the contestant UI", async ({ page, api }) => {
  await signIn(page, api, { ...staff, roles: [], team_id: TEAM_ID });
  await expect(page.locator('[data-ui="contestant"]')).toBeVisible();
});

test("a staff membership gets the organiser console on a laptop and the phone app on a phone", async ({
  page,
  api,
}) => {
  await signIn(page, api, staff);
  await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-ui="organiser-phone"]')).toBeVisible();
});

test("an account without a membership sees the session access screen", async ({
  page,
  api,
}) => {
  await signIn(page, api, null);
  await expect(
    page.getByRole("heading", { name: "Session access", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-ui]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh access", exact: true }),
  ).toBeVisible();
});

test("the sidebar account card opens the account page and focuses its heading", async ({
  page,
  api,
}) => {
  await signIn(page, api, { ...staff, roles: ["volunteer"] });
  const card = page.getByRole("button", { name: /^Account settings for/ });
  await expect(card).not.toHaveAttribute("aria-current", "page");
  await card.click();
  await expect(page).toHaveURL("/account");
  await expect(
    page.getByRole("heading", { name: "My account", exact: true }),
  ).toBeFocused();
  await expect(card).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

for (const [path, heading, membership] of [
  ["/administration", "Overview", { ...staff, is_admin: true }],
  ["/administration/accounts", "Accounts", { ...staff, is_admin: true }],
  ["/administration/roster", "Roster", { ...staff, is_admin: true }],
  [
    "/administration/settings",
    "Session settings",
    { ...staff, is_admin: true },
  ],
  ["/jury", "Award review", staff],
] as const) {
  test(`a direct ${path} link survives sign-in and reload`, async ({
    page,
    api,
  }) => {
    await signIn(page, api, membership, path);
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
  api,
}) => {
  await signIn(page, api, {
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
  api,
}) => {
  await signIn(page, api, { ...staff, roles: ["volunteer"] }, "/administration");
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
        name: /^(Award review|Overview|Accounts|Roster|Session settings)$/,
      }),
  ).toHaveCount(0);
});

test("an unknown route retains its address and offers a route back to issues", async ({
  page,
  api,
}) => {
  await signIn(page, api, { ...staff, roles: ["volunteer"] }, "/unknown-page");
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

test("the account page changes the password in place and keeps the route", async ({
  page,
  api,
}) => {
  await signIn(page, api, staff, "/account");
  const heading = page.getByRole("heading", {
    level: 1,
    name: "My account",
    exact: true,
  });
  await expect(heading).toBeVisible();
  const current = page.getByLabel("Current password", { exact: true });
  const next = page.getByLabel("New password", { exact: true });
  const confirm = page.getByLabel("Confirm password", { exact: true });
  const save = page.getByRole("button", { name: "Save password", exact: true });

  await current.fill("fixture-password");
  await next.fill("replacement-password");
  await confirm.fill("another-password");
  await save.click();
  await expect(page.getByText("Passwords must match.")).toBeVisible();
  await expect(current).toHaveValue("fixture-password");

  await confirm.fill("replacement-password");
  await save.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your password was changed." }),
  ).toBeVisible();
  for (const field of [current, next, confirm]) await expect(field).toHaveValue("");
  await expect(page.getByText("Passwords must match.")).toHaveCount(0);
  await expect(page).toHaveURL("/account");
  await expect(heading).toBeVisible();

  await page.reload();
  await expect(heading).toBeVisible();
  await expect(page).toHaveURL("/account");
});

test("the organiser account page shows every section and signs out", async ({
  page,
  api,
}) => {
  await signIn(page, api, { ...staff, roles: ["volunteer", "jury"], is_admin: true }, "/account");
  await expect(
    page.getByRole("heading", { level: 1, name: "My account", exact: true }),
  ).toBeVisible();
  for (const title of [
    "Profile",
    "Access in this session",
    "Sessions",
    "Security",
    "Appearance",
    "Activity",
    "Help",
  ]) {
    await expect(
      page.getByRole("heading", { level: 2, name: title, exact: true }),
    ).toBeVisible();
  }
  const sections = page.getByRole("navigation", { name: "Account sections" });
  await expect(sections.getByRole("link")).toHaveCount(7);
  const access = page.locator("#access");
  for (const role of ["Volunteer", "Jury", "Session admin"]) {
    await expect(access.getByText(role, { exact: true })).toBeVisible();
  }
  await expect(
    access.getByRole("link", { name: "Manage session accounts", exact: true }),
  ).toHaveAttribute("href", "/administration/accounts");
  await expect(
    page.locator("#sessions").getByText("Current", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("#help").getByRole("link", { name: /^Documentation/ }),
  ).toHaveAttribute("target", "_blank");

  await page.locator("#appearance").getByText("Dark", { exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(
    page.locator("#appearance").getByRole("radio", { name: "Dark" }),
  ).toBeChecked();

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("the theme options work with the keyboard and stay in view", async ({
  page,
  api,
}) => {
  await signIn(page, api, staff, "/account");
  const options = page.locator("#appearance").getByRole("radio");
  await expect(options).toHaveCount(3);
  await options.first().focus();
  await expect(page.locator("#appearance label").first()).toBeInViewport();
  await page.keyboard.press("ArrowRight");
  await expect(options.nth(1)).toBeChecked();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.keyboard.press("ArrowRight");
  await expect(options.nth(2)).toBeChecked();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("an address with a section fragment scrolls to that section", async ({
  page,
  api,
}) => {
  await signIn(page, api, staff, "/account#security");
  const security = page.locator("#security");
  await expect(security).toBeFocused();
  await expect(security).toBeInViewport();
});

test("a team account page shows the team and no staff content", async ({
  page,
  api,
}) => {
  await signIn(page, api, { ...staff, roles: [], team_id: TEAM_ID }, "/account");
  await expect(
    page.getByRole("heading", { level: 1, name: "My account", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Team account").first()).toBeVisible();
  await expect(page.locator("#profile").getByText("Aurora")).toBeVisible();
  await expect(page.locator("#profile").getByText("Desk 12")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Manage session accounts" }),
  ).toHaveCount(0);
  for (const role of ["Volunteer", "Specialist", "Jury", "Session admin"]) {
    await expect(page.getByText(role, { exact: true })).toHaveCount(0);
  }
});

test("the command palette opens the password form and focuses its first field", async ({
  page,
  api,
}) => {
  await signIn(page, api, { ...staff, roles: ["volunteer"] });
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const current = page.getByLabel("Current password", { exact: true });
  const heading = page.getByRole("heading", { name: "My account", exact: true });
  async function changePassword() {
    await page.getByRole("button", { name: /^Search teams, issues/ }).click();
    await expect(palette).toBeVisible();
    await page.getByRole("option", { name: "Change password" }).click();
    // Check focus only after the dialog has unmounted. Closing it must not
    // take focus from the field.
    await expect(palette).toBeHidden();
    await expect(page).toHaveURL("/account#security");
    await expect(current).toBeFocused();
    await expect(current).toBeInViewport();
  }

  await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
  await changePassword();

  // The same request on the account page moves focus back from the heading.
  await heading.focus();
  await page.locator("#profile").scrollIntoViewIfNeeded();
  await expect(current).not.toBeInViewport();
  await changePassword();
});

test("the contestant account menu opens the password form and focuses its first field", async ({
  page,
  api,
}) => {
  await signIn(page, api, { ...staff, roles: [], team_id: TEAM_ID });
  await page.getByRole("button", { name: /^Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "Change password" }).click();
  await expect(page).toHaveURL("/account#security");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toBeFocused();
});
