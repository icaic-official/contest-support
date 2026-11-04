import { z } from 'zod';
import type {
  AccountIdentity, Authentication, Unsubscribe,
} from '../contracts';

const identitySchema = z.object({ id: z.uuid(), name: z.string().exactOptional(), email: z.string().exactOptional() });
const sessionSchema = z.object({
  user: identitySchema,
  status: z.object({
    handle: z.string().nullable(), must_change: z.boolean(), session_valid: z.boolean(),
    // A Worker from before the field shows no username form.
    can_change_handle: z.boolean().default(false),
  }),
  csrf: z.string().min(1),
});
const errorSchema = z.object({ error: z.string() });

export interface CloudflareAuthentication extends Authentication {
  /**
   * Sends a request with the login's CSRF token. The token comes from the
   * last session read and is reused until the login changes. A 403 reply
   * means the server stopped before it ran the request, so one retry with a
   * fresh token is safe.
   */
  withCsrf(send: (token: string) => Promise<Response>): Promise<Response>;
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
  // The CSRF token of the current login. It changes only with the login.
  let csrf: string | undefined;

  function notify(user: AccountIdentity | undefined) {
    for (const callback of subscribers) callback(user);
  }

  function fetchRaw(path: string, init?: RequestInit): Promise<Response> {
    return request(new URL(path, origin), {
      ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    });
  }

  async function checked(response: Response): Promise<Response> {
    if (!response.ok && response.status !== 401) {
      const parsed = errorSchema.safeParse(await response.json().catch(() => undefined));
      throw new Error(parsed.success ? parsed.data.error : 'The authentication request failed.');
    }
    return response;
  }

  async function read(path: string, init?: RequestInit): Promise<Response> {
    return checked(await fetchRaw(path, init));
  }

  async function session() {
    const expected = generation;
    const response = await read('/api/auth/session');
    if (response.status === 401) {
      if (expected === generation) csrf = undefined;
      return undefined;
    }
    const current = sessionSchema.parse(await response.json());
    // A read that started before a sign-in, sign-out or password change can carry the old login.
    if (expected === generation) csrf = current.csrf;
    return current;
  }

  async function token(fresh = false): Promise<string> {
    if (!fresh && csrf) return csrf;
    const current = await session();
    if (!current) {
      notify(undefined);
      throw new Error('Sign in to continue.');
    }
    return current.csrf;
  }

  async function withCsrf(send: (token: string) => Promise<Response>): Promise<Response> {
    const used = await token();
    const response = await send(used);
    if (response.status !== 403) return response;
    const fresh = await token(true);
    return fresh === used ? response : send(fresh);
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
    const send = (csrfToken?: string) => {
      const headers = new Headers({ 'Content-Type': 'application/json', 'X-Minsky-Request': '1' });
      if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
      return fetchRaw(path, { method: 'POST', headers, body: JSON.stringify(body) });
    };
    const response = await checked(authenticated ? await withCsrf(send) : await send());
    if (response.status === 401) {
      notify(undefined);
      // A refused sign-in shows the server's one message. Elsewhere a 401 means that the session ended.
      const refused = authenticated ? undefined : errorSchema.safeParse(await response.json().catch(() => undefined)).data;
      throw new Error(refused?.error ?? 'Sign in to continue.');
    }
    return response;
  }

  async function mutateSession(path: string, body: unknown, authenticated = true) {
    generation++;
    try {
      await mutate(path, body, authenticated);
    } finally {
      // Reads started during a mutation can still contain the earlier identity.
      // Discard them after success or failure, including an unknown write outcome.
      generation++;
      csrf = undefined;
    }
  }

  return {
    withCsrf,
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
    async signIn(target, handle, password) {
      const event = target.kind === 'event' ? target.code : null;
      await mutateSession('/api/auth/sign-in', { event, handle, password }, false);
      await refresh();
    },
    async signOut() {
      await mutateSession('/api/auth/sign-out', {});
      notify(undefined);
    },
    async accountStatus() {
      const current = await session();
      // A reset removes the identity session. Report a restricted status without
      // recovering an account ID from an invalid cookie or browser memory.
      if (!current) return { handle: null, must_change: true, session_valid: false, can_change_handle: false };
      return current.status;
    },
    async changePassword(currentPassword, newPassword) {
      await mutateSession('/api/auth/change-password', { currentPassword, newPassword });
      const current = await refresh();
      if (!current || current.status.must_change || !current.status.session_valid) {
        throw new Error('Sign in again to confirm the password change.');
      }
    },
  };
}
