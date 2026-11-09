import { z } from 'zod';
import { can } from '../../../connected/capabilities';
import { CONTEST_RECORD_FORMAT, CONTEST_RECORD_VERSION } from '../../../connected/contestRecord';
import type { Caller } from '../../authentication';
import { AuthenticationError } from '../../authentication';
import { bound } from '../d1/assertions';
import type { D1Connection, D1Value } from '../d1/connection';
import { type ContestAuthorityRow, contestDataBindings, contestDataSql, contestSeatsSql, seatFromRow } from './authority';

/** D1 advises about 1,000 rows for each statement. */
const PAGE_ROWS = 1000;

const bool = (condition: string) => `json(CASE WHEN ${condition} THEN 'true' ELSE 'false' END)`;

/**
 * The record's one-row parts. D1 caps a value near 2 MB, so each table is read in
 * pages of one `json_object` per row, and the Worker never parses a row.
 * Binds contestId.
 */
export const headerSql = `SELECT json_object('id', e.id, 'name', e.name, 'code', e.code, 'time_zone', e.time_zone,
    'archived', ${bool('e.archived = 1')}) AS event,
  json_object('id', s.id, 'name', s.name, 'kind', s.kind, 'contest_type', s.contest_type, 'starts_at', s.starts_at,
    'ends_at', s.ends_at, 'grace_minutes', s.grace_minutes, 'intake_follows_schedule', ${bool('s.intake_follows_schedule = 1')},
    'categories', json(s.categories), 'max_image_bytes', s.max_image_bytes, 'max_images_per_issue', s.max_images_per_issue,
    'max_image_bytes_per_issue', s.max_image_bytes_per_issue) AS contest
  FROM sessions s JOIN events e ON e.id = s.event_id WHERE s.id = ?`;

/**
 * The rows after a cursor. The first key alone bounds the index range, and the
 * row value makes the order exact, so a page never reads the rows before its cursor.
 * `seekValues` gives the matching bindings.
 */
const after = (...keys: string[]) => keys.length === 1 ? `${keys[0]} > ?`
  : `${keys[0]} >= ? AND (${keys.join(', ')}) > (${keys.map(() => '?').join(', ')})`;
const seekValues = (cursor: D1Value[]): D1Value[] => cursor.length === 1 ? cursor : [cursor[0] ?? null, ...cursor];

/**
 * A table of the contest, ordered by `key` and then `id`. The key must be the second column of an index
 * on `(session_id, key)`. Then each page starts at its cursor and sorts only the rows of one key value,
 * so a page never sorts the whole contest again. Binds contestId, the seek values, and the page size.
 */
const byKey = (from: string, alias: string, key: string, row: string) => `SELECT ${row} AS row,
    ${alias}.${key} AS k1, ${alias}.id AS k2
  FROM ${from} WHERE ${alias}.session_id = ? AND ${after(`${alias}.${key}`, `${alias}.id`)}
  ORDER BY ${alias}.${key}, ${alias}.id LIMIT ?`;

const awardColumns = (a: string) => `'id', ${a}.id, 'minutes', ${a}.minutes, 'explanation', ${a}.explanation,
  'actor', ${a}.actor, 'actor_name', ${a}.actor_name, 'at', ${a}.at, 'applied_at', ${a}.applied_at,
  'applied_by', ${a}.applied_by, 'applied_name', ${a}.applied_name, 'withdrawn_at', ${a}.withdrawn_at,
  'withdrawn_by', ${a}.withdrawn_by, 'withdrawn_name', ${a}.withdrawn_name`;

interface Section {
  /** The record's key for this table. */
  name: string;
  /** Selects `row` and the key columns `k1`, `k2`, ... of each row, in key order. */
  sql: string;
  /** The cursor before the first row, one value for each key column. */
  start: D1Value[];
}

/** Every table of the record, in the record's order. Each query reads one contest through its own index. */
export const sections: readonly Section[] = [
  { name: 'teams', start: [''], sql: `SELECT json_object('id', t.id, 'entrant_id', t.entrant_id, 'kind', en.kind,
        'name', t.name, 'location', t.location) AS row, t.id AS k1
      FROM teams t LEFT JOIN entrants en ON en.id = t.entrant_id
      WHERE t.session_id = ? AND ${after('t.id')} ORDER BY t.id LIMIT ?` },
  { name: 'members', start: [''], sql: `SELECT json_object('account_id', m.account_id, 'name', p.name, 'handle', p.handle,
        'team_id', m.team_id, 'is_admin', ${bool('m.is_admin = 1')}, 'roles', json(m.roles)) AS row, m.account_id AS k1
      FROM (${contestSeatsSql}) m JOIN accounts p ON p.id = m.account_id
      WHERE ${after('m.account_id')} ORDER BY m.account_id LIMIT ?` },
  { name: 'issues', start: [0], sql: `SELECT json_object('id', i.id, 'number', i.number, 'session_id', i.session_id,
        'team_id', i.team_id, 'reporter', i.reporter, 'reporter_name', i.reporter_name, 'category', i.category,
        'description', i.description, 'status', i.status, 'created_at', i.created_at,
        'first_assigned_at', i.first_assigned_at, 'owner', i.owner, 'owner_name', i.owner_name,
        'resolved_at', i.resolved_at, 'revision', i.public_revision) AS row, i.number AS k1
      FROM issues i WHERE i.session_id = ? AND ${after('i.number')} ORDER BY i.number LIMIT ?` },
  // History has no session. CROSS JOIN keeps the issues first, so the contest's issues drive the read.
  { name: 'history', start: [0, '', ''], sql: `SELECT json_object('id', h.id, 'issue_id', h.issue_id, 'at', h.at,
        'actor', h.actor, 'actor_name', h.actor_name, 'text', h.text, 'visibility', h.visibility) AS row,
        i.number AS k1, h.at AS k2, h.id AS k3
      FROM issues i CROSS JOIN history h ON h.issue_id = i.id
      WHERE i.session_id = ? AND ${after('i.number', 'h.at', 'h.id')}
      ORDER BY i.number, h.at, h.id LIMIT ?` },
  { name: 'resolutions', start: ['', ''], sql: byKey('resolutions r', 'r', 'issue_id', `json_object('id', r.id,
      'session_id', r.session_id, 'issue_id', r.issue_id, 'actor', r.actor, 'actor_name', r.actor_name, 'at', r.at,
      'summary', r.summary, 'reopened_at', r.reopened_at, 'reopened_by', r.reopened_by,
      'reopened_name', r.reopened_name, 'reason', r.reason)`) },
  { name: 'awards', start: ['', ''], sql: byKey('awards w', 'w', 'issue_id', `json_object(${awardColumns('w')},
      'issue_id', w.issue_id, 'resolution_id', w.resolution_id)`) },
  { name: 'contest_awards', start: ['', ''], sql: byKey('contest_awards k', 'k', 'at', `json_object(${awardColumns('k')})`) },
  { name: 'announcements', start: ['', ''], sql: byKey('announcements a', 'a', 'published_at', `json_object('id', a.id,
      'title', a.title, 'details', a.details, 'author', a.author, 'author_name', a.author_name,
      'published_at', a.published_at, 'expires_at', a.expires_at, 'edited_at', a.edited_at, 'edited_by', a.edited_by,
      'edited_name', a.edited_name, 'removed_at', a.removed_at, 'removed_by', a.removed_by,
      'removed_name', a.removed_name)`) },
  // A path names stored bytes only while the image is ready. Every other state keeps its row and no path.
  { name: 'issue_images', start: ['', ''], sql: byKey('issue_images x', 'x', 'issue_id', `json_object('id', x.id,
      'issue_id', x.issue_id, 'uploader', x.uploader, 'uploader_name', x.uploader_name, 'visibility', x.visibility,
      'state', x.state, 'byte_size', x.byte_size, 'content_type', x.content_type, 'original_name', x.original_name,
      'original_path', CASE WHEN x.state = 'ready' THEN x.original_path END, 'original_digest', x.original_digest,
      'created_at', x.created_at, 'uploaded_at', x.uploaded_at, 'deleted_by', x.deleted_by, 'deleted_at', x.deleted_at)`) },
  { name: 'announcement_images', start: ['', ''], sql: byKey('announcement_images x', 'x', 'announcement_id', `json_object('id', x.id,
      'announcement_id', x.announcement_id, 'uploader', x.uploader, 'uploader_name', x.uploader_name, 'name', x.name,
      'state', x.state, 'byte_size', x.byte_size, 'content_type', x.content_type,
      'object_key', CASE WHEN x.state = 'ready' THEN x.object_key END, 'digest', x.digest,
      'uploaded_at', x.uploaded_at, 'deleted_by', x.deleted_by, 'deleted_at', x.deleted_at)`) },
  { name: 'audit', start: ['', ''], sql: byKey('admin_audit d LEFT JOIN accounts p ON p.id = d.actor', 'd', 'at', `json_object('id', d.id,
      'actor', d.actor, 'actor_name', p.name, 'at', d.at, 'action', d.action, 'target', d.target,
      'detail', json(d.detail))`) },
];

/** One row of a page: the row's JSON text, and the key columns that the next page continues from. */
interface PageRow { row: string; k1?: D1Value; k2?: D1Value; k3?: D1Value }

const refused = () => new AuthenticationError(403, 'Only contest admins can download the contest record. Under the read restriction, a webmaster joins the contest first.');

/**
 * The complete support record of one contest as JSON text, for the contest archive.
 * The browser builds the archive, so the Worker only reads and joins text.
 * The pages are separate reads, not one snapshot, and an ended contest rarely changes.
 * The text is held in memory at about twice its size, and again as the response body.
 * A record of 21 MiB (2,000 issues, 80,000 history rows) peaked at 43 MiB of live memory in a local replay.
 */
export class D1ContestRecordService {
  constructor(private readonly db: D1Connection) {}

  /** The resolver with the webmaster read restriction, so a webmaster must have joined the contest. */
  private async authorize(caller: Caller, contestId: string): Promise<ContestAuthorityRow> {
    const row = await bound(this.db, contestDataSql('caller'), ...contestDataBindings(caller, contestId)).first<ContestAuthorityRow>();
    if (!row || !can(seatFromRow(row), 'export_contest')) throw refused();
    return row;
  }

  /** Reads one table page by page and joins its rows as a JSON array. */
  private async table(section: Section, contestId: string): Promise<string> {
    const rows: string[] = [];
    let cursor = section.start;
    for (;;) {
      const page = await bound(this.db, section.sql, contestId, ...seekValues(cursor), PAGE_ROWS).all<PageRow>();
      for (const { row } of page.results) rows.push(row);
      const last = page.results.at(-1);
      if (!last || page.results.length < PAGE_ROWS) return `[${rows.join(',')}]`;
      cursor = [last.k1, last.k2, last.k3].slice(0, section.start.length).map((key) => key ?? null);
    }
  }

  async read(caller: Caller, contestId: string): Promise<string> {
    if (!z.uuid().safeParse(contestId).success) throw new AuthenticationError(400, 'Invalid session or account.');
    const exporter = await this.authorize(caller, contestId);
    // Taken before the table reads, so the record holds every row that existed at this instant.
    const exportedAt = new Date().toISOString();
    const [header, tables] = await Promise.all([
      bound(this.db, headerSql, contestId).first<{ event: string; contest: string }>(),
      Promise.all(sections.map((section) => this.table(section, contestId))),
    ]);
    if (!header) throw refused();
    // Reads take time, and revoked access or a deletion fence must return nothing.
    await this.authorize(caller, contestId);
    const exportedBy = JSON.stringify({ id: exporter.account_id, name: exporter.account_name });
    return `{"format":"${CONTEST_RECORD_FORMAT}","version":${CONTEST_RECORD_VERSION},"exported_at":"${exportedAt}",`
      + `"exported_by":${exportedBy},"event":${header.event},"contest":${header.contest},`
      + sections.map(({ name }, index) => `"${name}":${tables[index]}`).join(',') + '}';
  }
}
