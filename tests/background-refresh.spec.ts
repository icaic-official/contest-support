import { expect, test } from "./support/localWorker";

// A tab in the background shows nothing, so live hints must not make it read
// the session. It reads once when the person returns.
test("a background tab does not read on live hints and catches up on return", async ({ page, local }) => {
  await page.addInitScript(() => {
    // Headless Chromium has no real background state, so the test sets it.
    let state = "visible";
    Object.defineProperty(document, "visibilityState", { get: () => state, configurable: true });
    Object.defineProperty(window, "__setVisibility", {
      value: (next: string) => {
        state = next;
        document.dispatchEvent(new Event("visibilitychange"));
      },
    });
  });
  let reads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/snapshot") reads++;
  });
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("volunteer");
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThan(0);
  // Let the first reads settle.
  await page.waitForTimeout(500);

  await page.evaluate(() => (window as unknown as { __setVisibility(s: string): void }).__setVisibility("hidden"));
  const before = reads;
  for (let i = 0; i < 5; i++) local.notify();
  await page.waitForTimeout(1000);
  expect(reads).toBe(before);

  await page.evaluate(() => (window as unknown as { __setVisibility(s: string): void }).__setVisibility("visible"));
  await expect.poll(() => reads).toBeGreaterThan(before);
});
