import { expect, test } from "./support/localWorker";

// A webmaster starts a second site change while the first still runs.
test.use({ seedIssues: false, webmaster: "admin", withEventAdmin: false });

test("a site change that starts while another runs says so", async ({ page, local }) => {
  void local;
  test.setTimeout(60_000);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Site sign-in", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.goto("/site");
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/manage", async (route) => {
    await held;
    await route.fallback();
  });
  const setting = page.getByRole("switch", { name: "Webmasters read contest data only after joining" });
  await expect(setting).toBeVisible();
  // The switch stays enabled while its change runs, so a second click starts a second change.
  await setting.click();
  await setting.click();
  await expect(page.getByText("Another change is still running. Try again.")).toBeVisible();
  release();
});
