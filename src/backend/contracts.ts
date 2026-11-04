import type {
  AnnouncementCommand,
  AnnouncementImage,
  AnnouncementSnapshot,
} from '../connected/announcementModel.ts';
import type { Command, Role, Snapshot } from '../connected/model.ts';

/**
 * How far an account's authority reaches over a contest's structure. Ordered:
 * none < contest (contest admin) < event (event admin) < site (webmaster).
 */
export type ManageLevel = 'none' | 'contest' | 'event' | 'site';

export type EntrantKind = 'team' | 'single';

/**
 * What an account holds inside one contest. `admin` is true for contest admins,
 * event admins, and webmasters alike. A contestant seat never holds a role.
 */
export type Seat =
  | { readonly kind: 'contestant'; readonly entryId: string; readonly entrantKind: EntrantKind }
  | { readonly kind: 'staff'; readonly admin: boolean; readonly roles: readonly Role[] };

/** Site-unique, 3 to 40 characters of [a-z0-9-], for example `xxxx-olympiad-2026`. */
export type EventCode = string & { readonly __brand: 'EventCode' };

/**
 * What a person types to sign in (`accounts.handle`). It is unique inside one
 * event, or among site accounts. The screens call it the username.
 */
export type Handle = string & { readonly __brand: 'Handle' };

/**
 * `accounts.username` and `ba_user.username`: the only name that Better Auth
 * knows. It is globally unique, and it is never shown or typed. Server only.
 */
export type LoginKey = string & { readonly __brand: 'LoginKey' };

/**
 * The handle namespace that a sign-in names. Webmasters belong to no event, so
 * they choose `site`. Everyone else names the event, usually from the
 * `?event=` link on their credentials.
 */
export type SignInTarget = { readonly kind: 'event'; readonly code: EventCode } | { readonly kind: 'site' };

/** Normalizes typed text to an event code. Undefined when the text cannot be one. */
export function parseEventCode(text: string): EventCode | undefined {
  const code = text.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{2,39}$/.test(code) ? code as EventCode : undefined;
}

/** Normalizes typed text to a handle, the shape of the column CHECK. Undefined when the text cannot be one. */
export function parseHandle(text: string): Handle | undefined {
  const handle = text.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{2,31}$/.test(handle) ? handle as Handle : undefined;
}

export interface AccountIdentity {
  id: string;
  email?: string;
  name?: string;
}

export interface AccountStatus {
  handle: string | null;
  must_change: boolean;
  session_valid: boolean;
  /** True when the account may change its own handle. The server applies the same rule to the change. */
  can_change_handle: boolean;
}

/** Cleanup is idempotent. No callback may run after cleanup returns. */
export type Unsubscribe = () => void;

export interface Authentication {
  currentUser(): Promise<AccountIdentity | undefined>;
  subscribe(onChange: (user: AccountIdentity | undefined) => void): Unsubscribe;
  /** A wrong event code, handle, or password gives the same refusal. */
  signIn(target: SignInTarget, handle: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  accountStatus(): Promise<AccountStatus>;
  /** Resolves only after the password changes and the access gate is cleared. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

/**
 * When a contest runs. Instants are UTC strings. The event's time zone
 * decides how the browser shows them. Contests run continuously and may overlap.
 */
export interface Schedule {
  readonly startsAt: string;
  readonly endsAt: string;
  /** Minutes after the end during which intake stays open. */
  readonly graceMinutes: number;
}

/** The longest grace period, in minutes. D1 enforces the same bound. */
export const GRACE_MINUTES_MAX = 240;

/** Why intake is open or closed. The override reasons mean that staff hold intake open or closed. */
export type IntakeReason = 'before_start' | 'running' | 'grace' | 'ended' | 'override_open' | 'override_closed';

/** Derived by D1 at read time from the schedule and the override. Never stored. */
export interface IntakeState {
  readonly open: boolean;
  readonly reason: IntakeReason;
  /** The next instant at which the reason changes by time alone. Null while an override holds. */
  readonly changesAt: string | null;
}

/** `schedule`: intake follows the schedule. `open`, `closed`: staff override it. */
export type IntakeMode = 'schedule' | 'open' | 'closed';

/**
 * A contest that the caller may list. `canOpen` is false for a contest of the
 * caller's event that the caller holds no seat in. `manage` is the caller's
 * authority over its structure.
 */
export interface ContestSummary {
  id: string;
  name: string;
  eventId: string;
  eventName: string;
  timeZone: string;
  contestType: ContestType;
  /** Null for a contest created before schedules existed. */
  schedule: Schedule | null;
  /** The contest-wide state. A contestant's own state can last longer by confirmed extra time. */
  intake: IntakeState;
  canOpen: boolean;
  manage: ManageLevel;
}

/**
 * `eventId`: every contest of that event that the caller may list.
 * `window`: every scheduled contest of the caller's event that overlaps the
 * window. A webmaster gets the contests of every event.
 */
export type ContestQuery =
  | { readonly eventId?: string; readonly window?: undefined }
  | { readonly eventId?: undefined; readonly window: { readonly from: string; readonly to: string } };

export type ContestAwardCommand =
  | { readonly type: 'grant'; readonly minutes: number; readonly explanation: string }
  | { readonly type: 'apply'; readonly awardId: string };

/**
 * Contest-wide time awards give minutes to every contestant of one contest.
 * Jury grant them. Support or jury confirm that the minutes were applied outside Minsky.
 * Minsky changes no external contest clock.
 */
export interface ContestAwards {
  /**
   * Reusing a request ID with the same command must not repeat a write.
   * Resolves to the award ID. A rejection carries the reason.
   */
  execute(sessionId: string, requestId: string, command: ContestAwardCommand): Promise<string>;
}

export interface Workflows {
  /**
   * Lists the contests that the caller may open. With an event ID, only the
   * contests of that event. Without one, the caller's own event, or every
   * contest for a webmaster.
   */
  contests(query?: ContestQuery): Promise<ContestSummary[]>;
  snapshot(sessionId: string): Promise<Snapshot>;
  /**
   * Reusing a request ID with the same command must not repeat a write.
   * Only WorkflowRejectedError confirms that the server rejected the command.
   * Other failures leave the outcome unknown. The caller retains the request ID.
   */
  execute(
    sessionId: string,
    requestId: string,
    command: Command,
  ): Promise<string>;
  /**
   * Like execute, and also returns the session snapshot that the server read
   * right after the commit. It saves the caller a second read. The snapshot is
   * missing when the server could not read it. The caller then reads again.
   * The same rules for request IDs and failures apply.
   */
  executeAndRead?(
    sessionId: string,
    requestId: string,
    command: Command,
  ): Promise<{ issueId: string; snapshot?: Snapshot | undefined }>;
}

/** A staff account or a webmaster. The server gives it a login key that nobody sees. */
export interface PersonInput {
  readonly handle: string;
  readonly name: string;
}

/** Which entrants a contest takes: only single contestants, only teams, or both. */
export type ContestType = 'singles' | 'mixed' | 'teams';

export interface EntrantInput {
  readonly kind: EntrantKind;
  /** The team's name, or the single contestant's name. Unique inside the event. */
  readonly name: string;
  /** The entrant's one sign-in. A team shares it. A single contestant owns it. */
  readonly handle: string;
}

/**
 * Every structural change. The server derives each command's requirement from
 * the command alone, resolves the caller's authority once, and checks it again
 * inside the write batch. Callers never name their own authority.
 */
export type ManageCommand =
  // Site. Requires a webmaster.
  | { readonly type: 'create_event'; readonly name: string; readonly code: string; readonly timeZone: string; readonly firstAdmin: PersonInput }
  | { readonly type: 'add_webmaster'; readonly person: PersonInput }
  | { readonly type: 'remove_webmaster'; readonly accountId: string }
  | { readonly type: 'set_webmaster_reads'; readonly restricted: boolean }
  // Event. Requires an event admin of that event, or a webmaster.
  | { readonly type: 'update_event'; readonly eventId: string; readonly name: string; readonly code: string; readonly timeZone: string }
  | { readonly type: 'set_event_admin'; readonly eventId: string; readonly accountId: string; readonly admin: boolean }
  | { readonly type: 'create_people'; readonly eventId: string; readonly people: readonly PersonInput[] }
  | { readonly type: 'create_entrants'; readonly eventId: string; readonly entrants: readonly EntrantInput[] }
  | { readonly type: 'rename_entrant'; readonly eventId: string; readonly entrantId: string; readonly name: string }
  | { readonly type: 'create_contest'; readonly eventId: string; readonly name: string; readonly contestType: ContestType; readonly schedule: Schedule; readonly categories: readonly string[] }
  | { readonly type: 'update_contest'; readonly contestId: string; readonly name: string; readonly contestType: ContestType; readonly schedule?: Schedule | undefined }
  | { readonly type: 'assign_entrants'; readonly contestId: string; readonly entries: ReadonlyArray<{ readonly entrantId: string; readonly location: string }> }
  | { readonly type: 'unassign_entrant'; readonly contestId: string; readonly entrantId: string }
  | { readonly type: 'assign_staff'; readonly contestId: string; readonly accountId: string; readonly roles: readonly Role[]; readonly admin: boolean }
  | { readonly type: 'unassign_staff'; readonly contestId: string; readonly accountId: string }
  // Contest. Requires a contest admin of that contest, or higher.
  | { readonly type: 'set_intake'; readonly contestId: string; readonly mode: IntakeMode }
  | { readonly type: 'set_image_limits'; readonly contestId: string; readonly fileMegabytes: number; readonly count: number; readonly totalMegabytes: number }
  | { readonly type: 'set_categories'; readonly contestId: string; readonly categories: readonly string[] }
  | { readonly type: 'set_location'; readonly contestId: string; readonly entrantId: string; readonly location: string }
  /** A webmaster's audited join. D1 accepts it only while the site restricts webmaster reads. */
  | { readonly type: 'join_contest'; readonly contestId: string }
  /**
   * Changes the handle of an account of the event. The login key and open
   * sessions stay. Staff may change their own handle. Contestants may not,
   * because venue staff read it from the credential sheet.
   */
  | { readonly type: 'set_handle'; readonly eventId: string; readonly accountId: string; readonly handle: string };

/** Created IDs, so a retry with the same request ID returns the same IDs. Never a password. */
export interface ManageReceipt {
  readonly eventId?: string;
  readonly contestId?: string;
  readonly accountIds?: readonly string[];
  readonly entrantIds?: readonly string[];
}

/** The most accounts that one credential request issues. Each password hash costs Worker CPU time. */
export const ISSUE_BATCH = 8;

export interface IssuedCredential {
  readonly accountId: string;
  readonly handle: string;
  /**
   * Shown once and never stored. Null when a retry of the same request finds
   * the issue already done. Issue again with a new request ID.
   */
  readonly temporaryPassword: string | null;
}

export interface SiteOverview {
  readonly webmasters: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly handle: string;
    /** False until a password is issued, and while a reset waits for its password. */
    readonly ready: boolean;
  }>;
  readonly restrictWebmasterReads: boolean;
  readonly events: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly code: string;
    readonly timeZone: string;
    readonly archived: boolean;
    readonly contests: number;
    readonly accounts: number;
  }>;
  /** Contests that the caller has not joined. Empty while webmasters read every contest. */
  readonly contestsToJoin: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly eventName: string;
  }>;
}

export interface AuditEntry {
  readonly id: string;
  readonly actorName: string;
  readonly at: string;
  readonly action: string;
  readonly target: string | null;
}

/** What an event admin or a webmaster reads to run one event. */
export interface EventConsole {
  readonly event: {
    readonly id: string;
    readonly name: string;
    readonly code: string;
    readonly timeZone: string;
    readonly archived: boolean;
  };
  readonly manage: ManageLevel;
  readonly admins: readonly string[];
  /** Staff accounts of the event. An entrant's sign-in is listed under its entrant. */
  readonly people: ReadonlyArray<{ readonly id: string; readonly name: string; readonly handle: string | null; readonly ready: boolean }>;
  readonly entrants: ReadonlyArray<{
    readonly id: string;
    readonly kind: EntrantKind;
    readonly name: string;
    readonly accountId: string | null;
    readonly handle: string | null;
  }>;
  readonly contests: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly contestType: ContestType;
    readonly schedule: Schedule | null;
    readonly mode: IntakeMode;
    readonly intake: IntakeState;
  }>;
  /** Staff seats that an assignment made. Event admins and webmasters hold none. */
  readonly staffAssignments: ReadonlyArray<{
    readonly contestId: string;
    readonly accountId: string;
    readonly admin: boolean;
    readonly roles: readonly Role[];
  }>;
  readonly entries: ReadonlyArray<{ readonly contestId: string; readonly entrantId: string; readonly location: string }>;
  readonly audit: readonly AuditEntry[];
}

/**
 * Which accounts get a password. With an event ID, accounts of that event.
 * With null, other webmasters, and only a webmaster may ask.
 */
export interface CredentialIssue {
  readonly eventId: string | null;
  readonly accountIds: readonly string[];
}

/** Site and event administration, and handle changes for the accounts that a caller may manage. */
export interface Management {
  /** Null when the signed-in account is not a webmaster. */
  site(): Promise<SiteOverview | null>;
  /**
   * Requires an event admin of the event, or a webmaster. Without an event ID,
   * the console of the caller's own event.
   */
  event(eventId?: string): Promise<EventConsole>;
  /**
   * Reusing a request ID with the same command returns the first receipt.
   * A rejection carries the reason. Other failures leave the outcome unknown,
   * and the caller retries with the same request ID.
   */
  execute(requestId: string, command: ManageCommand): Promise<ManageReceipt>;
  /**
   * Issues a new temporary password for each of up to ISSUE_BATCH accounts, in
   * one batch. Reusing the request ID returns the accounts without passwords.
   */
  issueCredentials(requestId: string, input: CredentialIssue): Promise<readonly IssuedCredential[]>;
}

export interface StartedImage {
  id: string;
  original_path: string;
  thumbnail_path: string;
}

export interface ImageTransport {
  begin(input: {
    requestId: string;
    sessionId: string;
    issueId: string;
    visibility: 'public' | 'internal';
    name: string;
    bytes: number;
  }): Promise<StartedImage>;
  upload(
    path: string,
    body: Blob,
    contentType: string,
    onProgress: (loaded: number) => void,
  ): Promise<void>;
  finish(sessionId: string, attachmentId: string): Promise<void>;
  remove(sessionId: string, attachmentId: string): Promise<void>;
  abandon(sessionId: string, attachmentId: string): Promise<void>;
  download(path: string): Promise<Blob>;
}

export interface Announcements {
  /** A newer read may abort an older one. A failed read leaves issue reads unaffected. */
  snapshot(sessionId: string, signal?: AbortSignal): Promise<AnnouncementSnapshot>;
  /**
   * Reusing a request ID with the same command must not repeat a write.
   * AnnouncementRejectedError confirms that the server rejected the command.
   * Other failures leave the outcome unknown. The caller retains the request ID.
   */
  execute(
    sessionId: string,
    requestId: string,
    command: AnnouncementCommand,
  ): Promise<string>;
  /** Reusing a request ID after a lost response must not publish another image. */
  uploadImage(input: {
    sessionId: string;
    announcementId: string;
    requestId: string;
    file: File;
    onProgress: (percent: number) => void;
  }): Promise<void>;
  /** A failed file deletion stays retryable. */
  removeImage(sessionId: string, imageId: string): Promise<void>;
  downloadImage(
    image: Pick<AnnouncementImage, 'id' | 'session_id' | 'announcement_id'>,
  ): Promise<Blob>;
}

/** An avatar ID changes on every upload, so it is a safe cache key. */
export interface PersonAvatar {
  person_id: string;
  avatar_id: string;
}

/**
 * Profile pictures belong to accounts, not sessions. Staff of a session see the
 * avatars of its other staff. Every account sees its own avatar.
 */
export interface Avatars {
  /** Avatars that the caller may see in the session. */
  list(sessionId: string): Promise<PersonAvatar[]>;
  /** Replaces the caller's avatar. Reusing a request ID must not store another avatar. */
  upload(input: { requestId: string; file: Blob }): Promise<PersonAvatar>;
  /** Removes the caller's avatar. Removing when none exists succeeds. */
  remove(): Promise<void>;
  /** The provider checks the visibility rule for this session again before it returns the bytes. */
  download(sessionId: string, avatar: PersonAvatar): Promise<Blob>;
}

export interface LiveUpdates {
  /** Notifications invalidate a snapshot. They contain no issue or staff data. */
  subscribe(input: {
    sessionId: string;
    userId: string;
    onChange: () => void;
    onConnection: (connected: boolean) => void;
  }): Unsubscribe;
}

/** Server implementations remain responsible for authorization and transactions. */
export interface Backend {
  auth: Authentication;
  workflows: Workflows;
  manage: Management;
  contestAwards: ContestAwards;
  images: ImageTransport;
  announcements: Announcements;
  avatars: Avatars;
  updates: LiveUpdates;
}
