import type { AccountIdentity, AccountStatus, Handle, SignInTarget } from '../backend/contracts.ts';

export interface Caller {
  /** Supplied by a trusted identity adapter, never accepted from a request body. */
  accountId: string;
  loginId: string;
}

/** Opaque cookie credentials stay in the identity adapter and HTTP boundary. */
export interface AuthenticationSession {
  caller: Caller;
  user: AccountIdentity;
  status: AccountStatus;
  csrf: string;
}

export interface AuthenticationService {
  current(headers: Headers): Promise<AuthenticationSession | undefined>;
  signIn(target: SignInTarget, handle: Handle, password: string): Promise<{ cookie: string }>;
  signOut(headers: Headers): Promise<{ cookie: string }>;
  changePassword(headers: Headers, currentPassword: string, newPassword: string): Promise<{ cookie: string }>;
}

export class AuthenticationError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 409 | 429 | 503, message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * The one refusal of a sign-in. A wrong event code, handle, or password gives
 * the same answer, so a sign-in never reveals whether an event code exists.
 */
export function signInRefused(kind: SignInTarget['kind']): AuthenticationError {
  return new AuthenticationError(401, kind === 'event'
    ? 'The event code, username, or password is incorrect.'
    : 'The username or password is incorrect.');
}
