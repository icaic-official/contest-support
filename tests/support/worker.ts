import { test as base, expect, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type {
  CredentialIssue, EventCode, EventConsole, IssuedCredential, ManageCommand, ManageReceipt, PersonAvatar, SignInTarget,
  SiteOverview,
} from '../../src/backend/contracts';
import type { AnnouncementSnapshot } from '../../src/connected/announcementModel';
import type { Command, Membership, Snapshot } from '../../src/connected/model';
import {
  AuthenticationError, signInRefused, type AuthenticationService, type AuthenticationSession,
} from '../../src/server/authentication';
import { createAuthenticationHandler } from '../../src/server/authenticationHttp';
import { eventCodeStorageKey } from '../../src/screens/eventCodeMemory';
import type { CommandResult } from '../../src/server/workflow';
import { createApplicationHandler, type ApplicationHttpServices } from '../../src/server/adapters/cloudflare/http';

/** The application services behind the Worker routes. Identity and live updates come from the fixture. */
export type WorkerServices = Omit<ApplicationHttpServices, 'auth' | 'connect'>;

/** A fixture account. Sign-in accepts any password for its username in its target. */
export interface FixtureAccount {
  id: string;
  /** The event or the site that the sign-in form must name. */
  target: SignInTarget;
  username: string;
  name: string;
  loginId: string;
}

/** The event of every in-memory fixture account. */
export const fixtureEvent = { kind: 'event', code: 'fixture-event' as EventCode } as const satisfies SignInTarget;

export function fixtureAccount(id: string, username: string, name: string, target: SignInTarget = fixtureEvent): FixtureAccount {
  return { id, target, username, name, loginId: randomUUID() };
}

function sameTarget(account: SignInTarget, typed: SignInTarget): boolean {
  return account.kind === 'site' ? typed.kind === 'site' : typed.kind === 'event' && typed.code === account.code;
}

const loginCookie = 'minsky_fixture_login';

/**
 * Replaces Better Auth and password checks. Each account has one login, and an
 * HttpOnly cookie carries it, so every browser context signs in separately.
 */
class FixtureIdentity implements AuthenticationService {
  constructor(
    private readonly accounts: () => readonly FixtureAccount[],
    private readonly canChangeHandle: (accountId: string) => Promise<boolean>,
  ) {}

  async current(headers: Headers): Promise<AuthenticationSession | undefined> {
    const loginId = headers.get('Cookie')?.split(';').map((part) => part.trim().split('='))
      .find(([name]) => name === loginCookie)?.[1];
    const account = this.accounts().find((candidate) => candidate.loginId === loginId);
    if (!account) return undefined;
    return {
      caller: { accountId: account.id, loginId: account.loginId },
      user: { id: account.id, name: account.name },
      status: { handle: account.username, must_change: false, session_valid: true, can_change_handle: await this.canChangeHandle(account.id) },
      csrf: `csrf-${account.loginId}`,
    };
  }

  async signIn(target: SignInTarget, username: string): Promise<{ cookie: string }> {
    const account = this.accounts().find((candidate) => candidate.username === username && sameTarget(candidate.target, target));
    if (!account) throw signInRefused(target.kind);
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
}

/** The request paths that the deployed Worker sends to its authentication handler. */
function authenticationPath(path: string): boolean {
  return path.startsWith('/api/auth/');
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
  /** Whether an account may change its own username, as the account status reports it. */
  protected abstract canChangeHandle(accountId: string): Promise<boolean>;
  protected abstract readonly services: WorkerServices;

  constructor(readonly origin: string) {}

  /** The event code of the fixture's accounts. */
  protected eventCodeOfDevice(): EventCode {
    return fixtureEvent.code;
  }

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

  /**
   * Serves the Worker to one browser context. By default the browser acts as
   * a device that last signed in to the fixture's event, so the sign-in form
   * fills in the code. `newDevice` starts with no remembered code. A later
   * attach of the same context names its own event, because its script runs last.
   */
  async attach(context: BrowserContext, options: { newDevice?: boolean } = {}): Promise<void> {
    if (!options.newDevice) {
      await context.addInitScript(({ key, code }) => {
        try {
          window.localStorage.setItem(key, code);
        } catch {
          // A page without storage starts with an empty code.
        }
      }, { key: eventCodeStorageKey, code: this.eventCodeOfDevice() });
    }
    const identity = new FixtureIdentity(() => this.accounts(), (id) => this.canChangeHandle(id));
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
      const stage = loss < 0 ? undefined : this.losses.splice(loss, 1)[0]!.stage;
      if (stage === 'request') {
        await route.abort('failed');
        return;
      }
      const handler = authenticationPath(url.pathname) ? authentication : application;
      const headers = new Headers(await request.allHeaders());
      // Chromium adds the body length below the layer that Playwright intercepts.
      if (bytes) headers.set('Content-Length', String(bytes.byteLength));
      const response = await handler(new Request(url, {
        method: request.method(), headers, body: bytes ? new Uint8Array(bytes) : null,
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
    contest_awards: [],
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

  /** Receives each management command. Throw an AuthenticationError to reject. */
  manage: (command: ManageCommand) => Promise<ManageReceipt> = async () => {
    throw new AuthenticationError(403, 'Only a webmaster can change the site.');
  };

  /** The event console that the signed-in account reads. Undefined refuses the read. */
  eventConsole: EventConsole | undefined;

  /** The site that the signed-in account reads. Null is a person who is not a webmaster. */
  site: SiteOverview | null = null;

  /** Receives each credential request. Throw an AuthenticationError to reject. */
  issue: (input: CredentialIssue) => Promise<IssuedCredential[]> = async () => {
    throw new AuthenticationError(403, 'Only a webmaster can issue webmaster passwords.');
  };

  protected accounts(): readonly FixtureAccount[] {
    return this.account ? [this.account] : [];
  }

  /** The fake Worker refuses every username change. */
  protected async canChangeHandle(): Promise<boolean> {
    return false;
  }

  private read(sessionId: string): Snapshot {
    const snapshot = this.snapshots().find((item) => item.session?.id === sessionId && item.membership);
    if (!snapshot) throw new AuthenticationError(403, 'Sign in again or change your temporary password.');
    return snapshot;
  }

  protected readonly services: WorkerServices = {
    application: {
      contests: async () => this.snapshots().filter((item) => item.membership)
        .map((item) => ({
          id: item.session!.id, name: item.session!.name, eventId: item.event?.id ?? '', eventName: item.event?.name ?? '',
          timeZone: 'UTC', contestType: 'teams' as const, schedule: null,
          intake: { open: item.session!.intake_open, reason: item.session!.intake_open ? 'override_open' as const : 'override_closed' as const, changesAt: null },
          canOpen: true, manage: 'none' as const,
        })),
      snapshot: async (_caller, sessionId) => this.read(sessionId),
    },
    workflow: { execute: (_caller, _sessionId, requestId, command) => this.workflow(command as Command, requestId) },
    manage: {
      site: async () => this.site,
      event: async () => {
        if (!this.eventConsole) throw new AuthenticationError(403, 'Only an event admin or a webmaster can change this event.');
        return this.eventConsole;
      },
      execute: async (_caller, _requestId, command) => this.manage(command as ManageCommand),
      issueCredentials: async (_caller, _requestId, input) => this.issue(input as CredentialIssue),
    },
    contestAwards: { execute: async () => randomUUID() },
    contestRecord: { read: unavailable },
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
