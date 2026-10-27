import type {
  AccountCommand,
  AccountIdentity,
  Backend,
  MembershipInput,
} from '../../src/backend/contracts';
import type { Command } from '../../src/connected/model';

export interface BrowserProvider {
  backend: Backend;
  discardNextWorkflowResponse(): void;
  discardNextAccountResponse(): void;
  close(): Promise<void>;
}

export interface BrowserProviderModule {
  createBrowserProvider(
    configuration: unknown,
  ): Promise<BrowserProvider> | BrowserProvider;
}

/** Only the test bridge serializes contract calls. Providers retain their own protocols. */
export type Request =
  | {
    type:
      | 'currentUser'
      | 'signOut'
      | 'accountStatus'
      | 'discardNextWorkflowResponse'
      | 'discardNextAccountResponse'
      | 'close';
  }
  | { type: 'signIn'; username: string; password: string }
  | { type: 'changePassword'; currentPassword: string; newPassword: string }
  | { type: 'authSubscribe'; id: string }
  | { type: 'stop'; id: string }
  | { type: 'sessions'; userId: string }
  | { type: 'snapshot'; sessionId: string }
  | { type: 'execute'; sessionId: string; requestId: string; command: Command }
  | { type: 'account'; sessionId: string; command: AccountCommand }
  | { type: 'setIntake'; sessionId: string; open: boolean }
  | {
    type: 'setImageLimits';
    sessionId: string;
    limits: Parameters<Backend['admin']['setImageLimits']>[1];
  }
  | {
    type: 'saveMember';
    sessionId: string;
    userId: string;
    member: MembershipInput;
  }
  | { type: 'removeMember'; sessionId: string; userId: string }
  | { type: 'editRoster'; sessionId: string; command: Parameters<Backend['admin']['editRoster']>[1] }
  | { type: 'beginImage'; input: Parameters<Backend['images']['begin']>[0] }
  | {
    type: 'uploadImage';
    path: string;
    bytes: number[];
    contentType: string;
    id: string;
  }
  | {
    type: 'finishImage' | 'removeImage' | 'abandonImage';
    sessionId: string;
    attachmentId: string;
  }
  | { type: 'downloadImage'; path: string }
  | { type: 'updatesSubscribe'; id: string; sessionId: string; userId: string };

export type BrowserEvent =
  | { type: 'auth'; id: string; user?: AccountIdentity | undefined }
  | { type: 'change'; id: string; arguments: unknown[] }
  | { type: 'connection'; id: string; connected: boolean }
  | { type: 'progress'; id: string; loaded: number };

export type Response =
  | { ok: true; value: unknown }
  | {
    ok: false;
    error: {
      kind: 'rejected' | 'image' | 'unknown';
      message: string;
      validation?: boolean;
      restart?: boolean;
      incomplete?: boolean;
    };
  };
