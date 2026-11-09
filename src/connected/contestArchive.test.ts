import { describe, expect, it } from "vitest";
import { safeName, slug } from "./archiveFormat";
import {
  archiveEntries,
  archiveRoot,
  imageEntries,
  manifestEntry,
  readmeEntry,
  teamViews,
  type ArchiveEntry,
} from "./contestArchive";
import { awardsCsv, issuesCsv } from "./contestArchiveCsv";
import type { ContestRecord } from "./contestRecord";
import { CEDAR_REPLY, fixtureRecord, ids, INTERNAL_NOTE } from "./contestRecordFixture";

const text = (entries: readonly ArchiveEntry[], path: string): string => {
  const entry = entries.find((item) => item.path === path);
  if (entry?.kind !== "text") throw new Error(`No text file ${path}`);
  return entry.text;
};

const id8 = (id: string) => id.slice(0, 8);
const aurora = `contestant-visible/teams/aurora-${id8(ids.teamA)}`;
const cedar = `contestant-visible/teams/cedar-${id8(ids.teamB)}`;

describe("contest archive layout", () => {
  it("names the root from the event code, the contest, and the export day in the event zone", () => {
    expect(archiveRoot(fixtureRecord())).toBe("minsky-fixture-olympiad-spring-finals-20261103");
    const late = fixtureRecord();
    late.exported_at = "2026-11-03T17:30:00.000Z";
    // 17:30 UTC is already the next day in Singapore.
    expect(archiveRoot(late)).toBe("minsky-fixture-olympiad-spring-finals-20261104");
    late.event.code = null;
    late.contest.name = "  Åland / Round #2!  ";
    expect(archiveRoot(late)).toBe("minsky-event-aland-round-2-20261104");
    late.contest.name = "!!!";
    expect(archiveRoot(late)).toBe("minsky-event-contest-20261104");
  });

  it("places every file in one fixed layout", () => {
    const entries = archiveEntries(fixtureRecord());
    expect(entries.map((entry) => entry.path)).toEqual([
      "staff-only/record.json",
      "staff-only/log.html",
      "staff-only/issues.csv",
      "staff-only/awards.csv",
      `${aurora}/log.html`,
      `${cedar}/log.html`,
      `${aurora}/images/issue-0001/${id8(ids.image(1))}-loose cable.png`,
      `staff-only/images/issue-0001/${id8(ids.image(2))}-_stock room.jpg`,
      `${cedar}/images/issue-0007/${id8(ids.image(4))}-projector.png`,
      `contestant-visible/announcements/${id8(ids.image(11))}-menu.webp`,
      `staff-only/announcements/${id8(ids.image(12))}-wrong room.png`,
    ]);
  });

  it("gives an image the record's key, digest, and ID", () => {
    const [first] = imageEntries(fixtureRecord());
    expect(first).toMatchObject({
      kind: "image",
      source: "issue",
      imageId: ids.image(1),
      key: `${ids.contest}/${ids.issue(1)}/${ids.image(1)}/original`,
    });
    expect(first?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(imageEntries(fixtureRecord()).at(-1)).toMatchObject({ source: "announcement", imageId: ids.image(12) });
  });

  it("gives no file to an image that is not ready or has no stored path", () => {
    const record = fixtureRecord();
    const template = record.issue_images[0]!;
    for (const state of ["pending", "deleting", "deleted", "abandoned", "expired"] as const) {
      record.issue_images.push({ ...template, id: `1000000${record.issue_images.length}-0000-4000-8000-000000000000`, state });
    }
    record.issue_images.push({ ...template, id: "20000000-0000-4000-8000-000000000000", original_path: null });
    record.announcement_images.push({ ...record.announcement_images[0]!, id: "30000000-0000-4000-8000-000000000000", state: "deleted" });
    const files = imageEntries(record);
    expect(files.map((file) => file.imageId)).toEqual([ids.image(1), ids.image(2), ids.image(4), ids.image(11), ids.image(12)]);
    // The logs still list the other rows as metadata.
    expect(text(archiveEntries(record), "staff-only/log.html")).toContain("No file in this archive.");
    expect((JSON.parse(text(archiveEntries(record), "staff-only/record.json")) as ContestRecord).issue_images).toHaveLength(10);
  });

  it("keeps hostile and colliding names inside their folder and unique, even ignoring case", () => {
    const record = fixtureRecord();
    const template = record.issue_images[0]!;
    const names = ["../x", "a/b", "a\\b", "bad\u0000name\u0007.png", "..", "", ".hidden", "C:\\evil?.png", "name.", "Same.png", "same.PNG", "SAME.png"];
    // Every ID starts with the same 8 characters, so only the cleaned name tells the files apart.
    record.issue_images = names.map((name, index) => ({
      ...template,
      id: `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`,
      original_name: name,
      visibility: "internal",
    }));
    const paths = imageEntries(record).filter((entry) => entry.source === "issue").map((entry) => entry.path);
    expect(paths).toHaveLength(names.length);
    expect(new Set(paths.map((path) => path.toLowerCase())).size).toBe(paths.length);
    const folder = "staff-only/images/issue-0001/";
    for (const path of paths) {
      expect(path.startsWith(folder)).toBe(true);
      const name = path.slice(folder.length);
      expect(name).not.toMatch(/[\\/<>:"|?*\p{Cc}]/u);
      expect(name).not.toContain("..");
      expect(name).not.toMatch(/^\.|[. ]$/u);
    }
    expect(paths.slice(-3)).toEqual([`${folder}aaaaaaaa-Same.png`, `${folder}aaaaaaaa-same-2.PNG`, `${folder}aaaaaaaa-SAME-3.png`]);
  });

  it("cleans a file name for every operating system", () => {
    expect(safeName("../x")).toBe("_x");
    expect(safeName("a/b")).toBe("a_b");
    expect(safeName("bad\u0000na\u202eme\u0007.png")).toBe("badname.png");
    expect(safeName("..")).toBe("file");
    expect(safeName("", "image")).toBe("image");
    expect(safeName(".hidden")).toBe("hidden");
    expect(safeName("trailing. . ")).toBe("trailing");
    expect(safeName('a<b>:c"d|e?f*g.png')).toBe("a_b__c_d_e_f_g.png");
    const long = safeName(`${"é".repeat(200)}.jpeg`);
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(200);
    expect(long.endsWith(".jpeg")).toBe(true);
    const wide = safeName(`${"\u{1F600}".repeat(200)}.png`);
    expect(new TextEncoder().encode(wide).length, "4-byte characters").toBeLessThanOrEqual(200);
    expect(wide.endsWith(".png")).toBe(true);
    expect(slug("Spring Finals 2026!", "x")).toBe("spring-finals-2026");
    expect(slug("☃", "contest")).toBe("contest");
    expect(slug("a".repeat(60), "x")).toHaveLength(40);
  });
});

describe("announcement image placement", () => {
  it("puts an image whose announcement the record lacks under staff-only", () => {
    const record = fixtureRecord();
    record.announcements = record.announcements.filter((announcement) => announcement.id !== ids.announcement(1));
    const path = archiveEntries(record).find((entry) => entry.kind === "image" && entry.imageId === ids.image(11))?.path;
    expect(path).toMatch(/^staff-only\/announcements\//u);
  });
});

describe("team folders", () => {
  const withTeams = (teams: Array<{ id: string; name: string }>, owners: string[]): ContestRecord => {
    const record = fixtureRecord();
    record.teams = teams.map((team) => ({ ...record.teams[0]!, ...team }));
    record.issues = record.issues.map((issue, index) => ({ ...issue, team_id: owners[index] ?? teams[0]!.id }));
    return record;
  };
  const folders = (record: ContestRecord) =>
    archiveEntries(record).flatMap((entry) => (entry.path.endsWith("/log.html") && entry.path.includes("/teams/") ? [entry.path.split("/")[2]!] : []));

  it("names a folder from the team's name and the start of its ID", () => {
    expect(folders(fixtureRecord())).toEqual([`aurora-${id8(ids.teamA)}`, `cedar-${id8(ids.teamB)}`]);
  });

  it("keeps two teams with one name apart, even when their IDs start alike", () => {
    const first = "00000005-0000-4000-8000-0000000000a1";
    const second = "00000005-0000-4000-8000-0000000000a2";
    const record = withTeams([{ id: first, name: "Aurora" }, { id: second, name: "Aurora" }], [first, second, first]);
    // The smaller ID keeps the plain name, whatever the order of the rows.
    for (const teams of [record.teams, [...record.teams].reverse()]) {
      const entries = archiveEntries({ ...record, teams });
      expect(folders({ ...record, teams })).toEqual(["aurora-00000005", "aurora-00000005-2"]);
      const [one, two] = ["aurora-00000005", "aurora-00000005-2"].map((folder) => text(entries, `contestant-visible/teams/${folder}/log.html`));
      expect(one).toContain("ISS-1:");
      expect(one).toContain("ISS-12:");
      expect(one).not.toContain("ISS-7:");
      expect(two).toContain("ISS-7:");
      expect(two).not.toContain("ISS-1:");
    }
  });

  it("stays inside the teams folder for a hostile or empty name", () => {
    const names = ["../../etc", "Team/One\\Two", "日本語チーム", "  ", "A".repeat(300), "con?", "x\u0000y"];
    const record = fixtureRecord();
    record.teams = names.map((name, index) => ({ ...record.teams[0]!, id: `0000000${index}-0000-4000-8000-000000000000`, name }));
    expect(folders(record)).toEqual([
      `${"a".repeat(40)}-00000004`,
      "con-00000005",
      "etc-00000000",
      "team-00000002",
      "team-00000003",
      "team-one-two-00000001",
      "x-y-00000006",
    ]);
  });

  it("gives a team with no issues a log with the announcements and the confirmed contest awards", () => {
    const record = fixtureRecord();
    const quiet = "00000009-0000-4000-8000-000000000000";
    record.teams.push({ ...record.teams[0]!, id: quiet, name: "Dune", location: "Hall D" });
    const entries = archiveEntries(record);
    const log = text(entries, `contestant-visible/teams/dune-${id8(quiet)}/log.html`);
    expect(log).toContain("No issues.");
    expect(log).not.toContain("ISS-");
    expect(log).toContain("Lunch at noon");
    expect(log).toContain("Network outage in Hall A");
    expect(log).not.toContain("Pending contest award");
    expect(log).not.toContain("Aurora");
    expect(log).not.toContain("Cedar");
    expect(entries.filter((entry) => entry.path.includes(`dune-${id8(quiet)}/images/`))).toEqual([]);
  });

  it("gives an image to the staff folder when its issue's team is missing from the record", () => {
    const record = fixtureRecord();
    record.teams = record.teams.filter((team) => team.id !== ids.teamB);
    const path = imageEntries(record).find((entry) => entry.imageId === ids.image(4))?.path;
    expect(path).toMatch(/^staff-only\/images\/issue-0007\//u);
  });
});

describe("team logs", () => {
  const entries = archiveEntries(fixtureRecord());
  const visible = entries.filter((entry) => entry.path.startsWith("contestant-visible/"));
  const staffOnly = entries.filter((entry) => entry.path.startsWith("staff-only/"));
  const visibleText = visible.flatMap((entry) => (entry.kind === "text" ? [entry.text] : [])).join("\n");
  const auroraLog = text(entries, `${aurora}/log.html`);
  const cedarLog = text(entries, `${cedar}/log.html`);
  const folderPaths = (folder: string) => entries.filter((entry) => entry.path.startsWith(`${folder}/`)).map((entry) => entry.path);

  it("never hold an internal note, a staff-only image, or the audit", () => {
    expect(visibleText).not.toContain(INTERNAL_NOTE);
    expect(visibleText).not.toContain("SENTINEL");
    expect(visibleText).not.toContain("stock room");
    expect(visibleText).not.toContain("Staff note");
    expect(visibleText).not.toContain("set_intake");
    expect(visibleText).not.toContain("Audit");
    expect(visible.map((entry) => entry.path).join("\n")).not.toContain(id8(ids.image(2)));
    expect(staffOnly.map((entry) => (entry.kind === "image" ? entry.imageId : ""))).toContain(ids.image(2));
  });

  it("hold no withdrawn award record, unconfirmed contest award, or removed announcement", () => {
    for (const hidden of ["Withdrawn contest award", "Pending contest award", "Wrong room", "wrong room.png"]) {
      expect(visibleText, hidden).not.toContain(hidden);
    }
    expect(visibleText).not.toContain("Withdrawn by");
    expect(visible.map((entry) => entry.path).join("\n")).not.toContain(id8(ids.image(12)));
  });

  it("hold the public timeline, confirmed awards, announcements, and images of their own team", () => {
    for (const shown of [
      "ISS-1:",
      "ISS-12:",
      "Monitor flickers",
      "I will bring a new cable.",
      "Replaced the cable",
      "Lost time while waiting",
      "Applied outside Minsky. Confirmed by Jordan Jury",
      "Network outage in Hall A",
      "Lunch at noon",
      "loose cable.png",
      "Spring finals",
    ]) {
      expect(auroraLog, shown).toContain(shown);
    }
    for (const shown of ["ISS-7:", CEDAR_REPLY, "projector.png", "Network outage in Hall A", "Lunch at noon", "Spring finals"]) {
      expect(cedarLog, shown).toContain(shown);
    }
    expect(folderPaths(aurora)).toEqual([
      `${aurora}/log.html`,
      `${aurora}/images/issue-0001/${id8(ids.image(1))}-loose cable.png`,
    ]);
    expect(folderPaths(cedar)).toEqual([
      `${cedar}/log.html`,
      `${cedar}/images/issue-0007/${id8(ids.image(4))}-projector.png`,
    ]);
  });

  it("keep the issues, replies, and images of one team out of the folder of another", () => {
    for (const other of ["ISS-7:", "HYPERLINK", CEDAR_REPLY, "projector.png", "Cedar", "Hall B, desk 4", id8(ids.image(4))]) {
      expect(auroraLog, other).not.toContain(other);
    }
    for (const other of ["ISS-1:", "ISS-12:", "Monitor flickers", "I will bring a new cable.", "Replaced the cable", "Lost time while waiting", "loose cable.png", "Aurora", "Hall A, desk 12", id8(ids.image(1))]) {
      expect(cedarLog, other).not.toContain(other);
    }
    expect(folderPaths(aurora).join("\n")).not.toContain("projector");
    expect(folderPaths(cedar).join("\n")).not.toContain("loose cable");
  });

  it("share one copy of each announcement image, which every team log links to", () => {
    const shared = `contestant-visible/announcements/${id8(ids.image(11))}-menu.webp`;
    expect(entries.map((entry) => entry.path).filter((path) => path.includes(id8(ids.image(11))))).toEqual([shared]);
    for (const log of [auroraLog, cedarLog]) expect(log).toContain(`href="../../announcements/${id8(ids.image(11))}-menu.webp"`);
  });

  it("have no contestant-visible log outside the team folders", () => {
    expect(visible.map((entry) => entry.path).filter((path) => path.endsWith("log.html"))).toEqual([`${aurora}/log.html`, `${cedar}/log.html`]);
  });
});

describe("the view of one team", () => {
  const record = fixtureRecord();

  it("keeps the issues of that team and drops every other row that the team could not see", () => {
    const view = teamViews(record).get(ids.teamA)!;
    expect(view.teams.map((team) => team.id)).toEqual([ids.teamA]);
    expect(view.issues.map((issue) => issue.number)).toEqual([1, 12]);
    expect(view.history.every((entry) => entry.visibility === "public")).toBe(true);
    expect(view.history.every((entry) => [ids.issue(1), ids.issue(12)].includes(entry.issue_id))).toBe(true);
    expect(view.resolutions.map((resolution) => resolution.summary)).toEqual(["Replaced the cable"]);
    expect(view.members).toEqual([]);
    expect(view.audit).toEqual([]);
    expect(view.contest_awards.map((award) => award.explanation)).toEqual(["Network outage in Hall A"]);
    expect(view.awards.map((award) => award.explanation)).toEqual(["Lost time while waiting"]);
    expect(view.announcements.map((announcement) => announcement.title)).toEqual(["Lunch at noon"]);
    expect(view.issue_images.map((image) => image.id)).toEqual([ids.image(1)]);
    expect(view.announcement_images.map((image) => image.id)).toEqual([ids.image(11)]);
    expect(record.history.some((entry) => entry.visibility === "internal")).toBe(true);
  });

  it("gives the other team its own rows, and the shared rows too", () => {
    const view = teamViews(record).get(ids.teamB)!;
    expect(view.issues.map((issue) => issue.number)).toEqual([7]);
    expect(view.history.map((entry) => entry.text)).toContain(CEDAR_REPLY);
    expect(view.awards).toEqual([]);
    expect(view.resolutions).toEqual([]);
    expect(view.issue_images.map((image) => image.id)).toEqual([ids.image(4)]);
    expect(view.announcements.map((announcement) => announcement.title)).toEqual(["Lunch at noon"]);
  });

  it("holds nothing of an issue for a team that has none, and does not change the record", () => {
    const quiet = "00000009-0000-4000-8000-000000000000";
    const withQuiet = { ...record, teams: [...record.teams, { ...record.teams[0]!, id: quiet, name: "Quiet" }] };
    const copy = structuredClone(withQuiet);
    const view = teamViews(withQuiet).get(quiet)!;
    expect(view.teams.map((team) => team.id)).toEqual([quiet]);
    expect([view.issues, view.history, view.resolutions, view.awards, view.issue_images]).toEqual([[], [], [], [], []]);
    expect(view.announcements).toHaveLength(1);
    expect(withQuiet).toEqual(copy);
  });
});

describe("staff-only files", () => {
  const entries = archiveEntries(fixtureRecord());
  const log = text(entries, "staff-only/log.html");

  it("hold everything, with internal notes labelled", () => {
    expect(log).toContain(INTERNAL_NOTE);
    expect(log).toMatch(/Staff note<\/span> Staff only\./u);
    for (const shown of ["Test award", "Withdrawn contest award", "Pending contest award", "Wrong room", "Removed", "set_intake", "Audit"]) {
      expect(log, shown).toContain(shown);
    }
    expect(JSON.parse(text(entries, "staff-only/record.json"))).toEqual(JSON.parse(JSON.stringify(fixtureRecord())));
  });

  it("labels workflow steps, lists issues in number order, and links files by relative path", () => {
    expect(log).toContain("Issue claimed");
    expect(log).toContain("Time award withdrawn");
    expect(log).toContain("External application confirmed");
    expect(log.indexOf("ISS-1:")).toBeLessThan(log.indexOf("ISS-7:"));
    expect(log.indexOf("ISS-7:")).toBeLessThan(log.indexOf("ISS-12:"));
    expect(log).toContain(`href="../${aurora}/images/issue-0001/${id8(ids.image(1))}-loose%20cable.png"`);
    expect(log).toContain(`href="../${cedar}/images/issue-0007/${id8(ids.image(4))}-projector.png"`);
    expect(log).toContain(`href="images/issue-0001/${id8(ids.image(2))}-_stock%20room.jpg"`);
    expect(log).toContain(`href="announcements/${id8(ids.image(12))}-wrong%20room.png"`);
    expect(log).toContain(`href="../contestant-visible/announcements/${id8(ids.image(11))}-menu.webp"`);
    expect(text(entries, `${aurora}/log.html`)).toContain(`href="images/issue-0001/${id8(ids.image(1))}-loose%20cable.png"`);
  });

  it("shows each time in the event zone and in ISO", () => {
    expect(log).toContain("2026-11-03 13:10 Asia/Singapore (2026-11-03T05:10:00.000Z)");
  });
});

describe("HTML safety", () => {
  const record = fixtureRecord();
  record.contest.name = "<img src=x onerror=alert(1)>";
  record.announcements[0]!.details = "</style><script>alert('x')</script>";
  record.issue_images[0]!.original_name = '"><script>alert(2)</script>.png';
  record.teams[1]!.name = "<b onmouseover=alert(3)>Cedar</b>";
  const pages = new Map(
    archiveEntries(record).flatMap((entry) => (entry.kind === "text" && entry.path.endsWith(".html") ? [[entry.path, entry.text] as const] : [])),
  );

  it("escapes every value and holds no script", () => {
    expect([...pages.keys()]).toHaveLength(3);
    for (const page of pages.values()) {
      expect(page).not.toMatch(/<script/iu);
      expect(page).not.toContain("<img");
      expect(page).not.toContain("<b ");
      expect(page).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(page).toContain("&lt;/style&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
      expect(page).not.toContain('"><script');
      expect(page).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
    }
    // Issue 1 belongs to Aurora, so its description is in the staff log and the Aurora log only.
    for (const path of ["staff-only/log.html", `${aurora}/log.html`]) {
      expect(pages.get(path)).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(pages.get(path)).toContain("&quot;flaky&quot;");
    }
    expect(pages.get(`${aurora}/log.html`)).toContain("&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;.png");
    expect(pages.get("staff-only/log.html")).toContain("&lt;b onmouseover=alert(3)&gt;Cedar&lt;/b&gt;");
  });
});

describe("CSV files", () => {
  const rows = (csv: string) => csv.replace(/^\uFEFF/u, "").split("\r\n");

  it("start with a byte order mark and use CRLF line ends", () => {
    const csv = issuesCsv(fixtureRecord());
    expect(csv.startsWith("\uFEFFissue_number,issue_id,team,")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(new TextEncoder().encode(csv).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(rows(csv)).toHaveLength(1 + 3 + 1);
  });

  it("neutralizes a formula and quotes per RFC 4180", () => {
    const record = fixtureRecord();
    const variants = ["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\rcmd", "plain, with comma", 'say "hi"', "two\nlines"];
    record.issues = variants.map((description, index) => ({ ...record.issues[0]!, id: ids.issue(40 + index), number: 40 + index, description }));
    const csv = issuesCsv(record);
    for (const formula of ["'=1+1", "'+1", "'-1", "'@SUM(A1)", "'\tcmd"]) expect(csv).toContain(`,${formula},`);
    expect(csv).toContain(`,"'\rcmd",`);
    expect(csv).toContain(',"plain, with comma",');
    expect(csv).toContain(',"say ""hi""",');
    expect(csv).toContain(',"two\nlines",');
    // A formula never starts a cell.
    for (const line of rows(csv).slice(1)) expect(line).not.toMatch(/(^|,)[=+\-@]/u);
  });

  it("list every award, with a status for each", () => {
    const [header, ...lines] = rows(awardsCsv(fixtureRecord()));
    expect(header).toBe(
      "scope,issue_number,award_id,minutes,explanation,status,decided_by,decided_at,applied_by,applied_at,withdrawn_by,withdrawn_at",
    );
    expect(lines.filter(Boolean).map((line) => line.split(",").slice(0, 2).concat(line.split(",")[5] ?? ""))).toEqual([
      ["issue", "1", "applied"],
      ["issue", "7", "withdrawn"],
      ["contest", "", "applied"],
      ["contest", "", "pending"],
      ["contest", "", "withdrawn"],
    ]);
  });
});

describe("README and manifest", () => {
  const record = fixtureRecord();
  const missing = [{ path: "staff-only/images/issue-0001/x.png", image_id: ids.image(2), reason: "This image could not be opened." }];

  it("explain the folders, warn about staff-only content, and list missing files", () => {
    const readme = readmeEntry(record, missing).text;
    expect(readme).toContain("minsky-contest-archive, version 1");
    expect(readme).toContain("Do not give it to contestants.");
    expect(readme).toContain("staff-only/log.html");
    expect(readme).toContain("contestant-visible/teams/<team folder>/log.html");
    expect(readme).not.toContain("contestant-visible/log.html");
    expect(readme).toContain("To give a team its record, copy the contestant-visible folder.");
    expect(readme).toMatch(/Team folders\n/u);
    expect(readme).toContain(`${aurora}/\n    Aurora, Hall A, desk 12`);
    expect(readme).toContain(`${cedar}/\n    Cedar, Hall B, desk 4`);
    expect(readme).toContain("2026-11-03 23:00 Asia/Singapore (2026-11-03T15:00:00.000Z)");
    expect(readme).toContain(`staff-only/images/issue-0001/x.png (image ${ids.image(2)}): This image could not be opened.`);
    expect(readmeEntry(record, []).text).toMatch(/Files that this archive lacks\nNone\./u);
  });

  it("count each record section and list files and missing images", () => {
    const written = [{ path: "README.txt", bytes: 10, sha256: "a".repeat(64) }];
    const manifest = JSON.parse(manifestEntry(record, written, missing).text) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      format: "minsky-contest-archive",
      version: 1,
      record_format: "minsky-contest-record",
      record_version: 1,
      exported_at: record.exported_at,
      exported_by: record.exported_by,
      event: { code: "fixture-olympiad", time_zone: "Asia/Singapore" },
      contest: { id: ids.contest, name: "Spring finals" },
      counts: {
        teams: 2, members: 2, issues: 3, history: 11, resolutions: 1, awards: 2, contest_awards: 3,
        announcements: 2, issue_images: 4, announcement_images: 2, audit: 2,
      },
      files: written,
      missing,
    });
  });
});

describe("record sanity", () => {
  it("keeps the fixture a valid record that the layout reads without changing it", () => {
    const record: ContestRecord = fixtureRecord();
    const copy = structuredClone(record);
    archiveEntries(record);
    expect(record).toEqual(copy);
  });
});
