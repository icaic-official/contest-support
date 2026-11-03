import type { Page } from "@playwright/test";
import type { ManageCommand } from "../src/backend/contracts";
import type { Issue, Membership, Snapshot } from "../src/connected/model";
import { AuthenticationError } from "../src/server/authentication";
import {
  type FakeWorker,
  EVENT_ID,
  SESSION_ID,
  TEAM_ID,
  USER_ID,
  expect,
  fixtureAccount,
  sessionSnapshot,
  test,
} from "./support/worker";

const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };

const admin: Membership = {
  session_id: SESSION_ID,
  user_id: USER_ID,
  team_id: null,
  roles: ["volunteer"],
  is_admin: true,
};

const issue: Issue = {
  id: "00000000-0000-4000-8000-000000000300",
  number: 1,
  session_id: SESSION_ID,
  team_id: TEAM_ID,
  reporter: USER_ID,
  reporter_name: "Roster fixture",
  category: "Network",
  description: "Fictional issue",
  status: "open",
  created_at: "2026-10-17T00:00:00Z",
  first_assigned_at: null,
  owner: null,
  owner_name: null,
  resolved_at: null,
  revision: 0,
};

/** What the fixture Worker holds, and every contest command that reached it. */
interface Roster {
  teams: Snapshot["teams"];
  categories: string[];
  commands: ManageCommand[];
  archived: boolean;
  /** The next command fails with this message and changes nothing. */
  reject?: string | undefined;
}

function team(id: string, name: string, location: string) {
  return { id, session_id: SESSION_ID, name, location };
}

async function openRoster(
  page: Page,
  api: FakeWorker,
  viewport: { width: number; height: number },
  startPath = "/issues",
): Promise<Roster> {
  const roster: Roster = {
    teams: [
      team(TEAM_ID, "Aurora", "Hall A · Desk 12"),
      team("00000000-0000-4000-8000-000000000201", "Cedar", "Hall B · Desk 4"),
    ],
    categories: ["Network", "Device"],
    commands: [],
    archived: false,
  };
  api.account = fixtureAccount(USER_ID, "organiser", "Roster fixture");
  api.snapshots = () => [
    sessionSnapshot(admin, {
      session: { name: "Roster session", categories: roster.categories },
      event: { id: EVENT_ID, name: "Roster event", archived: roster.archived },
      teams: roster.teams,
      issues: [issue],
      members: [{ membership: admin, person: { id: USER_ID, name: "Roster fixture", username: "organiser" } }],
    }),
  ];
  api.manage = async (command) => {
    roster.commands.push(command);
    if (roster.reject) {
      const message = roster.reject;
      roster.reject = undefined;
      throw new AuthenticationError(409, message);
    }
    switch (command.type) {
      case "set_location":
        roster.teams = roster.teams.map((current) =>
          current.id === command.entrantId ? { ...current, location: command.location } : current);
        break;
      case "set_categories":
        roster.categories = [...command.categories];
        break;
      default:
        throw new AuthenticationError(403, "The fixture takes only contest commands.");
    }
    return {};
  };
  await page.setViewportSize(viewport);
  await page.goto(startPath);
  await page.getByLabel("Username", { exact: true }).fill("organiser");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('[data-ui="organiser-desktop"], [data-ui="organiser-phone"]')).toBeVisible();
  return roster;
}

/** Opens the team locations. A laptop has the Roster page. A phone has a section of the Session tab. */
async function showTeams(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await page.getByRole("navigation", { name: "Console pages" }).getByRole("button", { name: "Team locations", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Team locations", exact: true })).toBeVisible();
  } else {
    await page.getByRole("navigation", { name: "Organizer sections" }).getByRole("button", { name: "Session", exact: true }).click();
    await page.getByText(/^Team locations · \d+$/).click();
  }
}

/** Opens the category editor in the same two places. */
async function showCategories(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await page.getByRole("navigation", { name: "Console pages" }).getByRole("button", { name: "Session settings", exact: true }).click();
  } else {
    await page.getByRole("navigation", { name: "Organizer sections" }).getByRole("button", { name: "Session", exact: true }).click();
    await page.locator("summary", { hasText: "Categories" }).click();
  }
  return page.getByLabel("New category", { exact: true });
}

for (const [layout, viewport] of [["laptop", desktop], ["phone", phone]] as const) {
  test.describe(layout, () => {
    test("a contest admin changes a team's location and cannot add, rename, or delete teams", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      await showTeams(page);
      await expect(page.getByRole("button", { name: /^(Edit|Delete|Add) / })).toHaveCount(0);
      await expect(page.getByLabel("Add teams", { exact: true })).toHaveCount(0);
      const location = page.getByLabel("Aurora", { exact: true });
      await expect(location).toHaveValue("Hall A · Desk 12");
      await location.fill("Hall C");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status").filter({ hasText: "Location saved." })).toBeVisible();
      expect(roster.commands).toEqual([{ type: "set_location", contestId: SESSION_ID, entrantId: TEAM_ID, location: "Hall C" }]);
    });

    test("a rejected location keeps the typed text", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      await showTeams(page);
      const location = page.getByLabel("Cedar", { exact: true });
      await location.fill("Hall Z");
      roster.reject = "This contest has no such team.";
      await page.getByRole("button", { name: "Save" }).nth(1).click();
      await expect(page.getByText("This contest has no such team.")).toBeVisible();
      await expect(location).toHaveValue("Hall Z");
    });

    test("the category editor fixes a category that an issue uses and saves the whole list", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      const fresh = await showCategories(page);
      await expect(page.getByLabel("Category 1", { exact: true })).toHaveAttribute("readonly", "");
      await expect(page.getByText("In use: 1 issue. This category stays and keeps its name.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Remove Network", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Remove Device", exact: true }).click();
      await expect(fresh).toBeFocused();
      await page.keyboard.type("Power");
      await page.keyboard.press("Enter");
      await expect(fresh).toHaveValue("");
      await page.keyboard.type("Food");
      await page.keyboard.press("Enter");
      const up = page.getByRole("button", { name: "Move Food up", exact: true });
      await up.click();
      await expect(up).toBeFocused();
      await page.getByRole("button", { name: "Save categories", exact: true }).click();
      await expect(page.getByRole("button", { name: "Save categories", exact: true })).toBeDisabled();
      expect(roster.commands).toEqual([{ type: "set_categories", contestId: SESSION_ID, categories: ["Network", "Food", "Power"] }]);
      await expect(page.getByLabel("Category 2", { exact: true })).toHaveValue("Food");
    });

    test("a category list with a blank or repeated name cannot be saved", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      const fresh = await showCategories(page);
      await fresh.fill("network");
      await fresh.press("Enter");
      await expect(page.getByText("Two categories have the same name.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Save categories", exact: true })).toBeDisabled();
      expect(roster.commands).toEqual([]);
    });

    test("an archived event disables every location control", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      roster.archived = true;
      await page.reload();
      await showTeams(page);
      await expect(page.getByLabel("Aurora", { exact: true })).toBeDisabled();
    });

    test("the page does not scroll sideways", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      roster.teams = [team(TEAM_ID, "A very long team name ".repeat(8), "A very long location ".repeat(8))];
      await page.reload();
      await showTeams(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test("a direct link opens the team locations page for an admin", async ({ page, api }) => {
  await openRoster(page, api, desktop, "/administration/roster");
  await expect(page).toHaveURL("/administration/roster");
  await expect(page.getByRole("heading", { level: 1, name: "Team locations", exact: true })).toBeVisible();
});
