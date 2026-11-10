import type { Page, Route } from "@playwright/test";
import { expect, test } from "./support/localWorker";

// An event admin meets a refused command, a lost answer, and a command that overlaps another.
test.use({ seedIssues: false, withEventAdmin: true });

const entrants = "Entrants, one per line: name, username";

async function openConsole(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("eventadmin");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('[data-ui="organiser-desktop"], [data-ui="organiser-phone"]')).toBeVisible();
  await page.goto("/event");
  await expect(page.getByRole("heading", { level: 1, name: "Jury verification" })).toBeVisible();
}

const commandType = (route: Route): unknown => (route.request().postDataJSON() as { command?: { type?: string } }).command?.type;

test("a refusal keeps the typed lines, and a lost answer clears them once the server recorded them", async ({ page, local }) => {
  test.setTimeout(60_000);
  await openConsole(page);
  await page.getByRole("tab", { name: "Entrants", exact: true }).click();
  const box = page.getByLabel(entrants, { exact: true });

  // A colleague takes the username while this page still shows the old list.
  const colleague = await page.context().newPage();
  await colleague.setViewportSize({ width: 1280, height: 800 });
  await colleague.goto("/event");
  await colleague.getByRole("tab", { name: "Entrants", exact: true }).click();
  await colleague.getByLabel(entrants, { exact: true }).fill("Team Lyra, team-lyra");
  await colleague.getByRole("button", { name: "Import entrants (1)", exact: true }).click();
  await expect(colleague.getByRole("dialog", { name: "Share these credentials securely" })).toBeVisible();
  await colleague.close();

  await box.fill("Team Lyra Two, team-lyra");
  await page.getByRole("button", { name: "Import entrants (1)", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  // The next read lists the handle, which must not erase what the person typed.
  await expect(page.getByRole("list", { name: "All entrants" }).getByRole("listitem")).toHaveCount(4);
  await expect(box).toHaveValue("Team Lyra Two, team-lyra");

  local.loseNext("/api/manage", "response");
  await box.fill("Team Draco, team-draco");
  await page.getByRole("button", { name: "Import entrants (1)", exact: true }).click();
  await expect(page.getByText("Minsky could not reach the server.")).toBeVisible();
  await expect(box).toHaveValue("");
});

test("a command that starts while another runs says so", async ({ page, local }) => {
  void local;
  test.setTimeout(60_000);
  await openConsole(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/manage", async (route) => {
    if (commandType(route) !== "create_people") return route.fallback();
    await held;
    await route.fallback();
  });
  await page.getByLabel("People, one per line: name, username", { exact: true }).fill("Sam Lee, sam-lee");
  await page.getByRole("button", { name: "Create people (1)", exact: true }).click();
  await page.getByRole("button", { name: "Reset password" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByText("Another change is still running. Try again.")).toBeVisible();
  release();
});
