import { awardState } from "./archiveFormat.ts";
import type { ContestRecord } from "./contestRecord.ts";

type Cell = string | number | null;
type Column<Row> = readonly [header: string, value: (row: Row) => Cell];

const BYTE_ORDER_MARK = "﻿";

/** A spreadsheet runs a cell that starts with one of these characters as a formula. */
const formulaStart = /^[=+\-@\t\r]/u;

function cellText(cell: Cell): string {
  if (cell === null) return "";
  const text = typeof cell === "number" ? String(cell) : formulaStart.test(cell) ? `'${cell}` : cell;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 with CRLF line ends, preceded by a byte order mark so that spreadsheets read UTF-8. */
function csv<Row>(columns: readonly Column<Row>[], rows: readonly Row[]): string {
  const lines = [columns.map(([header]) => header), ...rows.map((row) => columns.map(([, value]) => value(row)))];
  return `${BYTE_ORDER_MARK}${lines.map((line) => line.map(cellText).join(",")).join("\r\n")}\r\n`;
}

const nameOf = (names: ReadonlyMap<string, string>, id: string | null): string => (id ? (names.get(id) ?? "") : "");

interface IssueRow {
  issue: ContestRecord["issues"][number];
  team: string;
  resolutions: number;
  reopened: number;
  messages: number;
  notes: number;
  images: number;
}

const issueColumns: readonly Column<IssueRow>[] = [
  ["issue_number", (r) => r.issue.number],
  ["issue_id", (r) => r.issue.id],
  ["team", (r) => r.team],
  ["category", (r) => r.issue.category],
  ["status", (r) => r.issue.status],
  ["description", (r) => r.issue.description],
  ["reporter", (r) => r.issue.reporter_name],
  ["owner", (r) => r.issue.owner_name],
  ["created_at", (r) => r.issue.created_at],
  ["first_assigned_at", (r) => r.issue.first_assigned_at],
  ["resolved_at", (r) => r.issue.resolved_at],
  ["resolutions", (r) => r.resolutions],
  ["reopened", (r) => r.reopened],
  ["public_messages", (r) => r.messages],
  ["staff_notes", (r) => r.notes],
  ["images", (r) => r.images],
];

/** One row for each issue, in number order. */
export function issuesCsv(record: ContestRecord): string {
  const teams = new Map(record.teams.map((team) => [team.id, team.name]));
  // One pass over each table: a large contest has thousands of issues and tens of thousands of history rows.
  const counts = new Map(record.issues.map((issue) => [issue.id, { resolutions: 0, reopened: 0, messages: 0, notes: 0, images: 0 }]));
  for (const resolution of record.resolutions) {
    const count = counts.get(resolution.issue_id);
    if (!count) continue;
    count.resolutions++;
    if (resolution.reopened_at) count.reopened++;
  }
  for (const entry of record.history) {
    const count = counts.get(entry.issue_id);
    if (count && entry.visibility === "public") count.messages++;
    if (count && entry.visibility === "internal") count.notes++;
  }
  for (const image of record.issue_images) {
    const count = counts.get(image.issue_id);
    if (count) count.images++;
  }
  const rows = [...record.issues]
    .sort((a, b) => a.number - b.number)
    .map((issue): IssueRow => ({ issue, team: nameOf(teams, issue.team_id), ...counts.get(issue.id)! }));
  return csv(issueColumns, rows);
}

type Award = ContestRecord["contest_awards"][number];
interface AwardRow {
  scope: "issue" | "contest";
  issueNumber: number | null;
  award: Award;
}

const awardColumns: readonly Column<AwardRow>[] = [
  ["scope", (r) => r.scope],
  ["issue_number", (r) => r.issueNumber],
  ["award_id", (r) => r.award.id],
  ["minutes", (r) => r.award.minutes],
  ["explanation", (r) => r.award.explanation],
  ["status", (r) => awardState(r.award)],
  ["decided_by", (r) => r.award.actor_name],
  ["decided_at", (r) => r.award.at],
  ["applied_by", (r) => r.award.applied_name],
  ["applied_at", (r) => r.award.applied_at],
  ["withdrawn_by", (r) => r.award.withdrawn_name],
  ["withdrawn_at", (r) => r.award.withdrawn_at],
];

/** Issue awards in issue order, then contest-wide awards. Withdrawn awards stay, with status `withdrawn`. */
export function awardsCsv(record: ContestRecord): string {
  const numbers = new Map(record.issues.map((issue) => [issue.id, issue.number]));
  const issueRows = record.awards
    .map((award): AwardRow => ({ scope: "issue", issueNumber: numbers.get(award.issue_id) ?? null, award }))
    .sort((a, b) => (a.issueNumber ?? 0) - (b.issueNumber ?? 0) || Date.parse(a.award.at) - Date.parse(b.award.at));
  const contestRows = record.contest_awards.map((award): AwardRow => ({ scope: "contest", issueNumber: null, award }));
  return csv(awardColumns, [...issueRows, ...contestRows]);
}
