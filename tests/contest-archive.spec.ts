import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import type { Download, Page, Route } from "@playwright/test";
import { CEDAR_REPLY, fixtureRecord, ids, imageBytes } from "../src/connected/contestRecordFixture";
import { expect, test } from "./support/localWorker";

// Staff download one zip of a contest. The browser builds it from the record and the images.
// The Worker's record route belongs to another change, so these specs answer it with a fixed record
// and answer the two image routes with the bytes that the record's digests name.
test.use({ seedIssues: false, withEventAdmin: true });

const sizes = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
  narrow: { width: 320, height: 740 },
} as const;
/** Set MINSKY_SHOTS to a folder to keep a screenshot of each width. */
const shots = process.env.MINSKY_SHOTS;
const zipName = "minsky-fixture-olympiad-spring-finals-20261103.zip";
/** The first 8 characters of each fixture team's ID, which end its folder name. */
const aurora = ids.teamA.slice(0, 8);
const cedar = ids.teamB.slice(0, 8);

async function signIn(page: Page, username: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function openContests(page: Page) {
  await signIn(page, "eventadmin");
  await expect(page.locator('[data-ui="organiser-desktop"], [data-ui="organiser-phone"]')).toBeVisible();
  await page.goto("/event");
  await expect(page.getByRole("heading", { level: 1, name: "Jury verification" })).toBeVisible();
  await page.getByRole("tab", { name: "Contests", exact: true }).click();
}

interface Stub {
  /** The `sessionId` of each record read. */
  records: string[];
  /** The path of each image read. */
  images: string[];
}

async function stubContest(
  page: Page,
  options: { tamper?: string; hold?: Promise<void>; record?: (route: Route) => Promise<void> } = {},
): Promise<Stub> {
  const stub: Stub = { records: [], images: [] };
  await page.route("**/api/contest-record*", async (route) => {
    stub.records.push(new URL(route.request().url()).searchParams.get("sessionId") ?? "");
    if (options.record) return options.record(route);
    await route.fulfill({ json: fixtureRecord() });
  });
  const serve = (imageIdOf: (segments: string[]) => string) => async (route: Route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    stub.images.push(path);
    await options.hold;
    const id = imageIdOf(path.split("/"));
    const bytes = id === options.tamper ? new TextEncoder().encode("not the stored bytes") : imageBytes(id);
    await route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(bytes) });
  };
  // An issue image path ends `<image>/original`. An announcement image path ends with its ID.
  await page.route("**/api/image/**", serve((segments) => segments.at(-2) ?? ""));
  await page.route("**/api/announcement-image/**", serve((segments) => segments.at(-1) ?? ""));
  return stub;
}

async function unzipped(download: Download): Promise<Record<string, string>> {
  const files = unzipSync(new Uint8Array(readFileSync(await download.path())));
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]));
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [name, viewport] of Object.entries(sizes)) {
  test(`an event admin downloads a contest archive with the keyboard at ${name} width`, async ({ page, local }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const stub = await stubContest(page);
    await openContests(page);

    const edit = page.getByRole("button", { name: "Edit Primary", exact: true });
    const archive = page.getByRole("button", { name: "Download archive of Primary", exact: true });
    await expect(archive).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const box = await archive.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect((box?.x ?? -1)).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);

    await edit.focus();
    await page.keyboard.press("Tab");
    await expect(archive).toBeFocused();
    const saved = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    const download = await saved;

    expect(download.suggestedFilename()).toBe(zipName);
    await expect(page.getByRole("status").filter({ hasText: "Archive downloaded." })).toBeVisible();
    await expect(archive).toBeFocused();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (shots) await page.screenshot({ path: `${shots}/contest-archive-${name}.png` });

    const files = await unzipped(download);
    const root = zipName.replace(/\.zip$/u, "");
    expect(Object.keys(files).every((path) => path.startsWith(`${root}/`))).toBe(true);
    expect(Object.keys(files).map((path) => path.slice(root.length + 1))).toEqual([
      "staff-only/record.json",
      "staff-only/log.html",
      "staff-only/issues.csv",
      "staff-only/awards.csv",
      `contestant-visible/teams/aurora-${aurora}/log.html`,
      `contestant-visible/teams/cedar-${cedar}/log.html`,
      expect.stringMatching(new RegExp(`^contestant-visible/teams/aurora-${aurora}/images/issue-0001/\\d{8}-loose cable\\.png$`, "u")),
      expect.stringMatching(/^staff-only\/images\/issue-0001\/\d{8}-_stock room\.jpg$/u),
      expect.stringMatching(new RegExp(`^contestant-visible/teams/cedar-${cedar}/images/issue-0007/\\d{8}-projector\\.png$`, "u")),
      expect.stringMatching(/^contestant-visible\/announcements\/\d{8}-menu\.webp$/u),
      expect.stringMatching(/^staff-only\/announcements\/\d{8}-wrong room\.png$/u),
      "README.txt",
      "manifest.json",
    ]);
    expect(files[`${root}/staff-only/log.html`]).toContain("SENTINEL-INTERNAL-NOTE");
    const teamLogs = {
      aurora: files[`${root}/contestant-visible/teams/aurora-${aurora}/log.html`] ?? "",
      cedar: files[`${root}/contestant-visible/teams/cedar-${cedar}/log.html`] ?? "",
    };
    for (const log of Object.values(teamLogs)) expect(log).not.toContain("SENTINEL-INTERNAL-NOTE");
    // Each team log holds its own issues only.
    expect(teamLogs.aurora).toContain("ISS-1:");
    expect(teamLogs.aurora).not.toContain(CEDAR_REPLY);
    expect(teamLogs.aurora).not.toContain("ISS-7:");
    expect(teamLogs.cedar).toContain(CEDAR_REPLY);
    expect(teamLogs.cedar).not.toContain("ISS-1:");
    expect(files[`${root}/README.txt`]).toContain("None.");
    expect(JSON.parse(files[`${root}/manifest.json`] ?? "{}")).toMatchObject({ missing: [], counts: { issues: 3 } });

    // The page asked for the Primary contest, and read the images through the access-checked routes.
    expect(stub.records).toEqual([local.sessions[0]]);
    expect(stub.images).toHaveLength(5);
    expect(stub.images.filter((path) => path.startsWith("/api/image/"))).toHaveLength(3);
    expect(stub.images.filter((path) => path.startsWith("/api/announcement-image/"))).toHaveLength(2);
  });
}

test("the download stays on in an archived event, where writes are off", async ({ page, local }) => {
  test.setTimeout(60_000);
  await local.run("UPDATE events SET archived = 1 WHERE id = ?", local.event);
  await page.setViewportSize(sizes.desktop);
  await stubContest(page);
  await openContests(page);
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Primary", exact: true })).toBeDisabled();
  const archive = page.getByRole("button", { name: "Download archive of Secondary", exact: true });
  await expect(archive).toBeEnabled();
  const saved = page.waitForEvent("download");
  await archive.click();
  expect((await saved).suggestedFilename()).toBe(zipName);
});

test("progress shows while images load, and an image that fails its digest goes to the README", async ({ page, local }) => {
  test.setTimeout(60_000);
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => (release = resolve));
  await page.setViewportSize(sizes.desktop);
  const stub = await stubContest(page, { hold, tamper: ids.image(2) });
  await openContests(page);
  const archive = page.getByRole("button", { name: "Download archive of Primary", exact: true });
  const saved = page.waitForEvent("download");
  await archive.click();
  await expect(archive).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("status").filter({ hasText: "Downloading images 0 of 5." })).toBeVisible();
  // A second click while the first runs starts nothing.
  await archive.click();
  release();
  const download = await saved;
  // The second click read nothing more.
  expect(stub.records).toEqual([local.sessions[0]]);
  await expect(page.getByRole("status").filter({
    hasText: "Archive downloaded. 1 image could not be added. README.txt in the archive lists them.",
  })).toBeVisible();
  await expect(archive).not.toHaveAttribute("aria-busy", "true");

  const files = await unzipped(download);
  const root = zipName.replace(/\.zip$/u, "");
  expect(Object.keys(files).filter((path) => path.includes("stock room"))).toEqual([]);
  expect(files[`${root}/README.txt`]).toMatch(/staff-only\/images\/issue-0001\/\d{8}-_stock room\.jpg \(image .*\): The file does not match the digest/u);
  const manifest = JSON.parse(files[`${root}/manifest.json`] ?? "{}") as { missing: Array<{ image_id: string }> };
  expect(manifest.missing.map((file) => file.image_id)).toEqual([ids.image(2)]);
});

test("a refused read shows an error and leaves the button ready for another try", async ({ page, local }) => {
  await page.setViewportSize(sizes.phone);
  let calls = 0;
  const stub = await stubContest(page, {
    record: async (route) => {
      calls++;
      if (calls === 1) {
        await route.fulfill({ status: 403, json: { error: "Join this contest before you export it." } });
        return;
      }
      await route.fulfill({ json: fixtureRecord() });
    },
  });
  await openContests(page);
  const archive = page.getByRole("button", { name: "Download archive of Primary", exact: true });
  await archive.click();
  await expect(page.getByRole("alert").filter({ hasText: "The archive could not be built. Join this contest before you export it." })).toBeVisible();
  await expect(archive).toBeEnabled();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  const saved = page.waitForEvent("download");
  await archive.click();
  expect((await saved).suggestedFilename()).toBe(zipName);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(stub.records).toEqual([local.sessions[0], local.sessions[0]]);
});

test.describe("a contest admin", () => {
  test("downloads the archive from the Session settings page", async ({ page, local }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(sizes.desktop);
    const stub = await stubContest(page);
    await signIn(page, "admin");
    await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
    await page.goto("/administration/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Session settings" })).toBeVisible();
    const panel = page.getByRole("region", { name: "Archive" });
    await expect(panel).toContainText("The file holds internal staff notes. Keep it private.");
    const archive = panel.getByRole("button", { name: /^Download archive of / });
    const saved = page.waitForEvent("download");
    await archive.click();
    expect((await saved).suggestedFilename()).toBe(zipName);
    expect(stub.records).toEqual([local.sessions[0]]);
    if (shots) await page.screenshot({ path: `${shots}/contest-archive-settings.png` });
  });
});
