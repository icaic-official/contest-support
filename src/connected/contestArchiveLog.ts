import { stampText } from "./archiveFormat.ts";
import type { ContestRecord } from "./contestRecord.ts";
import { historyText, workflowEvent, type WorkflowEvent } from "./historyEvents.ts";
import { statusNames } from "./labels.ts";

/**
 * The log of one contest as a single HTML file. It has inline CSS and no script,
 * and a content security policy that forbids scripts, so a stray `<script>` in
 * a description cannot run. `html` escapes every interpolated value.
 */

export type Audience = "staff" | "contestant";
/** The archive path of each image file, by image ID. An image with no entry has no file. */
export type ImageLinks = ReadonlyMap<string, string>;

type Part = Markup | string | number | null | undefined | false | Part[];

class Markup {
  constructor(readonly text: string) {}
}

const escapes: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => escapes[character] ?? character);
}

function render(part: Part): string {
  if (part instanceof Markup) return part.text;
  if (Array.isArray(part)) return part.map(render).join("");
  if (part === null || part === undefined || part === false) return "";
  return escapeHtml(String(part));
}

/** A template that escapes each value. Only another `html` result passes through as markup. */
function html(strings: TemplateStringsArray, ...parts: Part[]): Markup {
  return new Markup(strings.reduce((out, text, index) => out + text + (index < parts.length ? render(parts[index]) : ""), ""));
}

const audienceText: Record<Audience, { title: string; warning: string }> = {
  staff: {
    title: "Staff-only log",
    warning:
      "This log holds internal staff notes, staff-only images, withdrawn awards, removed announcements, and the audit trail. Do not give it to contestants.",
  },
  contestant: {
    title: "Contestant-visible log",
    warning:
      "This log holds only what this team could see. It has the issues of this team, and the announcements and contest-wide awards that every team could see. Give it to this team only.",
  },
};

const stepLabels: Record<WorkflowEvent["kind"], string> = {
  submitted: "Issue submitted",
  claimed: "Issue claimed",
  handoff: "Handoff requested",
  accepted: "Handoff accepted",
  "image-added": "Image added",
  "image-removed": "Image removed",
  applied: "External application confirmed",
  resolved: "Resolved",
  reopened: "Reopened",
  awarded: "Time award",
  withdrawn: "Time award withdrawn",
};

type IssueImage = ContestRecord["issue_images"][number];
type AnnouncementImage = ContestRecord["announcement_images"][number];

/** What the log shows for one image, whatever kind it is. */
interface ImageLine {
  id: string;
  name: string;
  uploader: string;
  uploadedAt: string | null;
  visibility: string;
  bytes: number | null;
  state: IssueImage["state"];
  deletedAt: string | null;
}

const imageStateText: Record<IssueImage["state"], string> = {
  pending: "The upload did not finish.",
  ready: "The file is stored.",
  deleting: "Removed.",
  deleted: "Removed.",
  abandoned: "The upload did not finish.",
  expired: "The upload did not finish.",
};

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const styles = `
body{font:16px/1.5 system-ui,sans-serif;max-width:62rem;margin:0 auto;padding:1rem;color:#1b1b1f;background:#fff}
h1{font-size:1.7rem;margin:.25rem 0}h2{font-size:1.3rem;margin:2rem 0 .5rem;border-bottom:2px solid #d4d4d8}
h3{font-size:1.1rem;margin:0 0 .25rem}h4{font-size:.95rem;margin:1rem 0 .25rem}
a{color:#1d4ed8}.meta{color:#52525b;font-size:.875rem}.count{color:#52525b}
.banner{border:2px solid #b45309;background:#fffbeb;padding:.75rem 1rem;border-radius:.5rem}
.issue{border:1px solid #d4d4d8;border-radius:.5rem;padding:.75rem 1rem;margin:1rem 0;break-inside:avoid}
.text{white-space:pre-wrap;overflow-wrap:anywhere;margin:.25rem 0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.125rem 1rem;margin:.5rem 0}dt{color:#52525b}dd{margin:0}
ol.timeline,ul.plain{list-style:none;padding:0;margin:.25rem 0}
.entry{border-left:4px solid #a1a1aa;padding:.125rem .75rem;margin:.5rem 0}
.entry.note{border-color:#b45309;background:repeating-linear-gradient(135deg,#fffbeb,#fffbeb 8px,#fef3c7 8px,#fef3c7 16px)}
.entry.reply{border-color:#1d4ed8}.tag{font-weight:600}
table{border-collapse:collapse;width:100%;font-size:.875rem}th,td{border:1px solid #d4d4d8;padding:.25rem .5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}
code{font:.8125rem ui-monospace,monospace;overflow-wrap:anywhere}
`;

/** The relative link from the log's own path to a file of the archive. */
function relativePath(from: string, to: string): string {
  const base = from.split("/").slice(0, -1);
  const target = to.split("/");
  let shared = 0;
  while (shared < base.length && shared < target.length - 1 && base[shared] === target[shared]) shared++;
  return [...base.slice(shared).map(() => ".."), ...target.slice(shared)].map(encodeURIComponent).join("/");
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

const byTime = (a: { at: string }, b: { at: string }) => Date.parse(a.at) - Date.parse(b.at);

/** Renders the record for one audience. Pass one view of `teamViews(record)` for the log of one team. */
export function renderLog(record: ContestRecord, audience: Audience, links: ImageLinks, from: string): string {
  const zone = record.event.time_zone;
  const staff = audience === "staff";
  // The view of one team holds only that team.
  const [viewTeam] = staff ? [] : record.teams;
  const stamp = (instant: string) => stampText(instant, zone);
  const named = (name: string | null) => name ?? "Unknown";

  const teams = new Map(record.teams.map((team) => [team.id, team]));
  const history = groupBy(record.history, (entry) => entry.issue_id);
  const resolutions = groupBy(record.resolutions, (resolution) => resolution.issue_id);
  const awards = groupBy(record.awards, (award) => award.issue_id);
  const images = groupBy(record.issue_images, (image) => image.issue_id);
  const announcementImages = groupBy(record.announcement_images, (image) => image.announcement_id);

  const imageList = (lines: ImageLine[]): Markup => {
    if (lines.length === 0) return html`<p class="meta">No images.</p>`;
    return html`<ul class="plain">${lines.map((line) => {
      const path = links.get(line.id);
      return html`<li><strong>${line.name}</strong>
        <span class="meta"> Added by ${line.uploader}${line.uploadedAt && html` on ${stamp(line.uploadedAt)}`}.
        ${line.visibility}${line.bytes !== null && ` ${sizeText(line.bytes)}.`}
        ${path ? html`<a href="${relativePath(from, path)}">Open the file</a>` : html`No file in this archive. ${imageStateText[line.state]}${line.deletedAt && html` Removed on ${stamp(line.deletedAt)}.`}`}</span></li>`;
    })}</ul>`;
  };

  const issueImageLine = (image: IssueImage): ImageLine => ({
    id: image.id,
    name: image.original_name,
    uploader: image.uploader_name,
    uploadedAt: image.uploaded_at,
    visibility: image.visibility === "public" ? "The team can see it." : "Staff only.",
    bytes: image.byte_size,
    state: image.state,
    deletedAt: image.deleted_at,
  });

  const announcementImageLine = (image: AnnouncementImage): ImageLine => ({
    id: image.id,
    name: image.name,
    uploader: image.uploader_name,
    uploadedAt: image.uploaded_at,
    visibility: "",
    bytes: image.byte_size,
    state: image.state,
    deletedAt: image.deleted_at,
  });

  const awardStatus = (award: ContestRecord["contest_awards"][number]): string => {
    if (award.withdrawn_at) return `Withdrawn by ${named(award.withdrawn_name)} on ${stamp(award.withdrawn_at)}. It gives no time.`;
    if (award.applied_at) return `Applied outside Minsky. Confirmed by ${named(award.applied_name)} on ${stamp(award.applied_at)}.`;
    return "Not yet confirmed as applied.";
  };

  const awardItem = (award: ContestRecord["contest_awards"][number]): Markup => html`<li>
    <strong>${award.minutes} ${award.minutes === 1 ? "minute" : "minutes"}.</strong> ${award.explanation}
    <span class="meta"> Decided by ${award.actor_name} on ${stamp(award.at)}. ${awardStatus(award)}</span></li>`;

  const timelineEntry = (
    entry: ContestRecord["history"][number],
    context: Parameters<typeof workflowEvent>[1],
  ): Markup => {
    const award = (awards.get(entry.issue_id) ?? []).find((item) => Date.parse(item.at) === Date.parse(entry.at));
    const entryContext = { ...context, award };
    const step = workflowEvent(entry, entryContext);
    const note = entry.visibility === "internal";
    const label = step ? stepLabels[step.kind] : note ? "Staff note" : "Reply";
    const kind = step ? "step" : note ? "note" : "reply";
    return html`<li class="entry ${kind}">
      <div class="meta"><time datetime="${new Date(entry.at).toISOString()}">${stamp(entry.at)}</time> by ${entry.actor_name}.
        <span class="tag">${label}</span>${note && staff && " Staff only."}</div>
      <p class="text">${historyText(entry, entryContext)}</p></li>`;
  };

  const issueSection = (issue: ContestRecord["issues"][number]): Markup => {
    const entries = [...(history.get(issue.id) ?? [])].sort(byTime);
    const own = resolutions.get(issue.id) ?? [];
    const awardWithdrawn = entries.some(
      (entry) => workflowEvent(entry, { issue, resolutions: own, award: undefined })?.kind === "withdrawn",
    );
    const team = teams.get(issue.team_id);
    return html`<article class="issue" id="issue-${issue.number}">
      <h3>ISS-${issue.number}: ${statusNames[issue.status]}</h3>
      <dl>
        <dt>Team</dt><dd>${team ? `${team.name} (${team.location})` : "Unknown team"}</dd>
        <dt>Category</dt><dd>${issue.category}</dd>
        <dt>Reported by</dt><dd>${issue.reporter_name} on ${stamp(issue.created_at)}</dd>
        <dt>First assigned</dt><dd>${issue.first_assigned_at ? stamp(issue.first_assigned_at) : "Not assigned"}</dd>
        <dt>Owner</dt><dd>${issue.owner_name ?? "No owner"}</dd>
        <dt>Resolved</dt><dd>${issue.resolved_at ? stamp(issue.resolved_at) : "Not resolved"}</dd>
      </dl>
      <p class="text">${issue.description}</p>
      <h4>Timeline</h4>
      <ol class="timeline">${entries.map((entry) => timelineEntry(entry, { issue, resolutions: own, award: undefined, awardWithdrawn }))}</ol>
      <h4>Resolutions</h4>
      ${own.length === 0 ? html`<p class="meta">None.</p>` : html`<ul class="plain">${[...own].sort(byTime).map((resolution) => html`<li>
        <span class="text">${resolution.summary}</span>
        <span class="meta"> Resolved by ${resolution.actor_name} on ${stamp(resolution.at)}.
        ${resolution.reopened_at && html` Reopened by ${named(resolution.reopened_name)} on ${stamp(resolution.reopened_at)}. Reason: ${resolution.reason ?? "none"}.`}</span></li>`)}</ul>`}
      <h4>Time awards</h4>
      ${(awards.get(issue.id) ?? []).length === 0 ? html`<p class="meta">None.</p>` : html`<ul class="plain">${[...(awards.get(issue.id) ?? [])].sort(byTime).map(awardItem)}</ul>`}
      <h4>Images</h4>
      ${imageList((images.get(issue.id) ?? []).map(issueImageLine))}
    </article>`;
  };

  const sortedIssues = [...record.issues].sort((a, b) => a.number - b.number);
  const contest = record.contest;
  return `<!doctype html>\n${html`<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="robots" content="noindex">
<title>${audienceText[audience].title}: ${contest.name}${viewTeam && ` (${viewTeam.name})`}</title>
<style>${new Markup(styles)}</style>
</head><body>
<header>
<h1>${contest.name}</h1>
<p>${audienceText[audience].title} of ${record.event.name}${record.event.code && ` (${record.event.code})`}.</p>
<p class="banner">${audienceText[audience].warning}</p>
<dl>
  ${viewTeam && html`<dt>Team</dt><dd>${viewTeam.name} (${viewTeam.location})</dd>`}
  <dt>Exported</dt><dd>${stamp(record.exported_at)}${staff && ` by ${record.exported_by.name}`}</dd>
  <dt>Time zone</dt><dd>${zone}</dd>
  <dt>Kind</dt><dd>${contest.kind === "live" ? "Live" : "Practice"}, ${contest.contest_type}</dd>
  <dt>Schedule</dt><dd>${contest.starts_at && contest.ends_at ? html`${stamp(contest.starts_at)} to ${stamp(contest.ends_at)}, grace ${contest.grace_minutes} minutes` : "No schedule"}</dd>
  <dt>Issues</dt><dd>${record.issues.length}</dd>
</dl>
<p class="meta">Files that the export could not add to the archive are listed in README.txt and manifest.json.</p>
</header>
<main>
<h2>Issues <span class="count">${record.issues.length}</span></h2>
${sortedIssues.length === 0 ? html`<p class="meta">No issues.</p>` : sortedIssues.map(issueSection)}
<h2>Contest-wide time awards <span class="count">${record.contest_awards.length}</span></h2>
${record.contest_awards.length === 0 ? html`<p class="meta">None.</p>` : html`<ul class="plain">${[...record.contest_awards].sort(byTime).map(awardItem)}</ul>`}
<h2>Announcements <span class="count">${record.announcements.length}</span></h2>
${record.announcements.length === 0 ? html`<p class="meta">None.</p>` : [...record.announcements].sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at)).map((announcement) => html`<article class="issue">
  <h3>${announcement.title}</h3>
  <p class="meta">Published by ${announcement.author_name} on ${stamp(announcement.published_at)}.
  ${announcement.expires_at && html` Expires on ${stamp(announcement.expires_at)}.`}
  ${announcement.edited_at && html` Edited by ${named(announcement.edited_name)} on ${stamp(announcement.edited_at)}.`}
  ${announcement.removed_at && html` <strong>Removed</strong> by ${named(announcement.removed_name)} on ${stamp(announcement.removed_at)}.`}</p>
  <p class="text">${announcement.details}</p>
  ${imageList((announcementImages.get(announcement.id) ?? []).map(announcementImageLine))}
</article>`)}
${staff && html`<h2>Audit <span class="count">${record.audit.length}</span></h2>
${record.audit.length === 0 ? html`<p class="meta">No entries.</p>` : html`<table>
<thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
<tbody>${[...record.audit].sort(byTime).map((entry) => html`<tr><td>${stamp(entry.at)}</td><td>${entry.actor_name ?? "System"}</td><td>${entry.action}</td><td>${entry.target}</td><td><code>${entry.detail === null || entry.detail === undefined ? "" : JSON.stringify(entry.detail)}</code></td></tr>`)}</tbody>
</table>`}`}
</main>
</body></html>
`.text}`;
}
