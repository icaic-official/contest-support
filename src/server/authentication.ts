import type { AccountCommand, AccountIdentity, AccountResult, AccountStatus, SessionSummary } from '../backend/contracts';
import type { Caller } from './applicationStore';

/** Opaque cookie credentials stay in the identity adapter and HTTP boundary. */
export interface AuthenticationSession {
  caller: Caller;
  user: AccountIdentity;
  status: AccountStatus;
  csrf: string;
}

export interface AuthenticationService {
  current(headers: Headers): Promise<AuthenticationSession | undefined>;
  signIn(username: string, password: string): Promise<{ cookie: string }>;
  signOut(headers: Headers): Promise<{ cookie: string }>;
  changePassword(headers: Headers, currentPassword: string, newPassword: string): Promise<{ cookie: string }>;
  account(headers: Headers, sessionId: string, command: AccountCommand): Promise<AccountResult>;
  sessions(headers: Headers): Promise<SessionSummary[]>;
}

export class AuthenticationError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 409 | 429 | 503, message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}
