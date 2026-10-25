import { expect, test } from "./support/worker";

test("page head describes the app and links a served icon", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.locator('head meta[name="description"]')).toHaveAttribute(
    "content",
    /\S+/,
  );
  const iconHref = await page
    .locator('head link[rel="icon"]')
    .getAttribute("href");
  expect(iconHref).toBe("/favicon.svg");

  const response = await page.request.get(iconHref!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\//);
});
