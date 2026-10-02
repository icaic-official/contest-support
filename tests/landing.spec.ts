import { expect, test } from "@playwright/test";

test("centered sign-in explains access and keeps unauthenticated users outside the workspace", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Access your contest workspace.")).toBeVisible();
  await expect(
    page.getByText("Accounts are created by contest organizers.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Contact your contest organizers.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Workspace navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/LOCAL DEMO|Demo persona|Reset demo/),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1505, height: 1045 });
  await page.evaluate(() => document.fonts.ready);
  const form = await page.locator(".sign-in-panel").boundingBox();
  expect(form).not.toBeNull();
  expect(Math.abs(form!.x + form!.width / 2 - 1505 / 2)).toBeLessThan(2);
  await page.screenshot({
    path: testInfo.outputPath("sign-in-desktop.png"),
    fullPage: true,
  });
});

test("password visibility works by keyboard without changing the password", async ({
  page,
}) => {
  await page.goto("/");
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("example-password");
  await expect(password).toHaveAttribute("type", "password");
  const toggle = page.getByRole("button", {
    name: "Show password",
    exact: true,
  });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("example-password");
  await expect(
    page.getByRole("button", { name: "Hide password", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue("example-password");
});

test("sign-in fits phone widths and supports skip navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  for (const width of [800, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const username = await page
      .getByLabel("Username", { exact: true })
      .boundingBox();
    expect(username).not.toBeNull();
    expect(username!.x).toBeGreaterThanOrEqual(0);
    expect(username!.x + username!.width).toBeLessThanOrEqual(width);
    expect(username!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({
    path: testInfo.outputPath("sign-in-320.png"),
    fullPage: true,
  });
  await page.reload();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});
