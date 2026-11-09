import { awardsCsv, issuesCsv } from "./contestArchiveCsv.ts";
import { type ImageLinks, renderLog } from "./contestArchiveLog.ts";
import type { ContestRecord } from "./contestRecord.ts";
import { compactDate, safeName, slug, stampText } from "./archiveFormat.ts";

/**
 * The files of a contest archive, as pure data. `buildContestArchive` fetches the
 * images and writes the zip. Every path is relative to the archive's root folder.
 *
 * `staff-only/` holds the whole record. `contestant-visible/` holds one folder for
 * each team, with only what that team could read, and one shared folder of
 * announcement images. Each team log is built from `teamView`, before any
 * rendering, so no renderer can leak a staff-only row or another team's issue into it.
 */

export const ARCHIVE_FORMAT = "minsky-contest-archive";
export const ARCHIVE_VERSION = 1;
export const README_PATH = "README.txt";
export const MANIFEST_PATH = "manifest.json";

const STAFF = "staff-only";
const CONTESTANTS = "contestant-visible";
const TEAMS = `${CONTESTANTS}/teams`;
const STAFF_LOG = `${STAFF}/log.html`;

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

/** The text files of the staff folder, and how to write each one. */
const staffFiles: ReadonlyArray<{
  path: string;
  render: (record: ContestRecord, links: ImageLinks) => string;
}> = [
  { path: `${STAFF}/record.json`, render: (record) => `${JSON.stringify(record, null, 2)}\n` },
  { path: STAFF_LOG, render: (record, links) => renderLog(record, "staff", links, STAFF_LOG) },
  { path: `${STAFF}/issues.csv`, render: issuesCsv },
  { path: `${STAFF}/awards.csv`, render: awardsCsv },
];

const announcementImageFolder = (announcementRemoved: boolean) =>
  `${announcementRemoved ? STAFF : CONTESTANTS}/announcements`;

/** Orders UUIDs and ISO times the same way on every device, which `localeCompare` does not. */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * What one team could read. Its own issues are in, with their public history, resolutions,
 * issue awards that were not withdrawn, and ready team-visible images. The contest-wide
 * awards that staff confirmed and the announcements that were not removed are in too,
 * because every team saw them. The other teams and their issues are out, and so are the
 * internal notes, the members, the audit, the withdrawn award records, the removed
 * announcements, the staff-only images, and the images that are not ready.
 * The public history keeps its award lines, as the contestant app shows them.
 */
export function teamView(record: ContestRecord, teamId: string): ContestRecord {
  const shown = new Set(record.announcements.filter((announcement) => !announcement.removed_at).map((a) => a.id));
  const issues = record.issues.filter((issue) => issue.team_id === teamId);
  const own = new Set(issues.map((issue) => issue.id));
  const ofTeam = (row: { issue_id: string }) => own.has(row.issue_id);
  return {
    ...record,
    teams: record.teams.filter((team) => team.id === teamId),
    members: [],
    issues,
    history: record.history.filter((entry) => entry.visibility === "public" && ofTeam(entry)),
    resolutions: record.resolutions.filter(ofTeam),
    awards: record.awards.filter((award) => !award.withdrawn_at && ofTeam(award)),
    contest_awards: record.contest_awards.filter((award) => award.applied_at && !award.withdrawn_at),
    announcements: record.announcements.filter((announcement) => shown.has(announcement.id)),
    issue_images: record.issue_images.filter(
      (image) => image.visibility === "public" && image.state === "ready" && ofTeam(image),
    ),
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
 * The folder of each team, in a fixed order. The name makes a folder easy to find, and
 * the first 8 characters of the team ID tell apart teams that share a name. A name can
 * reduce to nothing, and two IDs can share their first 8 characters, so a number settles
 * any collision. The order is the same on every export, so a team keeps its number.
 */
function teamFolders(record: ContestRecord): Array<{ team: ContestRecord["teams"][number]; folder: string }> {
  const base = (team: ContestRecord["teams"][number]) => `${TEAMS}/${slug(team.name, "team")}-${team.id.slice(0, 8)}`;
  const used = new Set<string>();
  return [...record.teams]
    .sort((a, b) => compareText(base(a), base(b)) || compareText(a.id, b.id))
    .map((team) => ({ team, folder: uniquePath(base(team), used) }));
}

/**
 * The image files, in a fixed order. Only a `ready` image with a stored path has a
 * file. Every other image appears in the logs and the record as metadata.
 */
export function imageEntries(record: ContestRecord): ImageEntry[] {
  const used = new Set<string>();
  const numbers = new Map(record.issues.map((issue) => [issue.id, issue.number]));
  const issueTeams = new Map(record.issues.map((issue) => [issue.id, issue.team_id]));
  const folders = new Map(teamFolders(record).map(({ team, folder }) => [team.id, folder]));
  const removed = new Map(record.announcements.map((announcement) => [announcement.id, announcement.removed_at !== null]));
  const place = (folder: string, id: string, name: string) => uniquePath(`${folder}/${id.slice(0, 8)}-${safeName(name, "image")}`, used);

  /**
   * The folder of an issue image. The uploader chose the visibility, and it never changes. A
   * team-visible image goes to the folder of its issue's team. If the record lacks that team,
   * the image goes to `staff-only/`, as an announcement image does when its announcement is missing.
   */
  const issueImageFolder = (image: ContestRecord["issue_images"][number]): string => {
    const team = image.visibility === "public" ? folders.get(issueTeams.get(image.issue_id) ?? "") : undefined;
    return team ? `${team}/images` : `${STAFF}/images`;
  };

  const issueFiles = record.issue_images
    .flatMap((image) => (image.state === "ready" && image.original_path !== null ? [{ image, key: image.original_path }] : []))
    .sort((a, b) =>
      (numbers.get(a.image.issue_id) ?? 0) - (numbers.get(b.image.issue_id) ?? 0) ||
      Date.parse(a.image.created_at) - Date.parse(b.image.created_at) ||
      compareText(a.image.id, b.image.id))
    .map(({ image, key }): ImageEntry => {
      const issue = String(numbers.get(image.issue_id) ?? 0).padStart(4, "0");
      return {
        path: place(`${issueImageFolder(image)}/issue-${issue}`, image.id, image.original_name),
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
      path: place(announcementImageFolder(removed.get(image.announcement_id) ?? true), image.id, image.name),
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
  const staff = staffFiles.map((file): TextEntry => ({ path: file.path, kind: "text", text: file.render(record, links) }));
  const teams = teamFolders(record).map(({ team, folder }): TextEntry => {
    const path = `${folder}/log.html`;
    return { path, kind: "text", text: renderLog(teamView(record, team.id), "contestant", links, path) };
  });
  return [...staff, ...teams, ...images];
}

const folderNotes: ReadonlyArray<readonly [path: string, note: string]> = [
  [`${STAFF}/`, "Keep this folder private. It holds internal staff notes, staff-only images, withdrawn awards, removed announcements, and the audit. Do not give it to contestants."],
  [`${STAFF}/log.html`, "Every issue with its whole timeline, awards, announcements, images, and the audit. Open it in a web browser."],
  [`${STAFF}/record.json`, "The complete record as data, for other programs."],
  [`${STAFF}/issues.csv`, "One row for each issue. It opens in a spreadsheet."],
  [`${STAFF}/awards.csv`, "One row for each time award, with the withdrawn awards."],
  [`${STAFF}/images/`, "Images that only staff could see, in one folder for each issue."],
  [`${STAFF}/announcements/`, "Images of announcements that staff removed."],
  [`${CONTESTANTS}/`, "Only what contestants could see. It has one folder for each team, and one folder of announcement images that every team shares."],
  [`${TEAMS}/<team folder>/log.html`, "The issues of that team with their public timeline, and the issue awards that were not withdrawn. It also holds the contest-wide awards that staff confirmed and the announcements that were not removed, because every team saw them. Open it in a web browser."],
  [`${TEAMS}/<team folder>/images/`, "Images of the issues of that team that the team could see, in one folder for each issue."],
  [`${CONTESTANTS}/announcements/`, "Images of announcements that staff did not remove. Every team log links to them."],
  [MANIFEST_PATH, "Every file with its size and SHA-256 digest, the number of rows of each kind in the record, and the files that this archive lacks."],
];

/** The plain-text guide. The builder writes it after the images, so it can list the files that are missing. */
export function readmeEntry(record: ContestRecord, missing: readonly MissingFile[]): TextEntry {
  const { event, contest } = record;
  const teams = teamFolders(record);
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
    "To give a team its record, copy the contestant-visible folder. In the copy, delete the folders of the other teams from the teams folder. Keep the announcements folder, because each team log links to it.",
    "",
    "What each part is",
    ...folderNotes.map(([path, note]) => `${path}\n    ${note}`),
    "",
    "Team folders",
    ...(teams.length === 0 ? ["None."] : teams.map(({ team, folder }) => `${folder}/\n    ${team.name}, ${team.location}`)),
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
