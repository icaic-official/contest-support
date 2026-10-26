import type { Page } from "@playwright/test";
import {
  EVENT_ID,
  SESSION_ID,
  USER_ID,
  expect,
  fixtureAccount,
  sessionSnapshot,
  test,
} from "./support/worker";

const BEN_ID = "00000000-0000-4000-8000-000000000002";
const REVOKED_ID = "00000000-0000-4000-8000-000000000003";

const admin = {
  session_id: SESSION_ID,
  user_id: USER_ID,
  team_id: null,
  roles: [],
  is_admin: true,
};

function entry(n: number, action: string, target: string | null) {
  return {
    id: `00000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`,
    actor: USER_ID,
    at: `2026-10-17T00:0${n}:00Z`,
    action,
    target,
  };
}

async function openActivity(
  page: Page,
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("organiser");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  if (viewport.width >= 1024) {
    await page
      .getByRole("navigation", { name: "Console pages" })
      .getByRole("button", { name: "Accounts", exact: true })
      .click();
  } else {
    await page
      .getByRole("navigation", { name: "Organizer sections" })
      .getByRole("button", { name: "Session", exact: true })
      .click();
  }
  const section = page
    .locator("details")
    .filter({ hasText: "Recent administration activity" });
  await section.getByText("Recent administration activity").click();
  return section.getByRole("listitem");
}

for (const [name, viewport] of [
  ["desktop console", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`the ${name} activity list names the person an action changed`, async ({
    page,
    api,
  }) => {
    api.account = fixtureAccount(USER_ID, "organiser", "Ada Lovelace");
    api.snapshots = () => [
      sessionSnapshot(admin, {
        event: { id: EVENT_ID, name: "Activity event", archived: false },
        members: [
          {
            membership: admin,
            person: { id: USER_ID, name: "Ada Lovelace", username: "organiser" },
          },
          {
            membership: { ...admin, user_id: BEN_ID, is_admin: false },
            person: { id: BEN_ID, name: "Ben Okoro", username: "ben" },
          },
        ],
        audit: [
          entry(3, "reset_password", BEN_ID),
          entry(2, "revoke_membership", REVOKED_ID),
          entry(1, "set_intake", null),
        ],
      }),
    ];
    const items = await openActivity(page, viewport);
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText(/^reset password for Ben Okoro/i);
    await expect(items.nth(0)).toContainText("Ada Lovelace");
    // A person who left the session has no name here, and the ID stays hidden.
    await expect(items.nth(1)).toHaveText(/^revoke membership\s*Ada Lovelace/i);
    await expect(items.nth(2)).toHaveText(/^set intake\s*Ada Lovelace/i);
    expect((await items.allTextContents()).join(" ")).not.toContain(REVOKED_ID);
  });
}
