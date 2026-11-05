import { z } from 'zod';
import {
  ISSUE_BATCH, parseEventCode, type ContestType, type EntrantKind, type EventConsole, type IssuedCredential,
  type LoginKey, type ManageCommand, type ManageLevel, type ManageReceipt, type SiteOverview,
} from '../../../backend/contracts';
import { categoriesMax, hasControlCharacter, rosterKey, rosterTextMax, teamsPerCommandMax } from '../../../connected/roster';
import { roleSchema, type Role } from '../../../connected/model';
import { AuthenticationError, type Caller } from '../../authentication';
import type { D1Connection, D1Statement, D1Value } from '../d1/connection';
import { currentReadyLoginBindings, currentReadyLoginSql, notificationStatements } from './application';
import {
  authorityGuard, contestsToJoinSql, eventAdminsSql, eventStaffSql, manageAccountBindings, manageAccountSql, manageHandleBindings, manageHandleSql,
  manageWebmasterSql, reaches, resolveAuthority, webmastersSql, type Authority, type Target,
} from './authority';
import { handleSchema, loginKeyFor, replaceCredentialStatements } from './credentials';
import { randomSecret, type PasswordHasher } from './password';

const noControl = (value: string) => !hasControlCharacter(value);
const nameSchema = z.string().trim().min(1).max(rosterTextMax).refine(noControl, 'Remove control characters.');
const locationSchema = z.string().trim().max(rosterTextMax).refine(noControl, 'Remove control characters.');
const distinct = (names: readonly string[]) => new Set(names.map(rosterKey)).size === names.length;
const personSchema = z.strictObject({ handle: handleSchema, name: nameSchema });
const eventCodeSchema = z.string().transform((text, context) => {
  const code = parseEventCode(text);
  if (!code) context.addIssue({ code: 'custom', message: 'Use 3 to 40 letters, digits, or hyphens.' });
  return code ?? z.NEVER;
});
const timeZoneSchema = z.string().trim().min(1).max(64).refine((zone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}, 'Use an IANA time zone name.');
const contestTypeSchema = z.enum(['singles', 'mixed', 'teams']);
const categoriesSchema = z.array(nameSchema).min(1).max(categoriesMax).refine(distinct, 'Category names must be different.');
const uuid = z.uuid();

const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('create_event'), name: nameSchema, code: eventCodeSchema, timeZone: timeZoneSchema, firstAdmin: personSchema,
  }),
  z.strictObject({ type: z.literal('add_webmaster'), person: personSchema }),
  z.strictObject({ type: z.literal('remove_webmaster'), accountId: uuid }),
  z.strictObject({ type: z.literal('set_webmaster_reads'), restricted: z.boolean() }),
  z.strictObject({
    type: z.literal('update_event'), eventId: uuid, name: nameSchema, code: eventCodeSchema, timeZone: timeZoneSchema,
  }),
  z.strictObject({ type: z.literal('set_event_admin'), eventId: uuid, accountId: uuid, admin: z.boolean() }),
  z.strictObject({
    type: z.literal('create_people'), eventId: uuid,
    people: z.array(personSchema).min(1).max(teamsPerCommandMax)
      .refine((people) => new Set(people.map((person) => person.handle)).size === people.length, 'Usernames must be different.'),
  }),
  z.strictObject({
    type: z.literal('create_entrants'), eventId: uuid,
    entrants: z.array(z.strictObject({ kind: z.enum(['team', 'single']), name: nameSchema, handle: handleSchema }))
      .min(1).max(teamsPerCommandMax)
      .refine((entrants) => distinct(entrants.map((entrant) => entrant.name)), 'Entrant names must be different.')
      .refine((entrants) => new Set(entrants.map((entrant) => entrant.handle)).size === entrants.length, 'Usernames must be different.'),
  }),
  z.strictObject({ type: z.literal('rename_entrant'), eventId: uuid, entrantId: uuid, name: nameSchema }),
  z.strictObject({ type: z.literal('add_entrant_sign_in'), eventId: uuid, entrantId: uuid, handle: handleSchema }),
  z.strictObject({
    type: z.literal('create_contest'), eventId: uuid, name: nameSchema, contestType: contestTypeSchema, categories: categoriesSchema,
  }),
  z.strictObject({ type: z.literal('update_contest'), contestId: uuid, name: nameSchema, contestType: contestTypeSchema }),
  z.strictObject({
    type: z.literal('assign_entrants'), contestId: uuid,
    entries: z.array(z.strictObject({ entrantId: uuid, location: locationSchema })).min(1).max(teamsPerCommandMax)
      .refine((entries) => new Set(entries.map((entry) => entry.entrantId)).size === entries.length),
  }),
  z.strictObject({ type: z.literal('unassign_entrant'), contestId: uuid, entrantId: uuid }),
  z.strictObject({
    type: z.literal('assign_staff'), contestId: uuid, accountId: uuid, admin: z.boolean(),
    roles: z.array(roleSchema).max(3).refine((roles) => new Set(roles).size === roles.length),
  }).refine((command) => command.admin || command.roles.length > 0),
  z.strictObject({ type: z.literal('unassign_staff'), contestId: uuid, accountId: uuid }),
  z.strictObject({ type: z.literal('set_intake'), contestId: uuid, open: z.boolean() }),
  z.strictObject({
    type: z.literal('set_image_limits'), contestId: uuid,
    fileMegabytes: z.number().int().min(1).max(50),
    count: z.number().int().min(1).max(24),
    totalMegabytes: z.number().int().min(1).max(120),
  }).refine((limits) => limits.fileMegabytes <= limits.totalMegabytes),
  z.strictObject({ type: z.literal('set_categories'), contestId: uuid, categories: categoriesSchema }),
  z.strictObject({ type: z.literal('set_location'), contestId: uuid, entrantId: uuid, location: locationSchema }),
  z.strictObject({ type: z.literal('join_contest'), contestId: uuid }),
  z.strictObject({ type: z.literal('set_handle'), eventId: uuid, accountId: uuid, handle: handleSchema }),
]) satisfies z.ZodType<ManageCommand>;
const issueSchema = z.strictObject({
  eventId: z.uuid().nullable(),
  accountIds: z.array(z.uuid()).min(1).max(ISSUE_BATCH)
    .refine((accountIds) => new Set(accountIds).size === accountIds.length),
});

/**
 * What a command needs: at least a level of authority over one target. Or,
 * for a change to one account, any authority in the account's event, and
 * the plan checks that account inside the batch.
 */
type ManageRequirement =
  | { readonly target: Target; readonly level: Exclude<ManageLevel, 'none'> }
  | { readonly target: { readonly scope: 'event'; readonly eventId: string }; readonly account: string };

const site = (): ManageRequirement => ({ target: { scope: 'site' }, level: 'site' });
const event = (id: string): ManageRequirement => ({ target: { scope: 'event', eventId: id }, level: 'event' });
const contest = (id: string, level: 'contest' | 'event' | 'site'): ManageRequirement =>
  ({ target: { scope: 'contest', contestId: id }, level });

/**
 * Each command's requirement, derived from the command alone. A new command
 * without a row fails to compile.
 */
export const requirementOf: {
  readonly [K in ManageCommand['type']]: (command: Extract<ManageCommand, { type: K }>) => ManageRequirement;
} = {
  create_event: site,
  add_webmaster: site,
  remove_webmaster: site,
  set_webmaster_reads: site,
  update_event: (command) => event(command.eventId),
  set_event_admin: (command) => event(command.eventId),
  create_people: (command) => event(command.eventId),
  create_entrants: (command) => event(command.eventId),
  rename_entrant: (command) => event(command.eventId),
  add_entrant_sign_in: (command) => event(command.eventId),
  create_contest: (command) => event(command.eventId),
  update_contest: (command) => contest(command.contestId, 'event'),
  assign_entrants: (command) => contest(command.contestId, 'event'),
  unassign_entrant: (command) => contest(command.contestId, 'event'),
  // Only event admins and webmasters assign people to contests.
  assign_staff: (command) => contest(command.contestId, 'event'),
  unassign_staff: (command) => contest(command.contestId, 'event'),
  set_intake: (command) => contest(command.contestId, 'contest'),
  set_image_limits: (command) => contest(command.contestId, 'contest'),
  set_categories: (command) => contest(command.contestId, 'contest'),
  set_location: (command) => contest(command.contestId, 'contest'),
  // Only a site grant resolves to `site` in a contest, so only webmasters join.
  join_contest: (command) => contest(command.contestId, 'site'),
  set_handle: (command) => ({ target: { scope: 'event', eventId: command.eventId }, account: command.accountId }),
};

function requirementFor(command: ManageCommand): ManageRequirement {
  // requirementOf is keyed by command type, so each row receives its own command.
  return (requirementOf[command.type] as (command: ManageCommand) => ManageRequirement)(command);
}

const deniedMessage: { readonly [L in Exclude<ManageLevel, 'none'>]: string } = {
  site: 'Only a webmaster can change the site.',
  event: 'Only an event admin or a webmaster can change this event.',
  contest: 'Only an admin of this contest, an event admin, or a webmaster can change this contest.',
};

/** What one command writes after the authority guard, in order. */
interface Plan {
  readonly statements: readonly D1Statement[];
  /** A record in authority_audit, of the target's event or of the site. Null when D1 writes the audit itself. */
  readonly audit: { readonly action: string; readonly target: string | null; readonly detail: object } | null;
  /** A record in admin_audit of the contest target, which the contest's activity list shows. */
  readonly contestAudit?: { readonly action: string; readonly target: string | null; readonly detail: object };
  /** Audiences per contest whose open screens refresh after the commit. */
  readonly notify: ReadonlyArray<{ readonly contestId: string; readonly audiences: readonly string[] }>;
  readonly receipt: ManageReceipt;
}

const lastWebmaster = 'The last webmaster cannot be removed.';
const joinNeedsRestriction = 'Turn on "Webmasters read contest data only after joining" before you join a contest.';
const usernameTaken = 'That username is taken. Choose another.';
const cannotChangeAccount = 'You cannot change this account.';
const codeTaken = 'That event code is taken. Choose another.';
const notInEvent = 'That account is not in this event. Refresh the page.';
const staleEntrant = 'That entrant is not in this event. Refresh the page.';
const typeExcludes = 'Remove the entrants that this contest type excludes first.';
const entrantDoesNotFit = 'This entrant does not fit this contest. Check the contest type.';

/** D1 refusals that tell a person what to change. Each rule lives in a D1 trigger or index. */
const refusals: ReadonlyArray<readonly [cause: string, message: string]> = [
  ['The last webmaster cannot be removed', lastWebmaster],
  ['Webmasters join a contest only while the site restricts their reads', joinNeedsRestriction],
  ['UNIQUE constraint failed: accounts.handle', usernameTaken],
  ['UNIQUE constraint failed: accounts.event_id, accounts.handle', usernameTaken],
  ['UNIQUE constraint failed: events.code', codeTaken],
  ['UNIQUE constraint failed: teams.session_id, teams.entrant_id', 'That entrant is already in this contest.'],
  ['This entrant cannot enter this contest', entrantDoesNotFit],
  ['Remove the entrants that this contest type excludes first', typeExcludes],
  ['An entrant sign-in holds only its own entries', 'An entrant sign-in cannot take a staff seat.'],
  ['An entrant sign-in holds no grant', 'An entrant sign-in cannot be an event admin.'],
  ['A contestant holds no staff role', 'A contestant cannot take a staff role.'],
  ['A contestant holds no admin seat', 'A contestant cannot be a contest admin.'],
  ['An account joins only contests of its own event', notInEvent],
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

interface CredentialRow {
  id: string;
  name: string;
  handle: string;
  loginKey: LoginKey;
  disabled: number;
  credential_generation: number;
  ready: number;
}

/**
 * The reads of the event console, one statement each. Every one starts from an
 * event index and binds the event ID once. The plan test pins them.
 */
export const eventConsoleSql = {
  event: 'SELECT id, name, code, time_zone, archived FROM events WHERE id = ?',
  admins: eventAdminsSql,
  people: `SELECT id, name, handle, credential_state = 'ready' AS ready FROM accounts
    WHERE event_id = ? AND entrant_id IS NULL ORDER BY name, id`,
  entrants: `SELECT en.id, en.kind, en.name, a.id AS account_id, a.handle FROM entrants en
    LEFT JOIN accounts a ON a.id = (SELECT id FROM accounts WHERE entrant_id = en.id ORDER BY rowid LIMIT 1)
    WHERE en.event_id = ? ORDER BY en.name, en.id`,
  contests: 'SELECT id, name, contest_type, intake_open FROM sessions WHERE event_id = ? ORDER BY name, id',
  staffAssignments: eventStaffSql,
  entries: `SELECT t.session_id AS contest_id, t.entrant_id, t.location FROM sessions s
    JOIN teams t ON t.session_id = s.id WHERE s.event_id = ? ORDER BY t.session_id, t.entrant_id`,
  audit: `SELECT id, actor_name, at, action, target FROM authority_audit WHERE event_id = ?
    ORDER BY at DESC, id DESC LIMIT 50`,
} as const;

/** The events of the site, with their counts. Reads the events and the account index only. */
export const siteEventsSql = `SELECT e.id, e.name, e.code, e.time_zone, e.archived,
    (SELECT count(*) FROM sessions s WHERE s.event_id = e.id) AS contests,
    (SELECT count(*) FROM accounts a WHERE a.event_id = e.id) AS accounts
  FROM events e ORDER BY e.name, e.id`;

/**
 * Site and event administration. Every change runs one path: parse, receipt
 * replay, requirement, authority, plan, then one D1 batch that checks the
 * authority again before its writes and stores the receipt with them.
 */
export class D1ManageService {
  constructor(private readonly db: D1Connection, private readonly passwords: PasswordHasher) {}

  private statement(sql: string, ...values: D1Value[]): D1Statement {
    return this.db.prepare(sql).bind(...values);
  }

  /** Null for a caller who is not a webmaster, so asking is not an error. */
  async site(caller: Caller): Promise<SiteOverview | null> {
    if (!(await resolveAuthority(this.db, caller, { scope: 'site' }))) return null;
    const [webmasters, restricted, contests, events] = await Promise.all([
      this.webmasters(),
      this.readsRestricted(),
      this.statement(contestsToJoinSql, caller.accountId).all<{ id: string; name: string; event_name: string }>(),
      this.statement(siteEventsSql).all<{
        id: string; name: string; code: string; time_zone: string; archived: number; contests: number; accounts: number;
      }>(),
    ]);
    return {
      webmasters: webmasters.map(({ id, name, handle, ready }) => ({ id, name, handle, ready: ready === 1 })),
      restrictWebmasterReads: restricted,
      events: events.results.map((row) => ({
        id: row.id, name: row.name, code: row.code, timeZone: row.time_zone, archived: row.archived === 1,
        contests: row.contests, accounts: row.accounts,
      })),
      contestsToJoin: contests.results.map((row) => ({ id: row.id, name: row.name, eventName: row.event_name })),
    };
  }

  /**
   * The console of one event. Requires an event admin of the event, or a
   * webmaster. Without an ID, the caller's own event, so an event admin whose
   * event has no contest yet still finds the console.
   */
  async event(caller: Caller, eventId?: string): Promise<EventConsole> {
    const id = eventId ?? (await this.statement('SELECT event_id FROM accounts WHERE id = ?', caller.accountId)
      .first<{ event_id: string | null }>())?.event_id;
    if (!id || !uuid.safeParse(id).success) throw new AuthenticationError(400, 'Choose an event.');
    const authority = await resolveAuthority(this.db, caller, { scope: 'event', eventId: id });
    if (!authority || !reaches(authority, 'event')) throw new AuthenticationError(403, deniedMessage.event);
    const read = <T>(sql: string) => this.statement(sql, id).all<T>().then((result) => result.results);
    const [events, admins, people, entrants, contests, assignments, entries, audit] = await Promise.all([
      read<{ id: string; name: string; code: string; time_zone: string; archived: number }>(eventConsoleSql.event),
      read<{ account_id: string }>(eventConsoleSql.admins),
      read<{ id: string; name: string; handle: string | null; ready: number }>(eventConsoleSql.people),
      read<{ id: string; kind: EntrantKind; name: string; account_id: string | null; handle: string | null }>(eventConsoleSql.entrants),
      read<{ id: string; name: string; contest_type: ContestType; intake_open: number }>(eventConsoleSql.contests),
      read<{ contest_id: string; account_id: string; is_admin: number; roles: string }>(eventConsoleSql.staffAssignments),
      read<{ contest_id: string; entrant_id: string; location: string }>(eventConsoleSql.entries),
      read<{ id: string; actor_name: string; at: string; action: string; target: string | null }>(eventConsoleSql.audit),
    ]);
    const [row] = events;
    if (!row) throw new AuthenticationError(409, 'That event does not exist. Refresh the page.');
    return {
      event: { id: row.id, name: row.name, code: row.code, timeZone: row.time_zone, archived: row.archived === 1 },
      manage: authority.manage,
      admins: admins.map((admin) => admin.account_id),
      people: people.map((person) => ({ id: person.id, name: person.name, handle: person.handle, ready: person.ready === 1 })),
      entrants: entrants.map((entrant) => ({
        id: entrant.id, kind: entrant.kind, name: entrant.name, accountId: entrant.account_id, handle: entrant.handle,
      })),
      contests: contests.map((item) => ({
        id: item.id, name: item.name, contestType: item.contest_type, intakeOpen: item.intake_open === 1,
      })),
      staffAssignments: assignments.map((item) => ({
        contestId: item.contest_id, accountId: item.account_id, admin: item.is_admin === 1, roles: JSON.parse(item.roles) as Role[],
      })),
      entries: entries.map((entry) => ({ contestId: entry.contest_id, entrantId: entry.entrant_id, location: entry.location })),
      audit: audit.map((item) => ({ id: item.id, actorName: item.actor_name, at: item.at, action: item.action, target: item.target })),
    };
  }

  async execute(caller: Caller, requestId: string, input: unknown): Promise<ManageReceipt> {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) throw new AuthenticationError(400, 'Check the change and try again.');
    const command = parsed.data;
    const record = JSON.stringify(command);
    const replayed = await this.replay(caller, requestId, record);
    if (replayed) return replayed;
    const requirement = requirementFor(command);
    const authority = await resolveAuthority(this.db, caller, requirement.target);
    // A contest that is gone resolves to no authority. A webmaster sees that as a missing contest, not a denial.
    if (!authority && command.type === 'join_contest' && (await resolveAuthority(this.db, caller, { scope: 'site' }))) {
      throw new AuthenticationError(409, 'That contest no longer exists. Refresh the page.');
    }
    if (!authority || ('level' in requirement && !reaches(authority, requirement.level))) {
      throw new AuthenticationError(403, 'level' in requirement ? deniedMessage[requirement.level] : cannotChangeAccount);
    }
    if (!authority.writable) throw new AuthenticationError(403, 'This event is archived.');
    const assertions = new Assertions(this.db);
    const plan = await this.plan(command, authority, assertions);
    return (await this.commit(authority, requestId, record, plan, assertions)).receipt;
  }

  /**
   * Issues a temporary password for each of up to ISSUE_BATCH accounts.
   * Without an event, the accounts are other webmasters. With an event, they
   * are accounts of the event that the caller may manage (`manageAccountSql`).
   * Hashing runs before one batch that holds every write. The passwords are
   * returned once and never stored. A retry of a committed request returns
   * the same accounts without passwords.
   */
  async issueCredentials(caller: Caller, requestId: string, input: unknown): Promise<IssuedCredential[]> {
    const parsed = issueSchema.safeParse(input);
    if (!parsed.success) throw new AuthenticationError(400, `Choose 1 to ${ISSUE_BATCH} different accounts.`);
    const { eventId: scope, accountIds } = parsed.data;
    const record = JSON.stringify({ type: 'issue_credentials', eventId: scope, accountIds });
    const replayed = await this.replay(caller, requestId, record);
    if (replayed) return this.issued(accountIds, new Map());
    if (accountIds.includes(caller.accountId)) throw new AuthenticationError(400, 'Use Change password for your own account.');
    const authority = await resolveAuthority(this.db, caller, scope === null ? { scope: 'site' } : { scope: 'event', eventId: scope });
    if (!authority) {
      throw new AuthenticationError(403, scope === null ? 'Only a webmaster can issue webmaster passwords.' : cannotChangeAccount);
    }
    if (!authority.writable) throw new AuthenticationError(403, 'This event is archived.');
    const targets = scope === null ? await this.webmasterTargets(accountIds) : await this.eventTargets(caller, scope, accountIds);
    const assertions = new Assertions(this.db);
    const passwords = new Map<string, string>();
    const statements: D1Statement[] = [];
    for (const target of targets) {
      const password = randomSecret() + 'A9!';
      passwords.set(target.id, password);
      const seats = await this.statement('SELECT session_id FROM memberships WHERE account_id = ?', target.id)
        .all<{ session_id: string }>();
      // A reset or a change of authority since the read fails the batch.
      const allowed = scope === null
        ? `${manageWebmasterSql} AND t.disabled = 0 AND t.credential_generation = ?`
        : `${manageAccountSql} AND t.event_id = ? AND t.disabled = 0 AND t.credential_generation = ?`;
      statements.push(
        assertions.check(allowed, ...manageAccountBindings(caller.accountId, target.id),
          ...(scope === null ? [] : [scope]), target.credential_generation),
        // An account from before login keys gets its key with its first password.
        ...(target.stored ? [] : [this.statement('UPDATE accounts SET username = ? WHERE id = ? AND username IS NULL', target.loginKey, target.id)]),
        ...replaceCredentialStatements(this.db, target, await this.passwords.hash(password),
          { operationId: crypto.randomUUID(), actor: caller.accountId, temporary: true }),
        // The activity list of each contest that seats the account shows the reset.
        ...seats.results.map((seat) => this.statement(`INSERT INTO admin_audit (id, session_id, actor, action, target)
          VALUES (?, ?, ?, 'reset_password', ?)`, crypto.randomUUID(), seat.session_id, caller.accountId, target.id)),
      );
    }
    const { replayed: lost } = await this.commit(authority, requestId, record, {
      statements,
      audit: { action: 'issue_passwords', target: null, detail: { accountIds } },
      notify: [],
      receipt: { accountIds },
    }, assertions);
    // A concurrent copy of this request committed first and stored other passwords. These were never stored.
    return this.issued(accountIds, lost ? new Map() : passwords);
  }

  private async webmasterTargets(accountIds: readonly string[]): Promise<Array<CredentialRow & { stored: boolean }>> {
    const targets = (await this.webmasters()).filter((webmaster) => accountIds.includes(webmaster.id));
    if (targets.length !== accountIds.length) {
      throw new AuthenticationError(409, 'That account is not a webmaster. Refresh the page.');
    }
    return targets.map((target) => ({ ...target, stored: true }));
  }

  private async eventTargets(caller: Caller, scope: string, accountIds: readonly string[]): Promise<Array<CredentialRow & { stored: boolean }>> {
    const targets: Array<CredentialRow & { stored: boolean }> = [];
    for (const id of accountIds) {
      const allowed = await this.statement(`${manageAccountSql} AND t.event_id = ?`, ...manageAccountBindings(caller.accountId, id), scope)
        .first();
      if (!allowed) throw new AuthenticationError(403, cannotChangeAccount);
      const row = await this.statement(`SELECT id, name, COALESCE(handle, '') AS handle, username AS login_key, disabled,
          credential_generation, credential_state = 'ready' AS ready FROM accounts WHERE id = ?`, id)
        .first<Omit<CredentialRow, 'loginKey'> & { login_key: LoginKey | null }>();
      if (!row || row.disabled === 1) throw new AuthenticationError(409, 'That account is disabled. Refresh the page.');
      if (!row.handle) throw new AuthenticationError(409, 'Set a username before issuing this account a password.');
      const { login_key, ...rest } = row;
      targets.push({ ...rest, loginKey: login_key ?? loginKeyFor(id), stored: login_key !== null });
    }
    return targets;
  }

  private async issued(accountIds: readonly string[], passwords: ReadonlyMap<string, string>): Promise<IssuedCredential[]> {
    const accounts = await this.statement(`SELECT id, COALESCE(handle, '') AS handle FROM accounts
      WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(accountIds)).all<{ id: string; handle: string }>();
    const handles = new Map(accounts.results.map((account) => [account.id, account.handle]));
    return accountIds.map((id) => ({
      accountId: id, handle: handles.get(id) ?? '', temporaryPassword: passwords.get(id) ?? null,
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
   * concurrent copy of the request stored still answers it, and `replayed` says so.
   */
  private async commit(authority: Authority, requestId: string, record: string, plan: Plan, assertions: Assertions): Promise<{ receipt: ManageReceipt; replayed: boolean }> {
    const { caller } = authority;
    const statements = [
      assertions.authority(authority),
      ...plan.statements,
      ...(plan.audit ? [this.statement(`INSERT INTO authority_audit (id, event_id, actor, actor_name, action, target, detail)
        SELECT ?, ?, id, name, ?, ?, ? FROM accounts WHERE id = ?`, crypto.randomUUID(), authority.eventId, plan.audit.action,
      plan.audit.target, JSON.stringify(plan.audit.detail), caller.accountId)] : []),
      ...(plan.contestAudit && authority.target.scope === 'contest' ? [
        this.statement('INSERT INTO admin_audit (id, session_id, actor, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)',
          crypto.randomUUID(), authority.target.contestId, caller.accountId, plan.contestAudit.action,
          plan.contestAudit.target, JSON.stringify(plan.contestAudit.detail))] : []),
      this.statement('INSERT INTO manage_receipts (actor, request_id, command, result) VALUES (?, ?, ?, ?)',
        caller.accountId, requestId, record, JSON.stringify(plan.receipt)),
      ...plan.notify.flatMap(({ contestId: notified, audiences }) => notificationStatements(this.db, notified, audiences)),
      assertions.login(caller),
      assertions.cleanup(),
    ];
    try {
      await this.db.batch(statements);
    } catch (error) {
      const replayed = await this.replay(caller, requestId, record);
      if (replayed) return { receipt: replayed, replayed: true };
      throw refusal(error);
    }
    return { receipt: plan.receipt, replayed: false };
  }

  private async webmasters(): Promise<CredentialRow[]> {
    const rows = await this.statement(webmastersSql).all<Omit<CredentialRow, 'loginKey'> & { login_key: LoginKey }>();
    return rows.results.map(({ login_key, ...row }) => ({ ...row, loginKey: login_key }));
  }

  private async readsRestricted(): Promise<boolean> {
    const row = await this.statement('SELECT restrict_webmaster_reads FROM site_settings WHERE singleton = 1')
      .first<{ restrict_webmaster_reads: number }>();
    return row?.restrict_webmaster_reads === 1;
  }

  /** Staff and every entry of a contest, for the commands that change what all of them see. */
  private async contestAudiences(contestId: string): Promise<string[]> {
    const teams = await this.statement('SELECT id FROM teams WHERE session_id = ?', contestId).all<{ id: string }>();
    return ['staff', ...teams.results.map((team) => `team:${team.id}`)];
  }

  /** The handles that already name an account of the event, among the candidates. */
  private async takenHandles(eventScope: string, handles: readonly string[]): Promise<string[]> {
    const rows = await this.statement(`SELECT handle FROM accounts WHERE event_id = ?
      AND handle IN (SELECT value FROM json_each(?))`, eventScope, JSON.stringify(handles)).all<{ handle: string }>();
    return rows.results.map((row) => row.handle);
  }

  private async plan(command: ManageCommand, authority: Authority, assertions: Assertions): Promise<Plan> {
    const actor = authority.caller.accountId;
    // Contest commands and event commands both carry an authority with the target's event.
    const scope = authority.eventId ?? '';
    switch (command.type) {
      case 'create_event': {
        const { name, code, timeZone, firstAdmin } = command;
        if (await this.statement('SELECT 1 FROM events WHERE code = ?', code).first()) throw new AuthenticationError(409, codeTaken);
        const newEvent = crypto.randomUUID();
        const adminId = crypto.randomUUID();
        return {
          statements: [
            this.statement('INSERT INTO events (id, name, code, time_zone) VALUES (?, ?, ?, ?)', newEvent, name, code, timeZone),
            // The account cannot sign in until issueCredentials gives it a password.
            this.statement(`INSERT INTO accounts (id, name, username, handle, event_id, must_change, credential_state)
              VALUES (?, ?, ?, ?, ?, 1, 'pending')`, adminId, firstAdmin.name, loginKeyFor(adminId), firstAdmin.handle, newEvent),
            this.statement(`INSERT INTO grants (account_id, scope, event_id, granted_by) VALUES (?, 'event', ?, ?)`, adminId, newEvent, actor),
          ],
          audit: { action: 'create_event', target: newEvent, detail: { name, code, timeZone } },
          notify: [],
          receipt: { eventId: newEvent, accountIds: [adminId] },
        };
      }
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
      case 'update_event': {
        const current = await this.statement('SELECT name, code, time_zone FROM events WHERE id = ?', command.eventId)
          .first<{ name: string; code: string; time_zone: string }>();
        if (!current) throw new AuthenticationError(409, 'That event no longer exists. Refresh the page.');
        if (await this.statement('SELECT 1 FROM events WHERE code = ? AND id <> ?', command.code, command.eventId).first()) {
          throw new AuthenticationError(409, codeTaken);
        }
        return {
          statements: [
            this.statement('UPDATE events SET name = ?, code = ?, time_zone = ? WHERE id = ?',
              command.name, command.code, command.timeZone, command.eventId),
            assertions.check('SELECT 1 WHERE changes() = 1'),
          ],
          audit: {
            action: 'update_event', target: null,
            detail: { from: { name: current.name, code: current.code, timeZone: current.time_zone },
              to: { name: command.name, code: command.code, timeZone: command.timeZone } },
          },
          notify: [],
          receipt: {},
        };
      }
      case 'set_event_admin': {
        const account = await this.statement('SELECT event_id, entrant_id FROM accounts WHERE id = ?', command.accountId)
          .first<{ event_id: string | null; entrant_id: string | null }>();
        if (!account || account.event_id !== command.eventId) throw new AuthenticationError(409, notInEvent);
        if (command.admin && account.entrant_id) throw new AuthenticationError(409, 'An entrant sign-in cannot be an event admin.');
        return {
          statements: [
            assertions.check('SELECT 1 FROM accounts WHERE id = ? AND event_id = ?', command.accountId, command.eventId),
            command.admin
              ? this.statement(`INSERT INTO grants (account_id, scope, event_id, granted_by) VALUES (?, 'event', ?, ?)
                  ON CONFLICT (event_id, account_id) WHERE scope = 'event' DO NOTHING`, command.accountId, command.eventId, actor)
              : this.statement(`DELETE FROM grants WHERE scope = 'event' AND event_id = ? AND account_id = ?`,
                command.eventId, command.accountId),
          ],
          audit: { action: 'set_event_admin', target: command.accountId, detail: { admin: command.admin } },
          notify: [],
          receipt: {},
        };
      }
      case 'create_people': {
        const taken = await this.takenHandles(command.eventId, command.people.map((person) => person.handle));
        if (taken.length > 0) throw new AuthenticationError(409, `The username "${taken[0]}" is taken. Choose another.`);
        const people = command.people.map((person) => ({ ...person, id: crypto.randomUUID() }));
        return {
          statements: [
            // The accounts cannot sign in until issueCredentials gives each a password.
            this.statement(`INSERT INTO accounts (id, name, username, handle, event_id, must_change, credential_state)
              SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.key'),
                json_extract(value, '$.handle'), ?, 1, 'pending' FROM json_each(?)`, command.eventId,
            JSON.stringify(people.map((person) => ({ id: person.id, name: person.name, handle: person.handle, key: loginKeyFor(person.id) })))),
            assertions.check('SELECT 1 WHERE changes() = ?', people.length),
          ],
          audit: { action: 'create_people', target: null, detail: { count: people.length } },
          notify: [],
          receipt: { accountIds: people.map((person) => person.id) },
        };
      }
      case 'create_entrants': {
        const names = (await this.statement('SELECT name FROM entrants WHERE event_id = ?', command.eventId).all<{ name: string }>()).results;
        const used = new Set(names.map((row) => rosterKey(row.name)));
        const clash = command.entrants.find((entrant) => used.has(rosterKey(entrant.name)));
        if (clash) throw new AuthenticationError(409, `An entrant named "${clash.name}" already exists.`);
        const taken = await this.takenHandles(command.eventId, command.entrants.map((entrant) => entrant.handle));
        if (taken.length > 0) throw new AuthenticationError(409, `The username "${taken[0]}" is taken. Choose another.`);
        const entrants = command.entrants.map((entrant) => ({ ...entrant, id: crypto.randomUUID(), accountId: crypto.randomUUID() }));
        const rows = JSON.stringify(entrants.map((entrant) => ({
          id: entrant.id, kind: entrant.kind, name: entrant.name, accountId: entrant.accountId,
          handle: entrant.handle, key: loginKeyFor(entrant.accountId),
        })));
        return {
          statements: [
            this.statement(`INSERT INTO entrants (id, event_id, kind, name)
              SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.kind'), json_extract(value, '$.name')
              FROM json_each(?)`, command.eventId, rows),
            // Names are unique inside the event, ignoring case. The new rows are the only ones that match their own names.
            assertions.check(`SELECT 1 WHERE (SELECT count(*) FROM entrants WHERE event_id = ?
              AND lower(trim(name)) IN (SELECT lower(trim(json_extract(value, '$.name'))) FROM json_each(?))) = ?`,
            command.eventId, rows, entrants.length),
            // Each entrant owns one sign-in. A team shares it among its members.
            this.statement(`INSERT INTO accounts (id, name, username, handle, event_id, entrant_id, must_change, credential_state)
              SELECT json_extract(value, '$.accountId'), json_extract(value, '$.name'), json_extract(value, '$.key'),
                json_extract(value, '$.handle'), ?, json_extract(value, '$.id'), 1, 'pending' FROM json_each(?)`,
            command.eventId, rows),
          ],
          audit: { action: 'create_entrants', target: null, detail: { count: entrants.length } },
          notify: [],
          receipt: { entrantIds: entrants.map((entrant) => entrant.id), accountIds: entrants.map((entrant) => entrant.accountId) },
        };
      }
      case 'rename_entrant': {
        const current = await this.statement('SELECT name FROM entrants WHERE id = ? AND event_id = ?', command.entrantId, command.eventId)
          .first<{ name: string }>();
        if (!current) throw new AuthenticationError(409, staleEntrant);
        const others = (await this.statement('SELECT name FROM entrants WHERE event_id = ? AND id <> ?', command.eventId, command.entrantId)
          .all<{ name: string }>()).results;
        if (others.some((row) => rosterKey(row.name) === rosterKey(command.name))) {
          throw new AuthenticationError(409, `An entrant named "${command.name}" already exists.`);
        }
        const entries = (await this.statement('SELECT session_id, id FROM teams WHERE entrant_id = ?', command.entrantId)
          .all<{ session_id: string; id: string }>()).results;
        return {
          statements: [
            // D1 renames the entrant's entry in every contest, and a shared sign-in that carries the old name.
            this.statement('UPDATE entrants SET name = ? WHERE id = ? AND event_id = ?', command.name, command.entrantId, command.eventId),
            assertions.check('SELECT 1 WHERE changes() = 1'),
            assertions.check(`SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM entrants WHERE event_id = ? AND id <> ?
              AND lower(trim(name)) = lower(trim(?)))`, command.eventId, command.entrantId, command.name),
          ],
          audit: { action: 'rename_entrant', target: null, detail: { entrant: command.entrantId, from: current.name, to: command.name } },
          notify: entries.map((entry) => ({ contestId: entry.session_id, audiences: ['staff', `team:${entry.id}`] })),
          receipt: {},
        };
      }
      case 'add_entrant_sign_in': {
        const { eventId: scopeEvent, entrantId, handle } = command;
        const entrant = await this.statement('SELECT name FROM entrants WHERE id = ? AND event_id = ?', entrantId, scopeEvent)
          .first<{ name: string }>();
        if (!entrant) throw new AuthenticationError(409, staleEntrant);
        if (await this.statement('SELECT 1 FROM accounts WHERE entrant_id = ?', entrantId).first()) {
          throw new AuthenticationError(409, 'That entrant already has a sign-in. Refresh the page.');
        }
        if ((await this.takenHandles(scopeEvent, [handle])).length > 0) throw new AuthenticationError(409, usernameTaken);
        const accountId = crypto.randomUUID();
        return {
          statements: [
            assertions.check('SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE entrant_id = ?)', entrantId),
            // D1 seats the new sign-in in each entry of the entrant. It has no password until issueCredentials.
            this.statement(`INSERT INTO accounts (id, name, username, handle, event_id, entrant_id, must_change, credential_state)
              VALUES (?, ?, ?, ?, ?, ?, 1, 'pending')`, accountId, entrant.name, loginKeyFor(accountId), handle, scopeEvent, entrantId),
          ],
          audit: { action: 'add_entrant_sign_in', target: accountId, detail: { entrant: entrantId, handle } },
          notify: [],
          receipt: { entrantIds: [entrantId], accountIds: [accountId] },
        };
      }
      case 'create_contest': {
        const newContest = crypto.randomUUID();
        return {
          statements: [
            this.statement('INSERT INTO sessions (id, event_id, name, contest_type, categories) VALUES (?, ?, ?, ?, ?)',
              newContest, command.eventId, command.name, command.contestType, JSON.stringify(command.categories)),
          ],
          audit: { action: 'create_contest', target: null, detail: { contest: newContest, name: command.name, contestType: command.contestType } },
          notify: [],
          receipt: { contestId: newContest },
        };
      }
      case 'update_contest': {
        const current = await this.statement('SELECT name, contest_type FROM sessions WHERE id = ?', command.contestId)
          .first<{ name: string; contest_type: ContestType }>();
        if (!current) throw new AuthenticationError(409, 'That contest no longer exists. Refresh the page.');
        if (current.contest_type !== command.contestType && await this.entriesExcludedBy(command.contestId, command.contestType)) {
          throw new AuthenticationError(409, typeExcludes);
        }
        return {
          // D1 refuses a contest type that excludes an entry, and it counts the change in the contest version.
          statements: [
            this.statement('UPDATE sessions SET name = ?, contest_type = ? WHERE id = ?', command.name, command.contestType, command.contestId),
            assertions.check('SELECT 1 WHERE changes() = 1'),
          ],
          audit: { action: 'update_contest', target: null,
            detail: { contest: command.contestId, from: { name: current.name, contestType: current.contest_type },
              to: { name: command.name, contestType: command.contestType } } },
          contestAudit: { action: 'update_contest', target: null,
            detail: { from: { name: current.name, contestType: current.contest_type }, to: { name: command.name, contestType: command.contestType } } },
          notify: [{ contestId: command.contestId, audiences: await this.contestAudiences(command.contestId) }],
          receipt: {},
        };
      }
      case 'assign_entrants': {
        const ids = command.entries.map((entry) => entry.entrantId);
        const listed = JSON.stringify(ids);
        const [found, entered, type] = await Promise.all([
          this.statement('SELECT id, kind, name FROM entrants WHERE event_id = ? AND id IN (SELECT value FROM json_each(?))', scope, listed)
            .all<{ id: string; kind: EntrantKind; name: string }>(),
          this.statement('SELECT entrant_id FROM teams WHERE session_id = ? AND entrant_id IN (SELECT value FROM json_each(?))',
            command.contestId, listed).all<{ entrant_id: string }>(),
          this.statement('SELECT contest_type FROM sessions WHERE id = ?', command.contestId).first<{ contest_type: ContestType }>(),
        ]);
        const entrants = new Map(found.results.map((row) => [row.id, row]));
        if (!type || entrants.size !== ids.length) throw new AuthenticationError(409, staleEntrant);
        const already = entered.results[0];
        if (already) throw new AuthenticationError(409, `${entrants.get(already.entrant_id)?.name ?? 'That entrant'} is already in this contest.`);
        const misfit = found.results.find((row) => !fits(type.contest_type, row.kind));
        if (misfit) throw new AuthenticationError(409, `${misfit.name} does not fit this contest. It takes ${takes[type.contest_type]}.`);
        const entries = command.entries.map((entry) => ({
          id: crypto.randomUUID(), entrantId: entry.entrantId, location: entry.location,
        }));
        return {
          statements: [
            // D1 seats each entrant's sign-in and checks the contest type.
            this.statement(`INSERT INTO teams (id, session_id, entrant_id, name, location)
              SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.entrantId'),
                (SELECT name FROM entrants WHERE id = json_extract(value, '$.entrantId')), json_extract(value, '$.location')
              FROM json_each(?)`,
            command.contestId, JSON.stringify(entries)),
            assertions.check('SELECT 1 WHERE changes() = ?', entries.length),
          ],
          audit: { action: 'assign_entrants', target: null, detail: { contest: command.contestId, count: entries.length } },
          contestAudit: { action: 'assign_entrants', target: null, detail: { count: entries.length } },
          notify: [{ contestId: command.contestId, audiences: ['staff'] }],
          receipt: { contestId: command.contestId, entrantIds: ids },
        };
      }
      case 'unassign_entrant': {
        const entry = await this.statement(`SELECT t.id, t.name, (SELECT count(*) FROM issues i WHERE i.session_id = t.session_id
            AND i.team_id = t.id) AS issues FROM teams t WHERE t.session_id = ? AND t.entrant_id = ?`, command.contestId, command.entrantId)
          .first<{ id: string; name: string; issues: number }>();
        if (!entry) throw new AuthenticationError(409, 'That entrant is not in this contest. Refresh the page.');
        if (entry.issues > 0) {
          throw new AuthenticationError(409, `${entry.name} has ${entry.issues} ${entry.issues === 1 ? 'issue' : 'issues'} and stays in the contest.`);
        }
        const account = await this.statement('SELECT id FROM accounts WHERE entrant_id = ?', command.entrantId).all<{ id: string }>();
        return {
          statements: [
            assertions.check('SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM issues WHERE session_id = ? AND team_id = ?)', command.contestId, entry.id),
            // D1 removes the entrant's seats in this contest.
            this.statement('DELETE FROM teams WHERE id = ? AND session_id = ? AND entrant_id = ?', entry.id, command.contestId, command.entrantId),
            assertions.check('SELECT 1 WHERE changes() = 1'),
          ],
          audit: { action: 'unassign_entrant', target: null, detail: { contest: command.contestId, entrant: command.entrantId } },
          contestAudit: { action: 'unassign_entrant', target: null, detail: { entrant: command.entrantId, name: entry.name } },
          notify: [{ contestId: command.contestId, audiences: ['staff', `team:${entry.id}`, ...account.results.map((row) => `account:${row.id}`)] }],
          receipt: { contestId: command.contestId, entrantIds: [command.entrantId] },
        };
      }
      case 'assign_staff': {
        const account = await this.statement('SELECT event_id, entrant_id FROM accounts WHERE id = ?', command.accountId)
          .first<{ event_id: string | null; entrant_id: string | null }>();
        if (!account || account.event_id !== scope) throw new AuthenticationError(409, notInEvent);
        if (account.entrant_id) throw new AuthenticationError(409, 'An entrant sign-in cannot take a staff seat.');
        const roles = [...new Set(command.roles)];
        return {
          statements: [
            assertions.check('SELECT 1 FROM accounts WHERE id = ? AND event_id = ? AND entrant_id IS NULL', command.accountId, scope),
            this.statement(`INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, NULL, ?)
              ON CONFLICT (session_id, account_id) DO UPDATE SET team_id = NULL, is_admin = excluded.is_admin`,
            command.contestId, command.accountId, Number(command.admin)),
            this.statement('DELETE FROM membership_roles WHERE session_id = ? AND account_id = ?', command.contestId, command.accountId),
            this.statement('INSERT INTO membership_roles (session_id, account_id, role) SELECT ?, ?, value FROM json_each(?)',
              command.contestId, command.accountId, JSON.stringify(roles)),
            this.statement('UPDATE sessions SET version = version + 1 WHERE id = ?', command.contestId),
          ],
          audit: { action: 'assign_staff', target: command.accountId, detail: { contest: command.contestId, roles, admin: command.admin } },
          contestAudit: { action: 'assign_membership', target: command.accountId, detail: { team: null, roles, admin: command.admin } },
          notify: [{ contestId: command.contestId, audiences: ['staff', `account:${command.accountId}`] }],
          receipt: { contestId: command.contestId },
        };
      }
      case 'unassign_staff': {
        const seat = await this.statement('SELECT 1 FROM memberships WHERE session_id = ? AND account_id = ? AND team_id IS NULL',
          command.contestId, command.accountId).first();
        if (!seat) throw new AuthenticationError(409, 'That account has no staff seat in this contest. Refresh the page.');
        return {
          statements: [
            this.statement('DELETE FROM memberships WHERE session_id = ? AND account_id = ? AND team_id IS NULL', command.contestId, command.accountId),
            assertions.check('SELECT 1 WHERE changes() = 1'),
            this.statement('UPDATE sessions SET version = version + 1 WHERE id = ?', command.contestId),
          ],
          audit: { action: 'unassign_staff', target: command.accountId, detail: { contest: command.contestId } },
          contestAudit: { action: 'revoke_membership', target: command.accountId, detail: { team: null, roles: [], admin: false } },
          notify: [{ contestId: command.contestId, audiences: ['staff', `account:${command.accountId}`] }],
          receipt: { contestId: command.contestId },
        };
      }
      case 'set_intake':
        return {
          statements: [this.statement('UPDATE sessions SET intake_open = ? WHERE id = ?', Number(command.open), command.contestId)],
          audit: null,
          contestAudit: { action: 'set_intake', target: null, detail: { open: command.open } },
          notify: [{ contestId: command.contestId, audiences: await this.contestAudiences(command.contestId) }],
          receipt: {},
        };
      case 'set_image_limits':
        return {
          statements: [this.statement(`UPDATE sessions SET max_image_bytes = ?, max_images_per_issue = ?,
            max_image_bytes_per_issue = ? WHERE id = ?`, command.fileMegabytes * 1048576, command.count,
          command.totalMegabytes * 1048576, command.contestId)],
          audit: null,
          contestAudit: { action: 'set_image_limits', target: null,
            detail: { file_mb: command.fileMegabytes, count: command.count, total_mb: command.totalMegabytes } },
          notify: [{ contestId: command.contestId, audiences: await this.contestAudiences(command.contestId) }],
          receipt: {},
        };
      case 'set_categories': {
        const kept = new Set(command.categories);
        const used = (await this.statement(`SELECT category, count(*) AS issues FROM issues
          WHERE session_id = ? AND category <> '' GROUP BY category ORDER BY category`, command.contestId)
          .all<{ category: string; issues: number }>()).results;
        const stuck = used.filter((row) => !kept.has(row.category));
        const [first] = stuck;
        if (first) {
          throw new AuthenticationError(409, `${first.category} has ${first.issues} ${first.issues === 1 ? 'issue' : 'issues'} and stays in the list.${
            stuck.length > 1 ? ` ${stuck.length - 1} more ${stuck.length === 2 ? 'category stays' : 'categories stay'} too.` : ''}`);
        }
        return {
          statements: [
            this.statement('UPDATE sessions SET categories = ? WHERE id = ?', JSON.stringify(command.categories), command.contestId),
            assertions.check(`SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM issues WHERE session_id = ? AND category <> ''
              AND category NOT IN (SELECT value FROM json_each(?)))`, command.contestId, JSON.stringify(command.categories)),
          ],
          audit: null,
          contestAudit: { action: 'set_categories', target: null, detail: { categories: command.categories } },
          notify: [{ contestId: command.contestId, audiences: await this.contestAudiences(command.contestId) }],
          receipt: {},
        };
      }
      case 'set_location': {
        const entry = await this.statement('SELECT id, name, location FROM teams WHERE session_id = ? AND entrant_id = ?',
          command.contestId, command.entrantId).first<{ id: string; name: string; location: string }>();
        if (!entry) throw new AuthenticationError(409, 'That entrant is not in this contest. Refresh the page.');
        return {
          statements: [
            this.statement('UPDATE teams SET location = ? WHERE id = ? AND session_id = ?', command.location, entry.id, command.contestId),
            assertions.check('SELECT 1 WHERE changes() = 1'),
          ],
          audit: null,
          contestAudit: { action: 'set_location', target: null, detail: { entrant: command.entrantId, name: entry.name, from: entry.location, to: command.location } },
          notify: [{ contestId: command.contestId, audiences: ['staff', `team:${entry.id}`] }],
          receipt: {},
        };
      }
      case 'set_handle': {
        const { accountId: target, eventId: scopeEvent, handle } = command;
        const account = await this.statement(`SELECT handle, (SELECT json_group_array(session_id) FROM memberships
            WHERE account_id = a.id) AS contests FROM accounts a WHERE id = ? AND event_id = ?`, target, scopeEvent)
          .first<{ handle: string | null; contests: string }>();
        if (!account) throw new AuthenticationError(409, notInEvent);
        const allowed = await this.statement(`SELECT EXISTS (${manageHandleSql}) AS allowed`,
          ...manageHandleBindings(actor, target)).first<{ allowed: number }>();
        if (!allowed?.allowed) throw new AuthenticationError(403, cannotChangeAccount);
        if (await this.statement('SELECT 1 FROM accounts WHERE event_id = ? AND handle = ? AND id <> ?', scopeEvent, handle, target).first()) {
          throw new AuthenticationError(409, usernameTaken);
        }
        return {
          // Only the handle changes. The login key and Better Auth stay, so
          // open sessions continue.
          statements: [
            assertions.check(manageHandleSql, ...manageHandleBindings(actor, target)),
            this.statement('UPDATE accounts SET handle = ? WHERE id = ? AND event_id = ?', handle, target, scopeEvent),
            assertions.check('SELECT 1 WHERE changes() = 1'),
            // The 0017 takeover trigger checks this row under every Worker version.
            this.statement(`INSERT INTO account_operations (id, account_id, actor, action, state, completed_at)
              VALUES (?, ?, ?, 'set_username', 'completed', unixepoch())`, crypto.randomUUID(), target, actor),
          ],
          audit: { action: 'set_handle', target, detail: { from: account.handle, to: handle } },
          // Staff read the handle in each contest that seats the account.
          notify: (JSON.parse(account.contests) as string[])
            .map((notified) => ({ contestId: notified, audiences: ['staff', `account:${target}`] })),
          receipt: {},
        };
      }
    }
  }

  /** Whether a contest holds an entry that `contestType` would exclude. */
  private async entriesExcludedBy(contestId: string, contestType: ContestType): Promise<boolean> {
    const kinds = await this.statement(`SELECT DISTINCT e.kind FROM teams t JOIN entrants e ON e.id = t.entrant_id
      WHERE t.session_id = ?`, contestId).all<{ kind: EntrantKind }>();
    return kinds.results.some((row) => !fits(contestType, row.kind));
  }
}

/** The contest type rule that D1 repeats in `entry_fits_contest`. */
function fits(contestType: ContestType, kind: EntrantKind): boolean {
  return contestType === 'mixed' || (contestType === 'teams') === (kind === 'team');
}

const takes: { readonly [T in ContestType]: string } = {
  singles: 'single contestants', mixed: 'teams and single contestants', teams: 'teams',
};
