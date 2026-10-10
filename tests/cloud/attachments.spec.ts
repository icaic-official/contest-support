import { expect, test, type Page } from "@playwright/test";
import { account, fixture } from "./fixture";

async function login(page: Page, name: string) {
  const details = fixture().accounts[name];
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(details.username);
  await page.getByLabel("Password", { exact: true }).fill(details.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-heading")).toBeVisible();
}

test("hosted staff images upload, download, respect visibility, and can be removed", async ({ page }) => {
  const state = fixture();
  const volunteer = await account("volunteer");
  const description = `Image verification ${crypto.randomUUID()}`;
  const submitted = await volunteer.rpc("workflow", {
    p_session: state.sessions[0],
    p_request: crypto.randomUUID(),
    p_action: {
      type: "submit", team_id: state.teams[0], category: "Other", description,
    },
  });
  expect(submitted.error).toBeNull();
  await login(page, "volunteer");
  await page.locator(".issue-card").filter({ hasText: description }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const png = await page.screenshot();
  const images = page.locator(".images");
  for (const visibility of ["internal", "public"]) {
    await images.getByLabel("Who can see this image").selectOption(visibility);
    await images.getByLabel("Image file").setInputFiles({
      name: `${visibility}.png`, mimeType: "image/png", buffer: png,
    });
    await images.getByRole("button", { name: "Add image", exact: true }).click();
    await expect(images.getByRole("status")).toHaveText("Image added.");
  }
  await expect(images.locator(".image-thumb")).toHaveCount(2);
  await page.reload();
  await page.locator(".issue-card").filter({ hasText: description }).click();
  await expect(images.locator(".image-thumb")).toHaveCount(2);
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  )).toBe(true);

  const rows = await volunteer.from("attachments")
    .select("id,visibility").eq("issue_id", submitted.data);
  expect(rows.error).toBeNull();
  expect(rows.data).toHaveLength(2);
  const internal = rows.data?.find((image) => image.visibility === "internal");
  const visible = rows.data?.find((image) => image.visibility === "public");
  expect(internal).toBeDefined();
  expect(visible).toBeDefined();
  if (!internal || !visible) throw new Error("Missing uploaded fixture images.");
  const contestant = await account("contestant");
  const seen = await contestant.from("attachments").select("id").eq("issue_id", submitted.data);
  expect(seen.error).toBeNull();
  expect(seen.data).toEqual([{ id: visible.id }]);
  const privatePath = `${state.sessions[0]}/${submitted.data}/${internal.id}/original`;
  expect((await contestant.storage.from("issue-attachments").download(privatePath)).error)
    .not.toBeNull();
  const otherTeam = await account("cedar");
  const publicPath = `${state.sessions[0]}/${submitted.data}/${visible.id}/original`;
  expect((await otherTeam.storage.from("issue-attachments").download(publicPath)).error)
    .not.toBeNull();

  await images.locator(".image-thumb").filter({ hasText: "Staff only" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img")).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download image" }).click();
  expect((await downloaded).suggestedFilename()).toBe("internal.png");
  await dialog.getByRole("button", { name: "Remove image" }).click();
  await expect(dialog).toBeHidden();
  await expect(images.locator(".image-thumb")).toHaveCount(1);
  expect((await volunteer.storage.from("issue-attachments").download(privatePath)).error)
    .not.toBeNull();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "contestant");
  await page.locator(".issue-card").filter({ hasText: description }).click();
  await expect(images.locator(".image-thumb")).toHaveCount(1);
  await expect(images.getByLabel("Image file")).toHaveCount(0);
  await images.locator(".image-thumb").click();
  await expect(dialog.getByRole("img")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove image" })).toHaveCount(0);
});
