import type { Browser, Locator, Page } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };

const png = (name: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
});

async function signIn(
  browser: Browser,
  local: LocalWorker,
  name: string,
  viewport = desktop,
): Promise<Page> {
  const context = await browser.newContext({ viewport });
  await local.attach(context);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  return page;
}

function report(local: LocalWorker): Promise<string> {
  return local.act(local.users.volunteer, {
    type: "submit",
    category: "Backend",
    description: "Keyboard stopped responding",
    team_id: local.teams[0],
  });
}

function contestantThumbs(page: Page): Locator {
  return page
    .getByRole("region", { name: "Images", exact: true })
    .getByRole("button", { name: /^View image uploaded by / });
}

test("an admin without a support role replies to the team and writes an internal note", async ({
  browser,
  local,
}) => {
  const issueId = await report(local);
  const recorded = async () =>
    (await local.snapshot(local.users.admin)).history
      .filter((item) => item.issue_id === issueId && item.actor === local.users.admin)
      .map((item) => [item.text, item.visibility]);

  const admin = await signIn(browser, local, "admin");
  await admin.getByText("Keyboard stopped responding").first().click();
  const sheet = admin.getByRole("dialog", { name: /ISS-1: Keyboard stopped responding/ });
  await expect(sheet.getByRole("button", { name: "Claim" })).toHaveCount(0);

  await sheet.getByRole("textbox", { name: "Message", exact: true }).fill("A helper is on the way.");
  await sheet.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(recorded).toEqual([["A helper is on the way.", "public"]]);

  await sheet
    .getByRole("group", { name: "Audience", exact: true })
    .getByText("Internal note", { exact: true })
    .click();
  await sheet.getByRole("textbox", { name: "Internal note", exact: true }).fill("Swap the USB hub first.");
  await sheet.getByRole("button", { name: "Add note", exact: true }).click();
  await expect.poll(async () => (await recorded()).length).toBe(2);
  expect(await recorded()).toContainEqual(["Swap the USB hub first.", "internal"]);

  const contestant = await signIn(browser, local, "contestant");
  await expect(contestant.getByText("A helper is on the way.", { exact: true })).toBeVisible();
  await expect(contestant.getByText("Swap the USB hub first.")).toHaveCount(0);
});

test("an admin without a support role attaches images from the reply composer, and the team sees only the team image", async ({
  browser,
  local,
}) => {
  const issueId = await report(local);
  const visibilities = async (user: string) =>
    (await local.snapshot(user)).attachments
      .filter((item) => item.issue_id === issueId)
      .map((item) => item.visibility)
      .sort();

  const admin = await signIn(browser, local, "admin");
  await admin.getByText("Keyboard stopped responding").first().click();
  const sheet = admin.getByRole("dialog", { name: /ISS-1: Keyboard stopped responding/ });
  await sheet.getByRole("button", { name: "Attach an image", exact: true }).click();
  const upload = admin.getByRole("dialog", { name: "Add an image" });
  await upload.getByLabel("Image file").setInputFiles(png("staff.png"));
  await upload.getByRole("button", { name: "Add image", exact: true }).click();
  await expect(upload.getByRole("status")).toHaveText("Image added.");
  await upload.getByText("Visible to the team", { exact: true }).click();
  await upload.getByLabel("Image file").setInputFiles(png("team.png"));
  await upload.getByRole("button", { name: "Add image", exact: true }).click();
  await expect.poll(() => visibilities(local.users.admin)).toEqual(["internal", "public"]);
  expect(await visibilities(local.users.contestant)).toEqual(["public"]);

  const contestant = await signIn(browser, local, "contestant");
  await expect(contestant.getByText("Keyboard stopped responding").first()).toBeVisible();
  await expect(contestantThumbs(contestant)).toHaveCount(1);
});

test("an admin attaches an image from the phone reply sheet and returns to the draft", async ({
  browser,
  local,
}) => {
  const issueId = await report(local);
  const admin = await signIn(browser, local, "admin", phone);
  await admin.getByRole("button", { name: /^Open ISS-1,/ }).click();
  await admin.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = admin.getByRole("dialog", { name: "Reply", exact: true });
  await reply.getByLabel("Message").fill("Here is a photo of the cable.");
  await reply.getByRole("button", { name: "Attach an image", exact: true }).click();

  const upload = admin.getByRole("dialog", { name: "Add an image" });
  await upload.getByText("Visible to the team", { exact: true }).click();
  await upload.getByLabel("Image file").setInputFiles(png("cable.png"));
  await upload.getByRole("button", { name: "Add image", exact: true }).click();
  await expect(upload.getByRole("status")).toHaveText("Image added.");
  await upload.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(upload).toBeHidden();
  await expect(reply.getByLabel("Message")).toHaveValue("Here is a photo of the cable.");
  await admin.keyboard.press("Tab");
  expect(await reply.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await reply.getByRole("button", { name: "Send to team", exact: true }).click();
  await expect(reply).toHaveCount(0);
  const state = await local.snapshot(local.users.contestant);
  expect(state.attachments.filter((item) => item.issue_id === issueId)).toHaveLength(1);
  expect(state.history.map((item) => item.text)).toContain("Here is a photo of the cable.");
});
