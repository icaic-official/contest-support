import { z } from 'zod';
import {
  ISSUE_BATCH, type IssuedCredential, type LoginKey, type ManageCommand, type ManageLevel, type ManageReceipt,
  type SiteOverview,
} from '../../../backend/contracts';
import { AuthenticationError, type Caller } from '../../authentication';
import type { D1Connection, D1Statement, D1Value } from '../d1/connection';
import { currentReadyLoginBindings, currentReadyLoginSql, notificationStatements } from './application';
import {
  authorityGuard, contestsToJoinSql, manageAccountBindings, manageHandleBindings, manageHandleSql, manageWebmasterSql,
  reaches, resolveAuthority, webmastersSql, type Authority, type Target,
} from './authority';
import { handleSchema, loginKeyFor, replaceCredentialStatements } from './credentials';
import { randomSecret, type PasswordHasher } from './password';

const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('add_webmaster'),
    person: z.strictObject({ handle: handleSchema, name: z.string().trim().min(1).max(200) }),
  }),
  z.strictObject({ type: z.literal('remove_webmaster'), accountId: z.uuid() }),
  z.strictObject({ type: z.literal('set_webmaster_reads'), restricted: z.boolean() }),
  z.strictObject({ type: z.literal('join_contest'), contestId: z.uuid() }),
  z.strictObject({ type: z.literal('set_handle'), eventId: z.uuid(), accountId: z.uuid(), handle: handleSchema }),
]) satisfies z.ZodType<ManageCommand>;
const accountIdsSchema = z.array(z.uuid()).min(1).max(ISSUE_BATCH)
  .refine((accountIds) => new Set(accountIds).size === accountIds.length);

/**
 * What a command needs: at least a level of authority over one target. Or,
 * for a change to one account, any authority in the account's event, and
 * the plan checks that account inside the batch.
 */
type ManageRequirement =
  | { readonly target: Target; readonly level: Exclude<ManageLevel, 'none'> }
  | { readonly target: { readonly scope: 'event'; readonly eventId: string }; readonly account: string };

const site: ManageRequirement = { target: { scope: 'site' }, level: 'site' };

/**
 * Each command's requirement, derived from the command alone. A new command
 * without a row fails to compile.
 */
export const requirementOf: {
  readonly [K in ManageCommand['type']]: (command: Extract<ManageCommand, { type: K }>) => ManageRequirement;
} = {
  add_webmaster: () => site,
  remove_webmaster: () => site,
  set_webmaster_reads: () => site,
  // Only a site grant resolves to `site` in a contest, so only webmasters join.
  join_contest: (command) => ({ target: { scope: 'contest', contestId: command.contestId }, level: 'site' }),
  set_handle: (command) => ({ target: { scope: 'event', eventId: command.eventId }, account: command.accountId }),
};

function requirementFor(command: ManageCommand): ManageRequirement {
  // requirementOf is keyed by command type, so each row receives its own command.
  return (requirementOf[command.type] as (command: ManageCommand) => ManageRequirement)(command);
}

/** What one command writes after the authority guard, in order. */
interface Plan {
  readonly statements: readonly D1Statement[];
  /** A record in authority_audit, of the target's event or of the site. Null when D1 writes the audit itself. */
  readonly audit: { readonly action: string; readonly target: string | null; readonly detail: object } | null;
  /** Audiences per contest whose open screens refresh after the commit. */
  readonly notify: ReadonlyArray<{ readonly contestId: string; readonly audiences: readonly string[] }>;
  readonly receipt: ManageReceipt;
}

const lastWebmaster = 'The last webmaster cannot be removed.';
const joinNeedsRestriction = 'Turn on "Webmasters read contest data only after joining" before you join a contest.';
const usernameTaken = 'That username is taken. Choose another.';
const cannotChangeAccount = 'You cannot change this account.';

/** D1 refusals that tell a person what to change. Each rule lives in a D1 trigger or index. */
const refusals: ReadonlyArray<readonly [cause: string, message: string]> = [
  ['The last webmaster cannot be removed', lastWebmaster],
  ['Webmasters join a contest only while the site restricts their reads', joinNeedsRestriction],
  ['UNIQUE constraint failed: accounts.handle', usernameTaken],
  ['UNIQUE constraint failed: accounts.event_id, accounts.handle', usernameTaken],
];

/** Maps a failed batch to a message without SQL or provider detail. */
function refusal(error: unknown): AuthenticationError {
  const message = error instanceof Error ? error.message : '';
  const known = refusals.find(([cause]) => message.includes(cause));
  if (known) return new AuthenticationError(409, known[1]);
  return new AuthenticationError(409, /(?:CHECK|UNIQUE|FOREIGN KEY|NOT NULL) constraint failed/.test(message)
    ? 'The site changed. Refresh before retrying.'
    : 'The request outcome is unknown. Refresh before retrying.');
}

/**
 * The assertions of one batch. Each inserts a command assertion that fails
 * the batch when its condition no longer holds, and `cleanup` removes them all.
 */
class Assertions {
  private readonly ids: string[] = [];

  constructor(private readonly db: D1Connection) {}

  check(sql: string, ...values: D1Value[]): D1Statement {
    return this.db.prepare(`INSERT INTO command_assertions (id, valid)
      VALUES (?, CASE WHEN EXISTS (${sql}) THEN 1 ELSE 0 END)`).bind(this.next(), ...values);
  }

  authority(authority: Authority): D1Statement {
    return authorityGuard(this.db, this.next(), authority);
  }

  /** Time can pass between batch statements, so the batch checks the caller's login after its writes. */
  login(caller: Caller): D1Statement {
    return this.check(currentReadyLoginSql, ...currentReadyLoginBindings(caller));
  }

  /** The last statement of the batch. */
  cleanup(): D1Statement {
    return this.db.prepare('DELETE FROM command_assertions WHERE id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(this.ids));
  }

  private next(): string {
    const id = crypto.randomUUID();
    this.ids.push(id);
    return id;
  }
}

interface WebmasterRow {
  id: string;
  name: string;
  handle: string;
  loginKey: LoginKey;
  disabled: number;
  credential_generation: number;
  ready: number;
}

/**
 * Site administration. Every change runs one path: parse, receipt replay,
 * requirement, authority, plan, then one D1 batch that checks the authority
 * again before its writes and stores the receipt with them.
 */
export class D1ManageService {
  constructor(private readonly db: D1Connection, private readonly passwords: PasswordHasher) {}

  private statement(sql: string, ...values: D1Value[]): D1Statement {
    return this.db.prepare(sql).bind(...values);
  }

  /** Null for a caller who is not a webmaster, so asking is not an error. */
  async site(caller: Caller): Promise<SiteOverview | null> {
    if (!(await resolveAuthority(this.db, caller, { scope: 'site' }))) return null;
    const [webmasters, restricted, contests] = await Promise.all([
      this.webmasters(),
      this.readsRestricted(),
      this.statement(contestsToJoinSql, caller.accountId).all<{ id: string; name: string; event_name: string }>(),
    ]);
    return {
      webmasters: webmasters.map(({ id, name, handle, ready }) => ({ id, name, handle, ready: ready === 1 })),
      restrictWebmasterReads: restricted,
      contestsToJoin: contests.results.map((contest) => ({ id: contest.id, name: contest.name, eventName: contest.event_name })),
    };
  }

  async execute(caller: Caller, requestId: string, input: unknown): Promise<ManageReceipt> {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) throw new AuthenticationError(400, 'Check the site change and try again.');
    const command = parsed.data;
    const record = JSON.stringify(command);
    const replayed = await this.replay(caller, requestId, record);
    if (replayed) return replayed;
    const requirement = requirementFor(command);
    const authority = await resolveAuthority(this.db, caller, requirement.target);
    if (!authority || ('level' in requirement && !reaches(authority, requirement.level))) {
      throw new AuthenticationError(403, 'level' in requirement ? 'Only a webmaster can change the site.' : cannotChangeAccount);
    }
    if (!authority.writable) throw new AuthenticationError(403, 'This event is archived.');
    const assertions = new Assertions(this.db);
    const plan = await this.plan(command, authority, assertions);
    return this.commit(authority, requestId, record, plan, assertions);
  }

  /**
   * Issues a temporary password for each of up to ISSUE_BATCH other
   * webmasters. Hashing runs before one batch that holds every write. The
   * passwords are returned once and never stored. A retry of a committed
   * request returns the same accounts without passwords.
   */
  async issueCredentials(caller: Caller, requestId: string, input: unknown): Promise<IssuedCredential[]> {
    const parsed = accountIdsSchema.safeParse(input);
    if (!parsed.success) throw new AuthenticationError(400, `Choose 1 to ${ISSUE_BATCH} different webmasters.`);
    const accountIds = parsed.data;
    const record = JSON.stringify({ type: 'issue_credentials', accountIds });
    const replayed = await this.replay(caller, requestId, record);
    if (replayed) return this.issued(accountIds, new Map());
    if (accountIds.includes(caller.accountId)) throw new AuthenticationError(400, 'Use Change password for your own account.');
    const authority = await resolveAuthority(this.db, caller, { scope: 'site' });
    if (!authority) throw new AuthenticationError(403, 'Only a webmaster can issue webmaster passwords.');
    const targets = (await this.webmasters()).filter((webmaster) => accountIds.includes(webmaster.id));
    if (targets.length !== accountIds.length) {
      throw new AuthenticationError(409, 'That account is not a webmaster. Refresh the page.');
    }
    const assertions = new Assertions(this.db);
    const passwords = new Map<string, string>();
    const statements: D1Statement[] = [];
    for (const target of targets) {
      const password = randomSecret() + 'A9!';
      passwords.set(target.id, password);
      statements.push(
        // A reset or a change of authority since the read fails the batch.
        assertions.check(`${manageWebmasterSql} AND t.disabled = 0 AND t.credential_generation = ?`,
          ...manageAccountBindings(caller.accountId, target.id), target.credential_generation),
        ...replaceCredentialStatements(this.db, target, await this.passwords.hash(password),
          { operationId: crypto.randomUUID(), actor: caller.accountId, temporary: true }),
      );
    }
    await this.commit(authority, requestId, record, {
      statements,
      audit: { action: 'issue_passwords', target: null, detail: { accountIds } },
      notify: [],
      receipt: { accountIds },
    }, assertions);
    return this.issued(accountIds, passwords);
  }

  private async issued(accountIds: readonly string[], passwords: ReadonlyMap<string, string>): Promise<IssuedCredential[]> {
    const accounts = await this.statement(`SELECT id, COALESCE(handle, '') AS handle FROM accounts
      WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(accountIds)).all<{ id: string; handle: string }>();
    const handles = new Map(accounts.results.map((account) => [account.id, account.handle]));
    return accountIds.map((accountId) => ({
      accountId, handle: handles.get(accountId) ?? '', temporaryPassword: passwords.get(accountId) ?? null,
    }));
  }

  /**
   * The stored receipt of an earlier request with this ID. The same command
   * returns it. A different command is refused, so a request ID never names two changes.
   */
  private async replay(caller: Caller, requestId: string, record: string): Promise<ManageReceipt | undefined> {
    const row = await this.statement('SELECT command, result FROM manage_receipts WHERE actor = ? AND request_id = ?',
      caller.accountId, requestId).first<{ command: string; result: string }>();
    if (!row) return undefined;
    if (row.command !== record) {
      throw new AuthenticationError(409, 'This request was already used for another change. Refresh and try again.');
    }
    return JSON.parse(row.result) as ManageReceipt;
  }

  /**
   * One batch: the authority guard, the plan, the audit, the receipt, the
   * notifications, and the login check. When the batch fails, a receipt that a
   * concurrent copy of the request stored still answers it.
   */
  private async commit(authority: Authority, requestId: string, record: string, plan: Plan, assertions: Assertions): Promise<ManageReceipt> {
    const { caller } = authority;
    const statements = [
      assertions.authority(authority),
      ...plan.statements,
      ...(plan.audit ? [this.statement(`INSERT INTO authority_audit (id, event_id, actor, actor_name, action, target, detail)
        SELECT ?, ?, id, name, ?, ?, ? FROM accounts WHERE id = ?`, crypto.randomUUID(), authority.eventId, plan.audit.action,
      plan.audit.target, JSON.stringify(plan.audit.detail), caller.accountId)] : []),
      this.statement('INSERT INTO manage_receipts (actor, request_id, command, result) VALUES (?, ?, ?, ?)',
        caller.accountId, requestId, record, JSON.stringify(plan.receipt)),
      ...plan.notify.flatMap(({ contestId, audiences }) => notificationStatements(this.db, contestId, audiences)),
      assertions.login(caller),
      assertions.cleanup(),
    ];
    try {
      await this.db.batch(statements);
    } catch (error) {
      const replayed = await this.replay(caller, requestId, record);
      if (replayed) return replayed;
      throw refusal(error);
    }
    return plan.receipt;
  }

  private async webmasters(): Promise<WebmasterRow[]> {
    const rows = await this.statement(webmastersSql).all<Omit<WebmasterRow, 'loginKey'> & { login_key: LoginKey }>();
    return rows.results.map(({ login_key, ...row }) => ({ ...row, loginKey: login_key }));
  }

  private async readsRestricted(): Promise<boolean> {
    const row = await this.statement('SELECT restrict_webmaster_reads FROM site_settings WHERE singleton = 1')
      .first<{ restrict_webmaster_reads: number }>();
    return row?.restrict_webmaster_reads === 1;
  }

  private async plan(command: ManageCommand, authority: Authority, assertions: Assertions): Promise<Plan> {
    const actor = authority.caller.accountId;
    switch (command.type) {
      case 'add_webmaster': {
        const { handle, name } = command.person;
        if (await this.statement('SELECT 1 FROM accounts WHERE event_id IS NULL AND handle = ?', handle).first()) {
          throw new AuthenticationError(409, usernameTaken);
        }
        const accountId = crypto.randomUUID();
        return {
          statements: [
            // The account cannot sign in until issueCredentials gives it a password.
            this.statement(`INSERT INTO accounts (id, name, username, handle, must_change, credential_state)
              VALUES (?, ?, ?, ?, 1, 'pending')`, accountId, name, loginKeyFor(accountId), handle),
            this.statement(`INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', ?)`, accountId, actor),
          ],
          audit: { action: 'add_webmaster', target: accountId, detail: { handle, name } },
          notify: [],
          receipt: { accountIds: [accountId] },
        };
      }
      case 'remove_webmaster': {
        const webmasters = await this.webmasters();
        if (!webmasters.some((webmaster) => webmaster.id === command.accountId)) {
          throw new AuthenticationError(409, 'That account is not a webmaster. Refresh the page.');
        }
        const others = webmasters.filter((webmaster) => webmaster.id !== command.accountId && webmaster.disabled === 0);
        if (others.length === 0) throw new AuthenticationError(409, lastWebmaster);
        const leaving = command.accountId === actor;
        // D1 counts every enabled webmaster. One who leaves must leave one who can sign in.
        if (leaving && !others.some((webmaster) => webmaster.ready === 1)) {
          throw new AuthenticationError(409, 'Give another webmaster a password before you remove yourself.');
        }
        return {
          statements: [
            this.statement(`DELETE FROM grants WHERE scope = 'site' AND account_id = ?`, command.accountId),
            assertions.check('SELECT 1 WHERE changes() = 1'),
            // A removed webmaster's open sessions end. One who leaves keeps the
            // own login, which the batch checks after its writes.
            ...(leaving ? [] : [
              this.statement('UPDATE logins SET revoked = 1 WHERE account_id = ?', command.accountId),
              this.statement('DELETE FROM ba_session WHERE userId = ?', command.accountId),
            ]),
          ],
          audit: { action: 'remove_webmaster', target: command.accountId, detail: {} },
          notify: [],
          receipt: {},
        };
      }
      case 'set_webmaster_reads':
        return {
          statements: [this.statement(`INSERT INTO site_settings (singleton, restrict_webmaster_reads, changed_by)
            VALUES (1, ?, ?) ON CONFLICT (singleton) DO UPDATE SET
              restrict_webmaster_reads = excluded.restrict_webmaster_reads,
              changed_by = excluded.changed_by, changed_at = excluded.changed_at`, Number(command.restricted), actor)],
          audit: { action: 'set_webmaster_reads', target: null, detail: { restricted: command.restricted } },
          notify: [],
          receipt: {},
        };
      case 'join_contest':
        if (!(await this.readsRestricted())) throw new AuthenticationError(409, joinNeedsRestriction);
        return {
          // D1 refuses a join while webmasters read every contest, and it writes
          // both audit rows. A second join of the same contest writes nothing.
          statements: [this.statement(`INSERT INTO grants (account_id, scope, session_id, granted_by)
            VALUES (?, 'contest', ?, ?) ON CONFLICT (session_id, account_id) WHERE scope = 'contest' DO NOTHING`,
          actor, command.contestId, actor)],
          audit: null,
          notify: [{ contestId: command.contestId, audiences: ['staff'] }],
          receipt: {},
        };
      case 'set_handle': {
        const { accountId, eventId, handle } = command;
        const account = await this.statement('SELECT handle FROM accounts WHERE id = ? AND event_id = ?', accountId, eventId)
          .first<{ handle: string | null }>();
        if (!account) throw new AuthenticationError(409, 'That account is not in this event. Refresh the page.');
        const allowed = await this.statement(`SELECT EXISTS (${manageHandleSql}) AS allowed`,
          ...manageHandleBindings(actor, accountId)).first<{ allowed: number }>();
        if (!allowed?.allowed) throw new AuthenticationError(403, cannotChangeAccount);
        if (await this.statement('SELECT 1 FROM accounts WHERE event_id = ? AND handle = ? AND id <> ?', eventId, handle, accountId).first()) {
          throw new AuthenticationError(409, usernameTaken);
        }
        return {
          // Only the handle changes. The login key and Better Auth stay, so
          // open sessions continue.
          statements: [
            assertions.check(manageHandleSql, ...manageHandleBindings(actor, accountId)),
            this.statement('UPDATE accounts SET handle = ? WHERE id = ? AND event_id = ?', handle, accountId, eventId),
            assertions.check('SELECT 1 WHERE changes() = 1'),
            // The 0017 takeover trigger checks this row under every Worker version.
            this.statement(`INSERT INTO account_operations (id, account_id, actor, action, state, completed_at)
              VALUES (?, ?, ?, 'set_username', 'completed', unixepoch())`, crypto.randomUUID(), accountId, actor),
          ],
          audit: { action: 'set_handle', target: accountId, detail: { from: account.handle, to: handle } },
          notify: [],
          receipt: {},
        };
      }
    }
  }
}
