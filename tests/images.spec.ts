import { expect, test } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(thumb).toBeFocused();

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
  await expect(staff.locator(".image-thumb")).toHaveCount(2);
  await expect(staff.locator(".image-thumb").getByText("Staff only", { exact: true })).toHaveCount(1);
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
  await expect(staff.locator(".image-thumb")).toHaveCount(2);
  await expect(staff.locator(".image-thumb").getByText("Staff only", { exact: true })).toHaveCount(2);
});

test("failed file deletion remains retryable after the image row disappears", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/image-preview.html");
  const staff = page.getByRole("region", { name: "Staff images" });
  await staff.locator(".image-thumb").click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove image" }).click();
  await expect(staff.locator(".image-thumb")).toHaveCount(0);
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
  await expect(staff.locator(".image-thumb")).toHaveCount(2);
  await staff.getByRole("button", { name: "Try the upload again" }).click();
  await expect(staff.getByText("Image added.")).toBeVisible();
  await expect(staff.locator(".image-thumb")).toHaveCount(2);
});

test("file removal can resume from the server's saved cleanup status after refresh", async ({ page }) => {
  await page.goto("/image-preview.html");
  await page.reload();
  const pending = page.getByRole("region", { name: "Pending removal", exact: true });
  await expect(pending.locator(".image-thumb")).toHaveCount(0);
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
