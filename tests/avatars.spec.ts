import type { Locator, Page } from "@playwright/test";
import { ImageRequestError } from "../src/backend/errors";
import { expect, test } from "./support/worker";
import {
  BEN_ID,
  openApp,
  picture,
  SERVER_TIME,
  team,
  USER_ID,
} from "./support/avatarServer";
import {
  blue,
  green,
  leftRedRightBlue,
  noise,
  png,
  red,
  solid,
  withOrientation,
} from "./support/pictures";

/** The picture inside an avatar. The empty alt text hides it from role queries. */
const shown = (scope: Locator) => scope.locator('img[src^="blob:"]');

const sidebarCard = (page: Page) =>
  page.getByRole("button", { name: /^Account settings for/ });

test("staff see their own picture and a colleague's picture, and each downloads once", async ({
  page,
  api,
}) => {
  const server = await openApp(page, api, {
    pictures: [
      [USER_ID, solid(64, 64, green)],
      [BEN_ID, solid(64, 64, red)],
    ],
  });
  await expect(shown(sidebarCard(page))).toBeVisible();
  const owner = page.locator("tbody tr").first().getByRole("cell").nth(4);
  await expect(owner).toContainText("Ben Okoro");
  await expect(shown(owner)).toBeVisible();
  await sidebarCard(page).click();
  await expect(page).toHaveURL("/account");
  const header = page.getByRole("heading", { name: "My account", exact: true });
  await expect(header).toBeFocused();
  // The sidebar card, the page header and the Profile row.
  await expect(shown(page.locator("main"))).toHaveCount(3);
  for (const image of await shown(page.locator("body")).all()) {
    expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(64);
  }
  const ours = server.pictures.get(USER_ID)!.id;
  const theirs = server.pictures.get(BEN_ID)!.id;
  expect([...server.downloads].sort()).toEqual([ours, theirs].sort());
});

test("a team account reads and shows only its own picture", async ({ page, api }) => {
  const server = await openApp(page, api, {
    membership: team,
    startPath: "/account",
    pictures: [
      [USER_ID, solid(64, 64, blue)],
      [BEN_ID, solid(64, 64, red)],
    ],
  });
  // The page header and the Profile row.
  await expect(shown(page.locator('[data-ui="contestant"]'))).toHaveCount(2);
  expect(server.lists.at(-1)).toEqual([server.pictures.get(USER_ID)!.id]);
  expect(server.downloads).toEqual([server.pictures.get(USER_ID)!.id]);
});

test("a picture that cannot be decoded falls back to initials", async ({ page, api }) => {
  await openApp(page, api, { pictures: [[USER_ID, Buffer.from("This is not an image.")]] });
  const card = sidebarCard(page);
  await expect(card).toContainText("AL");
  await expect(shown(card)).toHaveCount(0);
});

test("a changed picture replaces the old one and revokes its URL", async ({ page, api }) => {
  await page.clock.install({ time: new Date(SERVER_TIME) });
  const server = await openApp(page, api, { pictures: [[USER_ID, solid(64, 64, green)]] });
  const image = shown(sidebarCard(page));
  await expect(image).toBeVisible();
  const before = await image.getAttribute("src");
  server.pictures.set(USER_ID, picture(solid(64, 64, blue)));
  // A picture change sends no live hint. A connected client sees it on the 60-second refresh.
  await page.clock.fastForward(60_000);
  await expect(image).not.toHaveAttribute("src", before!);
  expect(
    await page.evaluate(
      (url) => fetch(url).then(() => true, () => false),
      before!,
    ),
  ).toBe(false);
});

/** Decodes the bytes that the server received and reads the color at each point. */
async function inspect(page: Page, bytes: Buffer, points: [number, number][]) {
  return page.evaluate(
    async ({ data, at }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)]));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      return {
        width: bitmap.width,
        height: bitmap.height,
        colors: at.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]),
      };
    },
    { data: [...bytes], at: points },
  );
}

const chooser = (page: Page) => page.getByLabel("Choose a profile picture");
const changeButton = (page: Page) =>
  page.getByRole("button", { name: "Change picture", exact: true });
const removeButton = (page: Page) =>
  page.getByRole("button", { name: "Remove picture", exact: true });
const previewDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Use this picture?" });

async function choose(page: Page, name: string, buffer: Buffer, mimeType = "image/png") {
  await chooser(page).setInputFiles({ name, mimeType, buffer });
}

const isJpeg = (bytes: Buffer) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

test("a staff account crops, previews and saves a picture, then sees it everywhere", async ({
  page,
  api,
}) => {
  const server = await openApp(page, api, { startPath: "/account" });
  await expect(shown(page.locator("main"))).toHaveCount(0);
  await choose(page, "me.png", leftRedRightBlue(1200, 800));
  const dialog = previewDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img", { name: /cropped to a square/ })).toBeVisible();
  expect(server.uploads).toHaveLength(0);
  await dialog.getByRole("button", { name: "Save picture", exact: true }).click();
  await expect(page.getByText("Profile picture updated.")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  // The header, the Profile row and the sidebar card show the new picture.
  await expect(shown(page.locator("main"))).toHaveCount(3);
  expect(server.uploads).toHaveLength(1);
  expect(server.downloads).toEqual([]);

  const { bytes } = server.uploads[0]!;
  expect(isJpeg(bytes)).toBe(true);
  expect(bytes.length).toBeLessThanOrEqual(262144);
  // The middle square of the 1200 by 800 image: red on the left, blue on the right.
  const result = await inspect(page, bytes, [[64, 256], [448, 256]]);
  expect([result.width, result.height]).toEqual([512, 512]);
  expect(result.colors[0]![0]).toBeGreaterThan(150);
  expect(result.colors[0]![2]).toBeLessThan(90);
  expect(result.colors[1]![2]).toBeGreaterThan(150);
  expect(result.colors[1]![0]).toBeLessThan(90);
});

test("the saved picture follows the EXIF orientation and carries no EXIF data", async ({
  page,
  api,
}) => {
  const server = await openApp(page, api, { startPath: "/account" });
  const raw = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 200;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgb(220,30,30)";
    context.fillRect(0, 0, 200, 200);
    context.fillStyle = "rgb(30,30,220)";
    context.fillRect(200, 0, 200, 200);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.95));
    return [...new Uint8Array(await blob!.arrayBuffer())];
  });
  // Orientation 6 turns the 400 by 200 image a quarter turn, so red ends on top.
  const photo = withOrientation(Buffer.from(raw), 6);
  expect(photo.includes(Buffer.from("Exif\0\0", "binary"))).toBe(true);
  await choose(page, "phone.jpg", photo, "image/jpeg");
  await previewDialog(page).getByRole("button", { name: "Save picture", exact: true }).click();
  await expect(page.getByText("Profile picture updated.")).toBeVisible();
  const { bytes } = server.uploads[0]!;
  expect(bytes.includes(Buffer.from("Exif\0\0", "binary"))).toBe(false);
  const result = await inspect(page, bytes, [[100, 20], [100, 180]]);
  expect([result.width, result.height]).toEqual([200, 200]);
  expect(result.colors[0]![0]).toBeGreaterThan(150);
  expect(result.colors[1]![2]).toBeGreaterThan(150);
});

test("a transparent picture gets a white background, not black", async ({ page, api }) => {
  const server = await openApp(page, api, { startPath: "/account" });
  await choose(page, "logo.png", png(300, 300, () => [0, 0, 0, 0]));
  await previewDialog(page).getByRole("button", { name: "Save picture", exact: true }).click();
  await expect(page.getByText("Profile picture updated.")).toBeVisible();
  const result = await inspect(page, server.uploads[0]!.bytes, [[150, 150]]);
  expect([result.width, result.height]).toEqual([300, 300]);
  for (const channel of result.colors[0]!.slice(0, 3)) expect(channel).toBeGreaterThan(240);
});

test("a picture that is too detailed for one encoding still fits the size limit", async ({
  page,
  api,
}) => {
  const server = await openApp(page, api, { startPath: "/account" });
  const source = noise(512, 512);
  expect(source.length).toBeLessThan(2 * 1024 * 1024);
  await choose(page, "noise.png", source);
  await previewDialog(page).getByRole("button", { name: "Save picture", exact: true }).click();
  await expect(page.getByText("Profile picture updated.")).toBeVisible();
  const { bytes } = server.uploads[0]!;
  expect(bytes.length).toBeLessThanOrEqual(262144);
  const result = await inspect(page, bytes, []);
  expect(result.width).toBeLessThanOrEqual(512);
  expect(result.width).toBe(result.height);
});

for (const [label, file, message] of [
  [
    "a file over 2 MB",
    { name: "huge.png", mimeType: "image/png", buffer: Buffer.concat([png(2, 2, () => red), Buffer.alloc(2 * 1024 * 1024)]) },
    "Choose an image of up to 2 MB.",
  ],
  [
    "a file that is not an image",
    { name: "notes.png", mimeType: "image/png", buffer: Buffer.from("These are notes, not a picture.") },
    "Choose a JPEG, PNG, or WebP image.",
  ],
  [
    "a damaged image",
    { name: "broken.png", mimeType: "image/png", buffer: Buffer.concat([png(40, 40, () => red).subarray(0, 40), Buffer.alloc(200, 7)]) },
    "Choose a readable JPEG, PNG, or WebP image.",
  ],
] as const) {
  test(`${label} shows an alert and uploads nothing`, async ({ page, api }) => {
    const server = await openApp(page, api, { startPath: "/account" });
    await chooser(page).setInputFiles(file);
    await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
    await expect(previewDialog(page)).toHaveCount(0);
    expect(server.uploads).toHaveLength(0);
    // A good file clears the alert.
    await choose(page, "ok.png", solid(100, 100, green));
    await expect(previewDialog(page)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("cancel leaves the picture as it was", async ({ page, api }) => {
  const server = await openApp(page, api, {
    startPath: "/account",
    pictures: [[USER_ID, solid(64, 64, green)]],
  });
  await choose(page, "new.png", solid(100, 100, blue));
  await previewDialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(previewDialog(page)).toHaveCount(0);
  expect(server.uploads).toHaveLength(0);
  // The same file can be chosen again.
  await choose(page, "new.png", solid(100, 100, blue));
  await expect(previewDialog(page)).toBeVisible();
});

test("removing the picture asks first, then returns to initials", async ({ page, api }) => {
  const server = await openApp(page, api, {
    startPath: "/account",
    pictures: [[USER_ID, solid(64, 64, green)]],
  });
  await expect(shown(sidebarCard(page))).toBeVisible();
  await removeButton(page).click();
  const question = page.getByRole("dialog", { name: "Remove your picture?" });
  await question.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(server.removals).toBe(0);
  await expect(shown(sidebarCard(page))).toBeVisible();
  await removeButton(page).click();
  await question.getByRole("button", { name: "Remove picture", exact: true }).click();
  await expect(page.getByText("Profile picture removed.")).toBeVisible();
  expect(server.removals).toBe(1);
  await expect(shown(page.locator("main"))).toHaveCount(0);
  await expect(sidebarCard(page)).toContainText("AL");
  await expect(removeButton(page)).toHaveCount(0);
  await expect(changeButton(page)).toBeFocused();
});

test("a lost upload response is retried with the same request, and the picture is stored once", async ({
  page,
  api,
}) => {
  const server = await openApp(page, api, { startPath: "/account" });
  api.loseNext("/api/avatar", "response");
  await choose(page, "me.png", solid(200, 200, green));
  const dialog = previewDialog(page);
  await dialog.getByRole("button", { name: "Save picture", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "The picture may not have saved. Check your connection and try again.",
  );
  await dialog.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Profile picture updated.")).toBeVisible();
  expect(server.uploads).toHaveLength(2);
  expect(server.uploads[1]!.requestId).toBe(server.uploads[0]!.requestId);
  expect(server.uploads[1]!.bytes.equals(server.uploads[0]!.bytes)).toBe(true);
  await expect(shown(sidebarCard(page))).toBeVisible();
});

for (const [kind, flag] of [
  ["rejects the picture", { validation: true }],
  ["says that the upload expired", { restart: true }],
] as const) {
  test(`when the server ${kind}, the person chooses again with a new request`, async ({
    page,
    api,
  }) => {
    const server = await openApp(page, api, { startPath: "/account" });
    server.failNextUpload = new ImageRequestError("The server did not accept this picture.", flag);
    await choose(page, "me.png", solid(200, 200, green));
    await previewDialog(page).getByRole("button", { name: "Save picture", exact: true }).click();
    await expect(previewDialog(page)).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("The server did not accept this picture.");
    await choose(page, "me.png", solid(200, 200, green));
    await previewDialog(page).getByRole("button", { name: "Save picture", exact: true }).click();
    await expect(page.getByText("Profile picture updated.")).toBeVisible();
    expect(server.uploads).toHaveLength(2);
    expect(server.uploads[1]!.requestId).not.toBe(server.uploads[0]!.requestId);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("the whole flow works with the keyboard", async ({ page, api }) => {
  const server = await openApp(page, api, { startPath: "/account" });
  const heading = page.getByRole("heading", { name: "My account", exact: true });
  await heading.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Change profile picture" })).toBeFocused();
  await changeButton(page).focus();
  const picker = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await picker).setFiles({
    name: "me.png",
    mimeType: "image/png",
    buffer: solid(300, 300, green),
  });
  const dialog = previewDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save picture", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(changeButton(page)).toBeFocused();
  const again = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await again).setFiles({
    name: "me.png",
    mimeType: "image/png",
    buffer: solid(300, 300, green),
  });
  await expect(dialog.getByRole("button", { name: "Save picture", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Profile picture updated.")).toBeVisible();
  expect(server.uploads).toHaveLength(1);
  await expect(changeButton(page)).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(removeButton(page)).toBeFocused();
  await page.keyboard.press("Enter");
  const question = page.getByRole("dialog", { name: "Remove your picture?" });
  await expect(question).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(question).toHaveCount(0);
  await expect(removeButton(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(question.getByRole("button", { name: "Remove picture", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Profile picture removed.")).toBeVisible();
  expect(server.removals).toBe(1);
  await expect(changeButton(page)).toBeFocused();
});

test("a team account changes its own picture on its account page", async ({ page, api }) => {
  const server = await openApp(page, api, {
    membership: team,
    startPath: "/account",
    pictures: [[BEN_ID, solid(64, 64, red)]],
  });
  const root = page.locator('[data-ui="contestant"]');
  await expect(shown(root)).toHaveCount(0);
  await choose(page, "team.png", solid(200, 200, blue));
  await previewDialog(page).getByRole("button", { name: "Save picture", exact: true }).click();
  await expect(page.getByText("Profile picture updated.")).toBeVisible();
  await expect(shown(root)).toHaveCount(2);
  // The staff picture stays hidden from the team, before and after the change.
  const staffPicture = server.pictures.get(BEN_ID)!.id;
  expect(server.lists.flat()).not.toContain(staffPicture);
  expect(server.downloads).not.toContain(staffPicture);
  expect(server.downloads).toEqual([]);
});

test("the phone Me tab changes and removes the picture", async ({ page, api }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const server = await openApp(page, api);
  await page
    .getByRole("navigation", { name: "Organizer sections" })
    .getByRole("button", { name: "Me", exact: true })
    .click();
  await expect(page).toHaveURL("/account");
  const phone = page.locator('[data-ui="organiser-phone"]');
  await expect(shown(phone)).toHaveCount(0);
  await choose(page, "me.png", solid(200, 200, green));
  await previewDialog(page).getByRole("button", { name: "Save picture", exact: true }).click();
  await expect(page.getByText("Profile picture updated.")).toBeVisible();
  await expect(shown(phone)).toHaveCount(1);
  expect(server.uploads).toHaveLength(1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await removeButton(page).click();
  await page.getByRole("dialog", { name: "Remove your picture?" })
    .getByRole("button", { name: "Remove picture", exact: true }).click();
  await expect(page.getByText("Profile picture removed.")).toBeVisible();
  await expect(shown(phone)).toHaveCount(0);
});
