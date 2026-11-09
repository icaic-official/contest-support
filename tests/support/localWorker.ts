import type { BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import type { EventCode, ManageCommand, ManageReceipt, SignInTarget } from '../../src/backend/contracts';
import type { Command, Role, Snapshot } from '../../src/connected/model';
import { WorkflowService } from '../../src/server/workflow';
import { D1ApplicationStore } from '../../src/server/adapters/d1/store';
import type { D1Connection, D1Statement } from '../../src/server/adapters/d1/connection';
import { applyMigrations } from '../../src/server/adapters/d1/testFixture';
import { D1ApplicationService } from '../../src/server/adapters/cloudflare/application';
import { D1AnnouncementService } from '../../src/server/adapters/cloudflare/announcements';
import { R2AnnouncementImageService } from '../../src/server/adapters/cloudflare/announcementImages';
import { R2AvatarService } from '../../src/server/adapters/cloudflare/avatars';
import { ownHandleSql } from '../../src/server/adapters/cloudflare/authority';
import { D1ContestAwardService } from '../../src/server/adapters/cloudflare/contestAwards';
import { D1ContestRecordService } from '../../src/server/adapters/cloudflare/contestRecord';
import { D1ManageService } from '../../src/server/adapters/cloudflare/manage';
import { passwordHasher } from '../../src/server/adapters/cloudflare/password';
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
    list: (options) => bucket.list(options),
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
  /** The code that D1 gave the event. `create` reads it. */
  eventCode = '' as EventCode;
  /** An event admin of the event. It holds no seat, and exists only after `create(..., true)`. */
  readonly eventAdmin = randomUUID();
  private readonly logins = new Map<string, Omit<FixtureAccount, 'target'>>([
    ...names.map((name): [string, Omit<FixtureAccount, 'target'>] =>
      [this.users[name], { id: this.users[name], username: name, name: `Test ${name}`, loginId: randomUUID() }]),
    [this.eventAdmin, { id: this.eventAdmin, username: 'eventadmin', name: 'Test event admin', loginId: randomUUID() }],
  ]);
  /** Each account signs in with the event code, and the webmaster with Site sign-in. */
  private readonly targets = new Map<string, SignInTarget>();
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
      manage: new D1ManageService(db, passwordHasher),
      contestAwards: new D1ContestAwardService(db),
      contestRecord: new D1ContestRecordService(db),
      announcements: new D1AnnouncementService(db),
      announcementImages: new R2AnnouncementImageService(db, knownLength(bucket)),
      images: new R2ImageService(db, knownLength(bucket)),
      avatars: new R2AvatarService(db, bucket),
    };
  }

  protected accounts(): readonly FixtureAccount[] {
    return [...this.logins.values()].flatMap((login) => {
      const target = this.targets.get(login.id);
      return target ? [{ ...login, target }] : [];
    });
  }

  protected override eventCodeOfDevice(): EventCode {
    return this.eventCode;
  }

  /** The rule that the Worker's account status applies. */
  protected override async canChangeHandle(accountId: string): Promise<boolean> {
    const row = await this.db.prepare(`SELECT (${ownHandleSql}) AS own FROM accounts t WHERE t.id = ?`).bind(accountId)
      .first<{ own: number }>();
    return row?.own === 1;
  }

  override async attach(context: BrowserContext, options: { newDevice?: boolean } = {}): Promise<void> {
    await this.guard(context);
    await super.attach(context, options);
  }

  private caller(user: string) {
    return { accountId: user, loginId: this.logins.get(user)!.loginId };
  }

  /**
   * Lets an account that the app created sign in through the fixture identity.
   * The fixture skips Better Auth, so this adds the login rows and clears the
   * temporary-password gate, as a completed password change would. Resolves to
   * the account ID.
   */
  async adopt(handle: string): Promise<string> {
    const account = await this.db.prepare('SELECT id, name FROM accounts WHERE handle = ? AND event_id = ?').bind(handle, this.event)
      .first<{ id: string; name: string }>();
    if (!account) throw new Error(`No account of the fixture event has the handle ${handle}.`);
    const login = randomUUID();
    const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
    await this.db.batch([
      this.db.prepare("UPDATE accounts SET must_change = 0, credential_state = 'ready' WHERE id = ?").bind(account.id),
      // An account whose password nobody issued yet has no identity row.
      this.db.prepare(`INSERT OR IGNORE INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
        SELECT id, name, username || '@accounts.minsky.invalid', 1, ${now}, ${now}, username FROM accounts WHERE id = ?`).bind(account.id),
      this.db.prepare(`INSERT INTO ba_session (id, userId, token, expiresAt, createdAt, updatedAt)
        VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'), ${now}, ${now})`).bind(login, account.id, randomUUID()),
      // A login carries the credential generation of the password that opened it.
      this.db.prepare(`INSERT INTO logins (id, account_id, expires_at, identity_session_id, credential_generation)
        SELECT ?, id, unixepoch() + 3600, ?, credential_generation FROM accounts WHERE id = ?`).bind(login, login, account.id),
    ]);
    this.logins.set(account.id, { id: account.id, username: handle, name: account.name, loginId: login });
    this.targets.set(account.id, { kind: 'event', code: this.eventCode });
    return account.id;
  }

  /** Enters the contestant's entrant (Aurora) in the second session, which seats the contestant there too. */
  async seatContestantInSecondSession(): Promise<void> {
    await this.run('INSERT INTO teams (id, session_id, name, location, entrant_id) VALUES (?, ?, ?, ?, ?)',
      randomUUID(), this.sessions[1], 'Aurora', 'A12', this.teams[0]);
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

  /** Runs a site command as `user`, as the site page sends it. */
  manage(user: string, command: ManageCommand): Promise<ManageReceipt> {
    return this.services.manage.execute(this.caller(user), randomUUID(), command);
  }

  /** Commits a workflow command as `user` and notifies live clients. Returns the issue ID. */
  async act(user: string, command: Command, request: string = randomUUID(), session: string = this.sessions[0]): Promise<string> {
    const result = await this.workflow.execute(this.caller(user), session, request, command);
    this.notify();
    if (result.outcome !== 'committed') throw new Error(`The fixture command was not committed: ${JSON.stringify(result)}`);
    return result.issueId;
  }

  /** `webmaster` holds a site grant before its membership, as migration 0017 promotes an account. */
  async create(seedIssues: boolean, webmaster: Name | null = null, eventAdmin = false): Promise<void> {
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
    if (eventAdmin) {
      const login = this.logins.get(this.eventAdmin)!.loginId;
      const username = `eventadmin-${login.replaceAll('-', '').slice(0, 20)}`;
      statements.push(
        write('INSERT INTO accounts (id, name, username, handle, event_id, must_change) VALUES (?, ?, ?, ?, ?, 0)',
          this.eventAdmin, 'Test event admin', username, username, this.event),
        write(`INSERT INTO grants (account_id, scope, event_id, granted_by) VALUES (?, 'event', ?, 'fixture')`, this.eventAdmin, this.event),
        write(`INSERT INTO ba_user (id, name, email, username, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ${now}, ${now})`,
          this.eventAdmin, 'Test event admin', `${username}@accounts.minsky.invalid`, username),
        write(`INSERT INTO ba_session (id, userId, token, expiresAt, createdAt, updatedAt)
          VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'), ${now}, ${now})`, login, this.eventAdmin, randomUUID()),
        write('INSERT INTO logins (id, account_id, expires_at, identity_session_id) VALUES (?, ?, unixepoch() + 3600, ?)', login, this.eventAdmin, login),
      );
    }
    statements.push(
      write('INSERT INTO memberships (session_id, account_id) VALUES (?, ?)', this.sessions[1], this.users.jury),
      write(`INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')`, this.sessions[1], this.users.jury),
    );
    // The contestant's sign-in is the entrant of Aurora. Its seats follow the entries of that entrant.
    statements.push(write('UPDATE accounts SET entrant_id = ? WHERE id = ?', this.teams[0], this.users.contestant));
    if (seedIssues) statements.push(...this.issueRows(write));
    await this.db.batch(statements);
    this.eventCode = (await this.db.prepare('SELECT code FROM events WHERE id = ?').bind(this.event).first<{ code: EventCode }>())!.code;
    for (const name of names) {
      this.targets.set(this.users[name], name === webmaster ? { kind: 'site' } : { kind: 'event', code: this.eventCode });
    }
    if (eventAdmin) this.targets.set(this.eventAdmin, { kind: 'event', code: this.eventCode });
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
export const test = base.extend<{ seedIssues: boolean; webmaster: Name | null; withEventAdmin: boolean; local: LocalWorker }, { platform: Bindings }>({
  seedIssues: [true, { option: true }],
  /** Adds an event admin who signs in as `eventadmin`. */
  withEventAdmin: [false, { option: true }],
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
  local: async ({ platform, seedIssues, webmaster, withEventAdmin, baseURL, context, guard }, provide) => {
    const local = new LocalWorker(new URL(baseURL!).origin, platform.DB, platform.IMAGES, guard);
    await local.create(seedIssues, webmaster, withEventAdmin);
    await local.attach(context);
    await provide(local);
  },
});

export { expect } from './worker';
