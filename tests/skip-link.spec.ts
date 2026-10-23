import { expect, test, type Page } from "@playwright/test";
import type { Membership, Snapshot } from "../src/connected/model";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000100";
const TEAM_ID = "00000000-0000-4000-8000-000000000200";

/** Signs in with isolated Auth and database responses for one membership. */
async function signIn(page: Page, membership: Membership): Promise<void> {
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
      "/rest/v1/memberships": [membership],
      "/rest/v1/sessions": [{ id: SESSION_ID, name: "Selection session" }],
      "/rest/v1/rpc/session_snapshot": state,
    };
    if (!(path in responses)) {
      throw new Error(`Unexpected request: ${path}`);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responses[path]),
    });
  });
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("selection");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("[data-ui]")).toBeVisible();
  // A fresh load starts focus at the document, as the hosted staff check does.
  await page.goto("/");
  await expect(page.locator("[data-ui]")).toBeVisible();
}

/**
 * The hosted failure moved focus to the page heading after Enter. A hash
 * change fires popstate, and that listener focused the heading on the next
 * frame, so #main never stayed active.
 */
async function focusHeadingAfterHash(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.addEventListener("popstate", () => {
      window.requestAnimationFrame(() => {
        const heading = document.querySelector("h1");
        if (!(heading instanceof HTMLElement)) return;
        if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
        heading.focus();
      });
    });
  });
}

/** Presses Enter on the skip link and reads the focused element after paint. */
async function skipTargetIsMain(page: Page): Promise<boolean> {
  const skip = page.getByRole("link", { name: "Skip to main content" });
  // Route navigation focuses the page heading. Reach the skip link from there.
  for (let step = 0; step < 40; step++) {
    if (await skip.evaluate((link) => link === document.activeElement)) break;
    const onHeading = await page.evaluate(() =>
      document.activeElement instanceof HTMLHeadingElement,
    );
    await page.keyboard.press(onHeading || step > 0 ? "Shift+Tab" : "Tab");
  }
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  return page.evaluate(
    () => document.activeElement === document.getElementById("main"),
  );
}

const staff: Membership = {
  session_id: SESSION_ID,
  user_id: USER_ID,
  team_id: null,
  roles: ["volunteer"],
  is_admin: false,
};

test("Enter on the landing skip link focuses the main landmark", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true }))
    .toBeVisible();
  await focusHeadingAfterHash(page);
  expect(await skipTargetIsMain(page)).toBe(true);
});

test("Enter on the staff skip link focuses the main landmark", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await signIn(page, staff);
  await expect(
    page.getByRole("heading", { level: 1, name: "Queue", exact: true }),
  ).toBeVisible();
  await focusHeadingAfterHash(page);
  expect(await skipTargetIsMain(page)).toBe(true);
});

test("Enter on the organiser skip link focuses the main landmark", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, { ...staff, is_admin: true });
  await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
  await focusHeadingAfterHash(page);
  expect(await skipTargetIsMain(page)).toBe(true);
});

test("Enter on the contestant skip link focuses the main landmark", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, { ...staff, roles: [], team_id: TEAM_ID });
  await expect(page.locator('[data-ui="contestant"]')).toBeVisible();
  await focusHeadingAfterHash(page);
  expect(await skipTargetIsMain(page)).toBe(true);
});
