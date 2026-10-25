import { expect, test, type Page } from "@playwright/test";
import { emptyAnnouncementSnapshot } from "./support/announcementSnapshot";

// Self-contained on purpose. It mocks only the backend calls that signing in
// needs, so it is easy to move to another backend mock.
const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000100";
const EVENT_ID = "00000000-0000-4000-8000-000000000090";

/** Signs a volunteer in on the desktop console with valid backend responses. */
async function signIn(page: Page) {
  const serverTime = "2026-10-17T00:00:00Z";
  const snapshot = () => ({
    session: {
      id: SESSION_ID,
      event_id: EVENT_ID,
      name: "Boundary session",
      intake_open: true,
      categories: ["Network"],
      revision: 0,
      max_image_bytes: 10485760,
      max_images_per_issue: 20,
      max_image_bytes_per_issue: 125829120,
    },
    event: { id: EVENT_ID, name: "Boundary event", archived: false },
    membership: {
      session_id: SESSION_ID,
      user_id: USER_ID,
      team_id: null,
      roles: ["volunteer"],
      is_admin: false,
    },
    teams: [],
    issues: [],
    resolutions: [],
    history: [],
    attachments: [],
    pending_removals: [],
    awards: [],
    audit: [],
    members: [],
    server_time: serverTime,
  });
  const user = {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "boundary@accounts.minsky.invalid",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: serverTime,
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
        refresh_token: "boundary-fixture",
        expires_in: 3600,
        expires_at: expires,
        token_type: "bearer",
        user,
      },
      "/auth/v1/user": user,
      "/rest/v1/rpc/account_status": {
        username: "boundary",
        must_change: false,
        session_valid: true,
      },
      "/rest/v1/memberships": [snapshot().membership],
      "/rest/v1/sessions": [{ id: SESSION_ID, name: "Boundary session" }],
      "/rest/v1/rpc/session_snapshot": snapshot(),
      "/rest/v1/rpc/announcement_snapshot": emptyAnnouncementSnapshot(),
      "/rest/v1/rpc/avatar_list": [],
    };
    if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responses[path]),
    });
  });
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("boundary");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Makes the next render of the organiser UI throw, as a failed render does. */
async function breakNextRender(page: Page) {
  await page.evaluate(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (query.includes("min-width: 1024px")) {
        throw new Error("Forced render error.");
      }
      return original(query);
    };
  });
  // A narrower window changes the media query, so the UI renders again.
  await page.setViewportSize({ width: 600, height: 800 });
}

test("a render error shows a recovery screen, and Reload restores the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
  await breakNextRender(page);
  const recovery = page.getByRole("alert").filter({
    has: page.getByRole("heading", { name: "Something went wrong" }),
  });
  await expect(recovery).toBeVisible({ timeout: 15_000 });
  await expect(recovery).toContainText("saved on the server");
  // The page chrome outside the failed screen stays on the page.
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeAttached();
  await page.setViewportSize({ width: 1280, height: 800 });
  await recovery.getByRole("button", { name: "Reload" }).click();
  await expect(recovery).toBeHidden();
  await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
});
