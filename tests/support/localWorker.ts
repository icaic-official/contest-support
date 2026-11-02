import type { BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import type { Command, Role, Snapshot } from '../../src/connected/model';
import { WorkflowService } from '../../src/server/workflow';
import { D1ApplicationStore } from '../../src/server/adapters/d1/store';
import type { D1Connection, D1Statement } from '../../src/server/adapters/d1/connection';
import { applyMigrations } from '../../src/server/adapters/d1/testFixture';
import { D1ApplicationService } from '../../src/server/adapters/cloudflare/application';
import { D1AnnouncementService } from '../../src/server/adapters/cloudflare/announcements';
import { R2AnnouncementImageService } from '../../src/server/adapters/cloudflare/announcementImages';
import { R2AvatarService } from '../../src/server/adapters/cloudflare/avatars';
import { D1ManageService } from '../../src/server/adapters/cloudflare/manage';
import { R2ImageService, type PrivateBucket } from '../../src/server/adapters/cloudflare/images';
import { type FixtureAccount, FixtureWorker, type WorkerServices, test as base } from './worker';

interface Bindings { DB: D1Connection; IMAGES: PrivateBucket }

/**
 * The local R2 proxy rejects a Node request stream because it has no known
 * length. The Worker streams the request body, so this buffers it for the proxy.
 */
function knownLength(bucket: PrivateBucket): PrivateBucket {
  return {
    get: (key, options) => bucket.get(key, options),
    put: async (key, body, options) =>
      bucket.put(key, body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer()), options),
    delete: (keys) => bucket.delete(keys),
  };
}

const names = ['jury', 'combined', 'volunteer', 'specialist', 'admin', 'contestant'] as const;
type Name = typeof names[number];

const roles: Record<Name, Role[]> = {
  jury: ['jury'],
  combined: ['volunteer', 'specialist', 'jury'],
  volunteer: ['volunteer'],
  specialist: ['specialist'],
  admin: [],
  contestant: [],
};

/**
 * The real Cloudflare services over local D1 and R2. Each test owns one event,
 * two sessions, three teams and six accounts, all with new UUIDs. Sign in with
 * a name from `users`. Only the identity and the live socket are simulated.
 */
export class LocalWorker extends FixtureWorker {
  readonly event = randomUUID();
  readonly sessions: [string, string] = [randomUUID(), randomUUID()];
  readonly teams: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
  readonly users = Object.fromEntries(names.map((name) => [name, randomUUID()])) as Record<Name, string>;
  /** Issue IDs in number order. Empty when the test does not seed issues. */
  readonly issues: string[] = [];
  private readonly logins = new Map<string, FixtureAccount>(names.map((name) =>
    [this.users[name], { id: this.users[name], username: name, name: `Test ${name}`, loginId: randomUUID() }]));
  private readonly workflow: WorkflowService;
  protected readonly services: WorkerServices;

  constructor(
    origin: string,
    private readonly db: D1Connection,
    bucket: PrivateBucket,
    private readonly guard: (context: BrowserContext) => Promise<void>,
  ) {
    super(origin);
    this.workflow = new WorkflowService(new D1ApplicationStore(db));
    this.services = {
      application: new D1ApplicationService(db),
      workflow: this.workflow,
      manage: new D1ManageService(db),
      announcements: new D1AnnouncementService(db),
      announcementImages: new R2AnnouncementImageService(db, knownLength(bucket)),
      images: new R2ImageService(db, knownLength(bucket)),
      avatars: new R2AvatarService(db, bucket),
    };
  }

  protected accounts(): readonly FixtureAccount[] {
    return [...this.logins.values()];
  }

  override async attach(context: BrowserContext): Promise<void> {
    await this.guard(context);
    await super.attach(context);
  }

  private caller(user: string) {
    return { accountId: user, loginId: this.logins.get(user)!.loginId };
  }

  /** Runs one SQL statement against the fixture database. */
  async run(sql: string, ...values: Array<string | number | null>): Promise<void> {
    await this.db.prepare(sql).bind(...values).run();
  }

  async rows<T>(sql: string, ...values: Array<string | number | null>): Promise<T[]> {
    return (await this.db.prepare(sql).bind(...values).all<T>()).results;
  }

  /** The session as the Worker shows it to `user`. */
  snapshot(user: string = this.users.jury, session: string = this.sessions[0]): Promise<Snapshot> {
    return this.services.application.snapshot(this.caller(user), session);
  }

  /** Commits a workflow command as `user` and notifies live clients. Returns the issue ID. */
  async act(user: string, command: Command, request: string = randomUUID(), session: string = this.sessions[0]): Promise<string> {
    const result = await this.workflow.execute(this.caller(user), session, request, command);
    this.notify();
    if (result.outcome !== 'committed') throw new Error(`The fixture command was not committed: ${JSON.stringify(result)}`);
    return result.issueId;
  }

  /** `webmaster` holds a site grant before its membership, as migration 0017 promotes an account. */
  async create(seedIssues: boolean, webmaster: Name | null = null): Promise<void> {
    const write = (sql: string, ...values: Array<string | number | null>) => this.db.prepare(sql).bind(...values);
    const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
    const statements = [
      write('INSERT INTO events (id, name) VALUES (?, ?)', this.event, 'Jury verification'),
      write(`INSERT INTO sessions (id, event_id, name, intake_open) VALUES (?, ?, 'Primary', 1), (?, ?, 'Secondary', 1)`,
        this.sessions[0], this.event, this.sessions[1], this.event),
      write(`INSERT INTO teams (id, session_id, name, location)
        VALUES (?, ?, 'Aurora', 'A12'), (?, ?, 'Cedar', 'A18'), (?, ?, 'Isolated', 'B01')`,
      this.teams[0], this.sessions[0], this.teams[1], this.sessions[0], this.teams[2], this.sessions[1]),
    ];
    for (const name of names) {
      const id = this.users[name];
      const login = this.logins.get(id)!.loginId;
      // Usernames are unique in the shared worker database. The fixture identity signs in by `name`.
      const username = `${name}-${login.replaceAll('-', '').slice(0, 20)}`;
      statements.push(
        write('INSERT INTO accounts (id, name, username, must_change) VALUES (?, ?, ?, 0)', id, `Test ${name}`, username),
        ...(name === webmaster ? [write(`INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', 'fixture')`, id)] : []),
        write(`INSERT INTO ba_user (id, name, email, username, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ${now}, ${now})`,
          id, `Test ${name}`, `${username}@accounts.minsky.invalid`, username),
        write(`INSERT INTO ba_session (id, userId, token, expiresAt, createdAt, updatedAt)
          VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'), ${now}, ${now})`, login, id, randomUUID()),
        write('INSERT INTO logins (id, account_id, expires_at, identity_session_id) VALUES (?, ?, unixepoch() + 3600, ?)', login, id, login),
        write('INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, ?, ?)',
          this.sessions[0], id, name === 'contestant' ? this.teams[0] : null, Number(name === 'admin')),
        ...roles[name].map((role) => write('INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, ?)',
          this.sessions[0], id, role)),
      );
    }
    statements.push(
      write('INSERT INTO memberships (session_id, account_id) VALUES (?, ?)', this.sessions[1], this.users.jury),
      write(`INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')`, this.sessions[1], this.users.jury),
    );
    if (seedIssues) statements.push(...this.issueRows(write));
    await this.db.batch(statements);
  }

  /**
   * Six issues that the volunteer handled. Odd issues belong to Aurora, even
   * ones to Cedar. All were resolved in number order. Issues 3 to 5 have
   * awards: 3 has zero minutes and 5 is applied. Issues 4 and 6 were reopened.
   * The rows have no history, so history checks see only the test's own entries.
   */
  private issueRows(write: (sql: string, ...values: Array<string | number | null>) => D1Statement): D1Statement[] {
    const { volunteer, jury } = this.users;
    const stamp = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
    const statements = [write('INSERT INTO session_issue_sequences (session_id, number) VALUES (?, 6)', this.sessions[0])];
    for (let n = 1; n <= 6; n++) {
      const issue = randomUUID();
      const resolution = randomUUID();
      const reopened = n === 4 || n === 6;
      this.issues.push(issue);
      statements.push(
        write(`INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description,
          created_at, first_assigned_at, owner, owner_name, resolved_at)
          VALUES (?, ?, ?, ?, ?, ?, 'Test volunteer', 'Backend', ?, ?, ?, ?, 'Test volunteer', ?)`,
        issue, this.sessions[0], this.teams[n % 2 === 1 ? 0 : 1], reopened ? 'claimed' : 'resolved', n, volunteer,
        `Issue ${n} verification`, stamp(30), stamp(29), volunteer, reopened ? null : stamp(25 - n)),
        write(`INSERT INTO resolutions (id, session_id, issue_id, actor, actor_name, at, summary,
          reopened_at, reopened_by, reopened_name, reason) VALUES (?, ?, ?, ?, 'Test volunteer', ?, ?, ?, ?, ?, ?)`,
        resolution, this.sessions[0], issue, volunteer, stamp(25 - n), `Resolution ${n}: service restored`,
        reopened ? stamp(15) : null, reopened ? volunteer : null, reopened ? 'Test volunteer' : null, reopened ? 'Still failing' : null),
      );
      if (n >= 3 && n <= 5) {
        statements.push(write(`INSERT INTO awards (id, session_id, issue_id, resolution_id, minutes, explanation,
          actor, actor_name, at, applied_at, applied_by, applied_name) VALUES (?, ?, ?, ?, ?, ?, ?, 'Test jury', ?, ?, ?, ?)`,
        randomUUID(), this.sessions[0], issue, resolution, n === 3 ? 0 : 5, `Decision ${n} explanation`, jury,
        stamp(20 - n / 10), n === 5 ? stamp(10) : null, n === 5 ? jury : null, n === 5 ? 'Test jury' : null));
      }
    }
    return statements;
  }
}

/**
 * `local` serves a seeded `LocalWorker` to the default context. Each Playwright
 * worker starts one local D1 and R2 runtime and applies every migration once.
 * Tests share it, and each test's records have their own UUIDs.
 */
export const test = base.extend<{ seedIssues: boolean; webmaster: Name | null; local: LocalWorker }, { platform: Bindings }>({
  seedIssues: [true, { option: true }],
  webmaster: [null, { option: true }],
  // eslint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from this pattern. There are none.
  platform: [async ({}, provide) => {
    const directory = mkdtempSync(join(tmpdir(), 'minsky-browser-worker-'));
    const entry = join(directory, 'worker.js');
    writeFileSync(entry, 'export default { fetch() { return new Response("Local browser fixture binding"); } };');
    const configPath = join(directory, 'wrangler.json');
    writeFileSync(configPath, JSON.stringify({
      name: 'minsky-browser-fixture', main: entry, compatibility_date: '2026-10-13',
      d1_databases: [{ binding: 'DB', database_name: 'minsky-browser-fixture', database_id: randomUUID() }],
      r2_buckets: [{ binding: 'IMAGES', bucket_name: 'minsky-browser-fixture' }],
    }));
    const platform = await getPlatformProxy<Bindings>({ configPath, persist: false, remoteBindings: false, envFiles: [] });
    try {
      await applyMigrations(platform.env.DB);
      await provide(platform.env);
    } finally {
      await platform.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  }, { scope: 'worker' }],
  local: async ({ platform, seedIssues, webmaster, baseURL, context, guard }, provide) => {
    const local = new LocalWorker(new URL(baseURL!).origin, platform.DB, platform.IMAGES, guard);
    await local.create(seedIssues, webmaster);
    await local.attach(context);
    await provide(local);
  },
});

export { expect } from './worker';
