import { randomUUID } from 'node:crypto';
import { attachmentPath } from '../../../connected/imageFile';
import type { Caller } from '../../authentication';
import { avatarKey } from '../cloudflare/avatars';
import type { DeletionEnvironment } from '../cloudflare/eventDeletion';
import type { PrivateBucket } from '../cloudflare/images';
import { SessionLiveCoordinator, type LiveNamespace } from '../cloudflare/live';
import { bound } from './assertions';
import type { D1Connection, D1Statement, D1Value } from './connection';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const LATER = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour')";

export interface SeededAccount extends Caller {
  readonly handle: string;
}

export interface SeededWebmaster extends Caller {
  readonly name: string;
}

/** One event with a row in every table that names an event, a contest, or an account. */
export interface SeededEvent {
  readonly eventId: string;
  readonly name: string;
  readonly code: string;
  readonly practice: string;
  readonly live: string;
  readonly eventAdmin: SeededAccount;
  readonly contestAdmin: SeededAccount;
  readonly volunteer: SeededAccount;
  /** The sign-in of an entrant in both contests, with a live password. */
  readonly contestant: SeededAccount;
  /** The sign-in of an entrant in the live contest, without a live password. */
  readonly waiting: SeededAccount;
  readonly accounts: readonly SeededAccount[];
  /** Every generated ID. A row of this event names at least one. */
  readonly ids: readonly string[];
  /** The R2 keys of this event's files. */
  readonly objects: readonly string[];
}

/** A webmaster with a live login. Local databases are discarded, and a hosted database is temporary. */
export async function seedWebmaster(db: D1Connection): Promise<SeededWebmaster> {
  const accountId = randomUUID();
  const loginId = randomUUID();
  const name = `Fictional webmaster ${accountId.slice(0, 8)}`;
  const handle = `w-${accountId.slice(0, 12)}`;
  await db.batch([
    bound(db, 'INSERT INTO accounts (id, name, username, handle, must_change) VALUES (?, ?, ?, ?, 0)', accountId, name, handle, handle),
    ...identityStatements(db, { accountId, loginId, handle }, name),
    bound(db, `INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', 'fixture')`, accountId),
  ]);
  return { accountId, loginId, name };
}

function identityStatements(db: D1Connection, account: SeededAccount, name: string): D1Statement[] {
  return [
    bound(db, `INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username) VALUES (?, ?, ?, 1, ${NOW}, ${NOW}, ?)`,
      account.accountId, name, `${account.accountId}@deletion.minsky.invalid`, account.handle),
    bound(db, `INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (?, ?, 'credential', ?, 'fictional-test-hash', ${NOW}, ${NOW})`, randomUUID(), account.accountId, account.accountId),
    bound(db, `INSERT INTO ba_session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ${LATER}, ?, ${NOW}, ${NOW}, ?)`,
      account.loginId, randomUUID(), account.accountId),
    bound(db, 'INSERT INTO logins (id, account_id, expires_at, identity_session_id) VALUES (?, ?, unixepoch() + 3600, ?)',
      account.loginId, account.accountId, account.loginId),
  ];
}

/**
 * Seeds one event through the columns that the Worker writes. The webmaster
 * acts in both contests, joins one, and holds a seat in another, as a promoted
 * development account can.
 */
export async function seedEvent(db: D1Connection, webmaster: SeededWebmaster): Promise<SeededEvent> {
  const ids: string[] = [];
  const id = (): string => {
    const value = randomUUID();
    ids.push(value);
    return value;
  };
  const write = (sql: string, ...values: D1Value[]) => bound(db, sql, ...values);
  const person = (label: string): SeededAccount => {
    const accountId = id();
    return { accountId, loginId: id(), handle: `${label}-${accountId.slice(0, 8)}` };
  };
  const eventId = id();
  const practice = id();
  const live = id();
  const name = `Deletion seed ${eventId}`;
  const code = `ds-${eventId.slice(0, 13)}`;
  const entrant = id();
  const otherEntrant = id();
  const [entry, liveEntry, otherEntry] = [id(), id(), id()];
  const eventAdmin = person('admin');
  const contestAdmin = person('contest');
  const volunteer = person('volunteer');
  const contestant = person('team');
  const waiting = person('waiting');
  const accounts = [eventAdmin, contestAdmin, volunteer, contestant, waiting];
  const [issue, secondIssue, liveIssue] = [id(), id(), id()];
  const [resolution, reopened] = [id(), id()];
  const [originalImage, removedImage] = [id(), id()];
  const announcement = id();
  const [announcementImage, removedAnnouncementImage] = [id(), id()];
  const avatar = id();
  const originalKey = attachmentPath(practice, issue, originalImage, 'original');
  const thumbnailKey = attachmentPath(practice, issue, originalImage, 'thumbnail');
  const announcementKey = `${live}/announcements/${announcement}/${announcementImage}`;
  const objects = [originalKey, thumbnailKey, announcementKey, avatarKey(eventAdmin.accountId, avatar)];
  const reporter = contestant.accountId;
  const staff = volunteer.accountId;
  const site = webmaster.accountId;
  await db.batch([
    write('INSERT INTO events (id, name, code, time_zone) VALUES (?, ?, ?, ?)', eventId, name, code, 'Asia/Singapore'),
    write(`INSERT INTO sessions (id, event_id, name, intake_open) VALUES (?, ?, 'Practice', 1)`, practice, eventId),
    write(`INSERT INTO sessions (id, event_id, name, kind, starts_at, ends_at) VALUES (?, ?, 'Live', 'live',
      '2031-01-01T09:00:00.000Z', '2031-01-01T12:00:00.000Z')`, live, eventId),
    write(`INSERT INTO entrants (id, event_id, kind, name) VALUES (?, ?, 'team', 'Team one'), (?, ?, 'team', 'Team two')`,
      entrant, eventId, otherEntrant, eventId),
    ...accounts.map((account, index) => write(`INSERT INTO accounts (id, name, username, handle, event_id, must_change, entrant_id)
      VALUES (?, ?, ?, ?, ?, 0, ?)`, account.accountId, `Fictional ${account.handle}`, account.handle, account.handle, eventId,
    index === 3 ? entrant : index === 4 ? otherEntrant : null)),
    ...accounts.flatMap((account) => identityStatements(db, account, `Fictional ${account.handle}`)),
    write('INSERT INTO teams (id, session_id, name, location, entrant_id) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
      entry, practice, 'Team one', 'Desk 1', entrant, liveEntry, live, 'Team one', 'Desk 1', entrant, otherEntry, live, 'Team two', 'Desk 2', otherEntrant),
    write('INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, 1), (?, ?, 0), (?, ?, 0)',
      practice, contestAdmin.accountId, practice, staff, live, staff),
    write(`INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer'), (?, ?, 'jury')`, practice, staff, live, staff),
    write(`INSERT INTO grants (account_id, scope, event_id, granted_by) VALUES (?, 'event', ?, ?)`, eventAdmin.accountId, eventId, site),
    write('INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, 1)', practice, site),
    write(`INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at, owner, owner_name)
      VALUES (?, ?, ?, 'claimed', 1, ?, 'Team one', 'Devices', 'Fictional issue', ${NOW}, ?, 'Volunteer'),
        (?, ?, ?, 'open', 2, ?, 'Team one', 'Devices', 'Fictional issue', ${NOW}, NULL, NULL),
        (?, ?, ?, 'open', 1, ?, 'Team one', 'Devices', 'Fictional issue', ${NOW}, NULL, NULL)`,
    issue, practice, entry, reporter, staff, secondIssue, practice, entry, reporter, liveIssue, live, liveEntry, reporter),
    write('INSERT INTO session_issue_sequences (session_id, number) VALUES (?, 2), (?, 1)', practice, live),
    write(`INSERT INTO history (id, issue_id, actor, actor_name, at, text, visibility) VALUES (?, ?, ?, 'Team one', ${NOW}, 'Reported', 'public'),
      (?, ?, ?, 'Webmaster', ${NOW}, 'Noted', 'internal'), (?, ?, ?, 'Team one', ${NOW}, 'Reported', 'public')`,
    id(), issue, reporter, id(), issue, site, id(), liveIssue, reporter),
    write(`INSERT INTO resolutions (id, session_id, issue_id, actor, actor_name, at, summary, reopened_at, reopened_by, reopened_name, reason)
      VALUES (?, ?, ?, ?, 'Volunteer', ${NOW}, 'Fixed', ${NOW}, ?, 'Admin', 'Again'), (?, ?, ?, ?, 'Volunteer', ${NOW}, 'Fixed', NULL, NULL, NULL, NULL)`,
    reopened, practice, issue, staff, contestAdmin.accountId, resolution, practice, secondIssue, staff),
    write(`INSERT INTO awards (id, session_id, issue_id, resolution_id, minutes, explanation, actor, actor_name, at, applied_at, applied_by, applied_name)
      VALUES (?, ?, ?, ?, 5, 'Lost time', ?, 'Volunteer', ${NOW}, ${NOW}, ?, 'Admin')`,
    id(), practice, secondIssue, resolution, staff, contestAdmin.accountId),
    write(`INSERT INTO command_receipts (actor, request_id, session_id, command, issue_id) VALUES (?, ?, ?, '{}', ?), (?, ?, ?, '{}', ?)`,
      reporter, id(), practice, issue, site, id(), practice, issue),
    write(`INSERT INTO contest_awards (id, session_id, request_id, minutes, explanation, actor, actor_name, at, applied_at, applied_by, applied_name, applied_request)
      VALUES (?, ?, ?, 10, 'Outage', ?, 'Volunteer', ${NOW}, ${NOW}, ?, 'Admin', ?)`,
    id(), practice, id(), staff, contestAdmin.accountId, id()),
    write(`INSERT INTO contest_awards (id, session_id, request_id, minutes, explanation, actor, actor_name, at, withdrawn_at, withdrawn_by, withdrawn_name, withdrawn_request)
      VALUES (?, ?, ?, 11, 'Outage', ?, 'Volunteer', ${NOW}, ${NOW}, ?, 'Admin', ?)`,
    id(), live, id(), staff, contestAdmin.accountId, id()),
    write(`INSERT INTO admin_audit (id, session_id, actor, action, target, detail) VALUES (?, ?, ?, 'save_member', ?, '{}'), (?, ?, ?, 'save_member', ?, '{}')`,
      id(), practice, contestAdmin.accountId, staff, id(), live, site, staff),
    write(`INSERT INTO authority_audit (id, event_id, actor, actor_name, action, target, detail) VALUES (?, ?, ?, 'Admin', 'set_event_admin', ?, '{}')`,
      id(), eventId, eventAdmin.accountId, contestAdmin.accountId),
    write(`INSERT INTO manage_receipts (actor, request_id, command, result) VALUES (?, ?, '{}', '{}')`, eventAdmin.accountId, id()),
    // A webmaster's receipts outlive the event. A create_event receipt names the event only in its result.
    write(`INSERT INTO manage_receipts (actor, request_id, command, result) VALUES (?, ?, ?, ?), (?, ?, ?, '{}'), (?, ?, ?, '{}')`,
      site, id(), JSON.stringify({ type: 'create_event', name, code, firstAdmin: { handle: eventAdmin.handle, name: 'Fictional admin' } }),
      JSON.stringify({ eventId, accountIds: [eventAdmin.accountId] }),
      site, id(), JSON.stringify({ type: 'create_people', eventId, people: [{ handle: volunteer.handle, name: 'Fictional volunteer' }] }),
      site, id(), JSON.stringify({ type: 'set_location', contestId: live, entrantId: entrant, location: 'Desk 1' })),
    write(`INSERT INTO issue_images (id, session_id, issue_id, uploader, request_id, uploader_name, uploaded_at, visibility, declared_bytes, byte_size,
        content_type, original_name, state, original_path, thumbnail_path, deleted_by, deleted_at)
      VALUES (?, ?, ?, ?, ?, 'Team one', ${NOW}, 'public', 10, 10, 'image/png', 'a.png', 'ready', ?, ?, NULL, NULL),
        (?, ?, ?, ?, ?, 'Team one', ${NOW}, 'public', 10, 10, 'image/png', 'b.png', 'deleted', ?, ?, ?, ${NOW})`,
    originalImage, practice, issue, reporter, id(), originalKey, thumbnailKey,
    removedImage, practice, issue, reporter, id(), `${practice}/removed/${removedImage}/original`, `${practice}/removed/${removedImage}/thumbnail`, staff),
    write('INSERT INTO image_deletions (attachment_id) VALUES (?)', removedImage),
    write('INSERT INTO announcements (id, session_id, title, details, author, author_name, edited_at, edited_by, edited_name, removed_at, removed_by, removed_name) VALUES (?, ?, ?, ?, ?, ?, ' + `${NOW}, ?, 'Admin', ${NOW}, ?, 'Admin')`,
      announcement, live, 'Notice', 'Details', contestAdmin.accountId, 'Admin', contestAdmin.accountId, contestAdmin.accountId),
    write(`INSERT INTO announcement_images (id, session_id, announcement_id, uploader, uploader_name, request_id, request_command, name, declared_bytes,
        byte_size, content_type, digest, object_key, state, uploaded_at, deleted_by, deleted_at)
      VALUES (?, ?, ?, ?, 'Admin', ?, '{}', 'a.png', 10, 10, 'image/png', printf('%064d', 1), ?, 'ready', ${NOW}, NULL, NULL),
        (?, ?, ?, ?, 'Admin', ?, '{}', 'b.png', 10, 10, 'image/png', printf('%064d', 2), ?, 'deleted', ${NOW}, ?, ${NOW})`,
    announcementImage, live, announcement, contestAdmin.accountId, id(), announcementKey,
    removedAnnouncementImage, live, announcement, contestAdmin.accountId, id(), `${live}/announcements/${announcement}/${removedAnnouncementImage}`, staff),
    write('INSERT INTO announcement_image_deletions (image_id) VALUES (?)', removedAnnouncementImage),
    write(`INSERT INTO announcement_receipts (actor, request_id, session_id, command, announcement_id) VALUES (?, ?, ?, '{}', ?)`,
      contestAdmin.accountId, id(), live, announcement),
    write(`INSERT INTO account_avatars (id, account_id, request_id, byte_size, content_type, digest, state, ready_at)
      VALUES (?, ?, ?, 10, 'image/png', printf('%064d', 3), 'ready', ${NOW})`, avatar, eventAdmin.accountId, id()),
    write(`INSERT INTO account_operations (id, account_id, actor, session_id, action, state) VALUES
      (?, ?, ?, ?, 'reset_password', 'completed'), (?, ?, ?, NULL, 'reset_password', 'completed'),
      (?, ?, ?, NULL, 'set_username', 'completed'), (?, ?, ?, NULL, 'set_username', 'completed'),
      (?, ?, ?, NULL, 'reset_password', 'completed')`,
    id(), staff, contestAdmin.accountId, practice,
    id(), waiting.accountId, eventAdmin.accountId,
    id(), contestant.accountId, waiting.accountId,
    id(), waiting.accountId, contestant.accountId,
    id(), contestant.accountId, site),
    // After the operations, because an admin reset ends the scopes that an earlier issue gave.
    write(`INSERT INTO credential_scopes (account_id, session_id, operation_id, issued_from, issued_until)
      VALUES (?, ?, ?, '2031-01-01T09:00:00.000Z', '2031-01-01T12:00:00.000Z')`, contestant.accountId, live, id()),
    write(`INSERT INTO authentication_limits (key, window_start, attempts) VALUES (?, unixepoch(), 1), (?, unixepoch(), 1)`,
      `handle:${eventId}:${contestant.handle}`, `change:${contestant.accountId}`),
    write(`INSERT INTO audience_sequences (session_id, audience, sequence) VALUES (?, ?, 1) ON CONFLICT (session_id, audience) DO NOTHING`,
      practice, `team:${entry}`),
    write(`INSERT INTO notifications (id, session_id, audience, sequence) VALUES (?, ?, ?, 1)`, id(), practice, `team:${entry}`),
    // Set, join, and restore in one batch, so another test never reads the setting on.
    write(`INSERT INTO site_settings (singleton, restrict_webmaster_reads, changed_by) VALUES (1, 1, ?)
      ON CONFLICT (singleton) DO UPDATE SET restrict_webmaster_reads = 1`, site),
    write(`INSERT INTO grants (account_id, scope, session_id, granted_by) VALUES (?, 'contest', ?, ?)`, site, live, site),
    write('UPDATE site_settings SET restrict_webmaster_reads = 0 WHERE singleton = 1'),
  ]);
  return {
    eventId, name, code, practice, live, eventAdmin, contestAdmin, volunteer, contestant, waiting, accounts,
    ids: [...ids, entrant, otherEntrant], objects,
  };
}

/**
 * An account of `event` with a live login and a seat in a contest of another event, as
 * 0017 left a membership from before it. A trigger refuses that write now. A site grant
 * lets an account with no event hold the seat, and the account then takes its first event.
 */
export async function seedInertSeat(db: D1Connection, event: SeededEvent, otherContest: string): Promise<string> {
  const accountId = randomUUID();
  const handle = `inert-${accountId.slice(0, 8)}`;
  await db.batch([
    bound(db, 'INSERT INTO accounts (id, name, username, handle, must_change) VALUES (?, ?, ?, ?, 0)', accountId, 'Fictional legacy', handle, handle),
    ...identityStatements(db, { accountId, loginId: randomUUID(), handle }, 'Fictional legacy'),
    bound(db, `INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', 'fixture')`, accountId),
    bound(db, 'INSERT INTO memberships (session_id, account_id) VALUES (?, ?)', otherContest, accountId),
    bound(db, `DELETE FROM grants WHERE account_id = ? AND scope = 'site'`, accountId),
    bound(db, 'UPDATE accounts SET event_id = ? WHERE id = ?', event.eventId, accountId),
  ]);
  return accountId;
}

/** The `installation` table holds one row for the whole site, so only one event can hold it. */
export async function seedInstallation(db: D1Connection, event: SeededEvent): Promise<boolean> {
  if (await bound(db, 'SELECT 1 FROM installation').first()) return false;
  await bound(db, 'INSERT INTO installation (singleton, id, owner_account_id, event_id, session_id) VALUES (1, ?, ?, ?, ?)',
    randomUUID(), event.eventAdmin.accountId, event.eventId, event.practice).run();
  return true;
}

/** Tables of the application schema, from the schema itself. */
export async function tableNames(db: D1Connection): Promise<string[]> {
  const { results } = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name`).all<{ name: string }>();
  return results.map((row) => row.name);
}

export type TableRows = Record<string, unknown>;

/** Every row of every table, as one request. */
export async function readTables(db: D1Connection, tables: readonly string[]): Promise<Map<string, TableRows[]>> {
  const results = await db.batch(tables.map((table) => db.prepare(`SELECT * FROM "${table}"`))) as Array<{ results: TableRows[] }>;
  return new Map(results.map((result, index) => [tables[index] ?? '', result.results]));
}

const TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

/** A row with its volatile times masked. */
export function maskedRow(row: TableRows): string {
  return JSON.stringify(row, (key, value: unknown) => {
    if (typeof value === 'string') return value.replace(TIMESTAMP, '<time>');
    if (typeof value === 'number' && /(?:^|_)(?:at|until|start)$|expires|Expires/.test(key)) return '<time>';
    return value;
  });
}

/** The masked rows that name one of the IDs, per table. */
export function rowsNaming(tables: ReadonlyMap<string, TableRows[]>, ids: readonly string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [table, rows] of tables) {
    const naming = rows.map(maskedRow).filter((row) => ids.some((id) => row.includes(id))).sort();
    if (naming.length > 0) found.set(table, naming);
  }
  return found;
}

/** The rows that differ between two readings, per table. */
export function changedRows(before: ReadonlyMap<string, string[]>, after: ReadonlyMap<string, string[]>): Record<string, { removed: string[]; added: string[] }> {
  const changes: Record<string, { removed: string[]; added: string[] }> = {};
  for (const table of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(table) ?? [];
    const now = after.get(table) ?? [];
    const removed = old.filter((row) => !now.includes(row));
    const added = now.filter((row) => !old.includes(row));
    if (removed.length > 0 || added.length > 0) changes[table] = { removed, added };
  }
  return changes;
}

/** An R2 bucket in memory. It can return short pages and an empty page, as R2 may. */
export class FakeBucket implements Pick<PrivateBucket, 'list' | 'delete'> {
  readonly objects = new Set<string>();
  pageSize = 1000;
  /** The next listing of each prefix here returns an empty page that says more follow. */
  readonly emptyFirstPage = new Set<string>();

  add(keys: readonly string[]): void {
    for (const key of keys) this.objects.add(key);
  }

  async list({ prefix, cursor, limit = 1000 }: { prefix: string; cursor?: string; limit?: number }) {
    if (this.emptyFirstPage.delete(prefix)) return { objects: [], truncated: true, cursor: '0' };
    const keys = [...this.objects].filter((key) => key.startsWith(prefix)).sort();
    const start = Number(cursor ?? 0);
    const end = start + Math.min(limit, this.pageSize);
    return {
      objects: keys.slice(start, end).map((key) => ({ key })),
      truncated: end < keys.length,
      ...(end < keys.length ? { cursor: String(end) } : {}),
    };
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) this.objects.delete(key);
  }
}

class FakeLiveSocket {
  readyState = 1;
  attachment: unknown = {};
  send(): void { /* A deletion test reads no message. */ }
  close(): void { this.readyState = 3; }
  serializeAttachment(value: unknown): void { this.attachment = value; }
  deserializeAttachment(): unknown { return this.attachment; }
}

/** The storage, alarm, and sockets of one Durable Object, in memory. */
export class FakeLiveState {
  readonly data = new Map<string, unknown>();
  readonly sockets: FakeLiveSocket[] = [];
  alarmAt: number | null = null;
  readonly storage = {
    get: async <T>(key: string) => this.data.get(key) as T | undefined,
    put: async <T>(key: string, value: T) => { this.data.set(key, value); },
    setAlarm: async (at: number) => { this.alarmAt = at; },
    deleteAlarm: async () => { this.alarmAt = null; },
    getAlarm: async () => this.alarmAt,
    deleteAll: async () => { this.data.clear(); },
    list: async <T>() => new Map(this.data) as Map<string, T>,
  };
  acceptWebSocket(socket: FakeLiveSocket): void { this.sockets.push(socket); }
  getWebSockets(): FakeLiveSocket[] { return this.sockets.filter((socket) => socket.readyState === 1); }

  /** Holds what a running contest holds: a cursor, an alarm, and an open socket. */
  fill(sessionId: string): void {
    this.data.set(`sequence:${sessionId}:staff`, 1);
    this.alarmAt = 1;
    this.sockets.push(new FakeLiveSocket());
  }

  get empty(): boolean {
    return this.data.size === 0 && this.alarmAt === null && this.getWebSockets().length === 0;
  }
}

/** Real coordinators over in-memory state, one per contest. */
export class FakeLiveNamespace implements LiveNamespace {
  readonly states = new Map<string, FakeLiveState>();

  constructor(private readonly db: D1Connection) {}

  state(name: string): FakeLiveState {
    const state = this.states.get(name) ?? new FakeLiveState();
    this.states.set(name, state);
    return state;
  }

  idFromName(name: string): unknown {
    return name;
  }

  get(id: unknown): { fetch(request: Request): Promise<Response> } {
    const coordinator = new SessionLiveCoordinator(this.state(String(id)), { DB: this.db });
    return { fetch: (request) => coordinator.fetch(request) };
  }
}

/** Puts the event's files and live state in the fakes, as its real use would. */
export function fillStores(event: SeededEvent, bucket: FakeBucket, live: FakeLiveNamespace): void {
  bucket.add(event.objects);
  for (const contest of [event.practice, event.live]) live.state(contest).fill(contest);
}

export type CrashMode = 'never ran' | 'response lost';

/**
 * The process dies at call `at` of the D1, R2, and Durable Object calls together:
 * that call throws, with or without its effect, and every later call throws.
 * `writes` lists the calls so far that can change state.
 */
export function crashingEnvironment(env: DeletionEnvironment, at: number, mode: CrashMode): { env: DeletionEnvironment; calls: () => number; writes: () => readonly number[] } {
  let calls = 0;
  const writes: number[] = [];
  const enter = async <T>(write: boolean, run: () => Promise<T>): Promise<T> => {
    calls += 1;
    if (write) writes.push(calls);
    if (calls > at) throw new Error('The process is gone.');
    if (calls < at) return run();
    if (mode === 'response lost') await run();
    throw new Error('The process died at this call.');
  };
  const inner = new WeakMap<D1Statement, D1Statement>();
  const wrap = (statement: D1Statement, write: boolean): D1Statement => {
    const wrapped: D1Statement = {
      bind: (...values) => wrap(statement.bind(...values), write),
      first: <T>() => enter(write, () => statement.first<T>()),
      all: <T>() => enter(write, () => statement.all<T>()),
      run: () => enter(write, () => statement.run()),
    };
    inner.set(wrapped, statement);
    return wrapped;
  };
  return {
    calls: () => calls,
    writes: () => writes,
    env: {
      DB: {
        prepare: (sql) => wrap(env.DB.prepare(sql), !/^\s*SELECT\b/i.test(sql)),
        batch: (statements) => enter(true, () => env.DB.batch(statements.map((statement) => inner.get(statement) ?? statement))),
      },
      IMAGES: {
        list: (options) => enter(false, () => env.IMAGES.list(options)),
        delete: (keys) => enter(true, () => env.IMAGES.delete(keys)),
      },
      LIVE_UPDATES: {
        idFromName: (name) => env.LIVE_UPDATES.idFromName(name),
        get: (id) => ({ fetch: (request) => enter(true, () => env.LIVE_UPDATES.get(id).fetch(request)) }),
      },
    },
  };
}

/** Runs `hook` before every D1 call, with the SQL of that call. A batch has the SQL of each statement. */
export function interceptCalls(db: D1Connection, hook: (sql: readonly string[], values: ReadonlyArray<readonly D1Value[]>) => Promise<void>): D1Connection {
  const parts = new WeakMap<D1Statement, { statement: D1Statement; sql: string; values: readonly D1Value[] }>();
  const wrap = (statement: D1Statement, sql: string, values: readonly D1Value[]): D1Statement => {
    const before = () => hook([sql], [values]);
    const wrapped: D1Statement = {
      bind: (...next) => wrap(statement.bind(...next), sql, next),
      first: async <T>() => { await before(); return statement.first<T>(); },
      all: async <T>() => { await before(); return statement.all<T>(); },
      run: async () => { await before(); return statement.run(); },
    };
    parts.set(wrapped, { statement, sql, values });
    return wrapped;
  };
  return {
    prepare: (sql) => wrap(db.prepare(sql), sql, []),
    batch: async (statements) => {
      const items = statements.flatMap((statement) => {
        const part = parts.get(statement);
        return part ? [part] : [];
      });
      await hook(items.map((item) => item.sql), items.map((item) => item.values));
      return db.batch(items.map((item) => item.statement));
    },
  };
}
