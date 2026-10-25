import { expect, type Page, test } from "@playwright/test";
import { documentationUrl } from "../src/lib/links";

test("centered sign-in explains access and keeps unauthenticated users outside the workspace", async ({
  page,
}, testInfo) => {
  await page.goto("/sign-in");
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
  await expect(page.getByText(/^Build [0-9a-f]{7}$|^Build unknown$/)).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Workspace navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/LOCAL DEMO|Demo persona|Reset demo/),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1505, height: 1045 });
  await page.evaluate(() => document.fonts.ready);
  const form = await page
    .getByRole("region", { name: "Sign in", exact: true })
    .boundingBox();
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
  await page.goto("/sign-in");
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
  await page.goto("/sign-in");
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
  await expect(page.getByRole("heading", { name: "Sign in", exact: true }))
    .toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

const headline = "Contest problems, solved on the clock.";

/** The decorative issue card. Assistive technology skips it, so find it by its text. */
function demoCard(page: Page) {
  return page.locator('[aria-hidden="true"]', {
    hasText: "Monitor goes black every few minutes",
  });
}

test("the landing page links to sign-in and the guides", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: headline }),
  ).toBeVisible();
  const hero = page.getByRole("region", { name: headline });
  const links = [
    page.locator("header").getByRole("link", { name: "Docs", exact: true }),
    hero.getByRole("link", { name: "Read the docs", exact: true }),
  ];
  for (const link of links) {
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", documentationUrl);
    await expect(link).not.toHaveAttribute("target", /.+/);
  }
  await expect(
    page.locator("header").getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    hero.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Organizers create every account. There is no public sign-up."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "How an issue moves" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Who uses Minsky" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Replies and notes stay apart" }),
  ).toBeVisible();
  await expect(page.getByLabel("Username", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
});

test("Sign in on the landing page opens the sign-in page and the brand returns", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("region", { name: headline })
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: headline })).toHaveCount(0);
  await page.getByRole("link", { name: "Minsky", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { level: 1, name: headline }),
  ).toBeVisible();
});

test("a signed-out deep link goes through sign-in", async ({ page }) => {
  await page.goto("/issues");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: headline })).toHaveCount(0);
});

test("the landing page shows the build ID and supports skip navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText(/^Build [0-9a-f]{7}$|^Build unknown$/)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("the landing page fits phone widths and keeps the hero buttons large", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const hero = page.getByRole("region", { name: headline });
  for (const width of [800, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    for (const name of ["Sign in", "Read the docs"]) {
      const box = await hero
        .getByRole("link", { name, exact: true })
        .boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    const signIn = await page
      .locator("header")
      .getByRole("link", { name: "Sign in", exact: true })
      .boundingBox();
    expect(signIn).not.toBeNull();
    expect(signIn!.x + signIn!.width).toBeLessThanOrEqual(width);
  }
  await page.screenshot({
    path: testInfo.outputPath("landing-320.png"),
    fullPage: true,
  });
});

/**
 * Stops time before the page loads, so only `clock.runFor` moves the demo.
 * A running fake clock also follows real time, which varies on a busy machine.
 */
async function freezeClock(page: Page) {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
}

test("the demo replays the lifecycle and the timer stops on resolution", async ({
  page,
}) => {
  await freezeClock(page);
  await page.goto("/");
  const card = demoCard(page);
  const reported = card.getByText("Team Blue Herons reported the issue.");
  const claimed = card.getByText("Ana claimed the issue.");
  const escalated = card.getByText(/^Ana asked Hardware for help\./);
  const resolved = card.getByText("Ravi resolved the issue.");
  await expect(reported).toBeVisible();
  await expect(claimed).toBeHidden();
  const opening = await card.innerText();
  await page.clock.runFor(1000);
  await expect.poll(() => card.innerText()).not.toBe(opening);

  await page.clock.runFor(2000);
  await expect(claimed).toBeVisible();
  await expect(card.getByText("On our way to table C7.")).toBeVisible();
  await expect(escalated).toBeHidden();

  await page.clock.runFor(2400);
  await expect(escalated).toBeVisible();
  await expect(card.getByText("Swap the DisplayPort cable first.")).toBeVisible();
  await expect(card.getByText("Internal note · staff only")).toBeVisible();
  await expect(resolved).toBeHidden();

  await page.clock.runFor(2400);
  await expect(resolved).toBeVisible();
  await expect(card.getByText("Summary: replaced the cable.")).toBeVisible();
  const stopped = await card.innerText();
  await page.clock.runFor(2000);
  expect(await card.innerText()).toBe(stopped);

  await page.clock.runFor(3000);
  await expect(resolved).toBeHidden();
  await expect(reported).toBeVisible();
});

test("with reduced motion the demo shows the resolved issue and does not change", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await freezeClock(page);
  await page.goto("/");
  const card = demoCard(page);
  const entries = [
    "Team Blue Herons reported the issue.",
    "Ana claimed the issue.",
    "Ana asked Hardware for help.",
    "Ravi resolved the issue.",
    "Summary: replaced the cable.",
  ];
  for (const entry of entries) {
    await expect(card.getByText(entry)).toBeVisible();
  }
  const before = await card.innerText();
  await page.clock.runFor(60_000);
  expect(await card.innerText()).toBe(before);
  await expect(card.getByText("Ravi resolved the issue.")).toBeVisible();
});
