import type { Locator } from "@playwright/test";
import {
  SESSION_ID,
  TEAM_ID,
  USER_ID,
  expect,
  fixtureAccount,
  sessionSnapshot,
  test,
} from "./support/worker";

type Pixel = number[];

/**
 * Reads the text color and the opaque background that the browser paints for
 * an element. A canvas resolves any CSS color syntax, and it blends a
 * translucent text color or background over the ones below it.
 */
async function paintedColors(
  locator: Locator,
): Promise<{ text: Pixel; background: Pixel }> {
  return locator.evaluate((element) => {
    const context = document
      .createElement("canvas")
      .getContext("2d", { willReadFrequently: true })!;
    const read = () => Array.from(context.getImageData(0, 0, 1, 1).data);
    const backgrounds: string[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      backgrounds.push(getComputedStyle(node).backgroundColor);
    }
    for (const color of backgrounds.reverse()) {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
    }
    const background = read();
    context.fillStyle = getComputedStyle(element).color;
    context.fillRect(0, 0, 1, 1);
    return { text: read(), background };
  });
}

/** The WCAG contrast ratio of the text of an element against its background. */
async function contrastOf(locator: Locator): Promise<number> {
  const { text, background } = await paintedColors(locator);
  const luminance = ([r, g, b]: Pixel) => {
    const linear = (value: number) => {
      const unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  const [lighter, darker] = [luminance(text), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test("the Reconnecting badge text is readable", async ({ page, api }) => {
      api.account = fixtureAccount(USER_ID, "contrast", "Contrast fixture");
      api.snapshots = () => [
        sessionSnapshot({
          session_id: SESSION_ID,
          user_id: USER_ID,
          team_id: TEAM_ID,
          roles: [],
          is_admin: false,
        }),
      ];
      // A closed live channel keeps the contestant top bar on Reconnecting.
      await page.routeWebSocket(/\/api\/updates/, (socket) => socket.close());
      await page.goto("/sign-in");
      await page.getByLabel("Username", { exact: true }).fill("contrast");
      await page.getByLabel("Password", { exact: true }).fill("fixture-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const badge = page.getByRole("status").filter({ hasText: "Reconnecting" });
      await expect(badge).toBeVisible();
      expect(await contrastOf(badge)).toBeGreaterThanOrEqual(4.5);
    });

    test("an error alert is readable", async ({ page, api }) => {
      api.account = fixtureAccount(USER_ID, "contrast", "Contrast fixture");
      await page.route("**/api/auth/sign-in", (route) => route.abort("failed"));
      await page.goto("/sign-in");
      await page.getByLabel("Username", { exact: true }).fill("contrast");
      await page.getByLabel("Password", { exact: true }).fill("fixture-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const message = page
        .getByRole("alert")
        .locator('[data-slot="alert-description"]');
      await expect(message).toBeVisible();
      expect(await contrastOf(message)).toBeGreaterThanOrEqual(4.5);
    });
  });
}
