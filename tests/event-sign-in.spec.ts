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

  test("gives an added webmaster a sheet that names Site sign-in", async ({ page, local }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Site sign-in", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("complementary", { name: "Console" }).getByRole("link", { name: "Site", exact: true }).click();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const adding = page.getByRole("dialog", { name: "Add a webmaster" });
    await adding.getByLabel("Name", { exact: true }).fill("Fictional second webmaster");
    await adding.getByLabel("Username", { exact: true }).fill(`site-${crypto.randomUUID().slice(0, 8)}`);
    await adding.getByRole("button", { name: "Add webmaster", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Webmaster password" });
    await expect(sheet.getByLabel("Sign-in page", { exact: true })).toHaveValue(`${new URL(page.url()).origin}/sign-in`);
    await expect(sheet.getByText("On the sign-in page, the user selects Site sign-in.", { exact: false })).toBeVisible();
    expect(local.bodies("/api/credentials")).toHaveLength(1);
  });
});

test("an admin's credential sheet holds the event link, which fills in the code on a new device", async ({ browser, page, local }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation", { name: "Console pages" }).getByRole("button", { name: /^Accounts/ }).click();
  await page.getByRole("button", { name: "Create account" }).click();
  const dialog = page.getByRole("dialog", { name: "Create account" });
  await dialog.getByLabel("Display name", { exact: true }).fill("Fictional desk helper");
  await dialog.getByLabel("Username", { exact: true }).fill("desk-helper");
  await dialog.getByText("Volunteer", { exact: true }).click();
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Share these credentials securely" });
  const link = `${new URL(page.url()).origin}/?event=${local.eventCode}`;
  await expect(sheet.getByLabel("Sign-in link", { exact: true })).toHaveValue(link);
  await expect(sheet.getByLabel("Username", { exact: true })).toHaveValue("desk-helper");

  const device = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await local.attach(device, { newDevice: true });
  const opened = await device.newPage();
  await opened.goto(link);
  await expect(opened.getByLabel("Event code", { exact: true })).toHaveValue(local.eventCode);
  await device.close();
});
