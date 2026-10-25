import type {
  AnnouncementCommand,
  AnnouncementImage,
  AnnouncementSnapshot,
} from '../connected/announcementModel.ts';
import type { Command, Role, Snapshot } from '../connected/model.ts';

export interface AccountIdentity {
  id: string;
  email?: string;
  name?: string;
}

export interface AccountStatus {
  username: string | null;
  must_change: boolean;
  session_valid: boolean;
}

/** Cleanup is idempotent. No callback may run after cleanup returns. */
export type Unsubscribe = () => void;

export interface Authentication {
  currentUser(): Promise<AccountIdentity | undefined>;
  subscribe(onChange: (user: AccountIdentity | undefined) => void): Unsubscribe;
  signIn(username: string, password: string): Promise<void>;
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
  ): Promise<{ issueId: string; snapshot?: Snapshot }>;
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
  | { action: 'set_username'; userId: string; username: string }
  | { action: 'reset_password'; userId: string };

export interface AccountResult {
  temporaryPassword?: string;
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
  images: ImageTransport;
  announcements: Announcements;
  avatars: Avatars;
  updates: LiveUpdates;
}
