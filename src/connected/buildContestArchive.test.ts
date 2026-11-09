import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildContestArchive, type ArchiveProgress } from "./buildContestArchive";
import { archiveEntries, archiveRoot, imageEntries, type ImageEntry } from "./contestArchive";
import { fixtureRecord, ids, imageBytes, sha256Hex } from "./contestRecordFixture";

const record = fixtureRecord();
const root = archiveRoot(record);

/** Serves the fixture bytes of an image, found by the ID in its entry. */
const serve = async (entry: ImageEntry): Promise<Blob> => new Blob([imageBytes(entry.imageId)]);

async function unzip(blob: Blob): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

const readText = (files: Record<string, Uint8Array>, path: string): string => {
  const bytes = files[`${root}/${path}`];
  if (!bytes) throw new Error(`The zip has no ${path}`);
  return new TextDecoder().decode(bytes);
};

describe("buildContestArchive", () => {
  it("writes the layout, the images, a README, and a manifest that lists them", async () => {
    const progress: ArchiveProgress[] = [];
    const built = await buildContestArchive(record, serve, (item) => progress.push(item));
    expect(built.fileName).toBe(`${root}.zip`);
    expect(built.blob.type).toBe("application/zip");
    expect(built.missing).toEqual([]);

    const files = await unzip(built.blob);
    const expected = [...archiveEntries(record).map((entry) => entry.path), "README.txt", "manifest.json"];
    expect(Object.keys(files)).toEqual(expected.map((path) => `${root}/${path}`));
    for (const image of imageEntries(record)) {
      expect(files[`${root}/${image.path}`]).toEqual(imageBytes(image.imageId));
    }

    const manifest = JSON.parse(readText(files, "manifest.json")) as {
      files: Array<{ path: string; bytes: number; sha256: string }>;
      missing: unknown[];
      counts: Record<string, number>;
    };
    expect(manifest.files.map((file) => file.path)).toEqual(expected.filter((path) => path !== "manifest.json"));
    for (const file of manifest.files) {
      const bytes = files[`${root}/${file.path}`];
      expect(bytes?.byteLength, file.path).toBe(file.bytes);
      expect(sha256Hex(bytes ?? new Uint8Array()), file.path).toBe(file.sha256);
    }
    expect(manifest.missing).toEqual([]);
    expect(manifest.counts).toMatchObject({ issues: 3, issue_images: 4, announcement_images: 2 });
    expect(readText(files, "README.txt")).toMatch(/Files that this archive lacks\nNone\./u);
    expect(readText(files, "staff-only/record.json")).toContain("SENTINEL-INTERNAL-NOTE");

    expect(progress[0]).toEqual({ stage: "images", done: 0, total: 5 });
    expect(progress.filter((item) => item.stage === "images").map((item) => item.done)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(progress.at(-1)).toEqual({ stage: "finishing", done: 5, total: 5 });
  });

  it("gives each team a folder that holds its own files, and links only to those and the shared announcements", async () => {
    const files = await unzip((await buildContestArchive(record, serve, () => undefined)).blob);
    const paths = Object.keys(files).map((path) => path.slice(root.length + 1));
    const teamLogs = paths.filter((path) => path.startsWith("contestant-visible/teams/") && path.endsWith("/log.html"));
    expect(teamLogs).toHaveLength(2);
    expect(paths.filter((path) => path.startsWith("contestant-visible/") && path.endsWith("log.html"))).toEqual(teamLogs);

    for (const logPath of teamLogs) {
      const folder = logPath.slice(0, -"/log.html".length);
      const links = [...readText(files, logPath).matchAll(/href="([^"]*)"/gu)].map((match) => match[1] ?? "");
      expect(links.length, logPath).toBeGreaterThan(0);
      for (const link of links) {
        const target = decodeURIComponent(new URL(link, `file:///${root}/${logPath}`).pathname.slice(1));
        expect(files[target], `${logPath} links to ${target}`).toBeDefined();
        const inside = target.startsWith(`${root}/${folder}/`) || target.startsWith(`${root}/contestant-visible/announcements/`);
        expect(inside, `${logPath} links to ${target}`).toBe(true);
      }
      // Every file of the folder is something that the log links to or is the log itself.
      const own = paths.filter((path) => path.startsWith(`${folder}/`));
      expect(own.length).toBe(links.filter((link) => !link.startsWith("../../announcements/")).length + 1);
    }

    // Two images of the Aurora folder and the Cedar folder differ, and the zip holds each once.
    const cedarImage = paths.find((path) => path.includes(`${ids.image(4).slice(0, 8)}-projector.png`));
    expect(cedarImage).toMatch(/^contestant-visible\/teams\/cedar-/u);
    expect(files[`${root}/${cedarImage}`]).toEqual(imageBytes(ids.image(4)));
    for (const [logPath, other] of [[teamLogs[0], "projector"], [teamLogs[1], "loose cable"]] as const) {
      expect(readText(files, logPath ?? ""), logPath).not.toContain(other);
    }
  });

  it("keeps an image whose digest does not match out of the zip and lists it as missing", async () => {
    const tampered = (entry: ImageEntry) =>
      entry.imageId === ids.image(2) ? Promise.resolve(new Blob(["not the stored bytes"])) : serve(entry);
    const built = await buildContestArchive(record, tampered, () => undefined);
    const files = await unzip(built.blob);

    const [internal] = imageEntries(record).filter((entry) => entry.imageId === ids.image(2));
    expect(built.missing).toEqual([
      { path: internal?.path, image_id: ids.image(2), reason: "The file does not match the digest that Minsky stored." },
    ]);
    expect(Object.keys(files)).not.toContain(`${root}/${internal?.path}`);
    expect(Object.keys(files)).toContain(`${root}/manifest.json`);

    const manifest = JSON.parse(readText(files, "manifest.json")) as { files: Array<{ path: string }>; missing: unknown[] };
    expect(manifest.missing).toEqual(built.missing);
    expect(manifest.files.map((file) => file.path)).not.toContain(internal?.path);
    expect(readText(files, "README.txt")).toContain(`${internal?.path} (image ${ids.image(2)}): The file does not match`);
  });

  it("keeps going when a download fails, and says why", async () => {
    const failing = (entry: ImageEntry): Promise<Blob> =>
      entry.source === "announcement" ? Promise.reject(new Error("This announcement image could not be opened.")) : serve(entry);
    const built = await buildContestArchive(record, failing, () => undefined);
    expect(built.missing.map((file) => file.image_id)).toEqual([ids.image(11), ids.image(12)]);
    expect(built.missing.every((file) => file.reason === "This announcement image could not be opened.")).toBe(true);
    const files = await unzip(built.blob);
    expect(Object.keys(files).filter((path) => path.includes("/announcements/"))).toEqual([]);
    expect(Object.keys(files).filter((path) => path.includes("/images/"))).toHaveLength(3);
  });

  it("accepts an image whose record has no digest, and a digest in capitals", async () => {
    const open = fixtureRecord();
    open.issue_images[0]!.original_digest = null;
    open.issue_images[1]!.original_digest = open.issue_images[1]!.original_digest!.toUpperCase();
    const built = await buildContestArchive(open, serve, () => undefined);
    expect(built.missing).toEqual([]);
  });

  it("adds images in record order although they finish in another order, with a few at a time", async () => {
    let running = 0;
    let most = 0;
    const entries = imageEntries(record);
    const slowFirst = async (entry: ImageEntry): Promise<Blob> => {
      running++;
      most = Math.max(most, running);
      const place = entries.findIndex((item) => item.imageId === entry.imageId);
      await new Promise((resolve) => setTimeout(resolve, (entries.length - place) * 15));
      running--;
      return serve(entry);
    };
    const built = await buildContestArchive(record, slowFirst, () => undefined);
    const names = Object.keys(await unzip(built.blob)).filter((path) => entries.some((entry) => path === `${root}/${entry.path}`));
    expect(names).toEqual(entries.map((entry) => `${root}/${entry.path}`));
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(3);
  });

  it("stores a name with other scripts as UTF-8", async () => {
    const world = fixtureRecord();
    world.issue_images[0]!.original_name = "résumé 写真.png";
    world.contest.name = "Финал";
    const built = await buildContestArchive(world, serve, () => undefined);
    const bytes = new Uint8Array(await built.blob.arrayBuffer());
    const files = unzipSync(bytes);
    const name = Object.keys(files).find((path) => path.endsWith("résumé 写真.png"));
    expect(name).toBeDefined();
    expect(name?.startsWith("minsky-fixture-olympiad-contest-")).toBe(true);
    // Bit 11 of the general-purpose flag tells readers that a name is UTF-8. A local header
    // is 30 bytes long before its name.
    const header = Buffer.from(bytes).indexOf(Buffer.from(name ?? "")) - 30;
    expect(Buffer.from(bytes).readUInt32LE(header)).toBe(0x04034b50);
    expect(Buffer.from(bytes).readUInt16LE(header + 6) & 0x0800).toBeTruthy();
  });

  it("refuses an archive that one zip file cannot hold", async () => {
    const huge = fixtureRecord();
    huge.issue_images[0]!.byte_size = 4_100_000_000;
    await expect(buildContestArchive(huge, serve, () => undefined)).rejects.toThrow("more than 4 GB");
    const crowded = fixtureRecord();
    const [issue, image] = [crowded.issues[0]!, crowded.issue_images[0]!];
    const id = (prefix: string, index: number) => `${prefix}${index.toString(16).padStart(7, "0")}-0000-4000-8000-000000000000`;
    // At most 24 images per issue, as the contest limits allow. The archive holds 4 staff files, one log for
    // each of the 2 teams, the README, and the manifest, so 65,528 images make 65,536 files, one too many.
    crowded.issues = Array.from({ length: 2_731 }, (_, index) => ({ ...issue, id: id("a", index), number: index + 1 }));
    crowded.issue_images = Array.from({ length: 65_528 }, (_, index) => ({
      ...image, id: id("b", index), issue_id: id("a", index % 2_731), byte_size: 1,
    }));
    crowded.announcement_images = [];
    expect(archiveEntries(crowded).length + 2).toBe(65_536);
    await expect(buildContestArchive(crowded, serve, () => undefined)).rejects.toThrow("more than 65,000 files");
  });
});
