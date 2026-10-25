import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

const viewports = [
  {
    name: "phone sheet",
    size: { width: 390, height: 844 },
    openName: "Report",
    // A tap on the dimmed page behind the sheet closes it, as a swipe down does.
    close: (page: Page) =>
      page
        .locator('[data-slot="drawer-overlay"]')
        .click({ position: { x: 10, y: 10 } }),
  },
  {
    name: "desktop dialog",
    size: { width: 1280, height: 800 },
    openName: "Report for a team",
    close: (page: Page) => page.keyboard.press("Escape"),
  },
] as const;

async function signInAsVolunteer(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("volunteer");
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
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

for (const viewport of viewports) {
  test.describe(`report on the ${viewport.name}`, () => {
    test("closing the report keeps the draft until it is sent", async ({
      page,
      local,
    }) => {
      await page.setViewportSize(viewport.size);
      await signInAsVolunteer(page);
      let report = await openReport(page, viewport.openName);
      await chooseTeam(page, report, "aur");
      await report.getByRole("button", { name: "Add another team" }).click();
      await chooseTeam(page, report, "ced");
      await report.getByText("Devices", { exact: true }).click();
      await report.getByLabel(/What.s happening/).fill("Power strip tripped");

      await viewport.close(page);
      await expect(report).toBeHidden();
      report = await openReport(page, viewport.openName);

      await expect(report.getByLabel(/What.s happening/)).toHaveValue(
        "Power strip tripped",
      );
      await expect(
        report.getByRole("radio", { name: "Devices" }),
      ).toBeChecked();
      const teams = report.getByRole("list", { name: "Teams to report" });
      await expect(teams).toContainText("Aurora");
      await expect(teams).toContainText("Cedar");

      await report
        .getByRole("button", { name: "Submit 2 issues", exact: true })
        .click();
      await expect(report).toBeHidden();
      const sent = await local.snapshot();
      expect(
        sent.issues
          .map((issue) => [issue.team_id, issue.description])
          .sort(),
      ).toEqual(
        [local.teams[0], local.teams[1]]
          .map((team) => [team, "Power strip tripped"])
          .sort(),
      );
      report = await openReport(page, viewport.openName);

      await expect(report.getByLabel(/What.s happening/)).toHaveValue("");
      await expect(
        report.getByRole("radio", { name: "Problem statement" }),
      ).toBeChecked();
      await expect(
        report.getByRole("list", { name: "Teams to report" }),
      ).toHaveCount(0);
    });
  });
}
