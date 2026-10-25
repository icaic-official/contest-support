import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

const viewports = [
  {
    name: "phone sheet",
    size: { width: 390, height: 844 },
    openName: "Report",
    closeIssue: (page: Page) =>
      page.getByRole("button", { name: "Back", exact: true }).click(),
    // A tap on the dimmed page behind the sheet closes it, as a swipe down does.
    close: (page: Page) =>
      page
        .locator('[data-slot="drawer-overlay"]')
        .click({ position: { x: 10, y: 10 } }),
    switchToSecondary: async (page: Page) => {
      const tabs = page.getByRole("navigation", { name: "Organizer sections" });
      await tabs.getByRole("button", { name: "Me", exact: true }).click();
      await page.getByRole("radio", { name: "Secondary" }).check();
      await tabs.getByRole("button", { name: "Queue", exact: true }).click();
    },
  },
  {
    name: "desktop dialog",
    size: { width: 1280, height: 800 },
    openName: "Report for a team",
    closeIssue: (page: Page) =>
      page.getByRole("button", { name: "Close issue" }).click(),
    close: (page: Page) => page.keyboard.press("Escape"),
    switchToSecondary: async (page: Page) => {
      await page
        .getByRole("button", { name: /^Contest session: Primary/ })
        .click();
      await page.getByRole("menuitemradio", { name: "Secondary" }).click();
    },
  },
] as const;

async function signIn(page: Page, username: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // The first snapshot comes from local D1, which can take several seconds on a busy machine.
  await expect(page.getByText("Live", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

async function openReport(page: Page, name: string): Promise<Locator> {
  await page.getByRole("button", { name, exact: true }).click();
  const report = page.getByRole("dialog", { name: "Report for a team" });
  await expect(report).toBeVisible();
  return report;
}

async function chooseTeam(page: Page, report: Locator, search: string) {
  await report.locator("#report-team-search").fill(search);
  await page.getByRole("option").click();
}

const description = (report: Locator) => report.getByLabel(/What.s happening/);
const teamsToReport = (report: Locator) =>
  report.getByRole("list", { name: "Teams to report" });

for (const viewport of viewports) {
  test.describe(`report on the ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport.size);
    });

    test("closing the report keeps the draft until it is sent", async ({
      page,
      local,
    }) => {
      await signIn(page, "volunteer");
      let report = await openReport(page, viewport.openName);
      await chooseTeam(page, report, "aur");
      await report.getByRole("button", { name: "Add another team" }).click();
      await chooseTeam(page, report, "ced");
      await report.getByText("Devices", { exact: true }).click();
      await description(report).fill("Power strip tripped");

      await viewport.close(page);
      await expect(report).toBeHidden();
      report = await openReport(page, viewport.openName);

      await expect(description(report)).toHaveValue("Power strip tripped");
      await expect(report.getByRole("radio", { name: "Devices" })).toBeChecked();
      await expect(teamsToReport(report)).toContainText("Aurora");
      await expect(teamsToReport(report)).toContainText("Cedar");

      await report
        .getByRole("button", { name: "Submit 2 issues", exact: true })
        .click();
      await expect(report).toBeHidden();
      // The last report opens its issue.
      await viewport.closeIssue(page);
      const sent = await local.snapshot();
      expect(
        sent.issues.map((issue) => [issue.team_id, issue.description]).sort(),
      ).toEqual(
        [local.teams[0], local.teams[1]]
          .map((team) => [team, "Power strip tripped"])
          .sort(),
      );
      report = await openReport(page, viewport.openName);

      await expect(description(report)).toHaveValue("");
      await expect(
        report.getByRole("radio", { name: "Problem statement" }),
      ).toBeChecked();
      await expect(teamsToReport(report)).toHaveCount(0);
    });

    test("a team that was sent leaves the draft when a later team fails", async ({
      page,
      local,
    }) => {
      const third = crypto.randomUUID();
      await local.run(
        "INSERT INTO teams (id, session_id, name, location) VALUES (?, ?, 'Birch', 'A20')",
        third,
        local.sessions[0],
      );
      await signIn(page, "volunteer");
      const report = await openReport(page, viewport.openName);
      await chooseTeam(page, report, "aur");
      await report.getByRole("button", { name: "Add another team" }).click();
      await chooseTeam(page, report, "ced");
      await report.getByRole("button", { name: "Add another team" }).click();
      await chooseTeam(page, report, "bir");
      await description(report).fill("Power strip tripped");
      // The page does not hear of this change, so the server rejects the last report.
      await local.run("DELETE FROM teams WHERE id = ?", third);
      await report
        .getByRole("button", { name: "Submit 3 issues", exact: true })
        .click();

      await expect(report.locator("p[role=alert]")).toBeVisible();
      await expect(teamsToReport(report)).toHaveCount(0);
      await expect(description(report)).toHaveValue("Power strip tripped");
      expect(
        (await local.snapshot()).issues.map((issue) => issue.team_id).sort(),
      ).toEqual([local.teams[0], local.teams[1]].sort());
    });

    test("a report that a retry records leaves no draft behind", async ({
      page,
      local,
    }) => {
      await signIn(page, "volunteer");
      const report = await openReport(page, viewport.openName);
      await chooseTeam(page, report, "aur");
      await description(report).fill("Power strip tripped");
      local.loseNext("/api/workflow", "response");
      await report
        .getByRole("button", { name: "Submit issue", exact: true })
        .click();
      await report
        .getByRole("button", { name: "Retry last request", exact: true })
        .click();

      // On the desktop the issue sheet opens over the dialog and hides it from role queries, so this query uses the label.
      await expect(page.getByLabel(/What.s happening/)).toHaveValue("");
      expect((await local.snapshot()).issues).toHaveLength(1);
    });

    test("changing the session clears the draft", async ({ page, local }) => {
      await local.run(
        "INSERT INTO memberships (session_id, account_id) VALUES (?, ?)",
        local.sessions[1],
        local.users.volunteer,
      );
      await local.run(
        "INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')",
        local.sessions[1],
        local.users.volunteer,
      );
      await signIn(page, "volunteer");
      let report = await openReport(page, viewport.openName);
      await chooseTeam(page, report, "aur");
      await report.getByRole("button", { name: "Add another team" }).click();
      await description(report).fill("Power strip tripped");
      await viewport.close(page);
      await expect(report).toBeHidden();

      await viewport.switchToSecondary(page);
      await expect(page.getByText("Secondary").first()).toBeVisible();
      report = await openReport(page, viewport.openName);

      await expect(description(report)).toHaveValue("");
      await expect(teamsToReport(report)).toHaveCount(0);
      expect((await local.snapshot()).issues).toHaveLength(0);
    });
  });
}
