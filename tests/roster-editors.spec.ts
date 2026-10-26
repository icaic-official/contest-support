import type { Page } from "@playwright/test";
import type { RosterCommand } from "../src/backend/contracts";
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

/** What the fixture Worker holds, and every roster command that reached it. */
interface Roster {
  teams: Snapshot["teams"];
  categories: string[];
  commands: RosterCommand[];
  archived: boolean;
  /** The next command fails with this message and changes nothing. */
  reject?: string;
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
  api.roster = async (_sessionId, command) => {
    roster.commands.push(command);
    if (roster.reject) {
      const message = roster.reject;
      roster.reject = undefined;
      throw new AuthenticationError(409, message);
    }
    switch (command.type) {
      case "add_teams":
        // A repeated ID keeps its first row, as the Worker does.
        roster.teams = [
          ...roster.teams,
          ...command.teams.filter((added) => !roster.teams.some((current) => current.id === added.id))
            .map((added) => team(added.id, added.name, added.location)),
        ];
        break;
      case "update_team":
        roster.teams = roster.teams.map((current) =>
          current.id === command.teamId ? { ...current, name: command.name, location: command.location } : current);
        break;
      case "delete_team":
        roster.teams = roster.teams.filter((current) => current.id !== command.teamId);
        break;
      case "set_categories":
        roster.categories = command.categories;
        break;
    }
  };
  await page.setViewportSize(viewport);
  await page.goto(startPath);
  await page.getByLabel("Username", { exact: true }).fill("organiser");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('[data-ui="organiser-desktop"], [data-ui="organiser-phone"]')).toBeVisible();
  return roster;
}

/** Opens the team editor. A laptop has the Roster page. A phone has a section of the Session tab. */
async function showTeams(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await page.getByRole("navigation", { name: "Console pages" }).getByRole("button", { name: "Roster", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Roster", exact: true })).toBeVisible();
  } else {
    await page.getByRole("navigation", { name: "Organizer sections" }).getByRole("button", { name: "Session", exact: true }).click();
    await page.getByText(/^Teams · \d+$/).click();
  }
  return page.getByLabel("Add teams", { exact: true });
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
    test("an admin adds team after team without leaving the keyboard", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      const box = await showTeams(page);
      await box.focus();
      await page.keyboard.type("Zeta, Hall 1");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Eta\tHall 2");
      await expect(page.getByRole("status").filter({ hasText: "2 teams are ready to add." })).toBeVisible();
      await page.keyboard.press("Control+Enter");
      await expect(page.getByText("Teams · 4")).toBeVisible();
      await expect(box).toHaveValue("");
      await expect(box).toBeFocused();
      await page.keyboard.type("Theta");
      await page.keyboard.press("Control+Enter");
      await expect(page.getByText("Teams · 5")).toBeVisible();
      await expect(box).toBeFocused();
      expect(roster.commands).toEqual([
        { type: "add_teams", teams: [
          { id: expect.any(String), name: "Zeta", location: "Hall 1" },
          { id: expect.any(String), name: "Eta", location: "Hall 2" }] },
        { type: "add_teams", teams: [{ id: expect.any(String), name: "Theta", location: "" }] },
      ]);
      await expect(page.getByText("Hall 2", { exact: true })).toBeVisible();
    });

    test("a problem line blocks the add and names its line", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      const box = await showTeams(page);
      await box.fill("New one\n aurora, Hall Z\nNew one");
      await expect(page.getByText("Line 2, aurora: Already in the roster.")).toBeVisible();
      await expect(page.getByText("Line 3, New one: Same name as line 1.")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Add/ })).toBeDisabled();
      await box.press("Control+Enter");
      expect(roster.commands).toEqual([]);
    });

    test("a rejected add keeps the typed lines", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      const box = await showTeams(page);
      await box.fill("Zeta, Hall 1\nEta");
      roster.reject = 'A team named "Zeta" already exists.';
      await page.getByRole("button", { name: "Add 2 teams" }).click();
      await expect(page.getByText('A team named "Zeta" already exists.')).toBeVisible();
      await expect(box).toHaveValue("Zeta, Hall 1\nEta");
      await page.getByRole("button", { name: "Add 2 teams" }).click();
      await expect(page.getByText("Teams · 4")).toBeVisible();
      await expect(box).toHaveValue("");
    });

    test("a retry after a request that never arrived sends the same team IDs", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      const box = await showTeams(page);
      await box.fill("Zeta, Hall 1\nEta");
      api.loseNext("/api/admin", "request");
      await page.getByRole("button", { name: "Add 2 teams" }).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
      await expect(box).toHaveValue("Zeta, Hall 1\nEta");
      await page.getByRole("button", { name: "Add 2 teams" }).click();
      await expect(page.getByText("Teams · 4")).toBeVisible();
      const [first, second] = api.bodies<{ command: RosterCommand }>("/api/admin").map((body) => body.command);
      expect(second).toEqual(first);
      expect(roster.commands).toEqual([second]);
    });

    test("when the answer was lost but the server added the teams, the box clears itself", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      const box = await showTeams(page);
      await box.fill("Zeta, Hall 1\nEta");
      api.loseNext("/api/admin", "response");
      await page.getByRole("button", { name: "Add 2 teams" }).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
      // The next read shows both teams with the IDs that the box sent.
      await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
      await expect(page.getByText("Teams · 4")).toBeVisible();
      await expect(box).toHaveValue("");
      expect(roster.teams.filter((current) => current.name === "Zeta")).toHaveLength(1);
    });

    test("an admin renames a team in its row with the keyboard, and Escape cancels", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      await showTeams(page);
      const edit = page.getByRole("button", { name: "Edit Aurora", exact: true });
      await edit.click();
      await expect(page.getByLabel("Team name", { exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(edit).toBeFocused();
      expect(roster.commands).toEqual([]);
      await edit.click();
      await page.keyboard.press("Control+a");
      await page.keyboard.type("Aurora Prime");
      await page.getByLabel("Location", { exact: true }).fill("Hall C");
      await page.keyboard.press("Enter");
      await expect(page.getByText("Aurora Prime", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit Aurora Prime", exact: true })).toBeFocused();
      expect(roster.commands).toEqual([{ type: "update_team", teamId: TEAM_ID, name: "Aurora Prime", location: "Hall C" }]);
    });

    test("a team name that another team has cannot be saved", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      await showTeams(page);
      await page.getByRole("button", { name: "Edit Aurora", exact: true }).click();
      await page.getByLabel("Team name", { exact: true }).fill(" cedar ");
      await expect(page.getByText("Another team has this name.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      expect(roster.commands).toEqual([]);
    });

    test("a team with an issue stays, and a team that nothing uses is deleted after a check", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      const box = await showTeams(page);
      await expect(page.getByText("In use: 1 issue. This team stays.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete Aurora", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Delete Cedar", exact: true })).toBeEnabled();
      await box.fill("Spare");
      await box.press("Control+Enter");
      await page.getByRole("button", { name: "Delete Spare", exact: true }).click();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(roster.commands.map((command) => command.type)).toEqual(["add_teams"]);
      await page.getByRole("button", { name: "Delete Spare", exact: true }).click();
      await page.getByRole("button", { name: "Delete team", exact: true }).click();
      await expect(page.getByText("Teams · 2")).toBeVisible();
      expect(roster.commands.map((command) => command.type)).toEqual(["add_teams", "delete_team"]);
    });

    test("the team filter narrows a long list", async ({ page, api }) => {
      await openRoster(page, api, viewport);
      const box = await showTeams(page);
      await box.fill(Array.from({ length: 120 }, (_, index) => `Team ${index + 1}, Table ${index + 1}`).join("\n"));
      await page.getByRole("button", { name: "Add 120 teams" }).click();
      await expect(page.getByText("Teams · 122")).toBeVisible();
      await page.getByLabel("Filter teams", { exact: true }).fill("team 11");
      await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(11);
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
      expect(roster.commands).toEqual([{ type: "set_categories", categories: ["Network", "Food", "Power"] }]);
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

    test("an archived event disables every roster control", async ({ page, api }) => {
      const roster = await openRoster(page, api, viewport);
      roster.archived = true;
      await page.reload();
      const box = await showTeams(page);
      await expect(box).toBeDisabled();
      await expect(page.getByRole("button", { name: "Edit Aurora", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Delete Cedar", exact: true })).toBeDisabled();
    });

    test("the page does not scroll sideways", async ({ page, api }) => {
      await openRoster(page, api, viewport);
      const box = await showTeams(page);
      await box.fill(`${"A very long team name ".repeat(8)}, ${"A very long location ".repeat(8)}`);
      await page.getByRole("button", { name: "Add team" }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test("a direct link opens the Roster page for an admin", async ({ page, api }) => {
  await openRoster(page, api, desktop, "/administration/roster");
  await expect(page).toHaveURL("/administration/roster");
  await expect(page.getByRole("heading", { level: 1, name: "Roster", exact: true })).toBeVisible();
});
