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

export interface SessionSummary {
  id: string;
  name: string;
}

export interface Workflows {
  /** Lists sessions accessible to the authenticated account. */
  sessions(userId: string): Promise<SessionSummary[]>;
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

export interface MembershipInput {
  teamId: string | null;
  roles: Role[];
  isAdmin: boolean;
}

interface CreateAccountCommand extends MembershipInput {
  action: 'create_account';
  username: string;
  name: string;
}

export type AccountCommand =
  | CreateAccountCommand
  | { action: 'reset_password'; userId: string };

/** A new temporary password, shown once and never stored. */
export interface AccountResult {
  temporaryPassword: string;
  /** The event code or the site that the account names to sign in. */
  signIn: SignInTarget;
}

/** A team of a roster edit. The browser chooses the ID, so a retry adds no second team. */
export interface NewTeam {
  id: string;
  name: string;
  location: string;
}

/**
 * One roster edit by a session admin. A team that has an issue or an account
 * stays. A category that an issue uses stays. `set_categories` replaces the
 * whole ordered list.
 */
export type RosterCommand =
  | { type: 'add_teams'; teams: NewTeam[] }
  | { type: 'update_team'; teamId: string; name: string; location: string }
  | { type: 'delete_team'; teamId: string }
  | { type: 'set_categories'; categories: string[] };

export interface Administration {
  account(sessionId: string, command: AccountCommand): Promise<AccountResult>;
  setIntake(sessionId: string, open: boolean): Promise<void>;
  setImageLimits(
    sessionId: string,
    limits: { fileMegabytes: number; count: number; totalMegabytes: number },
  ): Promise<void>;
  saveMember(
    sessionId: string,
    userId: string,
    member: MembershipInput,
  ): Promise<void>;
  removeMember(sessionId: string, userId: string): Promise<void>;
  /** Rejects with the reason when the edit would remove a team or category that is in use. */
  editRoster(sessionId: string, command: RosterCommand): Promise<void>;
}

/** A new webmaster. The server gives the account a login key that nobody sees. */
export interface PersonInput {
  readonly handle: string;
  readonly name: string;
}

/**
 * Every site change, and a handle change. The server derives each command's
 * requirement from the command alone, resolves the caller's authority once,
 * and checks it again inside the write batch. Callers never name their own
 * authority.
 */
export type ManageCommand =
  | { readonly type: 'add_webmaster'; readonly person: PersonInput }
  | { readonly type: 'remove_webmaster'; readonly accountId: string }
  | { readonly type: 'set_webmaster_reads'; readonly restricted: boolean }
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
  readonly accountIds?: readonly string[];
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
  /** Contests that the caller has not joined. Empty while webmasters read every contest. */
  readonly contestsToJoin: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly eventName: string;
  }>;
}

/** Site administration for webmasters, and handle changes for the accounts that a caller may manage. */
export interface Management {
  /** Null when the signed-in account is not a webmaster. */
  site(): Promise<SiteOverview | null>;
  /**
   * Reusing a request ID with the same command returns the first receipt.
   * A rejection carries the reason. Other failures leave the outcome unknown,
   * and the caller retries with the same request ID.
   */
  execute(requestId: string, command: ManageCommand): Promise<ManageReceipt>;
  /**
   * Issues a new temporary password for each of up to ISSUE_BATCH other
   * webmasters, in one batch. Reusing the request ID returns the accounts
   * without passwords.
   */
  issueCredentials(requestId: string, accountIds: readonly string[]): Promise<readonly IssuedCredential[]>;
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
  admin: Administration;
  manage: Management;
  images: ImageTransport;
  announcements: Announcements;
  avatars: Avatars;
  updates: LiveUpdates;
}
