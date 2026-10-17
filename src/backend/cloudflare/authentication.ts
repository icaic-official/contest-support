import { z } from 'zod';
import type {
  AccountCommand, AccountIdentity, AccountResult, Authentication,
  SessionSummary, Unsubscribe,
} from '../contracts';

const identitySchema = z.object({ id: z.uuid(), name: z.string().optional(), email: z.string().optional() });
const sessionSchema = z.object({
  user: identitySchema,
  status: z.object({ username: z.string().nullable(), must_change: z.boolean(), session_valid: z.boolean() }),
  csrf: z.string().min(1),
});
const sessionsSchema = z.array(z.object({ id: z.uuid(), name: z.string() }));
const resultSchema = z.object({ temporaryPassword: z.string().optional() });
const errorSchema = z.object({ error: z.string() });

export interface CloudflareAuthentication extends Authentication {
  account(sessionId: string, command: AccountCommand): Promise<AccountResult>;
  sessions(): Promise<SessionSummary[]>;
}

/** Experimental auth transport. It does not select the active application backend. */
export function createCloudflareAuthentication(options: {
  origin: string;
  fetch?: typeof fetch;
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}): CloudflareAuthentication {
  const origin = new URL(options.origin);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.origin !== options.origin ||
      (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) ||
      (typeof location !== 'undefined' && origin.origin !== location.origin)) {
    throw new Error('Authentication requires the current browser origin.');
  }
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const events = options.eventTarget ?? (typeof window !== 'undefined' ? window : undefined);
  const subscribers = new Set<(user: AccountIdentity | undefined) => void>();
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  function notify(user: AccountIdentity | undefined) {
    for (const callback of subscribers) callback(user);
  }

  async function read(path: string, init?: RequestInit): Promise<Response> {
    const response = await request(new URL(path, origin), {
      ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    });
    if (!response.ok && response.status !== 401) {
      const parsed = errorSchema.safeParse(await response.json().catch(() => undefined));
      throw new Error(parsed.success ? parsed.data.error : 'The authentication request failed.');
    }
    return response;
  }

  async function session() {
    const response = await read('/api/auth/session');
    if (response.status === 401) return undefined;
    return sessionSchema.parse(await response.json());
  }

  async function refresh() {
    const expected = generation;
    const current = await session();
    if (expected === generation) notify(current?.user);
    return current;
  }

  function refreshFromEvent() {
    // A failed connection does not assert that the server revoked the session.
    void refresh().catch(() => undefined);
  }

  async function mutate(path: string, body: unknown, authenticated = true) {
    const headers = new Headers({ 'Content-Type': 'application/json', 'X-Minsky-Request': '1' });
    if (authenticated) {
      const current = await session();
      if (!current) {
        notify(undefined);
        throw new Error('Sign in to continue.');
      }
      headers.set('X-CSRF-Token', current.csrf);
    }
    const response = await read(path, { method: 'POST', headers, body: JSON.stringify(body) });
    if (response.status === 401) {
      notify(undefined);
      throw new Error('Sign in to continue.');
    }
    return response;
  }

  return {
    async currentUser() {
      return (await session())?.user;
    },
    subscribe(onChange): Unsubscribe {
      // Each subscription has its own function, even when callers reuse a callback.
      const callback = (user: AccountIdentity | undefined) => onChange(user);
      subscribers.add(callback);
      const expected = generation;
      void session().then((current) => {
        if (subscribers.has(callback) && expected === generation) callback(current?.user);
      }).catch(() => undefined);
      if (subscribers.size === 1) {
        events?.addEventListener('focus', refreshFromEvent);
        events?.addEventListener('pageshow', refreshFromEvent);
        timer = setInterval(refreshFromEvent, 60_000);
      }
      return () => {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          events?.removeEventListener('focus', refreshFromEvent);
          events?.removeEventListener('pageshow', refreshFromEvent);
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
    async signIn(username, password) {
      generation++;
      await mutate('/api/auth/sign-in', { username, password }, false);
      await refresh();
    },
    async signOut() {
      generation++;
      await mutate('/api/auth/sign-out', {});
      notify(undefined);
    },
    async accountStatus() {
      const current = await session();
      if (!current) throw new Error('Sign in to continue.');
      return current.status;
    },
    async changePassword(currentPassword, newPassword) {
      generation++;
      await mutate('/api/auth/change-password', { currentPassword, newPassword });
      const current = await refresh();
      if (!current || current.status.must_change || !current.status.session_valid) {
        throw new Error('Sign in again to confirm the password change.');
      }
    },
    async account(sessionId, command) {
      return resultSchema.parse(await (await mutate('/api/accounts', { sessionId, command })).json());
    },
    async sessions() {
      const response = await read('/api/auth/sessions');
      if (response.status === 401) throw new Error('Sign in to continue.');
      return sessionsSchema.parse(await response.json());
    },
  };
}
