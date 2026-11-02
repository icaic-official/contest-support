import { expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

test("a contestant signs in from the event link on its sheet, and the device remembers the code", async ({ browser, local }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await local.attach(context, { newDevice: true });
  const page = await context.newPage();

  await page.goto("/sign-in");
  await expect(page.getByLabel("Event code", { exact: true })).toHaveValue("");

  await page.goto(`/?event=${local.eventCode}`);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  const code = page.getByLabel("Event code", { exact: true });
  await expect(code).toHaveValue(local.eventCode);
  await page.getByLabel("Username", { exact: true }).fill("contestant");
  const password = crypto.randomUUID();
  await page.getByLabel("Password", { exact: true }).fill(password);

  await code.fill("another-event");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("The event code, username, or password is incorrect.", { exact: true })).toBeVisible();

  await code.fill(local.eventCode);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('[data-ui="contestant"]')).toBeVisible();
  expect(local.bodies("/api/auth/sign-in").at(-1)).toEqual({ event: local.eventCode, handle: "contestant", password });

  await context.clearCookies();
  await page.goto("/sign-in");
  await expect(page.getByLabel("Event code", { exact: true })).toHaveValue(local.eventCode);
  await context.close();
});

test.describe("a webmaster", () => {
  test.use({ webmaster: "admin", viewport: { width: 1280, height: 800 } });

  test("signs in with Site sign-in, which names no event", async ({ page, local }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
    await page.getByLabel("Username", { exact: true }).fill("admin");
    const password = crypto.randomUUID();
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("The event code, username, or password is incorrect.", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Site sign-in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Site sign-in", exact: true })).toBeVisible();
    await expect(page.getByLabel("Event code", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Console" }).getByRole("link", { name: "Site", exact: true })).toBeVisible();
    expect(local.bodies("/api/auth/sign-in").at(-1)).toEqual({ event: null, handle: "admin", password });
  });
});
