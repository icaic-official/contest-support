import { test as base, expect, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { PersonAvatar } from '../../src/backend/contracts';
import type { AnnouncementSnapshot } from '../../src/connected/announcementModel';
import type { Command, Membership, Snapshot } from '../../src/connected/model';
import { AuthenticationError, type AuthenticationService, type AuthenticationSession } from '../../src/server/authentication';
import { createAuthenticationHandler } from '../../src/server/authenticationHttp';
import type { CommandResult } from '../../src/server/workflow';
import { createApplicationHandler, type ApplicationHttpServices } from '../../src/server/adapters/cloudflare/http';

/** The application services behind the Worker routes. Identity and live updates come from the fixture. */
export type WorkerServices = Omit<ApplicationHttpServices, 'auth' | 'connect'>;

/** A fixture account. Sign-in accepts any password for its username. */
export interface FixtureAccount {
  id: string;
  username: string;
  name: string;
  loginId: string;
}

export function fixtureAccount(id: string, username: string, name: string): FixtureAccount {
  return { id, username, name, loginId: randomUUID() };
}

const loginCookie = 'minsky_fixture_login';

/**
 * Replaces Better Auth and password checks. Each account has one login, and an
 * HttpOnly cookie carries it, so every browser context signs in separately.
 */
class FixtureIdentity implements AuthenticationService {
  constructor(private readonly accounts: () => readonly FixtureAccount[]) {}

  async current(headers: Headers): Promise<AuthenticationSession | undefined> {
    const loginId = headers.get('Cookie')?.split(';').map((part) => part.trim().split('='))
      .find(([name]) => name === loginCookie)?.[1];
    const account = this.accounts().find((candidate) => candidate.loginId === loginId);
    if (!account) return undefined;
    return {
      caller: { accountId: account.id, loginId: account.loginId },
      user: { id: account.id, name: account.name },
      status: { username: account.username, must_change: false, session_valid: true },
      csrf: `csrf-${account.loginId}`,
    };
  }

  async signIn(username: string): Promise<{ cookie: string }> {
    const account = this.accounts().find((candidate) => candidate.username === username);
    if (!account) throw new AuthenticationError(401, 'The username or password is incorrect.');
    return { cookie: `${loginCookie}=${account.loginId}; Path=/; HttpOnly; SameSite=Strict` };
  }

  async signOut(): Promise<{ cookie: string }> {
    return { cookie: `${loginCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` };
  }

  async changePassword(headers: Headers): Promise<{ cookie: string }> {
    const session = await this.current(headers);
    if (!session) throw new AuthenticationError(401, 'Sign in to continue.');
    return { cookie: `${loginCookie}=${session.caller.loginId}; Path=/; HttpOnly; SameSite=Strict` };
  }

  async account(): Promise<{ temporaryPassword?: string }> {
    return {};
  }

  async sessions(): Promise<never> {
    throw new AuthenticationError(403, 'The application routes list sessions.');
  }
}

/** The request paths that the deployed Worker sends to its authentication handler. */
function authenticationPath(path: string): boolean {
  return path === '/api/accounts' || (path.startsWith('/api/auth/') && path !== '/api/auth/sessions');
}

/**
 * Serves the real Worker HTTP handlers to the browser. Routing, origin, CSRF,
 * status codes, and error bodies come from `src/server`. Subclasses supply the
 * accounts and the application services.
 */
export abstract class FixtureWorker {
  /** The JSON body, or the bytes, of every POST and PUT that reached the Worker. */
  readonly writes: Array<{ path: string; body: unknown }> = [];
  private readonly sockets = new Set<WebSocketRoute>();
  private readonly losses: Array<{ path: string; stage: 'request' | 'response' }> = [];

  protected abstract accounts(): readonly FixtureAccount[];
  protected abstract readonly services: WorkerServices;

  constructor(readonly origin: string) {}

  /** The bodies of the writes to one path, in order. */
  bodies<T = unknown>(path: string): T[] {
    return this.writes.filter((write) => write.path === path).map((write) => write.body as T);
  }

  /**
   * Breaks the connection for the next write to `path` or a path below it. At `request` the
   * Worker never sees the write. At `response` the Worker handles it, and the
   * browser gets no answer.
   */
  loseNext(path: string, stage: 'request' | 'response'): void {
    this.losses.push({ path, stage });
  }

  /** Sends a change hint to every live connection, as the session coordinator does. */
  notify(): void {
    for (const socket of this.sockets) socket.send('{"type":"change"}');
  }

  async attach(context: BrowserContext): Promise<void> {
    const identity = new FixtureIdentity(() => this.accounts());
    const authentication = createAuthenticationHandler(identity, { origins: [this.origin] });
    const application = createApplicationHandler({
      ...this.services,
      auth: identity,
      connect: async () => new Response(null, { status: 426 }),
    }, this.origin);
    await context.route(`${this.origin}/api/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const write = request.method() === 'POST' || request.method() === 'PUT';
      const bytes = request.postDataBuffer() ?? undefined;
      if (write) {
        const json = request.headers()['content-type']?.startsWith('application/json');
        this.writes.push({ path: url.pathname, body: json && bytes ? JSON.parse(bytes.toString()) : bytes });
      }
      const loss = write ? this.losses.findIndex((item) =>
        url.pathname === item.path || url.pathname.startsWith(`${item.path}/`)) : -1;
      const stage = loss < 0 ? undefined : this.losses.splice(loss, 1)[0].stage;
      if (stage === 'request') {
        await route.abort('failed');
        return;
      }
      const handler = authenticationPath(url.pathname) ? authentication : application;
      const headers = new Headers(await request.allHeaders());
      // Chromium adds the body length below the layer that Playwright intercepts.
      if (bytes) headers.set('Content-Length', String(bytes.byteLength));
      const response = await handler(new Request(url, {
        method: request.method(), headers, body: bytes && new Uint8Array(bytes),
      }));
      if (stage === 'response') {
        await route.abort('failed');
      } else {
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
      }
      if (write && response.ok) this.notify();
    });
    const live = `${this.origin.replace(/^http/, 'ws')}/api/updates`;
    await context.routeWebSocket((url) => url.href.startsWith(`${live}?`), (socket) => {
      this.sockets.add(socket);
      socket.onClose(() => this.sockets.delete(socket));
      socket.send('{"type":"ready"}');
    });
  }
}

/**
 * Collects page errors and console messages of the given types. A signed-out
 * page asks for its session and gets 401, and Chromium logs that response. The
 * Worker does the same, so that one message is not an app error.
 */
export function appErrors(page: Page, types: readonly string[] = ['error']): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    const signedOut = message.location().url.endsWith('/api/auth/session') &&
      message.text().includes('status of 401');
    if (types.includes(message.type()) && !signedOut) errors.push(message.text());
  });
  return errors;
}

export const USER_ID = '00000000-0000-4000-8000-000000000001';
export const SESSION_ID = '00000000-0000-4000-8000-000000000100';
export const TEAM_ID = '00000000-0000-4000-8000-000000000200';
export const EVENT_ID = '00000000-0000-4000-8000-000000000090';

type SessionFields = NonNullable<Snapshot['session']>;

/** A session read for one membership. Each test overrides only the fields it checks. */
export function sessionSnapshot(
  membership: Membership | null,
  overrides: Partial<Omit<Snapshot, 'session'>> & { session?: Partial<SessionFields> } = {},
): Snapshot {
  const { session, ...rest } = overrides;
  const sessionId = membership?.session_id ?? SESSION_ID;
  return {
    session: {
      id: sessionId,
      event_id: EVENT_ID,
      name: 'Fixture session',
      intake_open: true,
      categories: ['Network'],
      revision: 0,
      max_image_bytes: 10 * 1024 * 1024,
      max_images_per_issue: 20,
      max_image_bytes_per_issue: 120 * 1024 * 1024,
      ...session,
    },
    event: { id: EVENT_ID, name: 'Fixture event', archived: false },
    membership,
    teams: [{ id: TEAM_ID, session_id: sessionId, name: 'Aurora', location: 'Desk 12' }],
    issues: [],
    resolutions: [],
    history: [],
    attachments: [],
    pending_removals: [],
    awards: [],
    audit: [],
    members: [],
    server_time: '2026-10-17T00:00:00Z',
    ...rest,
  };
}

export function emptyAnnouncementSnapshot(): AnnouncementSnapshot {
  return { announcements: [], images: [], server_time: new Date().toISOString() };
}

/** Avatar storage for UI checks. The default holds no pictures. */
export type AvatarServices = WorkerServices['avatars'];

const noAvatars: AvatarServices = {
  list: async () => [] as PersonAvatar[],
  upload: async () => { throw new AuthenticationError(403, 'The fixture stores no pictures.'); },
  remove: async () => {},
  download: async () => { throw new AuthenticationError(403, 'The picture does not exist.'); },
};

const unavailable = async (): Promise<never> => {
  throw new AuthenticationError(403, 'The fixture stores no images.');
};

/**
 * An in-memory Worker for UI checks. Each test sets the signed-in account and
 * the session reads, and can replace the workflow or avatar behavior. With no
 * account, every page stays at the sign-in screen.
 */
export class FakeWorker extends FixtureWorker {
  account: FixtureAccount | undefined;
  /** The session reads for the signed-in account. A read without a membership is not listed. */
  snapshots: () => Snapshot[] = () => [];
  announcements = emptyAnnouncementSnapshot();
  avatars: AvatarServices = noAvatars;
  /** Records each workflow command. Replace it to reject, hold, or change state. */
  workflow: (command: Command, requestId: string) => Promise<CommandResult> = async (command) =>
    ({ outcome: 'committed', issueId: 'issue_id' in command ? command.issue_id : randomUUID() });

  protected accounts(): readonly FixtureAccount[] {
    return this.account ? [this.account] : [];
  }

  private read(sessionId: string): Snapshot {
    const snapshot = this.snapshots().find((item) => item.session?.id === sessionId && item.membership);
    if (!snapshot) throw new AuthenticationError(403, 'Sign in again or change your temporary password.');
    return snapshot;
  }

  protected readonly services: WorkerServices = {
    application: {
      sessions: async () => this.snapshots().filter((item) => item.membership)
        .map((item) => ({ id: item.session!.id, name: item.session!.name })),
      snapshot: async (_caller, sessionId) => this.read(sessionId),
      setIntake: async () => {},
      setImageLimits: async () => {},
      saveMember: async () => {},
      removeMember: async () => {},
    },
    workflow: { execute: (_caller, _sessionId, requestId, command) => this.workflow(command as Command, requestId) },
    announcements: {
      snapshot: async () => this.announcements,
      execute: async () => randomUUID(),
    },
    avatars: {
      list: (caller, sessionId) => this.avatars.list(caller, sessionId),
      upload: (caller, input) => this.avatars.upload(caller, input),
      remove: (caller) => this.avatars.remove(caller),
      download: (caller, sessionId, avatarId) => this.avatars.download(caller, sessionId, avatarId),
    },
    images: { begin: unavailable, upload: unavailable, finish: unavailable, remove: unavailable, download: unavailable },
    announcementImages: { begin: unavailable, upload: unavailable, finish: unavailable, remove: unavailable, download: unavailable },
  };
}

/**
 * Every test's default context talks only to the app origin, and `api` starts
 * signed out. `guard` records requests to other hosts, such as a hosted
 * provider, in a context. The test fails when a context sent one.
 */
export const test = base.extend<{ api: FakeWorker; guard: (context: BrowserContext) => Promise<void> }>({
  guard: async ({ baseURL }, provide) => {
    const origin = new URL(baseURL!).origin;
    const local = (url: URL) => url.origin === origin || url.origin === origin.replace(/^http/, 'ws');
    const foreign: string[] = [];
    await provide(async (context) => {
      // A listener, not a route, so that local module loads are not intercepted.
      context.on('request', (request) => {
        if (/^(https?|wss?):/.test(request.url()) && !local(new URL(request.url()))) foreign.push(request.url());
      });
      await context.routeWebSocket((url) => !local(url), (socket) => {
        foreign.push(socket.url());
        return socket.close();
      });
    });
    expect(foreign, 'Browser requests left the app origin').toEqual([]);
  },
  api: [async ({ baseURL, context, guard }, provide) => {
    await guard(context);
    const api = new FakeWorker(new URL(baseURL!).origin);
    await api.attach(context);
    await provide(api);
  }, { auto: true }],
});

export { expect };
