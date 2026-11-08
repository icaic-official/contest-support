import type { Page } from "@playwright/test";
import type { Issue } from "../src/connected/model";
import { contrastOf } from "./support/contrast";
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

/** An open issue that was reported `minutes` before the fixture server time. */
function waitingIssue(number: number, minutes: number): Issue {
  return {
    id: `00000000-0000-4000-8000-00000000030${number}`,
    number,
    session_id: SESSION_ID,
    team_id: TEAM_ID,
    reporter: USER_ID,
    reporter_name: "Contrast fixture",
    category: "Network",
    description: `Waiting ${minutes} minutes`,
    status: "open",
    created_at: new Date(Date.parse(serverTime) - minutes * 60_000).toISOString(),
    first_assigned_at: null,
    owner: null,
    owner_name: null,
    resolved_at: null,
    revision: 0,
  };
}

const serverTime = "2026-10-17T01:00:00Z";

/** Issue 1 has waited 15 minutes, which is the amber tier. Issue 2 has waited 35, the rose tier. */
const tiers = [
  [1, /^1[5-9]:\d\d$/],
  [2, /^3[5-9]:\d\d$/],
] as const;

/** Signs a volunteer in to a queue of one amber and one rose issue. */
async function openQueue(page: Page, api: FakeWorker, layout: string) {
  api.account = fixtureAccount(USER_ID, "contrast", "Contrast fixture");
  api.snapshots = () => [
    sessionSnapshot(
      {
        session_id: SESSION_ID,
        user_id: USER_ID,
        team_id: null,
        roles: ["volunteer"],
        is_admin: false,
      },
      {
        issues: [waitingIssue(1, 15), waitingIssue(2, 35)],
        server_time: serverTime,
      },
    ),
  ];
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("contrast");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(layout)).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test("the Reconnecting badge text is readable", async ({ page, api }) => {
      api.account = fixtureAccount(USER_ID, "contrast", "Contrast fixture");
      api.snapshots = () => [
        sessionSnapshot({
          session_id: SESSION_ID,
          user_id: USER_ID,
          team_id: TEAM_ID,
          roles: [],
          is_admin: false,
        }),
      ];
      // A closed live channel keeps the contestant top bar on Reconnecting.
      await page.routeWebSocket(/\/api\/updates/, (socket) => socket.close());
      await page.goto("/sign-in");
      await page.getByLabel("Username", { exact: true }).fill("contrast");
      await page.getByLabel("Password", { exact: true }).fill("fixture-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const badge = page.getByRole("status").filter({ hasText: "Reconnecting" });
      await expect(badge).toBeVisible();
      expect(await contrastOf(badge)).toBeGreaterThanOrEqual(4.5);
    });

    test("an error alert is readable", async ({ page, api }) => {
      api.account = fixtureAccount(USER_ID, "contrast", "Contrast fixture");
      await page.route("**/api/auth/sign-in", (route) => route.abort("failed"));
      await page.goto("/sign-in");
      await page.getByLabel("Username", { exact: true }).fill("contrast");
      await page.getByLabel("Password", { exact: true }).fill("fixture-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const message = page
        .getByRole("alert")
        .locator('[data-slot="alert-description"]');
      await expect(message).toBeVisible();
      expect(await contrastOf(message)).toBeGreaterThanOrEqual(4.5);
    });

    test("the unresolved timer is readable in every age tier on a queue row", async ({
      page,
      api,
    }) => {
      await openQueue(page, api, '[data-ui="organiser-desktop"]');
      for (const [number, age] of tiers) {
        const row = page.locator("tr").filter({ hasText: `ISS-${number}` });
        const timer = row.getByText(/^\d\d:\d\d$/);
        await expect(timer).toHaveText(age);
        // The pointer from the last click would tint the row it rests on.
        await page.mouse.move(0, 0);
        expect(await contrastOf(timer)).toBeGreaterThanOrEqual(4.5);
        await row.getByRole("button", { name: `Open ISS-${number}` }).click();
        await expect(row).toHaveAttribute("data-state", "selected");
        expect(await contrastOf(timer)).toBeGreaterThanOrEqual(4.5);
        await page.keyboard.press("Escape");
      }
    });

    test("the unresolved timer is readable in every age tier on a phone card", async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openQueue(page, api, '[data-ui="organiser-phone"]');
      for (const [number, age] of tiers) {
        const timer = page
          .locator("li")
          .filter({ hasText: `ISS-${number}` })
          .getByText(/^\d\d:\d\d$/);
        await expect(timer).toHaveText(age);
        expect(await contrastOf(timer)).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
}
