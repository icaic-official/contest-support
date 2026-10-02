import { expect, test } from "@playwright/test";

test("public landing page links to login and explains organizer-provided access", async ({ page }) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await navigation.getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/#how-it-works$/);
  await expect(
    page.getByRole("heading", {
      name: "From the first report to the final decision.",
    }),
  ).toBeVisible();
  await navigation.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/#sign-in$/);
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Use the username and password provided by your organizer."),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace navigation" }))
    .toHaveCount(0);
  await expect(page.getByText(/LOCAL DEMO|Demo persona|Reset demo/))
    .toHaveCount(0);
});

test("login and recovery help work at narrow widths and with a keyboard", async ({ page }) => {
  await page.goto("/");
  for (const width of [800, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth
      ),
    ).toBe(true);
    const username = await page.getByLabel("Username", { exact: true })
      .boundingBox();
    expect(username).not.toBeNull();
    expect(username!.x).toBeGreaterThanOrEqual(0);
    expect(username!.x + username!.width).toBeLessThanOrEqual(width);
    expect(username!.height).toBeGreaterThanOrEqual(44);
  }
  const help = page.getByRole("button", { name: "Forgot password?" });
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(help).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("status")).toContainText(
    "Contact your contest organizer.",
  );
  await page.keyboard.press("Enter");
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" }))
    .toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});
