# Event platform sketches

**Status.** Proposed. Not implemented.

This page is reference material for the [webmaster, event, and contest platform design](event-platform-design.md). It holds the type sketch and the migration sketch in full.
Every `path:line` citation refers to `main` at `f90b1f5`.
The local checks that the design page describes ran these sketches in local SQLite 3.51 and the local TypeScript compiler, not D1.

## Type sketch

This TypeScript file is a sketch of the design's types and SQL, and each function body that is not yet written throws `not implemented`.

```ts
/**
 * Type sketch for the webmaster, event, and contest platform. Not implemented.
 * Authority is resolved from scoped grants, with the handle and login key split, D1-enforced
 * takeover protection and join audit, and guarded event deletion.
 *
 * Each section names the file it belongs to. The usage in the design page is the spec; these
 * types serve it. Bodies that the local checks exercise hold the real SQL: the contest, event,
 * and site resolvers, manageAccountSql, sign-in, intake, personal end, the forContests rule, the
 * fence, and the rows step of deletion. The local checks import this file with
 * `node --experimental-transform-types`, so every check runs this SQL and not a copy of it.
 * Other bodies throw 'not implemented' and carry `// TODO` pseudocode.
 *
 * The file imports types only, so Node can load it without the repository's modules.
 * A local type check rewrites the import paths and type-checks it against the repository.
 *
 * Reading order: contracts (what callers see) -> capabilities (the pure rule table) ->
 * authority (the one resolver) -> manage, credentials, schedule, deletion (what uses it).
 */

// =================================================================================================
// src/backend/contracts.ts  (additions and changes)
// =================================================================================================

import type { Command, Role, Snapshot } from '../connected/model.ts';

/** IDs are parsed at the HTTP boundary (zod `.brand()`), then trusted inside. */
export type EventId = string & { readonly __brand: 'EventId' };
export type ContestId = string & { readonly __brand: 'ContestId' };
export type AccountId = string & { readonly __brand: 'AccountId' };
export type EntrantId = string & { readonly __brand: 'EntrantId' };
export type RequestId = string & { readonly __brand: 'RequestId' };
/** UTC, `strftime('%Y-%m-%dT%H:%M:%fZ')` format, the format of every stored timestamp. */
export type Instant = string & { readonly __brand: 'Instant' };
/** Site-unique, 3 to 40 characters of [a-z0-9-], for example `xxxx-olympiad-2026`. */
export type EventCode = string & { readonly __brand: 'EventCode' };
/**
 * What a person types to sign in (`accounts.handle`). Unique inside one event, or among site
 * accounts. 3 to 32 characters of [a-z0-9_-], the shape of src/server/adapters/d1/migrations/0003_authentication.sql:2-4.
 */
export type Handle = string & { readonly __brand: 'Handle' };
/**
 * `accounts.username` and `ba_user.username`: the only name Better Auth knows. Globally
 * unique. Never shown and never typed. Server only.
 */
export type LoginKey = string & { readonly __brand: 'LoginKey' };

/**
 * Which handle namespace a sign-in names. Webmasters belong to no event, so they choose
 * `site`. Everyone else names the event, usually from the `?event=` link on the credential sheet.
 */
export type SignInTarget = { readonly kind: 'event'; readonly code: EventCode } | { readonly kind: 'site' };

export interface Authentication {
  currentUser(): Promise<AccountIdentity | undefined>;
  subscribe(onChange: (user: AccountIdentity | undefined) => void): Unsubscribe;
  /**
   * Changed: names the event and takes the typed handle. The form label stays "Username".
   * A wrong event code, handle, or password gives the same 401.
   */
  signIn(target: SignInTarget, handle: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  accountStatus(): Promise<AccountStatus>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

export interface AccountIdentity { id: string; name?: string }
/** Changed: `username` becomes `handle`. The login key never leaves the server. */
export interface AccountStatus { handle: string | null; must_change: boolean; session_valid: boolean }
export type Unsubscribe = () => void;

export type ContestKind = 'practice' | 'live';
export type ContestType = 'singles' | 'mixed' | 'teams';
export type EntrantKind = 'team' | 'single';

/**
 * How far the caller's authority reaches over a contest's structure. Ordered:
 * none < contest (contest admin) < event (event admin) < site (webmaster).
 */
export type ManageLevel = 'none' | 'contest' | 'event' | 'site';

/**
 * What the caller holds inside one contest, as authority.ts resolved it. A contestant seat and
 * a staff seat never mix (D1 triggers contestant_has_no_role, seat_matches_entrant).
 * `admin` is true for contest admins, event admins, and webmasters alike.
 */
export type Seat =
  | { readonly kind: 'contestant'; readonly entryId: string; readonly entrantKind: EntrantKind }
  | { readonly kind: 'staff'; readonly admin: boolean; readonly roles: readonly Role[] };

export interface Schedule {
  readonly startsAt: Instant;
  readonly endsAt: Instant;
  readonly graceMinutes: number;
}

/** Derived by D1 at read time from the schedule, the override, and live readiness. Never stored. */
export interface IntakeState {
  readonly open: boolean;
  readonly reason:
    | 'before_start' | 'running' | 'grace' | 'ended'
    | 'override_open' | 'override_closed'
    /** A live contest whose contestant sign-ins do not all hold a password issued for it. */
    | 'awaiting_live_passwords';
  /** The next instant at which `open` changes by time alone. The browser refreshes then. */
  readonly changesAt: Instant | null;
}

/** One row of the picker and the calendar. */
export interface ContestSummary {
  readonly id: ContestId;
  readonly name: string;
  readonly kind: ContestKind;
  readonly type: ContestType;
  readonly event: { readonly id: EventId; readonly name: string; readonly code: EventCode; readonly timeZone: string };
  readonly schedule: Schedule | null;
  readonly intake: IntakeState;
  /** Null: the contest shows on the caller's calendar, but the caller cannot open it. */
  readonly seat: Seat | null;
  readonly manage: ManageLevel;
}

/**
 * `eventId`: every contest of that event the caller may list (members see their whole event).
 * `window`: every contest of the caller's events that overlaps the window; for webmasters,
 * every event's. Unscheduled contests are listed only by `eventId`.
 */
export type ContestQuery =
  | { readonly eventId: EventId }
  | { readonly window: { readonly from: Instant; readonly to: Instant } };

/** Snapshot addition: the clock that staff and contestants read. All derived by D1. */
export interface ContestClock {
  readonly timeZone: string;
  readonly schedule: Schedule | null;
  readonly intake: IntakeState;
  /** Contestants only: scheduled end plus applied issue awards plus applied contest awards. */
  readonly personalEndAt: Instant | null;
  readonly extraMinutes: number;
}

export interface Workflows {
  /** Replaces `sessions(userId)`, whose argument was ignored (src/backend/contracts.ts:40, src/backend/cloudflare/backend.ts:249). */
  contests(query: ContestQuery): Promise<ContestSummary[]>;
  /** The snapshot gains `clock`, `contest_awards`, `access: {manage}`, and `session.kind/type`. */
  snapshot(contestId: ContestId): Promise<Snapshot>;
  execute(contestId: ContestId, requestId: RequestId, command: Command): Promise<string>;
  executeAndRead?(contestId: ContestId, requestId: RequestId, command: Command):
    Promise<{ issueId: string; snapshot?: Snapshot | undefined }>;
}

// ---- Management: one command surface for site, event, and contest structure ----------------

/** A staff account or a webmaster. The server gives it a login key; nobody sees the key. */
export interface PersonInput { readonly handle: string; readonly name: string }
export interface EntrantInput {
  readonly kind: EntrantKind;
  /** The team's name, or the single contestant's name. Unique inside the event. */
  readonly name: string;
  /** The entrant's one sign-in. A team shares it; a single contestant owns it. */
  readonly handle: string;
}

/**
 * Every structural change. The server derives the target and the requirement from the
 * command alone (manage.ts `requirementOf`), resolves authority once, and checks it inside
 * the write batch. Callers never name their own authority.
 */
export type ManageCommand =
  // Site. Requires a webmaster.
  | { type: 'create_event'; name: string; code: EventCode; timeZone: string; firstAdmin: PersonInput }
  | { type: 'delete_event'; eventId: EventId; confirmName: string }
  | { type: 'add_webmaster'; person: PersonInput }
  | { type: 'remove_webmaster'; accountId: AccountId }
  | { type: 'set_webmaster_reads'; restricted: boolean }
  // Event. Requires an event admin of that event, or a webmaster.
  | { type: 'update_event'; eventId: EventId; name: string; code: EventCode; timeZone: string }
  | { type: 'set_event_admin'; eventId: EventId; accountId: AccountId; admin: boolean }
  | { type: 'create_people'; eventId: EventId; people: readonly PersonInput[] }
  | { type: 'create_entrants'; eventId: EventId; entrants: readonly EntrantInput[] }
  | { type: 'rename_entrant'; eventId: EventId; entrantId: EntrantId; name: string }
  | { type: 'create_contest'; eventId: EventId; name: string; kind: ContestKind; contestType: ContestType;
      schedule: Schedule; categories: readonly string[] }
  | { type: 'update_contest'; contestId: ContestId; name: string; contestType: ContestType; schedule: Schedule }
  | { type: 'assign_entrants'; contestId: ContestId; entries: ReadonlyArray<{ entrantId: EntrantId; location: string }> }
  | { type: 'unassign_entrant'; contestId: ContestId; entrantId: EntrantId }
  | { type: 'assign_staff'; contestId: ContestId; accountId: AccountId; roles: readonly Role[]; admin: boolean }
  | { type: 'unassign_staff'; contestId: ContestId; accountId: AccountId }
  // An account of the event. manageAccountSql decides per account (see requirementOf).
  | { type: 'set_handle'; eventId: EventId; accountId: AccountId; handle: string }
  // Contest. Requires a contest admin of that contest, or higher.
  | { type: 'set_intake'; contestId: ContestId; mode: 'schedule' | 'open' | 'closed' }
  | { type: 'set_image_limits'; contestId: ContestId; fileMegabytes: number; count: number; totalMegabytes: number }
  | { type: 'set_categories'; contestId: ContestId; categories: readonly string[] }
  | { type: 'set_location'; contestId: ContestId; entrantId: EntrantId; location: string }
  // A webmaster's audited join. D1 accepts it only while the site restricts webmaster reads.
  | { type: 'join_contest'; contestId: ContestId };

/** Created IDs, so a retried request with the same ID returns the same IDs. Never a password. */
export interface ManageReceipt {
  readonly eventId?: EventId;
  readonly contestId?: ContestId;
  readonly accountIds?: readonly AccountId[];
  readonly entrantIds?: readonly EntrantId[];
}

/**
 * The only way a password is made: creation, reset, and live reissue all use it.
 * At most ISSUE_BATCH accounts per request (scrypt costs 56 to 96 ms of a 1,000 ms CPU limit).
 * The request never lists the contests that the password opens. The server derives that set,
 * `forContests`, per account with forContestsSql: the live contests of the account's entries
 * whose window overlaps the window of `contestId`. With `contestId` null or a practice
 * contest, the set is empty. The server refuses an issue that would sign a contestant out of a
 * contest outside that set whose intake is open now.
 */
export interface CredentialIssue {
  /** The accounts' event. Null only for site accounts, which only a webmaster may issue for. */
  readonly eventId: EventId | null;
  readonly accountIds: readonly AccountId[];
  /** The contest the organizer issues for, such as "Live 1". */
  readonly contestId: ContestId | null;
}
export interface IssuedCredential {
  readonly accountId: AccountId;
  readonly handle: string;
  /** Shown once on the sheet. Not stored. A lost response means "Issue again". */
  readonly temporaryPassword: string;
}

export interface SiteOverview {
  readonly webmasters: ReadonlyArray<{ id: AccountId; name: string; handle: string }>;
  readonly restrictWebmasterReads: boolean;
  readonly events: ReadonlyArray<{
    id: EventId; name: string; code: EventCode; timeZone: string; archived: boolean;
    /** Derived from its contests' schedules. An event stores no dates. */
    span: { from: Instant; to: Instant } | null;
    contests: number; accounts: number;
  }>;
  readonly deletions: ReadonlyArray<{ eventId: EventId; name: string; requestedBy: string;
    requestedAt: Instant; step: DeletionStep; blocked: string | null; finishedAt: Instant | null }>;
  readonly audit: readonly AuditEntry[];
}

export interface EventConsole {
  readonly event: { id: EventId; name: string; code: EventCode; timeZone: string; archived: boolean };
  readonly manage: ManageLevel;
  readonly admins: readonly AccountId[];
  readonly people: ReadonlyArray<{ id: AccountId; name: string; handle: string | null; ready: boolean }>;
  readonly entrants: ReadonlyArray<{ id: EntrantId; kind: EntrantKind; name: string;
    accountId: AccountId | null; handle: string | null }>;
  readonly contests: readonly ContestSummary[];
  /** Who sits where. Staff rows carry roles; entrant rows carry the location and extra minutes. */
  readonly staffAssignments: ReadonlyArray<{ contestId: ContestId; accountId: AccountId; admin: boolean; roles: readonly Role[] }>;
  readonly entries: ReadonlyArray<{ contestId: ContestId; entrantId: EntrantId; location: string;
    liveReady: boolean; extraMinutes: number }>;
  readonly audit: readonly AuditEntry[];
}

export interface AuditEntry { id: string; actorName: string; at: Instant; action: string; target: string | null }
/** rows: contests, accounts, and the event row; live: Durable Object erase; files: R2 prefixes. */
export type DeletionStep = 'rows' | 'live' | 'files' | 'done';

export interface Management {
  site(): Promise<SiteOverview>;
  event(eventId: EventId): Promise<EventConsole>;
  /** Reusing a request ID with the same command returns the first receipt. */
  execute(requestId: RequestId, command: ManageCommand): Promise<ManageReceipt>;
  issueCredentials(requestId: RequestId, input: CredentialIssue): Promise<readonly IssuedCredential[]>;
}

export type ContestAwardCommand =
  | { type: 'grant'; minutes: number; explanation: string }
  | { type: 'apply'; awardId: string };

/** Contest-wide time awards. Jury grants; support or jury confirms external application. */
export interface ContestAwards {
  execute(contestId: ContestId, requestId: RequestId, command: ContestAwardCommand): Promise<string>;
}

/**
 * Changed: `admin: Administration` is deleted. Its methods and `/api/admin` and
 * `/api/accounts` move into `manage`. `contestAwards` is new.
 */
export interface Backend {
  auth: Authentication;
  workflows: Workflows;
  manage: Management;
  contestAwards: ContestAwards;
  // images, announcements, avatars, updates: unchanged signatures; their server checks move
  // to authority.ts.
}

// =================================================================================================
// src/connected/capabilities.ts  (new, shared by the Worker and the browser)
// =================================================================================================

/**
 * The one rule table for what a seat may do in a contest. decideWorkflow (src/server/workflow.ts:100-211)
 * and the browser gates (src/connected/model.ts:186-198, src/connected/navigation.ts:39, src/organiser/organiserModel.ts:21-43,
 * src/organiser/desktop/consoleModel.ts:51-62) both read it, so the two definitions of "staff" (src/server/adapters/cloudflare/application.ts:35
 * against src/server/adapters/d1/store.ts:65-66) become one. Adding a capability without a row fails to compile.
 */
export type Capability =
  | 'read_internal' | 'submit_for_any_entry' | 'submit_own' | 'claim' | 'escalate' | 'accept'
  | 'resolve_any' | 'reopen_any' | 'award' | 'apply' | 'announce' | 'upload_staff_images'
  | 'configure_contest' | 'see_members';

export const capabilityRule: { readonly [C in Capability]: (seat: Seat) => boolean } = {
  read_internal: (s) => s.kind === 'staff',
  submit_for_any_entry: (s) => s.kind === 'staff',
  submit_own: (s) => s.kind === 'contestant',
  claim: (s) => hasRole(s, 'volunteer') || hasRole(s, 'specialist'),
  escalate: (s) => hasRole(s, 'volunteer') || hasRole(s, 'specialist'),
  accept: (s) => hasRole(s, 'specialist'),
  resolve_any: (s) => s.kind === 'staff' && s.admin,
  reopen_any: (s) => hasRole(s, 'volunteer') || hasRole(s, 'specialist'),
  award: (s) => hasRole(s, 'jury'),
  apply: (s) => hasRole(s, 'volunteer') || hasRole(s, 'specialist') || hasRole(s, 'jury'),
  announce: (s) => s.kind === 'staff' && (s.admin || s.roles.includes('jury')),
  upload_staff_images: (s) => s.kind === 'staff',
  configure_contest: (s) => s.kind === 'staff' && s.admin,
  see_members: (s) => s.kind === 'staff' && s.admin,
};

function hasRole(seat: Seat, role: Role): boolean {
  return seat.kind === 'staff' && seat.roles.includes(role);
}

export function can(seat: Seat | null, capability: Capability): boolean {
  return seat !== null && capabilityRule[capability](seat);
}

// =================================================================================================
// src/server/adapters/cloudflare/authority.ts  (new; replaces every copy of the access check:
// accessSql and currentAccessSql (src/server/adapters/cloudflare/application.ts:30-52), currentAccessForLoginsSql
// (src/server/adapters/cloudflare/application.ts:56), sessionsListSql (src/server/adapters/cloudflare/application.ts:176-183), adminGate (src/server/adapters/cloudflare/application.ts:218-232), workflowSql's membership join
// (src/server/adapters/d1/store.ts:36-70), adminCondition (src/server/adapters/cloudflare/authentication.ts:189-221), announcementManager
// (src/server/adapters/cloudflare/announcements.ts:39-63, src/server/adapters/cloudflare/announcements.ts:138-143), images imageSql/guard (src/server/adapters/cloudflare/images.ts:47-52, src/server/adapters/cloudflare/images.ts:114-118,
// src/server/adapters/cloudflare/images.ts:156-160), announcementImages imageSql (src/server/adapters/cloudflare/announcementImages.ts:36-42), avatars visibleSql (src/server/adapters/cloudflare/avatars.ts:25-34),
// live access (src/server/adapters/cloudflare/live.ts:103-120), ownerCondition (src/server/adapters/cloudflare/installation.ts:140-145), adminRoleSql
// (src/server/adapters/cloudflare/adminRecovery.ts:32-45))
// =================================================================================================

import type { D1Connection, D1Statement, D1Value } from '../d1/connection';
import type { Caller } from '../../authentication';

/** What a request acts on. Every authority question names exactly one. */
export type Target =
  | { readonly scope: 'site' }
  | { readonly scope: 'event'; readonly eventId: EventId }
  | { readonly scope: 'contest'; readonly contestId: ContestId };

/**
 * The resolved answer to "what may this account do here". Built only by `resolveAuthority`,
 * so no caller can assemble one from a request body.
 */
export interface Authority {
  readonly caller: Caller;
  readonly target: Target;
  /** The target's event. Null only for a site target. */
  readonly eventId: EventId | null;
  readonly manage: ManageLevel;
  /**
   * Contest targets only. Null when the caller may manage but not read contest data: a
   * webmaster who has not joined while the site restricts webmaster reads, or a member with
   * neither a team, a role, nor admin (refused today at src/server/adapters/cloudflare/application.ts:66-68).
   */
  readonly seat: Seat | null;
  /** False when the event is archived. Every write requires true. */
  readonly writable: boolean;
  /** Opaque. Compared inside the write batch by `authorityGuard`. Never sent to the browser. */
  readonly stamp: string;
}

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const liveLoginSql = `a.disabled = 0 AND a.must_change = 0 AND a.credential_state = 'ready'
  AND l.revoked = 0 AND l.expires_at > unixepoch() AND l.credential_generation = a.credential_generation
  AND b.expiresAt > ${nowSql}`;
const loginColumns = `a.id AS account_id, a.name AS account_name, l.id AS login_id,
  l.expires_at AS login_expires_at, b.expiresAt AS identity_expires_at`;
const loginFrom = `accounts a JOIN logins l ON l.account_id = a.id
  JOIN ba_session b ON b.id = l.identity_session_id AND b.userId = a.id`;
// Absent row = default. Both COALESCE to constants, so a guard never compares NULL (src/server/adapters/d1/migrations/0001_transaction_proof.sql:95-99).
const siteVersionSql = 'COALESCE((SELECT version FROM site_settings WHERE singleton = 1), 0)';
const readsRestrictedSql = 'COALESCE((SELECT restrict_webmaster_reads FROM site_settings WHERE singleton = 1), 0) = 1';
const notDeletingSql = (eventColumn: string) =>
  `NOT EXISTS (SELECT 1 FROM event_deletions d WHERE d.event_id = ${eventColumn})`;

/**
 * The one contest resolver, as SQL, because guards must re-run it inside D1 batches
 * (src/server/adapters/cloudflare/application.ts:226, src/server/adapters/d1/store.ts:143, src/server/adapters/d1/store.ts:222). Columns keep the names that CurrentAccessRow
 * (src/server/adapters/cloudflare/application.ts:9-26) embedders read (team_id, is_admin, staff, roles), so snapshotSql and the
 * other embedders change only their FROM clause. Version columns become one `stamp`.
 *
 * Not exported. Embedders import `contestDataSql`, which applies the webmaster restriction.
 * Only resolveAuthority reads the unfiltered row, because structure authority ignores the
 * restriction. authorityCopies.test.ts fails on any other reader of grants or memberships.
 *
 * `selection` binds, in order:
 *   'caller' -> accountId, loginId, contestId   (same order as currentAccessBindings today)
 *   'logins' -> contestId, JSON array of login IDs (live.ts, one query per 500 sockets)
 *
 * Isolation is structural: `a.event_id = s.event_id OR a.event_id IS NULL`, and D1 already
 * refuses any membership or event grant that crosses events (0017 membership_event_scope,
 * grant_holder_scope). A site grant decides `data` alone: a webmaster's own membership never
 * opens contest data while the restriction is on, so an assignment cannot bypass the audited
 * join. Hot-path cost against today's accessSql: two partial-index probes on grants, two
 * primary-key reads of site_settings, one entrant lookup by primary key, and one primary-key
 * probe of event_deletions. Phase 1 measures it (the gate in the design page's "Delivery phases").
 *
 * Final shape. Phase 1 ships it with entrant_kind as the constant 'team' and without the
 * event_deletions term; Phase 4 adds the entrants lookup; Phase 7 adds the deletion fence.
 */
function contestAuthoritySql(selection: 'caller' | 'logins'): string {
  const where = selection === 'caller'
    ? 'a.id = ? AND l.id = ? AND s.id = ?'
    : 's.id = ? AND l.id IN (SELECT value FROM json_each(?))';
  return `SELECT ${loginColumns}, s.id AS session_id, s.event_id, e.archived, m.team_id,
    (m.is_admin = 1 OR ge.account_id IS NOT NULL OR gs.account_id IS NOT NULL) AS is_admin,
    (m.team_id IS NULL AND (m.is_admin = 1 OR ge.account_id IS NOT NULL OR gs.account_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM membership_roles mr WHERE mr.session_id = s.id AND mr.account_id = a.id))) AS staff,
    (SELECT json_group_array(role) FROM (SELECT role FROM membership_roles mr
      WHERE mr.session_id = s.id AND mr.account_id = a.id ORDER BY role)) AS roles,
    (SELECT en.kind FROM teams t JOIN entrants en ON en.id = t.entrant_id WHERE t.id = m.team_id) AS entrant_kind,
    CASE WHEN gs.account_id IS NOT NULL THEN 'site' WHEN ge.account_id IS NOT NULL THEN 'event'
      WHEN m.is_admin = 1 THEN 'contest' ELSE 'none' END AS manage,
    CASE WHEN gs.account_id IS NOT NULL THEN (NOT (${readsRestrictedSql}) OR EXISTS (SELECT 1 FROM grants gj
      WHERE gj.scope = 'contest' AND gj.session_id = s.id AND gj.account_id = a.id)) ELSE 1 END AS data,
    json_array(a.access_version, a.credential_generation, l.version, COALESCE(m.version, 0),
      s.version, e.version, ${siteVersionSql}) AS stamp
    FROM ${loginFrom}
    CROSS JOIN sessions s JOIN events e ON e.id = s.event_id
    LEFT JOIN memberships m ON m.session_id = s.id AND m.account_id = a.id
    LEFT JOIN grants ge ON ge.scope = 'event' AND ge.event_id = s.event_id AND ge.account_id = a.id
    LEFT JOIN grants gs ON gs.scope = 'site' AND gs.account_id = a.id
    WHERE ${where} AND ${liveLoginSql}
      AND (a.event_id = s.event_id OR a.event_id IS NULL)
      AND (m.account_id IS NOT NULL OR ge.account_id IS NOT NULL OR gs.account_id IS NOT NULL)
      AND ${notDeletingSql('s.event_id')}`;
}

/** The contest-data view that snapshotSql, workflowSql, images, announcements, avatars, and live embed. */
export const contestDataSql = (selection: 'caller' | 'logins'): string =>
  `SELECT * FROM (${contestAuthoritySql(selection)}) WHERE data = 1`;

/**
 * Event resolver. A row exists for every live login of the event's own accounts and for
 * webmasters. Binds accountId, loginId, eventId. Webmaster structure authority ignores the
 * read restriction, which covers contest data only.
 */
function eventAuthoritySql(): string {
  return `SELECT ${loginColumns}, NULL AS session_id, e.id AS event_id, e.archived, NULL AS team_id,
    0 AS is_admin, 0 AS staff, '[]' AS roles, NULL AS entrant_kind,
    CASE WHEN gs.account_id IS NOT NULL THEN 'site' WHEN ge.account_id IS NOT NULL THEN 'event'
      ELSE 'none' END AS manage,
    0 AS data,
    json_array(a.access_version, a.credential_generation, l.version, e.version, ${siteVersionSql}) AS stamp
    FROM ${loginFrom}
    CROSS JOIN events e
    LEFT JOIN grants ge ON ge.scope = 'event' AND ge.event_id = e.id AND ge.account_id = a.id
    LEFT JOIN grants gs ON gs.scope = 'site' AND gs.account_id = a.id
    WHERE a.id = ? AND l.id = ? AND e.id = ? AND ${liveLoginSql}
      AND (a.event_id = e.id OR gs.account_id IS NOT NULL)
      AND ${notDeletingSql('e.id')}`;
}

/** Site resolver. A row exists only for webmasters. Binds accountId, loginId. */
function siteAuthoritySql(): string {
  return `SELECT ${loginColumns}, NULL AS session_id, NULL AS event_id, 0 AS archived, NULL AS team_id,
    0 AS is_admin, 0 AS staff, '[]' AS roles, NULL AS entrant_kind, 'site' AS manage, 0 AS data,
    json_array(a.access_version, a.credential_generation, l.version, ${siteVersionSql}) AS stamp
    FROM ${loginFrom}
    JOIN grants gs ON gs.scope = 'site' AND gs.account_id = a.id
    WHERE a.id = ? AND l.id = ? AND ${liveLoginSql}`;
}

interface AuthorityRow {
  account_id: string; account_name: string; login_id: string;
  login_expires_at: number; identity_expires_at: string;
  session_id: string | null; event_id: string | null; archived: number;
  team_id: string | null; is_admin: number | null; staff: number | null; roles: string;
  entrant_kind: EntrantKind | null; manage: ManageLevel; data: number; stamp: string;
}

function authoritySql(target: Target): string {
  switch (target.scope) {
    case 'site': return siteAuthoritySql();
    case 'event': return eventAuthoritySql();
    case 'contest': return contestAuthoritySql('caller');
  }
}

function authorityBindings(caller: Caller, target: Target): D1Value[] {
  switch (target.scope) {
    case 'site': return [caller.accountId, caller.loginId];
    case 'event': return [caller.accountId, caller.loginId, target.eventId];
    case 'contest': return [caller.accountId, caller.loginId, target.contestId];
  }
}

/** Pure. The only constructor of Seat on the server. */
function parseAuthorityRow(caller: Caller, target: Target, row: AuthorityRow): Authority {
  let seat: Seat | null = null;
  if (target.scope === 'contest' && row.data === 1) {
    if (row.team_id !== null) {
      seat = { kind: 'contestant', entryId: row.team_id, entrantKind: row.entrant_kind ?? 'team' };
    } else if (row.staff) {
      seat = { kind: 'staff', admin: Boolean(row.is_admin), roles: JSON.parse(row.roles) as Role[] };
    }
  }
  return {
    caller, target, seat,
    eventId: row.event_id as EventId | null,
    manage: row.manage,
    writable: row.archived === 0,
    stamp: row.stamp,
  };
}

/** One read. Undefined means no authority at all: the caller gets 403, never a partial answer. */
export async function resolveAuthority(db: D1Connection, caller: Caller, target: Target): Promise<Authority | undefined> {
  const row = await db.prepare(authoritySql(target)).bind(...authorityBindings(caller, target)).first<AuthorityRow>();
  return row ? parseAuthorityRow(caller, target, row) : undefined;
}

/** `{ manage: 'none' }` asks only for an authority row and, for a write, an unarchived event. */
export type Requirement =
  | { readonly manage: ManageLevel }
  | { readonly capability: Capability };

const manageRank: { readonly [L in ManageLevel]: number } = { none: 0, contest: 1, event: 2, site: 3 };

// In authority.ts this is AuthenticationError(403) from src/server/authentication.ts:25. The
// sketch keeps a local class so that Node can import this file without the repository.
class AuthorityRefused extends Error {
  readonly status = 403;
}

/** Throws a 403 with one fixed message per requirement. Pure. */
export function requireAuthority(authority: Authority | undefined, requirement: Requirement, write: boolean): Authority {
  if (!authority) throw new AuthorityRefused('You do not have access to this.');
  if (write && !authority.writable) throw new AuthorityRefused('This event is archived.');
  if ('manage' in requirement) {
    if (manageRank[authority.manage] < manageRank[requirement.manage]) {
      throw new AuthorityRefused(`This change needs ${requirement.manage} authority.`);
    }
  } else if (!can(authority.seat, requirement.capability)) {
    throw new AuthorityRefused('Your role in this contest does not allow this.');
  }
  return authority;
}

/**
 * The in-batch half of every authorized write. Re-runs the same resolver inside the batch and
 * asserts the captured stamp, so a grant, membership, role, login, contest, event, or site
 * setting change between read and commit aborts the batch (409 or retry). Replaces adminGate's
 * six compared columns (src/server/adapters/cloudflare/application.ts:226-231) and workflowSql's dependency fields for access.
 */
export function authorityGuard(db: D1Connection, assertionId: string, authority: Authority): D1Statement {
  return db.prepare(`INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN EXISTS (
      SELECT 1 FROM (${authoritySql(authority.target)}) WHERE stamp = ?) THEN 1 ELSE 0 END)`)
    .bind(assertionId, ...authorityBindings(authority.caller, authority.target), authority.stamp);
}

/**
 * Account management authority as one SQL condition, used inside credential and handle
 * batches. Replaces adminCondition (src/server/adapters/cloudflare/authentication.ts:189-203). An actor may manage a target when:
 *   webmaster     -> any other account;
 *   event admin   -> any other account of the same event; webmasters have no event, so never one;
 *   contest admin -> an account that holds no grant, has at least one assignment, and whose every
 *                    assignment is a contest that the actor administers in an unarchived event.
 * So no lower authority can reset a higher one. D1
 * repeats the core of that rule for every Worker version (0017 account_operation_takeover).
 * Bind with manageAccountBindings.
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
      WHERE m.account_id = t.id AND (e.archived = 1 OR NOT EXISTS (SELECT 1 FROM memberships am
        WHERE am.session_id = m.session_id AND am.account_id = ? AND am.is_admin = 1)))))`;

export function manageAccountBindings(actor: AccountId, target: AccountId): D1Value[] {
  return [target, actor, actor, actor, actor];
}

// =================================================================================================
// src/server/adapters/cloudflare/manage.ts  (new; replaces D1ApplicationService's admin methods
// (src/server/adapters/cloudflare/application.ts:259-455) and the account commands of D1AuthenticationService
// (src/server/adapters/cloudflare/authentication.ts:227-272))
// =================================================================================================

/**
 * What a command needs. Either a level over a target, or, for a change to one account, any
 * authority row in the account's event plus manageAccountSql for that account inside the batch.
 */
export type ManageRequirement =
  | { readonly target: Target; readonly level: Exclude<ManageLevel, 'none'> }
  | { readonly target: { readonly scope: 'event'; readonly eventId: EventId }; readonly account: AccountId };

const site = (): ManageRequirement => ({ target: { scope: 'site' }, level: 'site' });
const event = (eventId: EventId): ManageRequirement => ({ target: { scope: 'event', eventId }, level: 'event' });
const contest = (contestId: ContestId, level: 'contest' | 'event' | 'site'): ManageRequirement =>
  ({ target: { scope: 'contest', contestId }, level });

/**
 * Each command's requirement, derived from the command alone. Exhaustive by type, so a new
 * command without a row fails to compile. Commands that name a row inside an event also name
 * the event, and the plan's in-batch guard checks that the row belongs to it.
 */
export const requirementOf: {
  readonly [K in ManageCommand['type']]: (command: Extract<ManageCommand, { type: K }>) => ManageRequirement;
} = {
  create_event: site,
  delete_event: site,
  add_webmaster: site,
  remove_webmaster: site,
  set_webmaster_reads: site,
  update_event: (c) => event(c.eventId),
  set_event_admin: (c) => event(c.eventId),
  create_people: (c) => event(c.eventId),
  create_entrants: (c) => event(c.eventId),
  rename_entrant: (c) => event(c.eventId),
  create_contest: (c) => event(c.eventId),
  update_contest: (c) => contest(c.contestId, 'event'),
  assign_entrants: (c) => contest(c.contestId, 'event'),
  unassign_entrant: (c) => contest(c.contestId, 'event'),
  // Only event admins and webmasters assign people to contests (owner decision, 2026-10-27).
  assign_staff: (c) => contest(c.contestId, 'event'),
  unassign_staff: (c) => contest(c.contestId, 'event'),
  set_handle: (c) => ({ target: { scope: 'event', eventId: c.eventId }, account: c.accountId }),
  set_intake: (c) => contest(c.contestId, 'contest'),
  set_image_limits: (c) => contest(c.contestId, 'contest'),
  set_categories: (c) => contest(c.contestId, 'contest'),
  set_location: (c) => contest(c.contestId, 'contest'),
  join_contest: (c) => contest(c.contestId, 'site'),
};

/** The requirement of any command. The cast is safe: requirementOf is keyed by command type. */
export function requirementFor(command: ManageCommand): ManageRequirement {
  return (requirementOf[command.type] as (command: ManageCommand) => ManageRequirement)(command);
}

/** What one command writes. Built by a pure planner from the authority and a few reads. */
interface Plan {
  readonly statements: readonly D1Statement[];
  /** In-batch checks that give the reads' conclusions (for example noClash) their guarantee. */
  readonly guards: readonly D1Statement[];
  /** admin_audit for contest targets, authority_audit for event and site targets. */
  readonly audit: { action: string; target: string | null; detail: object } | null;
  /** Outbox rows per contest: staff and entry audiences, as sessionAudiences does today. */
  readonly notify: ReadonlyArray<{ contestId: ContestId; audiences: readonly string[] }>;
  readonly receipt: ManageReceipt;
}

export class D1ManageService {
  constructor(private readonly db: D1Connection) {}

  site(caller: Caller): Promise<SiteOverview> { throw new Error('not implemented'); }

  event(caller: Caller, eventId: EventId): Promise<EventConsole> { throw new Error('not implemented'); }

  /**
   * parse -> receipt replay -> requirementFor -> resolveAuthority -> requireAuthority ->
   * plan -> one batch [authorityGuard, ...guards, ...statements, audit, receipt, outbox,
   * final currentReadyLogin assertion, assertion cleanup]. A constraint failure maps to 409.
   * An account requirement asks requireAuthority for `{ manage: 'none' }`, so any authority
   * row in the event passes, and the batch asserts manageAccountSql for that one account.
   * Idempotent: a retry with the same request ID and command returns the stored receipt; with
   * a different command it is refused; a lost response after commit replays the receipt.
   */
  execute(caller: Caller, requestId: RequestId, input: unknown): Promise<ManageReceipt> {
    throw new Error('not implemented');
  }

  private plan(command: ManageCommand, authority: Authority): Promise<Plan> {
    // TODO per command. Notable cases:
    // create_event: INSERT events (code, time_zone validated by Intl), INSERT the first admin's
    //   account (event_id, handle, username = loginKeyFor(id), state pending), INSERT grant
    //   (scope 'event'). The browser then calls issueCredentials for that one account.
    // add_webmaster: INSERT a site account (event_id NULL, handle, login key), INSERT grant
    //   (scope 'site'). An existing event account cannot become a webmaster: its event is fixed.
    // delete_event: fenceStatements (eventDeletion.ts).
    // remove_webmaster: DELETE grant; revoke the account's logins. grant_last_webmaster refuses
    //   the last one inside the batch.
    // set_webmaster_reads: UPSERT site_settings; the version trigger invalidates webmaster guards.
    // create_people, create_entrants: read the event's handles and entrant names; refuse
    //   duplicates; INSERT accounts (event_id, handle, username = loginKeyFor(id)) and entrants.
    //   accounts_event_handle refuses a duplicate handle inside the batch as well.
    // rename_entrant: guard entrants.event_id = command.eventId; UPDATE entrants.name.
    // set_handle: guard accounts.event_id = command.eventId and manageAccountSql; UPDATE
    //   accounts.handle only. ba_user and the login key never change, so open sessions survive.
    //   INSERT account_operations (action 'set_username', session_id NULL), which the 0017
    //   takeover trigger checks; authority_audit records the old and new handle.
    // assign_entrants: INSERT teams (session_id, entrant_id, name = entrant name, location).
    //   D1 seats the sign-in (entry_seats_added) and checks contest type (entry_fits_contest).
    // unassign_entrant: refuse while the entry has issues (as delete_team, src/server/adapters/cloudflare/application.ts:365-388).
    // assign_staff: guard that the account belongs to the contest's event and has no entrant;
    //   UPSERT memberships (team_id NULL) and roles. D1 refuses entrant sign-ins and other events.
    // set_intake: schedule -> intake_follows_schedule = 1; open/closed -> 0 and intake_open = 1/0.
    // join_contest: INSERT grants (scope 'contest'). D1 refuses it unless the site restricts
    //   reads, and D1 writes both audit rows (0017 grant_join_audited).
    throw new Error('not implemented');
  }
}

// =================================================================================================
// src/server/adapters/cloudflare/credentials.ts  (new; replaces credentialReset.ts, the inline
// copies in src/server/adapters/cloudflare/installation.ts:165-169 and src/server/adapters/cloudflare/installation.ts:190-193, insertPendingReset, and the two-batch create
// and reset in src/server/adapters/cloudflare/authentication.ts:249-308)
// =================================================================================================

export const ISSUE_BATCH = 8;

/**
 * The login key of every account that the new Worker creates: its ID without dashes. 32
 * characters of [0-9a-f] pass the column CHECK (src/server/adapters/d1/migrations/0003_authentication.sql:2-4), src/server/adapters/cloudflare/identity.ts:121,
 * and the plugin's 3 to 32 limits (src/server/adapters/cloudflare/identity.ts:119-120). A legacy account keeps its old
 * username as login key. Nothing derives a login key from a handle, so a handle change never
 * touches Better Auth.
 */
export function loginKeyFor(accountId: AccountId): LoginKey {
  return accountId.replaceAll('-', '') as LoginKey;
}

const windowEndSql = (s: string) =>
  `strftime('%Y-%m-%dT%H:%M:%fZ', ${s}.ends_at, '+' || ${s}.grace_minutes || ' minutes')`;

/**
 * `forContests` for one account and one target contest: the live contests of the account's
 * entries whose window overlaps the target's window. A window runs from the scheduled start to
 * the scheduled end plus grace. Every live contest has a schedule (0021 CHECK on kind). This is
 * the only definition. An issue on day 1 for Live 1 never opens Live 3 on day 3, so each live
 * contest that does not overlap gets its own fresh password. The plan reads the target by
 * primary key, the event's contests that start before the target window ends
 * (sessions_event_schedule), and one membership each by primary key. Bind with
 * forContestsBindings.
 */
export const forContestsSql = `SELECT s.id FROM sessions t
  JOIN memberships m ON m.account_id = ? AND m.team_id IS NOT NULL
  JOIN sessions s ON s.id = m.session_id
  WHERE t.id = ? AND t.kind = 'live' AND s.kind = 'live' AND s.event_id = t.event_id
    AND s.starts_at < ${windowEndSql('t')} AND t.starts_at < ${windowEndSql('s')}
  ORDER BY s.id`;

export function forContestsBindings(accountId: AccountId, contestId: ContestId): D1Value[] {
  return [accountId, contestId];
}

export interface CredentialTarget { readonly id: AccountId; readonly name: string; readonly loginKey: LoginKey }

/**
 * One atomic replacement: Better Auth user and hash, revoked logins and sessions,
 * credential_generation + 1, must_change = 1, state ready, an account_operations row, and the
 * new credential_scopes. One batch after hashing, not two: an interrupted issue changes nothing,
 * and a live contest's readiness never shows the gap between "old revoked" and "new issued".
 * Insert order matters: the account_operations row first (its trigger ends the old scopes and
 * the 0017 takeover trigger checks the actor), then the scopes (their trigger recounts
 * unready_seats).
 */
export function replaceCredentialStatements(db: D1Connection, target: CredentialTarget, hash: string, options: {
  readonly operationId: string;
  readonly actor: AccountId;
  readonly temporary: boolean;
  readonly forContests: readonly ContestId[];
}): D1Statement[] {
  // TODO: INSERT ba_user (id, username = login key, email `${loginKey}@accounts.minsky.invalid`)
  //   ON CONFLICT(id) DO UPDATE, as completeCredentialReset does (src/server/adapters/cloudflare/credentialReset.ts:57-60). The
  //   login key never changes, so the upsert rewrites a value with itself.
  throw new Error('not implemented');
}

export class D1CredentialService {
  /**
   * Validates <= ISSUE_BATCH accounts of input.eventId, resolves the actor once on that event
   * (or the site for site accounts), checks manageAccountSql per account and the open-contest
   * conflict (below) in the read and again in the batch, derives forContests per account,
   * hashes outside the batch, commits one batch, and returns the passwords. Idempotent by
   * request ID: a replay returns the account IDs without passwords, and the sheet offers
   * "Issue again". Queues a staff notification for each contest in a scope, so readiness
   * panels refresh.
   */
  issue(caller: Caller, requestId: RequestId, input: CredentialIssue): Promise<readonly IssuedCredential[]> {
    // TODO conflict: refuse when any account has a contestant seat in a contest outside its
    //   forContests whose intake is open now (intakeOpenSql), because the reset would sign it
    //   out there and, for a live contest, close that contest's intake.
    throw new Error('not implemented');
  }
}

// =================================================================================================
// src/server/adapters/cloudflare/schedule.ts  (new; SQL fragments that D1 evaluates with its own
// clock, in reads and again inside batches)
// =================================================================================================

/**
 * SQL number: the confirmed extra minutes of `entry` in contest alias `s`. Counts only awards
 * whose external application staff confirmed (`applied_at IS NOT NULL`). Index path:
 * issues_session_team (0013), awards.issue_id unique (0005), contest_awards_session (0020).
 */
export function extraMinutesSql(s: string, entry: string): string {
  return `(COALESCE((SELECT sum(w.minutes) FROM issues i JOIN awards w ON w.issue_id = i.id
      WHERE i.session_id = ${s}.id AND i.team_id = ${entry} AND w.applied_at IS NOT NULL), 0)
    + COALESCE((SELECT sum(c.minutes) FROM contest_awards c
      WHERE c.session_id = ${s}.id AND c.applied_at IS NOT NULL), 0))`;
}

/** SQL text instant: the scheduled end plus the entry's confirmed extra minutes. NULL when unscheduled. */
export function personalEndSql(s: string, entry: string): string {
  return `strftime('%Y-%m-%dT%H:%M:%fZ', ${s}.ends_at, '+' || ${extraMinutesSql(s, entry)} || ' minutes')`;
}

/**
 * SQL boolean: is intake open now for contest alias `s`. With `entry`, the contestant's own
 * window: an entry with confirmed extra minutes keeps intake until its personal end plus grace.
 * The live gate comes first, so no override can open a live contest that is not ready.
 * Final shape: the schedule terms enter in Phase 5, the live gate in Phase 6.
 */
export function intakeOpenSql(s: string, entry?: string): string {
  const end = entry === undefined ? `${s}.ends_at` : personalEndSql(s, entry);
  return `((${s}.kind = 'practice' OR ${s}.unready_seats = 0) AND CASE WHEN ${s}.intake_follows_schedule = 1
    THEN ${nowSql} >= ${s}.starts_at
      AND ${nowSql} < strftime('%Y-%m-%dT%H:%M:%fZ', ${end}, '+' || ${s}.grace_minutes || ' minutes')
    ELSE ${s}.intake_open = 1 END)`;
}

/** SQL json_object for IntakeState: open, reason, changesAt. Same terms as intakeOpenSql. */
export function intakeStateSql(s: string, entry?: string): string {
  // TODO: reason in the order awaiting_live_passwords, override_open, override_closed,
  //   before_start, running, grace, ended; changesAt is the next of starts_at, the end, and the
  //   end plus grace that lies after now, or NULL while an override holds.
  throw new Error('not implemented');
}

// =================================================================================================
// src/connected/zonedTime.ts  (new, browser; the server stores instants only)
// =================================================================================================

/** Converts an event-local wall time to an instant. In a DST gap, moves forward; in an overlap,
 *  takes the earlier instant. Pure, uses Intl only. */
export function zonedWallTime(date: string, time: string, timeZone: string): Instant {
  throw new Error('not implemented');
}
export function formatInZone(instant: Instant, timeZone: string, style: 'time' | 'date' | 'datetime'): string {
  throw new Error('not implemented');
}

// =================================================================================================
// src/server/adapters/cloudflare/eventDeletion.ts  (new; replaces fixture-only cleanup in
// src/server/adapters/cloudflare/live.ts:245-285, src/server/adapters/cloudflare/live.ts:365-387 and the order in tests/providers/cloudflare/fixture.ts:342-407)
// =================================================================================================

/** Issues per statement and accounts per batch in the rows step. */
export const DELETE_CHUNK = 100;

/**
 * Statements for the delete_event plan. One batch, after the site authority guard. From this
 * batch on, the resolvers and sign-in refuse the event (`NOT EXISTS event_deletions`), and the
 * 0023 guards let the rows step delete its rows.
 */
export function fenceStatements(db: D1Connection, actor: { id: AccountId; name: string },
  eventId: EventId, confirmName: string, assertionId: string): D1Statement[] {
  const statement = (sql: string, ...values: D1Value[]) => db.prepare(sql).bind(...values);
  return [
    statement(`INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN
      EXISTS (SELECT 1 FROM events WHERE id = ? AND name = ?)
      AND NOT EXISTS (SELECT 1 FROM event_deletions WHERE event_id = ?) THEN 1 ELSE 0 END)`,
    assertionId, eventId, confirmName, eventId),
    statement(`INSERT INTO event_deletions (event_id, event_name, event_code, requested_by, requested_by_name)
      SELECT id, name, code, ?, ? FROM events WHERE id = ?`, actor.id, actor.name, eventId),
    statement(`INSERT INTO event_deletion_targets (event_id, kind, id)
      SELECT event_id, 'contest', id FROM sessions WHERE event_id = ?`, eventId),
    // Never a NULL-event account: webmasters and orphans are outside every event.
    statement(`INSERT INTO event_deletion_targets (event_id, kind, id)
      SELECT event_id, 'account', id FROM accounts WHERE event_id = ?`, eventId),
    statement(`INSERT INTO event_deletion_targets (event_id, kind, id)
      SELECT DISTINCT a.event_id, 'avatar_owner', v.account_id FROM account_avatars v
      JOIN accounts a ON a.id = v.account_id WHERE a.event_id = ?`, eventId),
    statement('UPDATE events SET archived = 1 WHERE id = ?', eventId),
    // The legacy anchor (src/server/adapters/d1/migrations/0008_installation.sql:5-7) would block the event's delete.
    statement('DELETE FROM installation WHERE event_id = ?', eventId),
    statement(`INSERT INTO authority_audit (id, event_id, actor, actor_name, action, target, detail)
      SELECT ?, NULL, ?, ?, 'delete_event', id, json_object('name', name, 'code', code) FROM events WHERE id = ?`,
    crypto.randomUUID(), actor.id, actor.name, eventId),
    // TODO: outbox rows for each contest's audiences, so open sockets refresh and close.
    statement('DELETE FROM command_assertions WHERE id = ?', assertionId),
  ];
}

export type RowsProgress = 'more' | 'blocked' | 'rows_done';

/**
 * One bounded, idempotent unit of the rows step. advanceDeletions calls it until it returns
 * 'rows_done' or the budget ends. A crash before a batch commits repeats that batch.
 *   contests: at most DELETE_CHUNK issues per statement (cascade), then the contest row (cascade
 *             teams, seats, audit, outbox, announcements, image rows); mark the target done.
 *   accounts: at most DELETE_CHUNK per batch: avatar rows, ba_user (no FK), the accounts
 *             (cascade logins, grants, scopes, receipts, their own operations), limiter keys.
 *             A foreign-key failure means an account acted outside its event (legacy only):
 *             record `blocked` and stop. Nothing outside the targets is deleted.
 *   event:    the events row (cascade entrants, event grants, event audit), the event's handle
 *             limiter keys, then step 'live'.
 */
export async function advanceRows(db: D1Connection, eventId: EventId, limit = DELETE_CHUNK): Promise<RowsProgress> {
  const contest = await db.prepare(`SELECT id FROM event_deletion_targets
    WHERE event_id = ? AND kind = 'contest' AND done = 0 ORDER BY id LIMIT 1`).bind(eventId).first<{ id: string }>();
  if (contest) {
    const left = await db.prepare('SELECT count(*) AS n FROM issues WHERE session_id = ?').bind(contest.id).first<{ n: number }>();
    if (left && left.n > 0) {
      await db.prepare('DELETE FROM issues WHERE id IN (SELECT id FROM issues WHERE session_id = ? LIMIT ?)')
        .bind(contest.id, limit).run();
      return 'more';
    }
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE id = ?').bind(contest.id),
      db.prepare(`UPDATE event_deletion_targets SET done = 1 WHERE event_id = ? AND kind = 'contest' AND id = ?`)
        .bind(eventId, contest.id),
    ]);
    return 'more';
  }
  const accounts = await db.prepare(`SELECT id FROM event_deletion_targets
    WHERE event_id = ? AND kind = 'account' AND done = 0 ORDER BY id LIMIT ?`).bind(eventId, limit).all<{ id: string }>();
  if (accounts.results.length > 0) {
    const ids = JSON.stringify(accounts.results.map((row) => row.id));
    const inIds = 'IN (SELECT value FROM json_each(?))';
    try {
      await db.batch([
        db.prepare(`DELETE FROM account_avatars WHERE account_id ${inIds}`).bind(ids),
        db.prepare(`DELETE FROM ba_user WHERE id ${inIds}`).bind(ids),
        db.prepare(`DELETE FROM accounts WHERE id ${inIds}`).bind(ids),
        db.prepare(`DELETE FROM authentication_limits WHERE key IN (SELECT 'change:' || value FROM json_each(?))`).bind(ids),
        db.prepare(`UPDATE event_deletion_targets SET done = 1 WHERE event_id = ? AND kind = 'account' AND id ${inIds}`)
          .bind(eventId, ids),
      ]);
    } catch (error) {
      await db.prepare('UPDATE event_deletions SET blocked = ?, attempts = attempts + 1 WHERE event_id = ?')
        .bind(String(error instanceof Error ? error.message : error), eventId).run();
      return 'blocked';
    }
    return 'more';
  }
  await db.batch([
    db.prepare('DELETE FROM events WHERE id = ?').bind(eventId),
    db.prepare('DELETE FROM authentication_limits WHERE key >= ? AND key < ?').bind(`handle:${eventId}:`, `handle:${eventId};`),
    db.prepare(`UPDATE event_deletions SET step = 'live', rows_done_at = ${nowSql}, blocked = NULL
      WHERE event_id = ? AND step = 'rows'`).bind(eventId),
  ]);
  return 'rows_done';
}

/** The last step: the targets go, and the journal row stays as the site record. */
export function finishStatements(db: D1Connection, eventId: EventId): D1Statement[] {
  return [
    db.prepare('DELETE FROM event_deletion_targets WHERE event_id = ?').bind(eventId),
    db.prepare(`UPDATE event_deletions SET step = 'done', finished_at = ${nowSql} WHERE event_id = ? AND step = 'files'`)
      .bind(eventId),
  ];
}

export interface DeletionEnvironment {
  DB: D1Connection;
  IMAGES: { list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
    delete(keys: string[]): Promise<void> };
  LIVE_UPDATES: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
}

/**
 * Advances every unfinished deletion within a budget. Runs from the minute cron and from
 * waitUntil after delete_event. Claims one deletion with a lease (UPDATE ... RETURNING, like
 * claimSql at src/server/adapters/cloudflare/live.ts:316-319), so two runners do not both work; if both do, every step is
 * still idempotent. Idle cost: one partial-index probe (event_deletions_open).
 *   rows   advanceRows until 'rows_done'.
 *   live   per contest target: POST /erase to its Durable Object (below).
 *   files  per contest target: R2 list `<contestId>/` and delete; per avatar owner:
 *          `accounts/<accountId>/`. A target is done when its prefix lists empty at least
 *          65 minutes after rows_done_at (issue image reservations live 3,600 s, src/server/adapters/d1/migrations/0006_application.sql:34),
 *          which also covers an upload whose Worker died between put and self-delete.
 *   done   finishStatements.
 */
export async function advanceDeletions(env: DeletionEnvironment, budget: { statements: number; r2Calls: number }): Promise<void> {
  throw new Error('not implemented');
}

// =================================================================================================
// src/server/adapters/cloudflare/live.ts  (changes)
// =================================================================================================

/**
 * Replaces cleanup() and the fixture name check (src/server/adapters/cloudflare/live.ts:245-285). Idempotent: closes sockets,
 * deletes the alarm and all storage. Refuses unless D1 shows an event_deletion_targets row of
 * kind 'contest' for this ID and no sessions row, so no request can wipe a live contest.
 * access() (src/server/adapters/cloudflare/live.ts:103-120) reads contestDataSql('logins') and admits staff or contestant seats.
 */
export type EraseResponse = { readonly empty: true };

// =================================================================================================
// src/server/adapters/cloudflare/authentication.ts  (changes)
// =================================================================================================

/**
 * Resolves the typed (event, handle) to an account and its login key. Two statements, never
 * one with OR, so each uses its own unique index:
 *   event: events_code, then accounts_event_handle. The row comes back with the event ID even
 *          when the handle is unknown, so the failure still counts against the event's key.
 *   site:  accounts_site_handle, then grants_site. An orphan with no event and no site grant
 *          cannot sign in.
 * Bind with signInBindings.
 */
export function signInAccountSql(kind: SignInTarget['kind']): string {
  return kind === 'event'
    ? `SELECT e.id AS event_id, a.id AS account_id, a.username AS login_key, a.disabled, a.credential_state
      FROM events e LEFT JOIN accounts a ON a.event_id = e.id AND a.handle = ?
      WHERE e.code = ? AND ${notDeletingSql('e.id')}`
    : `SELECT NULL AS event_id, a.id AS account_id, a.username AS login_key, a.disabled, a.credential_state
      FROM accounts a JOIN grants g ON g.account_id = a.id AND g.scope = 'site'
      WHERE a.event_id IS NULL AND a.handle = ?`;
}

export function signInBindings(target: SignInTarget, handle: Handle): D1Value[] {
  return target.kind === 'event' ? [handle, target.code] : [handle];
}

/** The failure counter. Two events' `team01` no longer share one (src/server/adapters/cloudflare/authentication.ts:119). */
export function signInLimitKey(eventId: EventId | 'site', handle: Handle): string {
  return `handle:${eventId}:${handle}`;
}

/**
 * signIn(target, handle, password):
 *   1. parse the handle (the usernameSchema of src/server/adapters/cloudflare/authentication.ts:16, branded Handle);
 *   2. read signInAccountSql; an unknown event code gives 401 at once (the IP limit applies);
 *   3. assertBelowLimit(signInLimitKey(eventId or 'site', handle));
 *   4. an unknown handle gives 401 and counts a failure. It never reaches Better Auth, which
 *      looks up the typed text as a login key, and a legacy login key in another event could
 *      match it;
 *   5. createLogin(loginKey, password), unchanged (src/server/adapters/cloudflare/authentication.ts:129-153): Better Auth and
 *      the guarded batch see the login key only.
 * changePassword passes the stored login key to createLogin, as it does today (src/server/adapters/cloudflare/authentication.ts:347).
 */
export interface D1AuthenticationServiceChanges {
  signIn(target: SignInTarget, handle: string, password: string): Promise<{ cookie: string }>;
}

// =================================================================================================
// src/server/adapters/cloudflare/installation.ts  (rewritten)
// =================================================================================================

/**
 * Trusted, empty database only. Creates exactly one webmaster and nothing else (from Phase 4).
 * Until Phase 4, bootstrap keeps its shape (src/server/adapters/cloudflare/installation.ts:86-138). From Phase 2 it also
 * inserts the site grant for its one account before that account's admin membership, so the
 * account stays a site account. Neither form ever creates a second webmaster.
 */
export function bootstrapSite(db: D1Connection, input: { webmasterHandle: string; webmasterName: string }):
  Promise<{ accountId: AccountId; handle: string; temporaryPassword: string }> {
  throw new Error('not implemented');
}

/** Trusted. Resets one webmaster found by site handle. Replaces recoverInstallationOwner and
 *  recoverCloudflareAdmin (adminRecovery.ts), which needed an anchor contest membership. */
export function recoverWebmaster(db: D1Connection, input: { handle: string }):
  Promise<{ accountId: AccountId; temporaryPassword: string }> {
  throw new Error('not implemented');
}
```

## Migration sketch

This SQL file is a sketch of D1 migrations `0017` to `0023`, with a marker line before each file, and no migration in the repository holds it yet.

```sql
-- D1 migration sketch for the webmaster, event, and contest platform. Not implemented.
-- Numbered from 0017. Each file is one delivery phase (see "Delivery phases" in the design page).
-- Each file starts with a marker line `-- ==== <file> (Phase N) additive: yes ====`, so the
-- local checks can split this sketch into the real files.
--
-- Guard status, checked locally with destructiveStatements
-- (src/server/adapters/cloudflare/tooling/migrations.mjs:19-36):
--   No file contains DROP TABLE, DROP COLUMN, or RENAME.
--   Each DROP TRIGGER is followed by a CREATE TRIGGER of the same name in the same file.
--   No file drops an index. accounts_username keeps the global shape that 0003 gave it.
--   reviewedDestructiveMigrations stays empty.
--
-- Rollback rule used throughout: a trigger that the previous Worker's writes can reach either
-- accepts that write or repairs it after the fact (AFTER trigger). The writes that it refuses
-- are listed per file under "Previous Worker". None of them is a sign-in or a workflow command.
--
-- No file inserts a row on an empty database, so bootstrap's emptiness check
-- (src/server/adapters/cloudflare/installation.ts:56-65) still passes after every file.
--
-- Two names for one account:
--   accounts.username is the login key. It stays globally unique (src/server/adapters/d1/migrations/0003_authentication.sql:5).
--     Better Auth stores the same value in ba_user.username and signs in by it alone.
--     A new account gets its UUID without dashes. A legacy account keeps its old value.
--   accounts.handle is the name a person types. It is unique inside one event (0018).


-- ==== 0017_scoped_authority.sql (Phase 1) additive: yes ====
-- Site, event, and contest grants. Account ownership by event. D1 rules that no Worker version
-- can bypass: isolation, the last webmaster, takeover protection, and the audited join.
-- Promotion of the development accounts organizer and playtest-admin to webmasters.
-- Previous Worker: refuses a membership that crosses events (the hole at src/server/adapters/cloudflare/application.ts:428-431).
-- Refuses a reset or rename of a webmaster by anyone but a webmaster (account_operation_takeover).
-- Its account creation keeps working through membership_adopts_event.

-- One structure for the two scopes above the contest and for a webmaster's audited join.
-- Contest staff stay in memberships and membership_roles. authority.ts merges both.
-- scope = 'site'    : the holder is a webmaster. Both targets are NULL.
-- scope = 'event'   : the holder is an event admin of event_id.
-- scope = 'contest' : a webmaster's audited join of session_id. Read only while the site
--                     setting restricts webmaster reads.
CREATE TABLE grants (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('site', 'event', 'contest')),
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  granted_by TEXT NOT NULL,            -- account ID or 'migration:0017'. No FK: grants outlive actors.
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((scope = 'site' AND event_id IS NULL AND session_id IS NULL)
    OR (scope = 'event' AND event_id IS NOT NULL AND session_id IS NULL)
    OR (scope = 'contest' AND event_id IS NULL AND session_id IS NOT NULL))
) STRICT;
-- The resolver repeats each WHERE term word for word, so SQLite uses these partial indexes.
CREATE UNIQUE INDEX grants_site ON grants(account_id) WHERE scope = 'site';
CREATE UNIQUE INDEX grants_event ON grants(event_id, account_id) WHERE scope = 'event';
CREATE UNIQUE INDEX grants_contest ON grants(session_id, account_id) WHERE scope = 'contest';
CREATE INDEX grants_by_account ON grants(account_id, scope);

-- Absent row means the default: webmasters read every contest. No row is seeded, because a
-- seeded row would fail bootstrap's emptiness check.
CREATE TABLE site_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  restrict_webmaster_reads INTEGER NOT NULL CHECK (restrict_webmaster_reads IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
-- The resolver stamps COALESCE(version, 0). The first insert moves 0 to 1, and each change
-- moves it again, so every guard captured before the change fails.
CREATE TRIGGER site_settings_changes AFTER UPDATE OF restrict_webmaster_reads ON site_settings
BEGIN
  UPDATE site_settings SET version = version + 1 WHERE singleton = 1;
END;

-- Site and event audit. Contest actions stay in admin_audit.
-- event_id NULL is a site record. It survives event deletion, so it can prove the deletion.
-- actor and target have no FK: a site record outlives the accounts that it names.
CREATE TABLE authority_audit (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail))
) STRICT;
CREATE INDEX authority_audit_scope_at ON authority_audit(event_id, at DESC);

-- Receipts for management commands, keyed like command_receipts and announcement_receipts.
-- A result never holds a password.
CREATE TABLE manage_receipts (
  actor TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  command TEXT NOT NULL CHECK (json_valid(command)),
  result TEXT NOT NULL CHECK (json_valid(result)),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (actor, request_id)
) STRICT;

-- The event that owns the account. NULL means a site account (a webmaster), or a legacy
-- account that no membership placed. A REFERENCES column added by ALTER must default to NULL.
-- No ON DELETE action: event deletion removes the event's accounts before the event row.
-- The repository's 0017 adds DEFERRABLE INITIALLY DEFERRED, because test cleanups delete
-- an event before its accounts in one batch.
ALTER TABLE accounts ADD COLUMN event_id TEXT REFERENCES events(id);
CREATE INDEX accounts_event ON accounts(event_id);
CREATE INDEX sessions_event ON sessions(event_id);

-- Every grant change moves the holder's access_version, like membership_added at src/server/adapters/d1/migrations/0001_transaction_proof.sql:117-120.
CREATE TRIGGER grant_added AFTER INSERT ON grants
BEGIN
  UPDATE accounts SET access_version = access_version + 1 WHERE id = NEW.account_id;
END;
CREATE TRIGGER grant_removed AFTER DELETE ON grants
BEGIN
  UPDATE accounts SET access_version = access_version + 1 WHERE id = OLD.account_id;
END;
CREATE TRIGGER grant_immutable BEFORE UPDATE ON grants
BEGIN
  SELECT RAISE(ABORT, 'Grants are added or removed, not edited');
END;

-- Grant shape rules that a CHECK cannot express.
CREATE TRIGGER grant_holder_scope BEFORE INSERT ON grants
WHEN (NEW.scope = 'site' AND EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND event_id IS NOT NULL))
  OR (NEW.scope = 'event' AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND event_id = NEW.event_id))
  OR (NEW.scope = 'contest' AND NOT EXISTS (SELECT 1 FROM grants WHERE account_id = NEW.account_id AND scope = 'site'))
BEGIN
  SELECT RAISE(ABORT, 'A webmaster holds no event, an event admin belongs to the event, and only webmasters join');
END;

-- The audited join exists only while the site restricts webmaster reads. A join in open mode
-- would grant nothing and record nothing useful.
CREATE TRIGGER grant_join_needs_restriction BEFORE INSERT ON grants
WHEN NEW.scope = 'contest'
  AND NOT EXISTS (SELECT 1 FROM site_settings WHERE singleton = 1 AND restrict_webmaster_reads = 1)
BEGIN
  SELECT RAISE(ABORT, 'Webmasters join a contest only while the site restricts their reads');
END;

-- The database writes the join audit, so no writer of a contest-scope grant can skip it.
-- The contest's admins read the admin_audit row in their
-- snapshot. The site row has no event, so it survives the deletion of the event.
CREATE TRIGGER grant_join_audited AFTER INSERT ON grants WHEN NEW.scope = 'contest'
BEGIN
  INSERT INTO admin_audit (id, session_id, actor, action, target)
    VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a'
      || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
      NEW.session_id, NEW.account_id, 'webmaster_join', NEW.account_id);
  INSERT INTO authority_audit (id, event_id, actor, actor_name, action, target, detail)
    SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a'
      || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
      NULL, a.id, a.name, 'webmaster_join', NEW.session_id,
      json_object('event_id', (SELECT event_id FROM sessions WHERE id = NEW.session_id))
    FROM accounts a WHERE a.id = NEW.account_id;
END;

-- The last enabled webmaster cannot lose the grant or the account.
CREATE TRIGGER grant_last_webmaster BEFORE DELETE ON grants
WHEN OLD.scope = 'site' AND NOT EXISTS (SELECT 1 FROM grants g JOIN accounts a ON a.id = g.account_id
  WHERE g.scope = 'site' AND g.account_id <> OLD.account_id AND a.disabled = 0)
BEGIN
  SELECT RAISE(ABORT, 'The last webmaster cannot be removed');
END;
CREATE TRIGGER account_last_webmaster BEFORE UPDATE OF disabled ON accounts
WHEN NEW.disabled = 1 AND OLD.disabled = 0
  AND EXISTS (SELECT 1 FROM grants WHERE account_id = NEW.id AND scope = 'site')
  AND NOT EXISTS (SELECT 1 FROM grants g JOIN accounts a ON a.id = g.account_id
    WHERE g.scope = 'site' AND g.account_id <> NEW.id AND a.disabled = 0)
BEGIN
  SELECT RAISE(ABORT, 'The last webmaster cannot be disabled');
END;
-- Removing a webmaster ends the joins that only a webmaster may hold.
CREATE TRIGGER grant_site_removed AFTER DELETE ON grants WHEN OLD.scope = 'site'
BEGIN
  DELETE FROM grants WHERE account_id = OLD.account_id AND scope = 'contest';
END;

-- Isolation by construction. A membership never crosses events. NULL event accounts pass here:
-- webmasters, and legacy or previous-Worker accounts, which the next trigger then places.
CREATE TRIGGER membership_event_scope BEFORE INSERT ON memberships
WHEN NOT EXISTS (SELECT 1 FROM accounts a JOIN sessions s ON s.id = NEW.session_id
  WHERE a.id = NEW.account_id AND (a.event_id = s.event_id OR a.event_id IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'An account joins only contests of its own event');
END;
-- Repair for the previous Worker, which inserts the account before its first membership
-- (src/server/adapters/cloudflare/authentication.ts:253-256). The account takes the event of that first contest.
CREATE TRIGGER membership_adopts_event AFTER INSERT ON memberships
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND event_id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM grants WHERE account_id = NEW.account_id AND scope = 'site')
BEGIN
  UPDATE accounts SET event_id = (SELECT event_id FROM sessions WHERE id = NEW.session_id)
  WHERE id = NEW.account_id;
END;
-- An account never moves between events. NULL to an event is allowed (placement above).
CREATE TRIGGER account_event_fixed BEFORE UPDATE OF event_id ON accounts
WHEN OLD.event_id IS NOT NULL AND NEW.event_id IS NOT OLD.event_id
BEGIN
  SELECT RAISE(ABORT, 'An account belongs to one event');
END;

-- Takeover protection in D1, read from grants.
-- A lower authority cannot reset or rename a higher one, even under a rolled-back Worker whose
-- adminCondition (src/server/adapters/cloudflare/authentication.ts:189-203) would let a contest admin reset a webmaster on a
-- one-contest site. Every admin issue and rename inserts this row in the same batch as its
-- writes (src/server/adapters/cloudflare/authentication.ts:236-268), so a refusal rolls the whole batch back. An actor may
-- always act on the own account, which keeps change_password and trusted recovery working
-- (src/server/adapters/cloudflare/installation.ts:170-171, src/server/adapters/cloudflare/adminRecovery.ts:131).
CREATE TRIGGER account_operation_takeover BEFORE INSERT ON account_operations
WHEN NEW.action IN ('create_account', 'reset_password', 'set_username') AND NEW.actor <> NEW.account_id
  AND NOT EXISTS (SELECT 1 FROM grants WHERE account_id = NEW.actor AND scope = 'site')
  AND (EXISTS (SELECT 1 FROM grants WHERE account_id = NEW.account_id AND scope = 'site')
    OR EXISTS (SELECT 1 FROM grants t WHERE t.account_id = NEW.account_id AND t.scope = 'event'
      AND NOT EXISTS (SELECT 1 FROM grants a WHERE a.account_id = NEW.actor AND a.scope = 'event'
        AND a.event_id = t.event_id)))
BEGIN
  SELECT RAISE(ABORT, 'Only a webmaster, or an event admin of the same event, may change this account');
END;

-- Promotion (owner decisions 2026-10-27). The accounts with the usernames organizer and
-- playtest-admin become webmasters, by name. A database without them promotes nobody.
-- Usernames are globally unique (src/server/adapters/d1/migrations/0003_authentication.sql:5), so each name matches at most one account.
-- Reach, per database that applies this file:
--   minsky-development: organizer and playtest-admin.
--   minsky-preview: an account with either username, if its test data holds one.
--   CI fixture databases: fixture usernames start with pc- (tests/providers/cloudflare/fixture.ts:127) -> nobody.
--   An empty database (local tests, a future minsky-prod database): no account -> nobody.
--   A self-hosted database: an account with either username. The example installation file names
--   its admin organizer (src/server/adapters/cloudflare/tooling/competition.example.json:2).
-- The grant goes in BEFORE the event backfill, so promoted accounts stay site accounts.
-- A name alone is not enough: the account must be a contest admin and hold no team seat,
-- so a self-hosted team or volunteer that happens to use one of these names stays as it is.
INSERT INTO grants (account_id, scope, granted_by)
SELECT a.id, 'site', 'migration:0017' FROM accounts a
WHERE a.username IN ('organizer', 'playtest-admin')
  AND EXISTS (SELECT 1 FROM memberships m WHERE m.account_id = a.id AND m.is_admin = 1)
  AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.account_id = a.id AND m.team_id IS NOT NULL);

INSERT INTO authority_audit (id, event_id, actor, actor_name, action, target, detail)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a'
    || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
  NULL, g.account_id, a.name, 'promote_webmaster', g.account_id, '{"source":"migration:0017"}'
FROM grants g JOIN accounts a ON a.id = g.account_id WHERE g.granted_by = 'migration:0017';

-- Place every other account in the event of most of its memberships (ties: oldest contest).
UPDATE accounts SET event_id = (
  SELECT s.event_id FROM memberships m JOIN sessions s ON s.id = m.session_id
  WHERE m.account_id = accounts.id GROUP BY s.event_id ORDER BY count(*) DESC, min(s.rowid) LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM grants g WHERE g.account_id = accounts.id AND g.scope = 'site');
-- An account with no membership joins the bootstrap event when there is one.
UPDATE accounts SET event_id = (SELECT event_id FROM installation WHERE singleton = 1)
WHERE event_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.account_id = accounts.id AND g.scope = 'site');
-- Remaining NULL accounts without a grant (CI databases only) get no handle in 0018 and
-- cannot sign in by event or as a site account.


-- ==== 0018_event_sign_in.sql (Phase 3) additive: yes ====
-- Event codes, the event time zone, and handles unique inside their event.
-- accounts_username is not touched. The previous Worker signs in by
-- `SELECT * FROM accounts WHERE username = ?` (src/server/adapters/cloudflare/authentication.ts:130). That lookup keeps the
-- global unique index, so after a rollback it still reads one row through an index.
-- Previous Worker: legacy accounts sign in as before, because their login key equals their
-- handle. Accounts that the new Worker creates have a login key that nobody types, so they
-- cannot sign in to it. Its account creation fails with a constraint error only when the new
-- account's username is already a handle in the same event (accounts_handle_default below).

-- The code that a sign-in names, for example 'xxxx-olympiad-2026'. Unique across the site.
ALTER TABLE events ADD COLUMN code TEXT
  CHECK (code IS NULL OR (length(code) BETWEEN 3 AND 40
    AND code NOT GLOB '*[^a-z0-9-]*' AND substr(code, 1, 1) GLOB '[a-z0-9]'));
-- Opaque, random, and collision-free in practice (64 bits). A webmaster renames it with
-- update_event. Event IDs are not used, because fixture IDs need not fit the CHECK.
UPDATE events SET code = 'e' || lower(hex(randomblob(8))) WHERE code IS NULL;
CREATE UNIQUE INDEX events_code ON events(code);
-- Fixtures and the previous Worker's bootstrap insert events without a code (src/server/adapters/d1/testFixture.ts:93).
CREATE TRIGGER event_default_code AFTER INSERT ON events WHEN NEW.code IS NULL
BEGIN
  UPDATE events SET code = 'e' || lower(hex(randomblob(8))) WHERE id = NEW.id;
END;
-- IANA name. The Worker validates it with Intl before every write.
ALTER TABLE events ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC'
  CHECK (length(time_zone) BETWEEN 1 AND 64);

-- The handle: what a person types. Same shape as the login key (src/server/adapters/d1/migrations/0003_authentication.sql:2-4).
ALTER TABLE accounts ADD COLUMN handle TEXT CHECK (handle IS NULL OR (length(handle) BETWEEN 3 AND 32
  AND handle NOT GLOB '*[^a-z0-9_-]*' AND substr(handle, 1, 1) GLOB '[a-z0-9]'));
-- Legacy accounts keep their visible name: the handle equals the login key. Orphan accounts
-- (no event, no site grant) get no handle, so they hold no name in the site namespace.
UPDATE accounts SET handle = username
WHERE handle IS NULL AND username IS NOT NULL
  AND (event_id IS NOT NULL OR EXISTS (SELECT 1 FROM grants g WHERE g.account_id = accounts.id AND g.scope = 'site'));
-- One namespace per event, and one for site accounts. Usernames were globally unique, so these
-- indexes cannot fail on existing data.
CREATE UNIQUE INDEX accounts_event_handle ON accounts(event_id, handle) WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX accounts_site_handle ON accounts(handle) WHERE event_id IS NULL AND handle IS NOT NULL;

-- Convergence for the previous Worker. It inserts an account with a username and no event, then
-- a membership (src/server/adapters/cloudflare/authentication.ts:253-256). The handle follows once the account has an event,
-- whichever trigger places it. Its set_username only fills a NULL username
-- (src/server/adapters/cloudflare/authentication.ts:238), and the handle follows that too. A clash with a handle already used
-- in the event fails the whole batch, which the previous Worker reports as an error.
CREATE TRIGGER accounts_handle_default AFTER UPDATE OF event_id, username ON accounts
WHEN NEW.handle IS NULL AND NEW.username IS NOT NULL AND NEW.event_id IS NOT NULL
BEGIN
  UPDATE accounts SET handle = NEW.username WHERE id = NEW.id;
END;

-- Code and time zone take part in the event version that guards capture.
DROP TRIGGER event_changes;
CREATE TRIGGER event_changes AFTER UPDATE OF archived, code, time_zone ON events
BEGIN
  UPDATE events SET version = version + 1 WHERE id = NEW.id;
END;


-- ==== 0019_event_roster.sql (Phase 4) additive: yes ====
-- Event-owned entrants (teams and single contestants). A teams row becomes the entry of one
-- entrant in one contest. Contest type.
-- Previous Worker: add_teams creates an entrant through entry_default_entrant; update_team
-- renames the entrant in every contest; a contestant membership links the account to the
-- entrant. It is refused only when it gives an entrant's sign-in a staff membership.

CREATE TABLE entrants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('team', 'single')),
  -- May be empty: fixtures insert unnamed teams (src/server/adapters/d1/testFixture.ts:96-98). The Worker refuses empty
  -- and duplicate names inside an event with a read and an in-batch guard, like noClash
  -- (src/server/adapters/cloudflare/application.ts:325-326). A unique index would make the backfill below fail on old data.
  name TEXT NOT NULL CHECK (length(name) <= 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX entrants_event ON entrants(event_id, name);

-- The entry's entrant. Always set after 0019 (backfill plus entry_default_entrant).
ALTER TABLE teams ADD COLUMN entrant_id TEXT REFERENCES entrants(id);
CREATE UNIQUE INDEX teams_entrant ON teams(session_id, entrant_id);
CREATE INDEX teams_by_entrant ON teams(entrant_id);
-- The entrant whose sign-in this account is. NULL for staff and webmasters.
-- The Worker creates exactly one account per entrant; old data may hold several.
ALTER TABLE accounts ADD COLUMN entrant_id TEXT REFERENCES entrants(id);
CREATE INDEX accounts_entrant ON accounts(entrant_id) WHERE entrant_id IS NOT NULL;

-- singles: only single contestants. teams: only teams. mixed: both. Existing contests are teams.
ALTER TABLE sessions ADD COLUMN contest_type TEXT NOT NULL DEFAULT 'teams'
  CHECK (contest_type IN ('singles', 'mixed', 'teams'));

-- Backfill. One entrant per event and normalized team name, so a team that already appears in
-- two contests of one event becomes one entrant. Unnamed teams each get their own entrant.
-- The representative teams row lends its ID to the entrant.
INSERT INTO entrants (id, event_id, kind, name)
SELECT t.id, s.event_id, 'team', t.name FROM teams t JOIN sessions s ON s.id = t.session_id
WHERE trim(t.name) = '' OR NOT EXISTS (
  SELECT 1 FROM teams t2 JOIN sessions s2 ON s2.id = t2.session_id
  WHERE s2.event_id = s.event_id AND lower(trim(t2.name)) = lower(trim(t.name)) AND t2.rowid < t.rowid);
UPDATE teams SET entrant_id = (
  SELECT t2.id FROM teams t2 JOIN sessions s2 ON s2.id = t2.session_id
  WHERE s2.event_id = (SELECT event_id FROM sessions WHERE id = teams.session_id)
    AND (t2.id = teams.id OR (trim(teams.name) <> '' AND lower(trim(t2.name)) = lower(trim(teams.name))))
  ORDER BY t2.rowid LIMIT 1);
UPDATE teams SET name = (SELECT name FROM entrants WHERE id = teams.entrant_id)
WHERE name IS NOT (SELECT name FROM entrants WHERE id = teams.entrant_id);
-- Each contestant account links to the entrant of its oldest team.
UPDATE accounts SET entrant_id = (
  SELECT t.entrant_id FROM memberships m JOIN teams t ON t.id = m.team_id
  WHERE m.account_id = accounts.id ORDER BY t.rowid LIMIT 1)
WHERE EXISTS (SELECT 1 FROM memberships WHERE account_id = accounts.id AND team_id IS NOT NULL);

-- Invariants. Created after the backfill, so legacy anomalies are kept, not refused.
-- (1) An entry's entrant belongs to the contest's event and fits the contest type.
CREATE TRIGGER entry_fits_contest BEFORE INSERT ON teams
WHEN NEW.entrant_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM entrants e JOIN sessions s ON s.id = NEW.session_id
  WHERE e.id = NEW.entrant_id AND e.event_id = s.event_id
    AND (s.contest_type = 'mixed' OR (s.contest_type = 'teams') = (e.kind = 'team')))
BEGIN
  SELECT RAISE(ABORT, 'This entrant cannot enter this contest');
END;
CREATE TRIGGER entry_entrant_fixed BEFORE UPDATE OF entrant_id ON teams
WHEN OLD.entrant_id IS NOT NULL AND NEW.entrant_id IS NOT OLD.entrant_id
BEGIN
  SELECT RAISE(ABORT, 'An entry keeps its entrant');
END;
CREATE TRIGGER contest_type_fits_entries BEFORE UPDATE OF contest_type ON sessions
WHEN EXISTS (SELECT 1 FROM teams t JOIN entrants e ON e.id = t.entrant_id
  WHERE t.session_id = NEW.id AND NOT (NEW.contest_type = 'mixed' OR (NEW.contest_type = 'teams') = (e.kind = 'team')))
BEGIN
  SELECT RAISE(ABORT, 'Remove the entrants that this contest type excludes first');
END;
-- (2) Repair for the previous Worker's add_teams, which sets no entrant.
CREATE TRIGGER entry_default_entrant AFTER INSERT ON teams WHEN NEW.entrant_id IS NULL
BEGIN
  INSERT INTO entrants (id, event_id, kind, name)
    SELECT NEW.id, event_id, 'team', NEW.name FROM sessions WHERE id = NEW.session_id;
  UPDATE teams SET entrant_id = NEW.id WHERE id = NEW.id;
END;
-- (3) Seats are a projection of entries. An entrant's sign-in holds a contestant membership in
-- exactly the contests that hold its entry. The Worker never writes contestant memberships.
CREATE TRIGGER entry_seats_added AFTER INSERT ON teams WHEN NEW.entrant_id IS NOT NULL
BEGIN
  INSERT INTO memberships (session_id, account_id, team_id)
    SELECT NEW.session_id, a.id, NEW.id FROM accounts a WHERE a.entrant_id = NEW.entrant_id
    ON CONFLICT (session_id, account_id) DO NOTHING;
END;
CREATE TRIGGER entry_seats_removed BEFORE DELETE ON teams
BEGIN
  DELETE FROM memberships WHERE session_id = OLD.session_id AND team_id = OLD.id;
END;
CREATE TRIGGER account_entrant_seats AFTER UPDATE OF entrant_id ON accounts
WHEN OLD.entrant_id IS NULL AND NEW.entrant_id IS NOT NULL
BEGIN
  INSERT INTO memberships (session_id, account_id, team_id)
    SELECT t.session_id, NEW.id, t.id FROM teams t WHERE t.entrant_id = NEW.entrant_id
    ON CONFLICT (session_id, account_id) DO NOTHING;
END;
CREATE TRIGGER account_entrant_fixed BEFORE UPDATE OF entrant_id ON accounts
WHEN (OLD.entrant_id IS NOT NULL AND NEW.entrant_id IS NOT OLD.entrant_id)
  OR (NEW.entrant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM entrants e
    WHERE e.id = NEW.entrant_id AND e.event_id IS NEW.event_id))
BEGIN
  SELECT RAISE(ABORT, 'A sign-in belongs to one entrant of its own event');
END;
CREATE TRIGGER account_entrant_event BEFORE INSERT ON accounts
WHEN NEW.entrant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM entrants e
  WHERE e.id = NEW.entrant_id AND e.event_id IS NEW.event_id)
BEGIN
  SELECT RAISE(ABORT, 'A sign-in belongs to one entrant of its own event');
END;
CREATE TRIGGER account_entrant_inserted AFTER INSERT ON accounts WHEN NEW.entrant_id IS NOT NULL
BEGIN
  INSERT INTO memberships (session_id, account_id, team_id)
    SELECT t.session_id, NEW.id, t.id FROM teams t WHERE t.entrant_id = NEW.entrant_id
    ON CONFLICT (session_id, account_id) DO NOTHING;
END;
-- (4) Repair for the previous Worker's contestant membership: link the account to the entry's
-- entrant. Then account_entrant_seats seats it in the entrant's other entries too.
-- It also places the account, because SQLite does not promise the order in which this trigger
-- and membership_adopts_event run, and account_entrant_fixed compares the two events.
CREATE TRIGGER contestant_seat_links_entrant AFTER INSERT ON memberships WHEN NEW.team_id IS NOT NULL
BEGIN
  UPDATE accounts SET
    event_id = COALESCE(event_id, (SELECT event_id FROM sessions WHERE id = NEW.session_id)),
    entrant_id = (SELECT entrant_id FROM teams WHERE id = NEW.team_id)
  WHERE id = NEW.account_id AND entrant_id IS NULL;
END;
-- (5) A seat matches its account's entrant, and an entrant's sign-in never holds staff authority.
CREATE TRIGGER seat_matches_entrant BEFORE INSERT ON memberships
WHEN EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.account_id AND a.entrant_id IS NOT NULL
  AND (NEW.team_id IS NULL OR a.entrant_id IS NOT (SELECT entrant_id FROM teams WHERE id = NEW.team_id)))
BEGIN
  SELECT RAISE(ABORT, 'An entrant sign-in holds only its own entries');
END;
CREATE TRIGGER seat_team_fixed BEFORE UPDATE OF team_id ON memberships
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND entrant_id IS NOT NULL)
  AND NEW.team_id IS NOT OLD.team_id
BEGIN
  SELECT RAISE(ABORT, 'An entrant sign-in holds only its own entries');
END;
CREATE TRIGGER contestant_has_no_role BEFORE INSERT ON membership_roles
WHEN EXISTS (SELECT 1 FROM memberships WHERE session_id = NEW.session_id
  AND account_id = NEW.account_id AND team_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'A contestant holds no staff role');
END;
-- (6) An entrant's sign-in never holds an event grant. A site grant already needs an account
-- without an event, and an entrant's sign-in always has one (account_entrant_event).
CREATE TRIGGER grant_holder_not_entrant BEFORE INSERT ON grants
WHEN NEW.scope = 'event' AND EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND entrant_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'An entrant sign-in holds no grant');
END;
-- (7) One name per entrant. An entry shows its entrant's name. Either side may be renamed;
-- the previous Worker renames through teams (src/server/adapters/cloudflare/application.ts:359). The WHEN terms stop the echo.
CREATE TRIGGER entrant_renamed AFTER UPDATE OF name ON entrants WHEN NEW.name IS NOT OLD.name
BEGIN
  UPDATE teams SET name = NEW.name WHERE entrant_id = NEW.id AND name IS NOT NEW.name;
END;
CREATE TRIGGER entry_renamed AFTER UPDATE OF name ON teams
WHEN NEW.name IS NOT OLD.name AND NEW.entrant_id IS NOT NULL
BEGIN
  UPDATE entrants SET name = NEW.name WHERE id = NEW.entrant_id AND name IS NOT NEW.name;
END;

-- Contest type now changes what an entry may hold, so it joins the contest version.
DROP TRIGGER session_changes;
CREATE TRIGGER session_changes AFTER UPDATE OF intake_open, event_id, categories, contest_type ON sessions
BEGIN
  UPDATE sessions SET version = version + 1 WHERE id = NEW.id;
END;


-- ==== 0020_contest_schedule.sql (Phase 5) additive: yes ====
-- Scheduled start and end, grace, automatic intake with a manual override, contest-wide awards.
-- This file comes before the live password rule (0021), because that rule's default scope is
-- "the live contests whose window overlaps", and a window needs a schedule.
-- Previous Worker: reads intake_open only. A contest that follows its schedule acts as manual
-- with its last intake_open value (closed by default) until roll-forward. Staff can still use
-- the old switch.

-- Instants in the format of every other timestamp: strftime('%Y-%m-%dT%H:%M:%fZ').
-- Nullable: existing and fixture contests have no schedule. The Worker requires one on create.
ALTER TABLE sessions ADD COLUMN starts_at TEXT;
ALTER TABLE sessions ADD COLUMN ends_at TEXT;
ALTER TABLE sessions ADD COLUMN grace_minutes INTEGER NOT NULL DEFAULT 0 CHECK (grace_minutes BETWEEN 0 AND 240);
-- 1: intake is derived from the schedule. 0: intake_open is the state (today's switch, and
-- the manual override). Existing contests keep 0, so their behavior does not change.
ALTER TABLE sessions ADD COLUMN intake_follows_schedule INTEGER NOT NULL DEFAULT 0
  CHECK (intake_follows_schedule IN (0, 1));

CREATE TRIGGER session_schedule_inserted BEFORE INSERT ON sessions
WHEN NOT ((NEW.starts_at IS NULL AND NEW.ends_at IS NULL AND NEW.intake_follows_schedule = 0)
  OR (NEW.starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.starts_at)
    AND NEW.ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.ends_at) AND NEW.ends_at > NEW.starts_at))
BEGIN
  SELECT RAISE(ABORT, 'A schedule needs a start before its end');
END;
CREATE TRIGGER session_schedule_changed BEFORE UPDATE OF starts_at, ends_at, intake_follows_schedule ON sessions
WHEN NOT ((NEW.starts_at IS NULL AND NEW.ends_at IS NULL AND NEW.intake_follows_schedule = 0)
  OR (NEW.starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.starts_at)
    AND NEW.ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.ends_at) AND NEW.ends_at > NEW.starts_at))
BEGIN
  SELECT RAISE(ABORT, 'A schedule needs a start before its end');
END;
-- Calendar reads: one event's contests in start order, and every contest that ends after a time.
CREATE INDEX sessions_event_schedule ON sessions(event_id, starts_at);
CREATE INDEX sessions_ends ON sessions(ends_at) WHERE ends_at IS NOT NULL;

-- A contest-wide time award. The decision and the confirmation of external application stay
-- separate records with separate actors, as for issue awards (src/server/adapters/d1/migrations/0005_workflow.sql:38-55).
-- (actor, request_id) makes a repeated grant insert nothing. applied_request makes a repeated
-- confirmation a no-op instead of an error.
CREATE TABLE contest_awards (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 0 AND 1440),
  explanation TEXT NOT NULL CHECK (length(trim(explanation)) BETWEEN 1 AND 2000),
  actor TEXT NOT NULL REFERENCES accounts(id),
  actor_name TEXT NOT NULL,
  at TEXT NOT NULL,
  applied_at TEXT,
  applied_by TEXT REFERENCES accounts(id),
  applied_name TEXT,
  applied_request TEXT,
  UNIQUE (actor, request_id),
  CHECK ((applied_at IS NULL AND applied_by IS NULL AND applied_name IS NULL AND applied_request IS NULL)
    OR (applied_at IS NOT NULL AND applied_by IS NOT NULL AND applied_name IS NOT NULL AND applied_request IS NOT NULL))
) STRICT;
CREATE INDEX contest_awards_session ON contest_awards(session_id, at);
CREATE TRIGGER contest_award_fixed BEFORE UPDATE ON contest_awards
WHEN OLD.applied_at IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.session_id IS NOT OLD.session_id
  OR NEW.minutes IS NOT OLD.minutes OR NEW.explanation IS NOT OLD.explanation OR NEW.actor IS NOT OLD.actor
  OR NEW.actor_name IS NOT OLD.actor_name OR NEW.at IS NOT OLD.at OR NEW.request_id IS NOT OLD.request_id
BEGIN
  SELECT RAISE(ABORT, 'A contest award is final, and its confirmation is written once');
END;
-- Personal end times sum applied issue awards per entry; the console sums per contest.
CREATE INDEX awards_session ON awards(session_id);

DROP TRIGGER session_changes;
CREATE TRIGGER session_changes AFTER UPDATE OF intake_open, event_id, categories, contest_type,
  starts_at, ends_at, grace_minutes, intake_follows_schedule ON sessions
BEGIN
  UPDATE sessions SET version = version + 1 WHERE id = NEW.id;
END;


-- ==== 0021_live_credentials.sql (Phase 6) additive: yes ====
-- The 2026-10-25 live password rule: a live contest's intake stays closed until every
-- contestant sign-in in it holds a completed password issued for it.
-- Previous Worker: its resets insert account_operations rows, which clear the scopes below,
-- so a live contest closes until the new Worker reissues. That is the safe direction.

-- Existing contests and fixture contests are practice, so nothing that exists today closes.
-- An organizer chooses the kind when creating a contest. It never changes. A live contest
-- always has a schedule, so "the live contests whose window overlaps" is always defined.
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'practice'
  CHECK (kind IN ('practice', 'live') AND (kind = 'practice' OR starts_at IS NOT NULL));
CREATE TRIGGER session_kind_fixed BEFORE UPDATE OF kind ON sessions WHEN NEW.kind IS NOT OLD.kind
BEGIN
  SELECT RAISE(ABORT, 'A contest kind is fixed at creation');
END;

-- The contests that the account's current password was issued for. Primary state, written by
-- the issuing batch. A self change of password keeps it (the password is still that issue's).
CREATE TABLE credential_scopes (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  PRIMARY KEY (account_id, session_id)
) STRICT;
CREATE INDEX credential_scopes_session ON credential_scopes(session_id);
CREATE INDEX account_operations_account ON account_operations(account_id, action);

-- Contestant seats of the contest without a password issued for it. D1 keeps it exact, so the
-- intake check reads one column instead of counting up to 800 seats on every snapshot.
-- It is not in session_changes: the submit batch re-checks intake through the workflow
-- dependency value, so a credential issue does not fail in-flight staff commands.
ALTER TABLE sessions ADD COLUMN unready_seats INTEGER NOT NULL DEFAULT 0 CHECK (unready_seats >= 0);

-- Backfill scopes from history: an account's newest admin-issued credential, when it completed
-- and named a contest (the same rule as the earlier design's issued_contest view).
INSERT INTO credential_scopes (account_id, session_id, operation_id)
SELECT o.account_id, o.session_id, o.id FROM account_operations o
WHERE o.session_id IS NOT NULL AND o.action IN ('create_account', 'reset_password') AND o.state = 'completed'
  AND o.rowid = (SELECT max(n.rowid) FROM account_operations n WHERE n.account_id = o.account_id
    AND n.action IN ('create_account', 'reset_password') AND n.state <> 'superseded');
UPDATE sessions SET unready_seats = (
  SELECT count(*) FROM memberships m WHERE m.session_id = sessions.id AND m.team_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM credential_scopes c WHERE c.account_id = m.account_id AND c.session_id = m.session_id));

-- An admin issue (create or reset, by either Worker or trusted recovery) ends every scope of
-- the old password. The issuing batch then inserts the new scopes after this row.
CREATE TRIGGER credential_issue_ends_scopes AFTER INSERT ON account_operations
WHEN NEW.action IN ('create_account', 'reset_password')
BEGIN
  DELETE FROM credential_scopes WHERE account_id = NEW.account_id;
END;
-- Keep unready_seats exact. Every change to a contestant seat or a scope passes here.
CREATE TRIGGER seat_counted AFTER INSERT ON memberships
WHEN NEW.team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM credential_scopes
  WHERE account_id = NEW.account_id AND session_id = NEW.session_id)
BEGIN
  UPDATE sessions SET unready_seats = unready_seats + 1 WHERE id = NEW.session_id;
END;
CREATE TRIGGER seat_uncounted AFTER DELETE ON memberships
WHEN OLD.team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM credential_scopes
  WHERE account_id = OLD.account_id AND session_id = OLD.session_id)
BEGIN
  UPDATE sessions SET unready_seats = unready_seats - 1 WHERE id = OLD.session_id;
END;
CREATE TRIGGER seat_recounted AFTER UPDATE OF team_id ON memberships
WHEN (OLD.team_id IS NULL) <> (NEW.team_id IS NULL) AND NOT EXISTS (SELECT 1 FROM credential_scopes
  WHERE account_id = NEW.account_id AND session_id = NEW.session_id)
BEGIN
  UPDATE sessions SET unready_seats = unready_seats + CASE WHEN NEW.team_id IS NULL THEN -1 ELSE 1 END
  WHERE id = NEW.session_id;
END;
CREATE TRIGGER scope_counted AFTER INSERT ON credential_scopes
WHEN EXISTS (SELECT 1 FROM memberships WHERE session_id = NEW.session_id
  AND account_id = NEW.account_id AND team_id IS NOT NULL)
BEGIN
  UPDATE sessions SET unready_seats = unready_seats - 1 WHERE id = NEW.session_id;
END;
CREATE TRIGGER scope_uncounted AFTER DELETE ON credential_scopes
WHEN EXISTS (SELECT 1 FROM memberships WHERE session_id = OLD.session_id
  AND account_id = OLD.account_id AND team_id IS NOT NULL)
BEGIN
  UPDATE sessions SET unready_seats = unready_seats + 1 WHERE id = OLD.session_id;
END;


-- ==== 0022_event_deletion.sql (Phase 7) additive: yes ====
-- A deletion journal that survives the cascade, plus indexes that keep the cascade and the
-- account deletes from scanning other events' rows. The guards that make the journal the only
-- way to delete come in 0023, one release later, so that the previous release's test cleanup
-- (src/server/adapters/d1/testFixture.ts:205-207 deletes rows directly) still passes scripts/rollback-check.mjs here.
-- Previous Worker: archived = 1 already makes it refuse every write (src/server/adapters/cloudflare/application.ts:222,
-- src/server/adapters/d1/store.ts:143). It does not read the journal.

-- No FK to events or accounts: the row is the permanent site record of the deletion.
-- Steps: rows (contests, then accounts, then the event row), live (Durable Object erase),
-- files (R2 prefixes), done.
CREATE TABLE event_deletions (
  event_id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  event_code TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  step TEXT NOT NULL DEFAULT 'rows' CHECK (step IN ('rows', 'live', 'files', 'done')),
  rows_done_at TEXT,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  blocked TEXT,
  finished_at TEXT,
  CHECK ((step = 'rows') = (rows_done_at IS NULL)),
  CHECK ((step = 'done') = (finished_at IS NOT NULL))
) STRICT;
CREATE INDEX event_deletions_open ON event_deletions(lease_until) WHERE finished_at IS NULL;
-- The journal only moves forward, and it keeps naming the same event. So the step 'rows', which
-- the 0023 guards read, opens once per event and closes for good.
CREATE TRIGGER event_deletion_step_order BEFORE UPDATE OF step ON event_deletions
WHEN NEW.step IS NOT OLD.step AND NOT ((OLD.step = 'rows' AND NEW.step = 'live')
  OR (OLD.step = 'live' AND NEW.step = 'files') OR (OLD.step = 'files' AND NEW.step = 'done'))
BEGIN
  SELECT RAISE(ABORT, 'A deletion moves forward one step at a time');
END;
CREATE TRIGGER event_deletion_fixed BEFORE UPDATE OF event_id, event_name, event_code, requested_by ON event_deletions
BEGIN
  SELECT RAISE(ABORT, 'A deletion record names its event for good');
END;

-- Exactly what the deletion may touch, captured in the fencing batch by event_id. Every later
-- step deletes by these IDs or by R2 prefixes derived from them, never by a wider predicate.
CREATE TABLE event_deletion_targets (
  event_id TEXT NOT NULL REFERENCES event_deletions(event_id),
  kind TEXT NOT NULL CHECK (kind IN ('contest', 'account', 'avatar_owner')),
  id TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  PRIMARY KEY (event_id, kind, id)
) STRICT;
CREATE INDEX event_deletion_targets_pending ON event_deletion_targets(event_id, kind, id) WHERE done = 0;

-- Foreign-key children without an index make each parent delete scan the child table across
-- every event. Local SQLite measured 11,363 ms for one event at N = 80,000 without the receipts
-- index (a local measurement, not D1). Partial indexes on mostly-NULL columns cost
-- nothing for rows that leave them NULL. Write cost added to hot paths, stated in the design page:
-- one index entry per history row, issue, resolution, award, and command receipt.
CREATE INDEX command_receipts_issue ON command_receipts(session_id, issue_id);
CREATE INDEX history_actor ON history(actor);
CREATE INDEX issues_owner ON issues(owner) WHERE owner IS NOT NULL;
CREATE INDEX issues_reporter ON issues(reporter);
CREATE INDEX resolutions_actor ON resolutions(actor);
CREATE INDEX resolutions_reopened_by ON resolutions(reopened_by) WHERE reopened_by IS NOT NULL;
CREATE INDEX resolutions_issue ON resolutions(session_id, issue_id);
CREATE INDEX awards_actor ON awards(actor);
CREATE INDEX awards_applied_by ON awards(applied_by) WHERE applied_by IS NOT NULL;
CREATE INDEX contest_awards_actor ON contest_awards(actor);
CREATE INDEX contest_awards_applied_by ON contest_awards(applied_by) WHERE applied_by IS NOT NULL;
CREATE INDEX admin_audit_actor ON admin_audit(actor);
CREATE INDEX admin_audit_target ON admin_audit(target) WHERE target IS NOT NULL;
CREATE INDEX issue_images_deleted_by ON issue_images(deleted_by) WHERE deleted_by IS NOT NULL;
CREATE INDEX announcements_author ON announcements(author);
CREATE INDEX announcements_edited_by ON announcements(edited_by) WHERE edited_by IS NOT NULL;
CREATE INDEX announcements_removed_by ON announcements(removed_by) WHERE removed_by IS NOT NULL;
CREATE INDEX announcement_images_deleted_by ON announcement_images(deleted_by) WHERE deleted_by IS NOT NULL;
CREATE INDEX account_operations_actor ON account_operations(actor);
CREATE INDEX account_operations_session ON account_operations(session_id) WHERE session_id IS NOT NULL;


-- ==== 0023_deletion_guards.sql (Phase 8) additive: yes ====
-- Only a deletion journal in step 'rows' lets a row of an event, a contest, or an event account
-- disappear. The guards read this design's journal. An ad hoc DELETE,
-- from any Worker version, a test, or a console, is refused. A site account (event_id NULL)
-- can never be deleted this way.
-- Previous Worker: never deletes events, contests, or accounts in production code. Its tests
-- (the previous release's npm run test:d1) clean up through the journal since Phase 7.

CREATE TRIGGER events_delete_guard BEFORE DELETE ON events
WHEN NOT EXISTS (SELECT 1 FROM event_deletions WHERE event_id = OLD.id AND step = 'rows')
BEGIN
  SELECT RAISE(ABORT, 'An event is deleted only through its deletion record');
END;
CREATE TRIGGER sessions_delete_guard BEFORE DELETE ON sessions
WHEN NOT EXISTS (SELECT 1 FROM event_deletions WHERE event_id = OLD.event_id AND step = 'rows')
BEGIN
  SELECT RAISE(ABORT, 'A contest is deleted only through the deletion of its event');
END;
CREATE TRIGGER accounts_delete_guard BEFORE DELETE ON accounts
WHEN OLD.event_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM event_deletions WHERE event_id = OLD.event_id AND step = 'rows')
BEGIN
  SELECT RAISE(ABORT, 'An account is deleted only through the deletion of its event');
END;
```
