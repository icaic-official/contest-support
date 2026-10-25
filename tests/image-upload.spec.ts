import type { Browser } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Signs the volunteer in on a phone, opens the new issue, and opens its upload sheet. */
async function openUploadSheet(browser: Browser, local: LocalWorker) {
  const issueId = await local.act(local.users.volunteer, {
    type: "submit",
    category: "Devices",
    description: "Projector shows no signal",
    team_id: local.teams[0],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await local.attach(context);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("volunteer");
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Open ISS-1,/ }).click();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: /^Add an image/ }).click();
  const sheet = page.getByRole("dialog", { name: "Add an image" });
  return {
    page,
    sheet,
    file: sheet.getByLabel("Image file"),
    add: sheet.getByRole("button", { name: "Add image", exact: true }),
    status: sheet.getByRole("status"),
    images: async () =>
      (await local.snapshot(local.users.volunteer)).attachments.filter(
        (item) => item.issue_id === issueId,
      ),
  };
}

test("an uploaded image leaves the form empty so a second tap adds nothing", async ({
  browser,
  local,
}) => {
  const { sheet, file, add, status, images } = await openUploadSheet(
    browser,
    local,
  );

  await sheet.getByText("Visible to the team", { exact: true }).click();
  await file.setInputFiles({ name: "first.png", mimeType: "image/png", buffer: png });
  await add.click();
  await expect(status).toHaveText("Image added.");
  expect(await images()).toHaveLength(1);

  await expect(file).toHaveValue("");
  await expect(
    sheet.getByRole("radio", { name: /^Visible to the team/ }),
  ).toBeChecked();

  await add.click();
  await expect(status).toHaveText("Choose a JPEG, PNG, or WebP image.");
  expect(await images()).toHaveLength(1);

  await file.setInputFiles({ name: "second.png", mimeType: "image/png", buffer: png });
  await expect(status).toHaveCount(0);
  await add.click();
  await expect(status).toHaveText("Image added.");
  await expect(file).toHaveValue("");
  const attached = await images();
  expect(attached.map((item) => item.original_name).sort()).toEqual([
    "first.png",
    "second.png",
  ]);
  expect(attached.map((item) => item.visibility)).toEqual(["public", "public"]);
});

test("a failed upload keeps its file for the retry, and the retry empties the form", async ({
  browser,
  local,
}) => {
  const { sheet, file, add, status, images } = await openUploadSheet(
    browser,
    local,
  );

  local.loseNext("/api/image", "request");
  await file.setInputFiles({ name: "retry.png", mimeType: "image/png", buffer: png });
  await add.click();
  const retry = sheet.getByRole("button", { name: "Try the upload again" });
  await expect(retry).toBeVisible();
  await expect(file).not.toHaveValue("");
  expect(await images()).toHaveLength(0);

  await retry.click();
  await expect(status).toHaveText("Image added.");
  await expect(file).toHaveValue("");
  expect(await images()).toHaveLength(1);
});
