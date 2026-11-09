import { errorMessage } from "@/backend/errors";
import {
  archiveEntries,
  archiveRoot,
  type ImageEntry,
  manifestEntry,
  type MissingFile,
  readmeEntry,
  type WrittenFile,
} from "./contestArchive.ts";
import type { ContestRecord } from "./contestRecord.ts";

export interface ArchiveProgress {
  stage: "images" | "finishing";
  done: number;
  total: number;
}

export interface BuiltArchive {
  blob: Blob;
  fileName: string;
  /** Images that could not be added. The archive lists them in `manifest.json` and `README.txt`. */
  missing: readonly MissingFile[];
}

/** Images that download at the same time. Fewer keeps a slow connection from timing out. */
const IMAGE_CONCURRENCY = 3;
/** fflate writes no ZIP64, so one archive cannot pass 4 GB. */
const ZIP_LIMIT_BYTES = 4_000_000_000;
const ZIP_LIMIT_FILES = 65_535;

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Fetched = { entry: ImageEntry; bytes: Uint8Array<ArrayBuffer>; sha256: string } | { entry: ImageEntry; reason: string };

/** A failed or altered download is a result, not an error, so one bad image never stops the archive. */
async function fetchVerified(entry: ImageEntry, fetchImage: (entry: ImageEntry) => Promise<Blob>): Promise<Fetched> {
  try {
    const bytes = new Uint8Array(await (await fetchImage(entry)).arrayBuffer());
    const sha256 = await sha256Hex(bytes);
    if (entry.sha256 !== null && entry.sha256.toLowerCase() !== sha256) {
      return { entry, reason: "The file does not match the digest that Minsky stored." };
    }
    return { entry, bytes, sha256 };
  } catch (cause) {
    return { entry, reason: errorMessage(cause) };
  }
}

/**
 * Builds the contest archive in the browser. The Worker has a small CPU limit and a
 * zip costs CPU for every byte, so it only serves the record and the images.
 *
 * Images download a few at a time but enter the zip in a fixed order. Each one is
 * checked against its stored SHA-256 digest. An image that fails to download or
 * to match is skipped and listed as missing. `manifest.json` goes in last, so it
 * lists every file and every missing image. The zip is kept as a list of Blob
 * parts, so the browser decides where the bytes live.
 */
export async function buildContestArchive(
  record: ContestRecord,
  fetchImage: (entry: ImageEntry) => Promise<Blob>,
  onProgress: (progress: ArchiveProgress) => void,
): Promise<BuiltArchive> {
  const entries = archiveEntries(record);
  const images = entries.filter((entry) => entry.kind === "image");
  const sizes = new Map([...record.issue_images, ...record.announcement_images].map((image) => [image.id, image.byte_size ?? 0]));
  if (images.reduce((sum, image) => sum + (sizes.get(image.imageId) ?? 0), 0) > ZIP_LIMIT_BYTES) {
    throw new Error("The images of this contest hold more than 4 GB. One zip file cannot hold them.");
  }
  // fflate writes 16-bit entry counts, so a larger zip would list fewer files than it holds.
  if (entries.length + 2 > ZIP_LIMIT_FILES) {
    throw new Error("This contest has more than 65,000 files. One zip file cannot hold them.");
  }

  const { Zip, ZipDeflate, ZipPassThrough } = await import("fflate");
  const root = archiveRoot(record);
  const modified = Date.parse(record.exported_at);
  const parts: Blob[] = [];
  const written: WrittenFile[] = [];
  const missing: MissingFile[] = [];
  const zip = new Zip();
  const closed = new Promise<void>((resolve, reject) => {
    zip.ondata = (error, chunk, final) => {
      if (error) {
        reject(error);
        return;
      }
      // fflate allocates plain ArrayBuffers, never shared ones.
      parts.push(new Blob([chunk as Uint8Array<ArrayBuffer>]));
      if (final) resolve();
    };
  });

  const add = (path: string, bytes: Uint8Array<ArrayBuffer>, sha256: string, compress: boolean) => {
    const file = compress ? new ZipDeflate(`${root}/${path}`) : new ZipPassThrough(`${root}/${path}`);
    file.mtime = modified;
    zip.add(file);
    file.push(bytes, true);
    written.push({ path, bytes: bytes.byteLength, sha256 });
  };
  const addText = async (path: string, text: string) => {
    const bytes = new TextEncoder().encode(text);
    add(path, bytes, await sha256Hex(bytes), true);
  };

  try {
    for (const entry of entries) {
      if (entry.kind === "text") await addText(entry.path, entry.text);
    }
    const total = images.length;
    const started = new Map<number, Promise<Fetched>>();
    const fetchAhead = (from: number) => {
      for (let index = from; index < Math.min(total, from + IMAGE_CONCURRENCY); index++) {
        const entry = images[index];
        if (entry && !started.has(index)) started.set(index, fetchVerified(entry, fetchImage));
      }
    };
    onProgress({ stage: "images", done: 0, total });
    for (let index = 0; index < total; index++) {
      fetchAhead(index);
      const result = await started.get(index);
      started.delete(index);
      if (result && "bytes" in result) {
        // JPEG, PNG, and WebP are compressed already.
        add(result.entry.path, result.bytes, result.sha256, false);
      } else if (result) {
        missing.push({ path: result.entry.path, image_id: result.entry.imageId, reason: result.reason });
      }
      onProgress({ stage: "images", done: index + 1, total });
    }

    onProgress({ stage: "finishing", done: total, total });
    const readme = readmeEntry(record, missing);
    await addText(readme.path, readme.text);
    const manifest = manifestEntry(record, written, missing);
    await addText(manifest.path, manifest.text);
    zip.end();
    await closed;
  } catch (cause) {
    zip.terminate();
    throw cause;
  }
  return { blob: new Blob(parts, { type: "application/zip" }), fileName: `${root}.zip`, missing };
}
