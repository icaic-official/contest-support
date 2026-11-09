import { awardsCsv, issuesCsv } from "./contestArchiveCsv.ts";
import { type Audience, type ImageLinks, renderLog } from "./contestArchiveLog.ts";
import type { ContestRecord } from "./contestRecord.ts";
import { compactDate, safeName, slug, stampText } from "./archiveFormat.ts";
import { workflowEvent } from "./historyEvents.ts";

/**
 * The files of a contest archive, as pure data. `buildContestArchive` fetches the
 * images and writes the zip. Every path is relative to the archive's root folder.
 *
 * `staff-only/` holds the whole record. `contestant-visible/` holds only what a
 * contestant could read. The second view is built from `contestantView`, before
 * any rendering, so no renderer can leak a staff-only row into it.
 */

export const ARCHIVE_FORMAT = "minsky-contest-archive";
export const ARCHIVE_VERSION = 1;
export const README_PATH = "README.txt";
export const MANIFEST_PATH = "manifest.json";

const STAFF = "staff-only";
const CONTESTANTS = "contestant-visible";

export type TextEntry = { path: string; kind: "text"; text: string };
export type ImageEntry = {
  path: string;
  kind: "image";
  source: "issue" | "announcement";
  /** The storage path that the image route takes. */
  key: string;
  /** The digest that the record holds. The bytes must match it. */
  sha256: string | null;
  imageId: string;
};
export type ArchiveEntry = TextEntry | ImageEntry;

/** A file that went into the zip. */
export interface WrittenFile {
  path: string;
  bytes: number;
  sha256: string;
}

/** An image that the archive lacks, with the reason. */
export interface MissingFile {
  path: string;
  image_id: string;
  reason: string;
}

/** The name of the archive's root folder, which is also the zip file's name without `.zip`. */
export function archiveRoot(record: ContestRecord): string {
  const { event, contest } = record;
  const day = compactDate(record.exported_at, event.time_zone);
  return `minsky-${event.code ?? "event"}-${slug(contest.name, "contest")}-${day}`;
}

const logPath: Record<Audience, string> = {
  staff: `${STAFF}/log.html`,
  contestant: `${CONTESTANTS}/log.html`,
};

/** Each text file of the layout and how to write it. */
const textFiles: ReadonlyArray<{
  path: string;
  render: (record: ContestRecord, links: ImageLinks) => string;
}> = [
  { path: `${STAFF}/record.json`, render: (record) => `${JSON.stringify(record, null, 2)}\n` },
  { path: logPath.staff, render: (record, links) => renderLog(record, "staff", links, logPath.staff) },
  { path: `${STAFF}/issues.csv`, render: issuesCsv },
  { path: `${STAFF}/awards.csv`, render: awardsCsv },
  {
    path: logPath.contestant,
    render: (record, links) => renderLog(contestantView(record), "contestant", links, logPath.contestant),
  },
];

/** The folder of an issue image. The uploader chose the visibility, and it never changes. */
const issueImageFolder = { public: `${CONTESTANTS}/images`, internal: `${STAFF}/images` } as const;

const announcementImageFolder = (announcementRemoved: boolean) =>
  `${announcementRemoved ? STAFF : CONTESTANTS}/announcements`;

/** Orders UUIDs and ISO times the same way on every device, which `localeCompare` does not. */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * What a contestant could read. A withdrawn issue award, a contest-wide award
 * that staff did not confirm or that they withdrew, a removed announcement, a staff-only image
 * and an image that has no stored file are out, and so are the internal notes, the members, and the audit.
 * The history entries that record a withdrawn award go too.
 */
export function contestantView(record: ContestRecord): ContestRecord {
  const issues = new Map(record.issues.map((issue) => [issue.id, issue]));
  const withdrawn = record.awards.filter((award) => award.withdrawn_at);
  const recordsWithdrawnAward = (entry: ContestRecord["history"][number]): boolean => {
    const issue = issues.get(entry.issue_id);
    if (!issue || !/awarded: |^Time award withdrawn/u.test(entry.text)) return false;
    const award = withdrawn.find((item) => item.issue_id === issue.id && Date.parse(item.at) === Date.parse(entry.at));
    const event = workflowEvent(entry, {
      issue,
      resolutions: record.resolutions.filter((resolution) => resolution.issue_id === issue.id),
      award,
    });
    return event?.kind === "withdrawn" || (event?.kind === "awarded" && award !== undefined);
  };
  const shown = new Set(record.announcements.filter((announcement) => !announcement.removed_at).map((a) => a.id));
  return {
    ...record,
    members: [],
    history: record.history.filter((entry) => entry.visibility === "public" && !recordsWithdrawnAward(entry)),
    awards: record.awards.filter((award) => !award.withdrawn_at),
    contest_awards: record.contest_awards.filter((award) => award.applied_at && !award.withdrawn_at),
    announcements: record.announcements.filter((announcement) => shown.has(announcement.id)),
    issue_images: record.issue_images.filter((image) => image.visibility === "public" && image.state === "ready"),
    announcement_images: record.announcement_images.filter(
      (image) => shown.has(image.announcement_id) && image.state === "ready",
    ),
    audit: [],
  };
}

/** A path that no earlier path equals, ignoring case, because Windows and macOS ignore it. */
function uniquePath(path: string, used: Set<string>): string {
  const dot = path.lastIndexOf(".");
  const stem = dot > path.lastIndexOf("/") + 1 ? path.slice(0, dot) : path;
  const extension = stem === path ? "" : path.slice(dot);
  let candidate = path;
  for (let attempt = 2; used.has(candidate.toLowerCase()); attempt++) candidate = `${stem}-${attempt}${extension}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * The image files, in a fixed order. Only a `ready` image with a stored path has a
 * file. Every other image appears in the logs and the record as metadata.
 */
export function imageEntries(record: ContestRecord): ImageEntry[] {
  const used = new Set<string>();
  const numbers = new Map(record.issues.map((issue) => [issue.id, issue.number]));
  const removed = new Map(record.announcements.map((announcement) => [announcement.id, announcement.removed_at !== null]));
  const place = (folder: string, id: string, name: string) => uniquePath(`${folder}/${id.slice(0, 8)}-${safeName(name, "image")}`, used);

  const issueFiles = record.issue_images
    .flatMap((image) => (image.state === "ready" && image.original_path !== null ? [{ image, key: image.original_path }] : []))
    .sort((a, b) =>
      (numbers.get(a.image.issue_id) ?? 0) - (numbers.get(b.image.issue_id) ?? 0) ||
      Date.parse(a.image.created_at) - Date.parse(b.image.created_at) ||
      compareText(a.image.id, b.image.id))
    .map(({ image, key }): ImageEntry => {
      const issue = String(numbers.get(image.issue_id) ?? 0).padStart(4, "0");
      return {
        path: place(`${issueImageFolder[image.visibility]}/issue-${issue}`, image.id, image.original_name),
        kind: "image",
        source: "issue",
        key,
        sha256: image.original_digest,
        imageId: image.id,
      };
    });
  const announcementFiles = record.announcement_images
    .flatMap((image) => (image.state === "ready" && image.object_key !== null ? [{ image, key: image.object_key }] : []))
    .sort((a, b) =>
      compareText(a.image.uploaded_at ?? "", b.image.uploaded_at ?? "") || compareText(a.image.id, b.image.id))
    .map(({ image, key }): ImageEntry => ({
      path: place(announcementImageFolder(removed.get(image.announcement_id) ?? false), image.id, image.name),
      kind: "image",
      source: "announcement",
      key,
      sha256: image.digest,
      imageId: image.id,
    }));
  return [...issueFiles, ...announcementFiles];
}

/** Every file of the layout except `README.txt` and `manifest.json`, which the builder writes last. */
export function archiveEntries(record: ContestRecord): ArchiveEntry[] {
  const images = imageEntries(record);
  const links: ImageLinks = new Map(images.map((image) => [image.imageId, image.path]));
  const texts = textFiles.map((file): TextEntry => ({ path: file.path, kind: "text", text: file.render(record, links) }));
  return [...texts, ...images];
}

const folderNotes: ReadonlyArray<readonly [path: string, note: string]> = [
  [`${STAFF}/`, "Keep this folder private. It holds internal staff notes, staff-only images, withdrawn awards, removed announcements, and the audit. Do not give it to contestants."],
  [`${STAFF}/log.html`, "Every issue with its whole timeline, awards, announcements, images, and the audit. Open it in a web browser."],
  [`${STAFF}/record.json`, "The complete record as data, for other programs."],
  [`${STAFF}/issues.csv`, "One row for each issue. It opens in a spreadsheet."],
  [`${STAFF}/awards.csv`, "One row for each time award, with the withdrawn awards."],
  [`${STAFF}/images/`, "Images that only staff could see, in one folder for each issue."],
  [`${STAFF}/announcements/`, "Images of announcements that staff removed."],
  [`${CONTESTANTS}/`, "Only what contestants could see. It covers every team. Do not give one team the issues of another team."],
  [`${CONTESTANTS}/log.html`, "The issues with their public timeline, awards that staff confirmed, and announcements. Open it in a web browser."],
  [`${CONTESTANTS}/images/`, "Images that the team could see, in one folder for each issue."],
  [`${CONTESTANTS}/announcements/`, "Images of announcements that staff did not remove."],
  [MANIFEST_PATH, "Every file with its size and SHA-256 digest, the number of rows of each kind in the record, and the files that this archive lacks."],
];

/** The plain-text guide. The builder writes it after the images, so it can list the files that are missing. */
export function readmeEntry(record: ContestRecord, missing: readonly MissingFile[]): TextEntry {
  const { event, contest } = record;
  const lines = [
    "Minsky contest archive",
    "",
    `Contest: ${contest.name}`,
    `Event: ${event.name}${event.code ? ` (${event.code})` : ""}`,
    `Exported: ${stampText(record.exported_at, event.time_zone)}`,
    `Exported by: ${record.exported_by.name}`,
    `Archive format: ${ARCHIVE_FORMAT}, version ${ARCHIVE_VERSION}`,
    `Record format: ${record.format}, version ${record.version}`,
    "",
    "This archive holds the support record of one contest and its images.",
    "It is a copy. Minsky keeps no link to it.",
    "",
    "The staff-only folder holds internal staff notes. Do not give it to contestants.",
    "",
    "What each part is",
    ...folderNotes.map(([path, note]) => `${path}\n    ${note}`),
    "",
    "To check a file, compute its SHA-256 digest and compare it with manifest.json.",
    "",
    "Files that this archive lacks",
    ...(missing.length === 0
      ? ["None."]
      : missing.map((file) => `${file.path} (image ${file.image_id}): ${file.reason}`)),
    "",
  ];
  return { path: README_PATH, kind: "text", text: lines.join("\n") };
}

const countedSections = [
  "teams", "members", "issues", "history", "resolutions", "awards", "contest_awards",
  "announcements", "issue_images", "announcement_images", "audit",
] as const satisfies readonly (keyof ContestRecord)[];

/** The index of the archive. `files` lists everything written before it, and `missing` lists the images that failed. */
export function manifestEntry(
  record: ContestRecord,
  files: readonly WrittenFile[],
  missing: readonly MissingFile[],
): TextEntry {
  const manifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    record_format: record.format,
    record_version: record.version,
    exported_at: record.exported_at,
    exported_by: record.exported_by,
    event: { id: record.event.id, name: record.event.name, code: record.event.code, time_zone: record.event.time_zone },
    contest: { id: record.contest.id, name: record.contest.name },
    counts: Object.fromEntries(countedSections.map((section) => [section, record[section].length])),
    files,
    missing,
  };
  return { path: MANIFEST_PATH, kind: "text", text: `${JSON.stringify(manifest, null, 2)}\n` };
}
