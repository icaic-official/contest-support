import type { EntrantKind, ManageLevel, Seat } from '../../../backend/contracts';
import type { Role } from '../../../connected/model';
import type { Caller } from '../../authentication';
import type { D1Connection, D1Statement, D1Value } from '../d1/connection';

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

// Every use checks both identity-session and application-login expiry against
// database time, including inside write batches.
const liveLoginSql = `a.disabled = 0 AND a.must_change = 0 AND a.credential_state = 'ready'
  AND l.revoked = 0 AND l.expires_at > unixepoch() AND l.credential_generation = a.credential_generation
  AND b.expiresAt > ${nowSql}`;

// An absent settings row is the default. Both values fall back to constants, so
// a guard that compares the stamp never compares NULL.
const siteVersionSql = 'COALESCE((SELECT version FROM site_settings WHERE singleton = 1), 0)';
const readsRestrictedSql = 'COALESCE((SELECT restrict_webmaster_reads FROM site_settings WHERE singleton = 1), 0) = 1';

/**
 * How a statement selects the callers and contests.
 * `caller` binds accountId, loginId, contestId (`contestDataBindings`).
 * `logins` binds contestId, then a JSON array of login IDs. One JSON value stays
 * under D1's limit of 100 bound parameters.
 * `contests` binds the caller for every contest that the caller reaches (`contestListBindings`).
 */
export type ContestSelection = 'caller' | 'logins' | 'contests';

const selections: { readonly [S in ContestSelection]: string } = {
  caller: 'a.id = ? AND l.id = ? AND s.id = ?',
  logins: 's.id = ? AND l.id IN (SELECT value FROM json_each(?))',
  // A webmaster reaches every contest of the site, so only that branch reads every contest.
  contests: `a.id = ? AND l.id = ? AND s.id IN (SELECT session_id FROM memberships WHERE account_id = ?
    UNION ALL SELECT id FROM sessions WHERE event_id IN (SELECT event_id FROM grants WHERE scope = 'event' AND account_id = ?)
    UNION ALL SELECT every_contest.id FROM sessions every_contest
      WHERE EXISTS (SELECT 1 FROM grants WHERE scope = 'site' AND account_id = ?))`,
};

const hasRoleSql = 'EXISTS (SELECT 1 FROM membership_roles mr WHERE mr.session_id = m.session_id AND mr.account_id = m.account_id)';

/**
 * The one contest resolver. It is SQL, because write batches evaluate it again.
 * A row exists when the caller has a live login and holds a membership, an
 * event grant of the contest's event, or a site grant.
 *
 * Event admins and webmasters resolve to an admin staff seat in every contest
 * that they reach, so the rules for contest admins apply to them unchanged.
 * `manage` ranks authority over structure. `data` says whether the caller may
 * read contest data. Only a site grant can set it to 0: while the site restricts
 * webmaster reads, a webmaster reads a contest only after an audited join. A
 * webmaster's own membership never opens data, so an assignment cannot bypass
 * the join. `stamp` holds every version that the answer depends on. Only a
 * webmaster's answer depends on the site setting, so only a webmaster's stamp
 * reads it, and other callers read no added row.
 *
 * An account of one event never reaches a contest of another event. D1 also
 * refuses a membership or an event grant that crosses events.
 *
 * The CROSS JOIN keeps the contest and its event outside the login loop, so
 * the `logins` form reads them once and not once per login.
 */
function contestAuthoritySql(selection: ContestSelection): string {
  const admin = 'm.is_admin = 1 OR ge.account_id IS NOT NULL OR gs.account_id IS NOT NULL';
  return `SELECT a.id AS account_id, a.name AS account_name, l.id AS login_id,
    l.expires_at AS login_expires_at, b.expiresAt AS identity_expires_at,
    s.id AS session_id, s.name AS session_name, s.event_id, e.archived, m.team_id,
    (${admin}) AS is_admin,
    (m.team_id IS NULL AND (${admin}
      OR EXISTS (SELECT 1 FROM membership_roles mr WHERE mr.session_id = s.id AND mr.account_id = a.id))) AS staff,
    (SELECT json_group_array(role) FROM (SELECT role FROM membership_roles mr
      WHERE mr.session_id = s.id AND mr.account_id = a.id ORDER BY role)) AS roles,
    'team' AS entrant_kind,
    CASE WHEN gs.account_id IS NOT NULL THEN 'site' WHEN ge.account_id IS NOT NULL THEN 'event'
      WHEN m.is_admin = 1 THEN 'contest' ELSE 'none' END AS manage,
    CASE WHEN gs.account_id IS NOT NULL THEN (NOT (${readsRestrictedSql}) OR EXISTS (SELECT 1 FROM grants gj
      WHERE gj.scope = 'contest' AND gj.session_id = s.id AND gj.account_id = a.id)) ELSE 1 END AS data,
    json_array(a.access_version, a.credential_generation, l.version, COALESCE(m.version, 0), s.version, e.version,
      CASE WHEN gs.account_id IS NOT NULL THEN ${siteVersionSql} ELSE 0 END) AS stamp
    FROM sessions s JOIN events e ON e.id = s.event_id
    CROSS JOIN accounts a JOIN logins l ON l.account_id = a.id
    JOIN ba_session b ON b.id = l.identity_session_id AND b.userId = a.id
    LEFT JOIN memberships m ON m.session_id = s.id AND m.account_id = a.id
    LEFT JOIN grants ge ON ge.scope = 'event' AND ge.event_id = s.event_id AND ge.account_id = a.id
    LEFT JOIN grants gs ON gs.scope = 'site' AND gs.account_id = a.id
    WHERE ${selections[selection]} AND ${liveLoginSql}
      AND (a.event_id = s.event_id OR a.event_id IS NULL)
      AND (m.account_id IS NOT NULL OR ge.account_id IS NOT NULL OR gs.account_id IS NOT NULL)`;
}

/** One row of the contest resolver. Embedders of `contestDataSql` read these names. */
export interface ContestAuthorityRow {
  account_id: string;
  account_name: string;
  login_id: string;
  login_expires_at: number;
  identity_expires_at: string;
  session_id: string;
  session_name: string;
  event_id: string;
  archived: number;
  team_id: string | null;
  is_admin: number;
  staff: number;
  roles: string;
  entrant_kind: EntrantKind;
  manage: ManageLevel;
  data: number;
  stamp: string;
}

/**
 * The contest resolver with the webmaster read restriction applied. Every
 * reader of contest data embeds it.
 */
export function contestDataSql(selection: ContestSelection): string {
  return `SELECT * FROM (${contestAuthoritySql(selection)}) WHERE data = 1`;
}

/** Callers must come from the trusted authentication service. */
export function contestDataBindings(caller: Caller, contestId: string): D1Value[] {
  return [caller.accountId, caller.loginId, contestId];
}

export function contestListBindings(caller: Caller): D1Value[] {
  return [caller.accountId, caller.loginId, caller.accountId, caller.accountId, caller.accountId];
}

/**
 * The staff seats assigned to one contest: memberships with no team that hold
 * admin or a role. Event admins and webmasters hold no assigned seat. Binds contestId.
 */
export const contestStaffSql = `SELECT m.account_id FROM memberships m
  WHERE m.session_id = ? AND m.team_id IS NULL AND (m.is_admin = 1 OR ${hasRoleSql})`;

/** Every seat assigned to one contest, with its roles. Binds contestId. */
export const contestSeatsSql = `SELECT m.session_id, m.account_id, m.team_id, m.is_admin,
  (SELECT json_group_array(role) FROM (SELECT role FROM membership_roles mr
    WHERE mr.session_id = m.session_id AND mr.account_id = m.account_id ORDER BY role)) AS roles
  FROM memberships m WHERE m.session_id = ?`;

/** What an authority question names: the site or one contest. */
export type Target =
  | { readonly scope: 'site' }
  | { readonly scope: 'contest'; readonly contestId: string };

/** The resolved answer to "what may this account do here". Built only by `resolveAuthority`. */
export interface Authority {
  readonly caller: Caller;
  readonly target: Target;
  /** The target's event. Null for the site. */
  readonly eventId: string | null;
  readonly manage: ManageLevel;
  /** Null when the caller may manage but not read contest data, or holds a seat with no team, role, or admin. */
  readonly seat: Seat | null;
  /** False when the event is archived. Every write requires true. */
  readonly writable: boolean;
  /** Opaque. Compared inside the write batch by `authorityGuard`. Never sent to the browser. */
  readonly stamp: string;
}

/**
 * The site resolver. A row exists only for a live login of a webmaster. The
 * stamp holds the site setting's version, so a change of the setting fails
 * every site command that read the older one. Binds accountId, loginId.
 */
const siteAuthoritySql = `SELECT a.id AS account_id,
    json_array(a.access_version, a.credential_generation, l.version, ${siteVersionSql}) AS stamp
  FROM accounts a JOIN logins l ON l.account_id = a.id
  JOIN ba_session b ON b.id = l.identity_session_id AND b.userId = a.id
  JOIN grants gs ON gs.scope = 'site' AND gs.account_id = a.id
  WHERE a.id = ? AND l.id = ? AND ${liveLoginSql}`;

/** The only constructor of a seat on the server. A row without data access has no seat. */
export function seatFromRow(row: Pick<ContestAuthorityRow, 'data' | 'team_id' | 'staff' | 'is_admin' | 'roles' | 'entrant_kind'>): Seat | null {
  if (row.data !== 1) return null;
  if (row.team_id !== null) return { kind: 'contestant', entryId: row.team_id, entrantKind: row.entrant_kind };
  if (!row.staff) return null;
  return { kind: 'staff', admin: Boolean(row.is_admin), roles: JSON.parse(row.roles) as Role[] };
}

/**
 * One read of the unfiltered resolver, because structure authority ignores the
 * webmaster read restriction. Undefined means no authority at all.
 */
export async function resolveAuthority(db: D1Connection, caller: Caller, target: Target): Promise<Authority | undefined> {
  const { sql, values } = authorityRead(caller, target);
  if (target.scope === 'site') {
    const row = await db.prepare(sql).bind(...values).first<{ stamp: string }>();
    if (!row) return undefined;
    return { caller, target, eventId: null, manage: 'site', seat: null, writable: true, stamp: row.stamp };
  }
  const row = await db.prepare(sql).bind(...values).first<ContestAuthorityRow>();
  if (!row) return undefined;
  return {
    caller, target, eventId: row.event_id, manage: row.manage, seat: seatFromRow(row),
    writable: row.archived === 0, stamp: row.stamp,
  };
}

function authorityRead(caller: Caller, target: Target): { sql: string; values: D1Value[] } {
  return target.scope === 'site'
    ? { sql: siteAuthoritySql, values: [caller.accountId, caller.loginId] }
    : { sql: contestAuthoritySql('caller'), values: contestDataBindings(caller, target.contestId) };
}

const manageRank: { readonly [L in ManageLevel]: number } = { none: 0, contest: 1, event: 2, site: 3 };

/** True when the authority reaches at least the level: none < contest < event < site. */
export function reaches(authority: Authority, level: ManageLevel): boolean {
  return manageRank[authority.manage] >= manageRank[level];
}

/**
 * The in-batch half of an authorized write, as a condition. It runs the same
 * resolver again and compares the stamp, so a grant, membership, role, login,
 * contest, event, or site setting change since the read fails the batch.
 */
export function authorityCheck(authority: Authority): { sql: string; values: D1Value[] } {
  const { sql, values } = authorityRead(authority.caller, authority.target);
  return { sql: `SELECT 1 FROM (${sql}) WHERE stamp = ?`, values: [...values, authority.stamp] };
}

/** Inserts the command assertion `id`, which fails the batch when `authorityCheck` no longer holds. */
export function authorityGuard(db: D1Connection, id: string, authority: Authority): D1Statement {
  const { sql, values } = authorityCheck(authority);
  return db.prepare(`INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN EXISTS (${sql}) THEN 1 ELSE 0 END)`)
    .bind(id, ...values);
}

/**
 * Account management authority as one SQL condition. An actor may manage a target when:
 *   webmaster     -> any other account;
 *   event admin   -> any other account of the same event; webmasters have no event, so never one;
 *   contest admin -> an account that holds no grant, has at least one assignment, and whose every
 *                    assignment is a contest that the actor administers in an unarchived event.
 * So no lower authority can manage a higher one. D1 repeats the core of the rule
 * for every Worker version (0017 account_operation_takeover). Bind with manageAccountBindings.
 */
export const manageAccountSql = `SELECT 1 FROM accounts t WHERE t.id = ? AND t.id <> ? AND (
  EXISTS (SELECT 1 FROM grants g WHERE g.scope = 'site' AND g.account_id = ?)
  OR (t.event_id IS NOT NULL AND EXISTS (SELECT 1 FROM grants g
    WHERE g.scope = 'event' AND g.event_id = t.event_id AND g.account_id = ?))
  OR (t.event_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.account_id = t.id)
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.account_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM memberships m JOIN sessions s ON s.id = m.session_id
      JOIN events e ON e.id = s.event_id
      LEFT JOIN memberships am ON am.session_id = m.session_id AND am.account_id = ? AND am.is_admin = 1
      WHERE m.account_id = t.id AND (e.archived = 1 OR am.account_id IS NULL))))`;

export function manageAccountBindings(actor: string, target: string): D1Value[] {
  return [target, actor, actor, actor, actor];
}

/** Every webmaster, enabled or not, by name. `ready` is false until a password is issued. */
export const webmastersSql = `SELECT a.id, a.name, COALESCE(a.username, '') AS username, a.disabled,
    a.credential_generation, a.credential_state = 'ready' AS ready
  FROM grants g JOIN accounts a ON a.id = g.account_id
  WHERE g.scope = 'site' ORDER BY a.name, a.id`;

/**
 * The contests of unarchived events that a webmaster has not joined, while the
 * site restricts webmaster reads. Empty while webmasters read every contest.
 * Binds accountId.
 */
export const contestsToJoinSql = `SELECT s.id, s.name, e.name AS event_name
  FROM sessions s JOIN events e ON e.id = s.event_id
  WHERE ${readsRestrictedSql} AND e.archived = 0 AND NOT EXISTS (SELECT 1 FROM grants gj
    WHERE gj.scope = 'contest' AND gj.session_id = s.id AND gj.account_id = ?)
  ORDER BY e.name, s.name, s.id`;

/**
 * `manageAccountSql` for a target that must be a webmaster. Webmasters issue
 * passwords only for other webmasters until events have their own consoles.
 * Bind with manageAccountBindings.
 */
export const manageWebmasterSql = `${manageAccountSql}
  AND EXISTS (SELECT 1 FROM grants g WHERE g.scope = 'site' AND g.account_id = t.id)`;
