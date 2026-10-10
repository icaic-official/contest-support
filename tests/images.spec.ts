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

  await staff.getByLabel("Image file").setInputFiles({
    name: "fail.png",
    mimeType: "image/png",
    buffer: png,
  });
  await staff.getByRole("button", { name: "Add image" }).click();
  await expect(staff.getByRole("button", { name: "Try the upload again" })).toBeVisible();
  await expect(staff.getByText("Uploading image,")).toBeHidden();
  await staff.getByRole("button", { name: "Try the upload again" }).click();
  await expect(staff.getByText("Image added.")).toBeVisible();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  );
  expect(overflow).toBe(true);
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
