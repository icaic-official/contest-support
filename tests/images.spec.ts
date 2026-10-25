import type { Locator } from "@playwright/test";
import { expect, test } from "./support/worker";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function thumbs(region: Locator): Locator {
  return region.getByRole("button", { name: /^View image uploaded by / });
}

for (const response of ["slow", "fail"] as const) {
  for (const close of ["button", "Escape"] as const) {
    test(`a ${response} image response cannot change a newer preview after ${close}`, async ({ page }) => {
      await page.clock.install({ time: new Date("2026-10-17T00:00:00Z") });
      await page.goto(`/image-preview.html?previewResponse=${response}`);
      await page.clock.pauseAt(new Date("2026-10-17T00:01:00Z"));
      const staff = page.getByRole("region", { name: "Staff images" });
      await staff.getByLabel("Image file").setInputFiles({
        name: "new.png",
        mimeType: "image/png",
        buffer: png,
      });
      await staff.getByRole("button", { name: "Add image", exact: true }).click();
      await expect(thumbs(staff)).toHaveCount(2);

      const dialog = staff.getByRole("dialog");
      await thumbs(staff).first().click();
      await expect(dialog.getByText("Opening image.")).toBeVisible();
      if (close === "button") {
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
      } else {
        await page.keyboard.press("Escape");
      }
      await expect(dialog).toBeHidden();
      await expect(thumbs(staff).first()).toBeFocused();
      await thumbs(staff).last().click();
      const download = dialog.getByRole("link", { name: "Download image" });
      await expect(download).toHaveAttribute("download", "new.png");
      const currentUrl = await download.getAttribute("href");
      if (!currentUrl) throw new Error("The newer preview has no download URL.");
      await expect(dialog.getByRole("img")).toHaveAttribute("src", currentUrl);

      // Finish the older request only after the newer image is displayed.
      await page.clock.runFor(10_000);
      await expect(download).toHaveAttribute("href", currentUrl);
      await expect(download).toHaveAttribute("download", "new.png");
      await expect(dialog.getByRole("img")).toHaveAttribute("src", currentUrl);
      await expect(staff.getByRole("status")).toHaveText("Image added.");
    });
  }
}

test("a failed current image request still reports its error", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-17T00:00:00Z") });
  await page.goto("/image-preview.html?previewResponse=fail");
  await page.clock.pauseAt(new Date("2026-10-17T00:01:00Z"));
  const staff = page.getByRole("region", { name: "Staff images" });
  await thumbs(staff).click();
  await expect(staff.getByRole("dialog").getByText("Opening image.")).toBeVisible();
  await page.clock.runFor(10_000);
  await staff.getByRole("button", { name: "Close", exact: true }).click();
  await expect(staff.getByRole("status")).toHaveText("This image could not be opened.");
});

test("staff can preview, validate, and retry an image on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/image-preview.html");
  const staff = page.getByRole("region", { name: "Staff images" });
  const thumb = staff.getByRole("button", { name: /View image uploaded by Ada Lovelace/ });
  await thumb.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img", { name: /Image uploaded by Ada Lovelace/ })).toBeVisible();
  const previewUrl = await dialog.getByRole("link", { name: "Download image" }).getAttribute("href");
  if (!previewUrl) throw new Error("The preview has no download URL.");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(thumb).toBeFocused();
  await expect.poll(() => page.evaluate(async (url) => {
    return fetch(url).then(() => false, () => true);
  }, previewUrl)).toBe(true);

  await staff.getByLabel("Image file").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await staff.getByRole("button", { name: "Add image" }).click();
  await expect(staff.getByText("Choose a JPEG, PNG, or WebP image.")).toBeVisible();

  await staff.getByLabel("Who can see this image").selectOption("public");
  await staff.getByLabel("Image file").setInputFiles({
    name: "fail.png",
    mimeType: "image/png",
    buffer: png,
  });
  await staff.getByRole("button", { name: "Add image" }).click();
  await expect(staff.getByRole("button", { name: "Try the upload again" })).toBeVisible();
  await expect(staff.getByLabel("Who can see this image")).toBeDisabled();
  await expect(staff.getByLabel("Who can see this image")).toHaveValue("public");
  await expect(staff.getByText("Uploading image,")).toBeHidden();
  await staff.getByRole("button", { name: "Try the upload again" }).click();
  await expect(staff.getByText("Image added.")).toBeVisible();
  await expect(thumbs(staff)).toHaveCount(2);
  await expect(thumbs(staff).getByText("Staff only", { exact: true })).toHaveCount(1);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  );
  expect(overflow).toBe(true);
});

test("canceling a failed upload permits a new visibility choice", async ({ page }) => {
  await page.goto("/image-preview.html");
  const staff = page.getByRole("region", { name: "Staff images" });
  await staff.getByLabel("Who can see this image").selectOption("public");
  await staff.getByLabel("Image file").setInputFiles({ name: "fail.png", mimeType: "image/png", buffer: png });
  await staff.getByRole("button", { name: "Add image", exact: true }).click();
  await expect(staff.getByRole("button", { name: "Cancel upload" })).toBeEnabled();
  await staff.getByRole("button", { name: "Cancel upload" }).click();
  await expect(staff.getByLabel("Who can see this image")).toBeEnabled();
  await staff.getByLabel("Who can see this image").selectOption("internal");
  await staff.getByLabel("Image file").setInputFiles({ name: "new.png", mimeType: "image/png", buffer: png });
  await staff.getByRole("button", { name: "Add image", exact: true }).click();
  await expect(staff.getByText("Image added.")).toBeVisible();
  await expect(thumbs(staff)).toHaveCount(2);
  await expect(thumbs(staff).getByText("Staff only", { exact: true })).toHaveCount(2);
});

test("failed file deletion remains retryable after the image row disappears", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/image-preview.html");
  const staff = page.getByRole("region", { name: "Staff images" });
  await thumbs(staff).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove image" }).click();
  await expect(thumbs(staff)).toHaveCount(0);
  await expect(staff.getByRole("status")).toHaveText("The stored files could not be deleted. Try again.");
  await staff.getByRole("button", { name: "Retry removal" }).click();
  await expect(staff.getByRole("status")).toHaveText("Image removed.");
  await expect(staff.getByRole("button", { name: "Retry removal" })).toHaveCount(0);
});

test("retrying a lost completion response does not attach the image twice", async ({ page }) => {
  await page.goto("/image-preview.html");
  const staff = page.getByRole("region", { name: "Staff images" });
  await staff.getByLabel("Image file").setInputFiles({ name: "finish-response.png", mimeType: "image/png", buffer: png });
  await staff.getByRole("button", { name: "Add image", exact: true }).click();
  await expect(staff.getByRole("button", { name: "Try the upload again" })).toBeVisible();
  await expect(thumbs(staff)).toHaveCount(2);
  await staff.getByRole("button", { name: "Try the upload again" }).click();
  await expect(staff.getByText("Image added.")).toBeVisible();
  await expect(thumbs(staff)).toHaveCount(2);
});

test("file removal can resume from the server's saved cleanup status after refresh", async ({ page }) => {
  await page.goto("/image-preview.html");
  await page.reload();
  const pending = page.getByRole("region", { name: "Pending removal", exact: true });
  await expect(thumbs(pending)).toHaveCount(0);
  await pending.getByRole("button", { name: "Retry removal" }).click();
  await expect(pending.getByRole("status")).toHaveText("Image removed.");
  await expect(pending.getByRole("button", { name: "Retry removal" })).toHaveCount(0);
});

test("contestant and archived image controls stay within a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/image-preview.html");
  const contestant = page.getByRole("region", { name: "Contestant images" });
  await expect(contestant.getByLabel("Image file")).toHaveCount(0);
  await expect(contestant.getByText("Staff only")).toHaveCount(0);
  await expect(contestant.getByRole("button", { name: /View image uploaded by Ada Lovelace/ }))
    .toBeVisible();
  const archived = page.getByRole("region", { name: "Archived images" });
  await expect(archived.getByLabel("Image file")).toHaveCount(0);
  await expect(archived.getByText("Images cannot be added.")).toBeVisible();
  await archived.getByRole("button", { name: /View image uploaded by Ada Lovelace/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  );
  expect(overflow).toBe(true);
});
