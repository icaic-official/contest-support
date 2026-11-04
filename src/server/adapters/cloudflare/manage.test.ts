import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { EventCode, Handle, ManageCommand, SignInTarget } from '../../../backend/contracts';
import type { Caller } from '../../authentication';
import type { D1Binding, D1Connection, D1Value } from '../d1/connection';
import { applyMigrations } from '../d1/testFixture';
import { D1ApplicationService } from './application';
import { D1AuthenticationService } from './authentication';
import { createBetterAuthIdentity } from './identity';
import { loginKeyFor } from './credentials';
import { D1ManageService, requirementOf } from './manage';
import { passwordHasher, randomSecret, type PasswordHasher } from './password';

const testSchedule = { startsAt: '2030-01-01T09:00:00.000Z', endsAt: '2030-01-01T11:00:00.000Z', graceMinutes: 0 };

const people = ['first', 'second', 'contestAdmin'] as const;
const fastPasswords: PasswordHasher = { hash: async () => 'fictional-test-hash', verify: async () => false };
type Person = typeof people[number];

describe('site commands for webmasters', () => {
  let db: D1Binding;
  let dispose: (() => Promise<void>) | undefined;
  let manage: D1ManageService;
  let application: D1ApplicationService;
  const callers = new Map<Person, Caller>();
  const caller = (person: Person) => callers.get(person)!;
  const ids = { event: '', contest: '', otherContest: '' };

  const run = (sql: string, ...values: D1Value[]) => db.prepare(sql).bind(...values).run();
  const rows = async <T>(sql: string, ...values: D1Value[]) => (await db.prepare(sql).bind(...values).all<T>()).results;
  const siteOf = async (person: Person) => {
    const site = await manage.site(caller(person));
    if (!site) throw new Error(`${person} is not a webmaster.`);
    return site;
  };
  const execute = (person: Person, command: ManageCommand, requestId: string = randomUUID()) =>
    manage.execute(caller(person), requestId, command);

  beforeEach(async () => {
    // Every case owns a fresh local database, because the last-webmaster rule counts the whole site.
    const platform = await getPlatformProxy<{ DB: D1Binding }>({
      configPath: 'wrangler.auth-ci.jsonc', persist: false, remoteBindings: false, envFiles: [],
    });
    db = platform.env.DB;
    dispose = platform.dispose;
    await applyMigrations(db);
    manage = new D1ManageService(db, fastPasswords);
    application = new D1ApplicationService(db);
    Object.assign(ids, { event: randomUUID(), contest: randomUUID(), otherContest: randomUUID() });
    await run('INSERT INTO events (id, name) VALUES (?, ?)', ids.event, 'Fictional event');
    await run(`INSERT INTO sessions (id, event_id, name) VALUES (?, ?, 'Live 1'), (?, ?, 'Live 2')`,
      ids.contest, ids.event, ids.otherContest, ids.event);
    const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
    for (const person of people) {
      const account = { accountId: randomUUID(), loginId: randomUUID() };
      callers.set(person, account);
      await run('INSERT INTO accounts (id, name, username, must_change) VALUES (?, ?, ?, 0)',
        account.accountId, `Fictional ${person}`, person.toLowerCase());
      await run(`INSERT INTO ba_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ${now}, ${now})`,
        account.accountId, person, `${account.accountId}@manage.minsky.invalid`);
      await run(`INSERT INTO ba_session (id, userId, token, expiresAt, createdAt, updatedAt)
        VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'), ${now}, ${now})`,
      account.loginId, account.accountId, randomUUID());
      await run('INSERT INTO logins (id, account_id, expires_at, identity_session_id) VALUES (?, ?, unixepoch() + 3600, ?)',
        account.loginId, account.accountId, account.loginId);
    }
    for (const person of ['first', 'second'] as const) {
      await run(`INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', 'fixture')`, caller(person).accountId);
    }
    await run('INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, 1)', ids.contest, caller('contestAdmin').accountId);
  }, 120_000);

  afterEach(async () => { await dispose?.(); }, 120_000);

  it('adds a webmaster who waits for a password, and answers a retry with the first receipt', async () => {
    const requestId = randomUUID();
    const command: ManageCommand = { type: 'add_webmaster', person: { handle: 'New-Webmaster', name: 'Fictional newcomer' } };
    const receipt = await execute('first', command, requestId);
    expect(receipt.accountIds).toHaveLength(1);
    const [added] = receipt.accountIds!;
    expect(await execute('first', command, requestId)).toEqual(receipt);
    expect((await siteOf('first')).webmasters).toContainEqual(
      { id: added, name: 'Fictional newcomer', handle: 'new-webmaster', ready: false });
    expect(await rows('SELECT action, actor, actor_name, target, event_id FROM authority_audit')).toEqual([{
      action: 'add_webmaster', actor: caller('first').accountId, actor_name: 'Fictional first', target: added, event_id: null,
    }]);
    await expect(execute('first', { type: 'set_webmaster_reads', restricted: true }, requestId))
      .rejects.toMatchObject({ status: 409, message: 'This request was already used for another change. Refresh and try again.' });
    await expect(execute('second', { type: 'add_webmaster', person: { handle: 'new-webmaster', name: 'Copy' } }))
      .rejects.toMatchObject({ status: 409, message: 'That username is taken. Choose another.' });
    expect(await rows("SELECT count(*) AS n FROM accounts WHERE handle = 'new-webmaster'")).toEqual([{ n: 1 }]);
    // The new webmaster types the handle. Better Auth knows only the login key.
    expect(await rows('SELECT username, event_id FROM accounts WHERE id = ?', added!))
      .toEqual([{ username: added!.replaceAll('-', ''), event_id: null }]);
  });

  it('returns the stored receipt when the response to a committed change is lost', async () => {
    const lossy: D1Connection = {
      prepare: (sql) => db.prepare(sql),
      batch: async (statements) => {
        await db.batch(statements);
        throw new Error('The network dropped the response.');
      },
    };
    const requestId = randomUUID();
    const command: ManageCommand = { type: 'add_webmaster', person: { handle: 'lost-response', name: 'Fictional' } };
    const receipt = await new D1ManageService(lossy, fastPasswords).execute(caller('first'), requestId, command);
    expect(await execute('first', command, requestId)).toEqual(receipt);
    expect(await rows("SELECT id FROM accounts WHERE handle = 'lost-response'")).toEqual([{ id: receipt.accountIds![0] }]);
  });

  it('refuses everyone but webmasters', async () => {
    expect(await manage.site(caller('contestAdmin'))).toBeNull();
    for (const command of [
      { type: 'set_webmaster_reads', restricted: true },
      { type: 'remove_webmaster', accountId: caller('first').accountId },
      { type: 'join_contest', contestId: ids.contest },
    ] satisfies ManageCommand[]) {
      await expect(execute('contestAdmin', command)).rejects.toMatchObject({ status: 403 });
    }
    await expect(manage.execute(caller('first'), randomUUID(), { type: 'join_contest', contestId: 'not-a-contest' }))
      .rejects.toMatchObject({ status: 400 });
    expect(await rows('SELECT * FROM authority_audit')).toEqual([]);
    expect(await rows('SELECT * FROM manage_receipts')).toEqual([]);
  });

  it('refuses a join while webmasters read every contest, and D1 writes both audit rows once they must join', async () => {
    const joinNeedsRestriction = 'Turn on "Webmasters read contest data only after joining" before you join a contest.';
    await expect(execute('first', { type: 'join_contest', contestId: ids.contest }))
      .rejects.toMatchObject({ status: 409, message: joinNeedsRestriction });
    await expect(run(`INSERT INTO grants (account_id, scope, session_id, granted_by) VALUES (?, 'contest', ?, 'fixture')`,
      caller('first').accountId, ids.contest)).rejects.toThrow(/only while the site restricts their reads/);
    expect((await siteOf('first')).contestsToJoin).toEqual([]);

    await execute('second', { type: 'set_webmaster_reads', restricted: true });
    const site = await siteOf('first');
    expect(site.restrictWebmasterReads).toBe(true);
    expect(site.contestsToJoin).toEqual([
      { id: ids.contest, name: 'Live 1', eventName: 'Fictional event' },
      { id: ids.otherContest, name: 'Live 2', eventName: 'Fictional event' },
    ]);
    expect((await application.snapshot(caller('first'), ids.contest)).membership).toBeNull();

    await execute('first', { type: 'join_contest', contestId: ids.contest });
    await execute('first', { type: 'join_contest', contestId: ids.contest });
    expect((await application.snapshot(caller('first'), ids.contest)).membership).toMatchObject({ is_admin: true, team_id: null });
    expect((await application.snapshot(caller('contestAdmin'), ids.contest)).audit).toEqual([
      expect.objectContaining({ action: 'webmaster_join', actor: caller('first').accountId, target: caller('first').accountId }),
    ]);
    expect(await rows(`SELECT actor, actor_name, target, event_id, json_extract(detail, '$.event_id') AS contest_event
      FROM authority_audit WHERE action = 'webmaster_join'`)).toEqual([{
      actor: caller('first').accountId, actor_name: 'Fictional first', target: ids.contest, event_id: null, contest_event: ids.event,
    }]);
    expect((await siteOf('first')).contestsToJoin.map((contest) => contest.id)).toEqual([ids.otherContest]);
    expect((await application.snapshot(caller('second'), ids.contest)).membership).toBeNull();

    // A join persists while the restriction is off and on again (owner decision 9).
    await execute('second', { type: 'set_webmaster_reads', restricted: false });
    expect((await siteOf('first')).contestsToJoin).toEqual([]);
    await execute('second', { type: 'set_webmaster_reads', restricted: true });
    expect((await application.snapshot(caller('first'), ids.contest)).membership).toMatchObject({ is_admin: true });
    expect(await rows("SELECT action, json_extract(detail, '$.restricted') AS restricted FROM authority_audit WHERE action = 'set_webmaster_reads' ORDER BY at, rowid"))
      .toEqual([1, 0, 1].map((restricted) => ({ action: 'set_webmaster_reads', restricted })));
  });

  it('keeps the last webmaster and ends the sessions of a removed one', async () => {
    const lastWebmaster = { status: 409, message: 'The last webmaster cannot be removed.' };
    await execute('first', { type: 'set_webmaster_reads', restricted: true });
    await execute('second', { type: 'join_contest', contestId: ids.contest });
    await execute('first', { type: 'remove_webmaster', accountId: caller('second').accountId });
    expect(await manage.site(caller('second'))).toBeNull();
    expect(await rows('SELECT revoked FROM logins WHERE account_id = ?', caller('second').accountId)).toEqual([{ revoked: 1 }]);
    expect(await rows('SELECT scope FROM grants WHERE account_id = ?', caller('second').accountId)).toEqual([]);
    expect((await siteOf('first')).webmasters.map((webmaster) => webmaster.id)).toEqual([caller('first').accountId]);

    await expect(execute('first', { type: 'remove_webmaster', accountId: caller('first').accountId })).rejects.toMatchObject(lastWebmaster);
    await expect(execute('first', { type: 'remove_webmaster', accountId: caller('contestAdmin').accountId }))
      .rejects.toMatchObject({ status: 409, message: 'That account is not a webmaster. Refresh the page.' });
    await expect(run(`DELETE FROM grants WHERE scope = 'site' AND account_id = ?`, caller('first').accountId))
      .rejects.toThrow(/The last webmaster cannot be removed/);

    const { accountIds } = await execute('first', { type: 'add_webmaster', person: { handle: 'pending', name: 'Fictional pending' } });
    await expect(execute('first', { type: 'remove_webmaster', accountId: caller('first').accountId }))
      .rejects.toMatchObject({ status: 409, message: 'Give another webmaster a password before you remove yourself.' });
    await run("UPDATE accounts SET credential_state = 'ready' WHERE id = ?", accountIds![0]!);
    await execute('first', { type: 'remove_webmaster', accountId: caller('first').accountId });
    expect(await manage.site(caller('first'))).toBeNull();
    expect(await rows('SELECT revoked FROM logins WHERE account_id = ?', caller('first').accountId)).toEqual([{ revoked: 0 }]);
    expect(await rows("SELECT action, actor, target FROM authority_audit WHERE action = 'remove_webmaster' ORDER BY at, rowid")).toEqual([
      { action: 'remove_webmaster', actor: caller('first').accountId, target: caller('second').accountId },
      { action: 'remove_webmaster', actor: caller('first').accountId, target: caller('first').accountId },
    ]);
  });

  it('issues a new webmaster a password in one batch, and a retry returns the account without it', async () => {
    const { accountIds } = await execute('first', { type: 'add_webmaster', person: { handle: 'newcomer', name: 'Fictional newcomer' } });
    const added = accountIds![0]!;
    const requestId = randomUUID();
    const issuing = new D1ManageService(db, passwordHasher);
    const [issued] = await issuing.issueCredentials(caller('first'), requestId, { eventId: null, accountIds: [added] });
    expect(issued).toMatchObject({ accountId: added, handle: 'newcomer' });
    expect(issued!.temporaryPassword).toMatch(/^.{12,}$/);
    expect((await siteOf('first')).webmasters).toContainEqual(expect.objectContaining({ id: added, ready: true }));
    const authentication = new D1AuthenticationService(db, createBetterAuthIdentity(db, {
      origin: 'http://127.0.0.1:8788', secret: randomSecret(), secureCookies: false,
    }), passwordHasher);
    const signed = await authentication.signIn({ kind: 'site' }, 'newcomer' as Handle, issued!.temporaryPassword!);
    const current = await authentication.current(new Headers({ cookie: signed.cookie.split(';')[0]! }));
    expect(current?.user.id).toBe(added);
    expect(current?.status.must_change).toBe(true);
    expect(await issuing.issueCredentials(caller('first'), requestId, { eventId: null, accountIds: [added] }))
      .toEqual([{ accountId: added, handle: 'newcomer', temporaryPassword: null }]);
    expect(await rows("SELECT action, state, actor FROM account_operations WHERE account_id = ?", added))
      .toEqual([{ action: 'reset_password', state: 'completed', actor: caller('first').accountId }]);
    expect(await rows("SELECT json_extract(detail, '$.accountIds') AS accounts FROM authority_audit WHERE action = 'issue_passwords'"))
      .toEqual([{ accounts: JSON.stringify([added]) }]);
    await expect(issuing.issueCredentials(caller('first'), requestId, { eventId: null, accountIds: [caller('second').accountId] }))
      .rejects.toMatchObject({ status: 409, message: 'This request was already used for another change. Refresh and try again.' });
  });

  it('resets another webmaster and refuses the own account, other accounts, and other callers', async () => {
    const issue = (person: Person, accountIds: unknown) => manage.issueCredentials(caller(person), randomUUID(), { eventId: null, accountIds });
    await expect(issue('first', [caller('first').accountId])).rejects.toMatchObject({ status: 400 });
    await expect(issue('first', [caller('contestAdmin').accountId])).rejects.toMatchObject({ status: 409 });
    await expect(issue('contestAdmin', [caller('first').accountId])).rejects.toMatchObject({ status: 403 });
    await expect(issue('first', Array.from({ length: 9 }, () => randomUUID()))).rejects.toMatchObject({ status: 400 });
    const second = caller('second').accountId;
    const failing = new D1ManageService({ prepare: (sql) => db.prepare(sql), batch: () => Promise.reject(new Error('private detail')) },
      fastPasswords);
    await expect(failing.issueCredentials(caller('first'), randomUUID(), { eventId: null, accountIds: [second] }))
      .rejects.toMatchObject({ status: 409, message: 'The request outcome is unknown. Refresh before retrying.' });
    expect(await rows('SELECT credential_generation, must_change FROM accounts WHERE id = ?', second))
      .toEqual([{ credential_generation: 1, must_change: 0 }]);

    const [reset] = await issue('first', [second]);
    expect(reset!.temporaryPassword).toMatch(/^.{12,}$/);
    expect(await rows('SELECT credential_generation, credential_state, must_change FROM accounts WHERE id = ?', second))
      .toEqual([{ credential_generation: 2, credential_state: 'ready', must_change: 1 }]);
    expect(await rows('SELECT revoked FROM logins WHERE account_id = ?', second)).toEqual([{ revoked: 1 }]);
    expect(await rows('SELECT count(*) AS n FROM ba_session WHERE userId = ?', second)).toEqual([{ n: 0 }]);
    expect(await rows('SELECT password FROM ba_account WHERE userId = ?', second)).toEqual([{ password: 'fictional-test-hash' }]);
    expect(await rows('SELECT count(*) AS n FROM command_assertions')).toEqual([{ n: 0 }]);
  });
});

describe('handle changes', () => {
  const accounts = ['webmaster', 'eventAdmin', 'contestAdmin', 'volunteer', 'contestant', 'otherStaff'] as const;
  type Account = typeof accounts[number];
  let db: D1Binding;
  let dispose: (() => Promise<void>) | undefined;
  let manage: D1ManageService;
  let authentication: D1AuthenticationService;
  const callers = new Map<Account, Caller>();
  const caller = (account: Account) => callers.get(account)!;
  const ids = { event: '', other: '', contest: '', otherContest: '', team: '' };
  const password = 'Fictional volunteer password 1';
  const run = (sql: string, ...values: D1Value[]) => db.prepare(sql).bind(...values).run();
  const rows = async <T>(sql: string, ...values: D1Value[]) => (await db.prepare(sql).bind(...values).all<T>()).results;
  const rename = (by: Account, accountId: string, handle: string, eventId = ids.event) =>
    manage.execute(caller(by), randomUUID(), { type: 'set_handle', eventId, accountId, handle });
  const renameAccount = (by: Account, account: Account, handle: string, eventId = ids.event) =>
    rename(by, caller(account).accountId, handle, eventId);
  const handleOf = async (account: Account) =>
    (await rows<{ handle: string }>('SELECT handle FROM accounts WHERE id = ?', caller(account).accountId))[0]!.handle;
  const eventCode = async () => (await rows<{ code: EventCode }>('SELECT code FROM events WHERE id = ?', ids.event))[0]!.code;
  const signIn = async (handle: string, secret = password) => {
    const signed = await authentication.signIn({ kind: 'event', code: await eventCode() }, handle as Handle, secret);
    return new Headers({ cookie: signed.cookie.split(';')[0]! });
  };

  beforeEach(async () => {
    const platform = await getPlatformProxy<{ DB: D1Binding }>({
      configPath: 'wrangler.auth-ci.jsonc', persist: false, remoteBindings: false, envFiles: [],
    });
    db = platform.env.DB;
    dispose = platform.dispose;
    await applyMigrations(db);
    manage = new D1ManageService(db, fastPasswords);
    authentication = new D1AuthenticationService(db, createBetterAuthIdentity(db, {
      origin: 'http://127.0.0.1:8788', secret: randomSecret(), secureCookies: false,
    }), passwordHasher);
    Object.assign(ids, { event: randomUUID(), other: randomUUID(), contest: randomUUID(), otherContest: randomUUID(), team: randomUUID() });
    await run('INSERT INTO events (id, name) VALUES (?, ?), (?, ?)', ids.event, 'Fictional event', ids.other, 'Other event');
    await run(`INSERT INTO sessions (id, event_id, name) VALUES (?, ?, 'Live 1'), (?, ?, 'Other live')`,
      ids.contest, ids.event, ids.otherContest, ids.other);
    await run(`INSERT INTO teams (id, session_id, name) VALUES (?, ?, 'Aurora')`, ids.team, ids.contest);
    const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
    const hash = await passwordHasher.hash(password);
    for (const account of accounts) {
      const login = { accountId: randomUUID(), loginId: randomUUID() };
      callers.set(account, login);
      const handle = account.toLowerCase();
      const event = account === 'webmaster' ? null : account === 'otherStaff' ? ids.other : ids.event;
      await db.batch([
        db.prepare('INSERT INTO accounts (id, name, username, handle, event_id, must_change) VALUES (?, ?, ?, ?, ?, 0)')
          .bind(login.accountId, `Fictional ${account}`, handle, handle, event),
        db.prepare(`INSERT INTO ba_user (id, name, email, username, createdAt, updatedAt) VALUES (?, ?, ?, ?, ${now}, ${now})`)
          .bind(login.accountId, account, `${handle}@accounts.minsky.invalid`, handle),
        db.prepare(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
          VALUES (?, ?, 'credential', ?, ?, ${now}, ${now})`).bind(randomUUID(), login.accountId, login.accountId, hash),
        db.prepare(`INSERT INTO ba_session (id, userId, token, expiresAt, createdAt, updatedAt)
          VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'), ${now}, ${now})`)
          .bind(login.loginId, login.accountId, randomUUID()),
        db.prepare('INSERT INTO logins (id, account_id, expires_at, identity_session_id) VALUES (?, ?, unixepoch() + 3600, ?)')
          .bind(login.loginId, login.accountId, login.loginId),
      ]);
    }
    await db.batch([
      db.prepare(`INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', 'fixture')`).bind(caller('webmaster').accountId),
      db.prepare(`INSERT INTO grants (account_id, scope, event_id, granted_by) VALUES (?, 'event', ?, 'fixture')`)
        .bind(caller('eventAdmin').accountId, ids.event),
      db.prepare(`INSERT INTO memberships (session_id, account_id, team_id, is_admin)
        VALUES (?, ?, NULL, 1), (?, ?, NULL, 0), (?, ?, ?, 0), (?, ?, NULL, 0)`)
        .bind(ids.contest, caller('contestAdmin').accountId, ids.contest, caller('volunteer').accountId,
          ids.contest, caller('contestant').accountId, ids.team, ids.otherContest, caller('otherStaff').accountId),
      db.prepare(`INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer'), (?, ?, 'volunteer')`)
        .bind(ids.contest, caller('volunteer').accountId, ids.otherContest, caller('otherStaff').accountId),
    ]);
  }, 120_000);

  afterEach(async () => { await dispose?.(); }, 120_000);

  it('lets a staff account change its own handle, and its open session continues', async () => {
    const headers = await signIn('volunteer');
    const signedIn = (await authentication.current(headers))!;
    expect(await manage.execute(signedIn.caller, randomUUID(),
      { type: 'set_handle', eventId: ids.event, accountId: signedIn.caller.accountId, handle: ' Desk-Volunteer ' })).toEqual({});
    expect((await authentication.current(headers))?.status)
      .toEqual({ handle: 'desk-volunteer', must_change: false, session_valid: true, can_change_handle: true });
    expect(await rows('SELECT username FROM ba_user WHERE id = ?', signedIn.caller.accountId)).toEqual([{ username: 'volunteer' }]);
    expect((await authentication.current(await signIn('desk-volunteer')))?.user.id).toBe(signedIn.caller.accountId);
    await expect(signIn('volunteer')).rejects.toMatchObject({ status: 401 });
    expect(await rows('SELECT action, session_id, actor FROM account_operations WHERE account_id = ?', signedIn.caller.accountId))
      .toEqual([{ action: 'set_username', session_id: null, actor: signedIn.caller.accountId }]);
    expect(await rows('SELECT event_id, action, target, detail FROM authority_audit')).toEqual([{
      event_id: ids.event, action: 'set_handle', target: signedIn.caller.accountId,
      detail: JSON.stringify({ from: 'volunteer', to: 'desk-volunteer' }),
    }]);
  });

  it('refreshes the staff and the account in every contest that seats the renamed account', async () => {
    const second = randomUUID();
    const volunteer = caller('volunteer').accountId;
    await run(`INSERT INTO sessions (id, event_id, name) VALUES (?, ?, 'Live 2')`, second, ids.event);
    await run('INSERT INTO memberships (session_id, account_id) VALUES (?, ?)', second, volunteer);
    await run('DELETE FROM notifications');
    expect(await renameAccount('volunteer', 'volunteer', 'desk-two')).toEqual({});
    expect(await rows('SELECT session_id, audience FROM notifications ORDER BY session_id, audience'))
      .toEqual([ids.contest, second].sort().flatMap((contest) => [
        { session_id: contest, audience: `account:${volunteer}` }, { session_id: contest, audience: 'staff' },
      ]));
    // An event admin holds no seat, so no contest lists its handle.
    expect(await renameAccount('eventAdmin', 'eventAdmin', 'event-own')).toEqual({});
    expect(await rows('SELECT count(*) AS n FROM notifications')).toEqual([{ n: 4 }]);
  });

  it('reports in the account status whether set_handle accepts the own handle', async () => {
    const own = async (handle: string, target?: SignInTarget) => {
      const headers = target
        ? new Headers({ cookie: (await authentication.signIn(target, handle as Handle, password)).cookie.split(';')[0]! })
        : await signIn(handle);
      return (await authentication.current(headers))?.status.can_change_handle;
    };
    expect({
      volunteer: await own('volunteer'), eventAdmin: await own('eventadmin'),
      contestant: await own('contestant'), webmaster: await own('webmaster', { kind: 'site' }),
    }).toEqual({ volunteer: true, eventAdmin: true, contestant: false, webmaster: false });
    // A team seat in any contest of the event takes the change away.
    const second = randomUUID();
    const team = randomUUID();
    await run(`INSERT INTO sessions (id, event_id, name) VALUES (?, ?, 'Live 2')`, second, ids.event);
    await run(`INSERT INTO teams (id, session_id, name) VALUES (?, ?, 'Borealis')`, team, second);
    await run('INSERT INTO memberships (session_id, account_id, team_id) VALUES (?, ?, ?)', second, caller('volunteer').accountId, team);
    expect(await own('volunteer')).toBe(false);
    await expect(renameAccount('volunteer', 'volunteer', 'two-seats')).rejects.toMatchObject({ status: 403 });
  });

  it('refuses an entrant sign-in its own handle while no contest seats it', async () => {
    const entrant = randomUUID();
    await run(`INSERT INTO entrants (id, event_id, kind, name) VALUES (?, ?, 'team', 'Unseated team')`, entrant, ids.event);
    await run('UPDATE accounts SET entrant_id = ? WHERE id = ?', entrant, caller('volunteer').accountId);
    expect(await rows('SELECT team_id FROM memberships WHERE account_id = ? AND team_id IS NOT NULL', caller('volunteer').accountId)).toEqual([]);
    await expect(renameAccount('volunteer', 'volunteer', 'unseated-team'))
      .rejects.toMatchObject({ status: 403, message: 'You cannot change this account.' });
    expect(await handleOf('volunteer')).toBe('volunteer');
  });

  it('refuses a contestant its own handle, because venue staff read it from the sheet', async () => {
    await expect(renameAccount('contestant', 'contestant', 'renamed-team'))
      .rejects.toMatchObject({ status: 403, message: 'You cannot change this account.' });
    expect(await handleOf('contestant')).toBe('contestant');
  });

  it('lets an admin change the handles that it manages, and no handle above it', async () => {
    expect(await renameAccount('contestAdmin', 'contestant', 'aurora-desk')).toEqual({});
    expect(await renameAccount('contestAdmin', 'volunteer', 'helper-1')).toEqual({});
    await expect(renameAccount('contestAdmin', 'eventAdmin', 'demoted')).rejects.toMatchObject({ status: 403 });
    expect(await renameAccount('eventAdmin', 'eventAdmin', 'event-own')).toEqual({});
    expect(await renameAccount('eventAdmin', 'contestAdmin', 'desk-lead')).toEqual({});
    expect(await renameAccount('webmaster', 'eventAdmin', 'event-lead')).toEqual({});
    expect([await handleOf('contestant'), await handleOf('volunteer'), await handleOf('eventAdmin'), await handleOf('contestAdmin')])
      .toEqual(['aurora-desk', 'helper-1', 'event-lead', 'desk-lead']);
  });

  it('keeps each handle unique inside its event only', async () => {
    await expect(renameAccount('contestAdmin', 'contestant', 'Volunteer'))
      .rejects.toMatchObject({ status: 409, message: 'That username is taken. Choose another.' });
    expect(await renameAccount('otherStaff', 'otherStaff', 'volunteer', ids.other)).toEqual({});
    expect(await handleOf('otherStaff')).toBe('volunteer');
  });

  it('refuses a change that names another event, a caller from another event, and an archived event', async () => {
    await expect(renameAccount('webmaster', 'otherStaff', 'moved')).rejects.toMatchObject({ status: 409 });
    await expect(renameAccount('otherStaff', 'volunteer', 'taken-over')).rejects.toMatchObject({ status: 403 });
    await expect(renameAccount('webmaster', 'webmaster', 'site-renamed')).rejects.toMatchObject({ status: 409 });
    await run('UPDATE events SET archived = 1 WHERE id = ?', ids.event);
    await expect(renameAccount('eventAdmin', 'volunteer', 'archived-change'))
      .rejects.toMatchObject({ status: 403, message: 'This event is archived.' });
    expect([await handleOf('otherStaff'), await handleOf('volunteer'), await handleOf('webmaster')])
      .toEqual(['otherstaff', 'volunteer', 'webmaster']);
    expect(await rows('SELECT count(*) AS n FROM command_assertions')).toEqual([{ n: 0 }]);
  });

  it('refuses a change when the authority to make it ends before the batch commits', async () => {
    const racing = new D1ManageService({ prepare: (sql) => db.prepare(sql), batch: async (statements) => {
      await run('UPDATE memberships SET is_admin = 0 WHERE account_id = ?', caller('contestAdmin').accountId);
      return db.batch(statements);
    } }, fastPasswords);
    await expect(racing.execute(caller('contestAdmin'), randomUUID(),
      { type: 'set_handle', eventId: ids.event, accountId: caller('volunteer').accountId, handle: 'late-change' }))
      .rejects.toMatchObject({ status: 409 });
    expect(await handleOf('volunteer')).toBe('volunteer');
  });

  it('gives an account from before usernames a handle, then a login key with its first password', async () => {
    const legacy = randomUUID();
    await db.batch([
      db.prepare('INSERT INTO accounts (id, name, event_id, must_change) VALUES (?, ?, ?, 0)').bind(legacy, 'Fictional legacy', ids.event),
      db.prepare('INSERT INTO memberships (session_id, account_id) VALUES (?, ?)').bind(ids.contest, legacy),
      db.prepare(`INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')`).bind(ids.contest, legacy),
    ]);
    const admin = (await authentication.current(await signIn('contestadmin')))!.caller;
    const issuing = new D1ManageService(db, passwordHasher);
    const issue = () => issuing.issueCredentials(admin, randomUUID(), { eventId: ids.event, accountIds: [legacy] });
    await expect(issue()).rejects.toMatchObject({ status: 409, message: 'Set a username before issuing this account a password.' });
    expect(await rows('SELECT credential_state FROM accounts WHERE id = ?', legacy)).toEqual([{ credential_state: 'ready' }]);
    expect(await rename('contestAdmin', legacy, 'desk-legacy')).toEqual({});
    const [reset] = await issue();
    const signedIn = await authentication.current(await signIn('desk-legacy', reset!.temporaryPassword!));
    expect(signedIn).toMatchObject({ user: { id: legacy }, status: { handle: 'desk-legacy', must_change: true } });
    expect(await rows('SELECT a.username, b.username AS identity FROM accounts a JOIN ba_user b ON b.id = a.id WHERE a.id = ?', legacy))
      .toEqual([{ username: loginKeyFor(legacy), identity: loginKeyFor(legacy) }]);
  });
});

describe('event, roster, and contest commands', () => {
  const callerNames = ['webmaster', 'eventAdmin', 'contestAdmin', 'volunteer', 'otherAdmin'] as const;
  type Name = typeof callerNames[number];
  let db: D1Binding;
  let dispose: (() => Promise<void>) | undefined;
  let manage: D1ManageService;
  const callers = new Map<Name, Caller>();
  const caller = (name: Name) => callers.get(name)!;
  const ids = { event: '', other: '', contest: '', otherContest: '' };

  const run = (sql: string, ...values: D1Value[]) => db.prepare(sql).bind(...values).run();
  const rows = async <T>(sql: string, ...values: D1Value[]) => (await db.prepare(sql).bind(...values).all<T>()).results;
  const execute = (by: Name, command: ManageCommand, requestId: string = randomUUID()) =>
    manage.execute(caller(by), requestId, command);
  const entrants = async (by: Name, eventId: string, list: Array<[string, 'team' | 'single']>) =>
    (await execute(by, {
      type: 'create_entrants', eventId,
      entrants: list.map(([name, kind]) => ({ kind, name, handle: name.toLowerCase().replaceAll(' ', '-') })),
    })).entrantIds!;
  const createContest = async (by: Name, eventId: string, name: string, contestType: 'singles' | 'mixed' | 'teams') =>
    (await execute(by, { type: 'create_contest', eventId, name, contestType, schedule: testSchedule, categories: ['Devices', 'Other'] })).contestId!;
  const seatsOf = (contestId: string) =>
    rows<{ account_id: string; team_id: string | null }>('SELECT account_id, team_id FROM memberships WHERE session_id = ? ORDER BY account_id', contestId);
  const addIssue = (contestId: string, entryId: string, category: string) => run(
    `INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at)
      VALUES (?, ?, ?, 'open', 1, ?, 'Fictional', ?, 'Fictional issue', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    randomUUID(), contestId, entryId, caller('webmaster').accountId, category);

  beforeEach(async () => {
    const platform = await getPlatformProxy<{ DB: D1Binding }>({
      configPath: 'wrangler.auth-ci.jsonc', persist: false, remoteBindings: false, envFiles: [],
    });
    db = platform.env.DB;
    dispose = platform.dispose;
    await applyMigrations(db);
    manage = new D1ManageService(db, fastPasswords);
    Object.assign(ids, { event: randomUUID(), other: randomUUID(), contest: randomUUID(), otherContest: randomUUID() });
    await run('INSERT INTO events (id, name, code) VALUES (?, ?, ?), (?, ?, ?)',
      ids.event, 'Fictional event', 'fictional-event', ids.other, 'Other event', 'other-event');
    await run(`INSERT INTO sessions (id, event_id, name, contest_type) VALUES (?, ?, 'Live 1', 'teams'), (?, ?, 'Other live', 'teams')`,
      ids.contest, ids.event, ids.otherContest, ids.other);
    const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
    for (const name of callerNames) {
      const login = { accountId: randomUUID(), loginId: randomUUID() };
      callers.set(name, login);
      const event = name === 'webmaster' ? null : name === 'otherAdmin' ? ids.other : ids.event;
      await db.batch([
        db.prepare('INSERT INTO accounts (id, name, username, handle, event_id, must_change) VALUES (?, ?, ?, ?, ?, 0)')
          .bind(login.accountId, `Fictional ${name}`, name.toLowerCase(), name.toLowerCase(), event),
        db.prepare(`INSERT INTO ba_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ${now}, ${now})`)
          .bind(login.accountId, name, `${login.accountId}@roster.minsky.invalid`),
        db.prepare(`INSERT INTO ba_session (id, userId, token, expiresAt, createdAt, updatedAt)
          VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'), ${now}, ${now})`)
          .bind(login.loginId, login.accountId, randomUUID()),
        db.prepare('INSERT INTO logins (id, account_id, expires_at, identity_session_id) VALUES (?, ?, unixepoch() + 3600, ?)')
          .bind(login.loginId, login.accountId, login.loginId),
      ]);
    }
    await db.batch([
      db.prepare(`INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', 'fixture')`).bind(caller('webmaster').accountId),
      db.prepare(`INSERT INTO grants (account_id, scope, event_id, granted_by) VALUES (?, 'event', ?, 'fixture'), (?, 'event', ?, 'fixture')`)
        .bind(caller('eventAdmin').accountId, ids.event, caller('otherAdmin').accountId, ids.other),
      db.prepare(`INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, 1)`)
        .bind(ids.contest, caller('contestAdmin').accountId),
    ]);
  }, 120_000);

  afterEach(async () => { await dispose?.(); }, 120_000);

  it('creates an event with its first admin, who waits for a password, and refuses a taken code', async () => {
    const requestId = randomUUID();
    const command: ManageCommand = {
      type: 'create_event', name: 'Olympiad 2027', code: 'Olympiad-2027', timeZone: 'Asia/Singapore',
      firstAdmin: { handle: 'Chief', name: 'Fictional chief' },
    };
    const receipt = await execute('webmaster', command, requestId);
    expect(receipt.eventId).toBeDefined();
    expect(await execute('webmaster', command, requestId)).toEqual(receipt);
    const [adminId] = receipt.accountIds!;
    expect(await rows('SELECT code, time_zone, name FROM events WHERE id = ?', receipt.eventId!))
      .toEqual([{ code: 'olympiad-2027', time_zone: 'Asia/Singapore', name: 'Olympiad 2027' }]);
    expect(await rows('SELECT handle, event_id, credential_state, must_change FROM accounts WHERE id = ?', adminId!))
      .toEqual([{ handle: 'chief', event_id: receipt.eventId, credential_state: 'pending', must_change: 1 }]);
    expect(await rows(`SELECT account_id FROM grants WHERE scope = 'event' AND event_id = ?`, receipt.eventId!))
      .toEqual([{ account_id: adminId }]);
    expect(await rows('SELECT action, event_id FROM authority_audit')).toEqual([{ action: 'create_event', event_id: null }]);
    expect((await manage.site(caller('webmaster')))!.events.find((event) => event.id === receipt.eventId))
      .toEqual({ id: receipt.eventId, name: 'Olympiad 2027', code: 'olympiad-2027', timeZone: 'Asia/Singapore', archived: false, contests: 0, accounts: 1 });
    await expect(execute('webmaster', { ...command, firstAdmin: { handle: 'other', name: 'Other' } }))
      .rejects.toMatchObject({ status: 409, message: 'That event code is taken. Choose another.' });
    await expect(execute('webmaster', { ...command, code: 'bad code' })).rejects.toMatchObject({ status: 400 });
    await expect(execute('webmaster', { ...command, code: 'zone-test', timeZone: 'Mars/Base' })).rejects.toMatchObject({ status: 400 });
    // Only a webmaster creates an event.
    await expect(execute('eventAdmin', { ...command, code: 'another-code' })).rejects.toMatchObject({ status: 403 });
    expect(await rows('SELECT count(*) AS n FROM events')).toEqual([{ n: 3 }]);
  });

  it('lets an event admin update only its own event and name event admins from its own accounts', async () => {
    await execute('eventAdmin', { type: 'update_event', eventId: ids.event, name: 'Renamed', code: 'renamed-event', timeZone: 'UTC' });
    expect(await rows('SELECT name, code FROM events WHERE id = ?', ids.event)).toEqual([{ name: 'Renamed', code: 'renamed-event' }]);
    await expect(execute('eventAdmin', { type: 'update_event', eventId: ids.event, name: 'Renamed', code: 'other-event', timeZone: 'UTC' }))
      .rejects.toMatchObject({ status: 409, message: 'That event code is taken. Choose another.' });
    await expect(execute('eventAdmin', { type: 'update_event', eventId: ids.other, name: 'Taken over', code: 'taken-over', timeZone: 'UTC' }))
      .rejects.toMatchObject({ status: 403 });
    await expect(execute('contestAdmin', { type: 'update_event', eventId: ids.event, name: 'Nope', code: 'nope-code', timeZone: 'UTC' }))
      .rejects.toMatchObject({ status: 403 });
    const { accountIds } = await execute('eventAdmin', { type: 'create_people', eventId: ids.event, people: [{ handle: 'newadmin', name: 'New admin' }] });
    const [person] = accountIds!;
    await execute('eventAdmin', { type: 'set_event_admin', eventId: ids.event, accountId: person!, admin: true });
    expect(await rows(`SELECT count(*) AS n FROM grants WHERE scope = 'event' AND account_id = ?`, person!)).toEqual([{ n: 1 }]);
    await execute('webmaster', { type: 'set_event_admin', eventId: ids.event, accountId: person!, admin: false });
    expect(await rows(`SELECT count(*) AS n FROM grants WHERE scope = 'event' AND account_id = ?`, person!)).toEqual([{ n: 0 }]);
    // An account of another event, and a webmaster, cannot be named.
    await expect(execute('eventAdmin', { type: 'set_event_admin', eventId: ids.event, accountId: caller('otherAdmin').accountId, admin: true }))
      .rejects.toMatchObject({ status: 409 });
    await expect(execute('eventAdmin', { type: 'set_event_admin', eventId: ids.event, accountId: caller('webmaster').accountId, admin: true }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('creates people and entrants, each with one pending sign-in, and refuses duplicates and other events', async () => {
    const people = await execute('eventAdmin', { type: 'create_people', eventId: ids.event, people: [
      { handle: 'ada', name: 'Ada' }, { handle: 'grace', name: 'Grace' }] });
    expect(people.accountIds).toHaveLength(2);
    expect(await rows('SELECT handle, username, credential_state, must_change, entrant_id FROM accounts WHERE id = ?', people.accountIds![0]!))
      .toEqual([{ handle: 'ada', username: people.accountIds![0]!.replaceAll('-', ''), credential_state: 'pending', must_change: 1, entrant_id: null }]);
    await expect(execute('eventAdmin', { type: 'create_people', eventId: ids.event, people: [{ handle: 'ada', name: 'Again' }] }))
      .rejects.toMatchObject({ status: 409, message: 'The username "ada" is taken. Choose another.' });
    // The same handle in another event is a different name.
    await execute('otherAdmin', { type: 'create_people', eventId: ids.other, people: [{ handle: 'ada', name: 'Ada elsewhere' }] });
    await expect(execute('eventAdmin', { type: 'create_people', eventId: ids.other, people: [{ handle: 'eve', name: 'Eve' }] }))
      .rejects.toMatchObject({ status: 403 });

    const receipt = await execute('eventAdmin', { type: 'create_entrants', eventId: ids.event, entrants: [
      { kind: 'team', name: 'Aurora', handle: 'aurora' }, { kind: 'single', name: 'Solo Sam', handle: 'sam' }] });
    expect(receipt.entrantIds).toHaveLength(2);
    expect(await rows('SELECT en.id, en.kind, en.name, a.entrant_id, a.handle, a.credential_state FROM entrants en JOIN accounts a ON a.entrant_id = en.id WHERE en.event_id = ? ORDER BY en.name', ids.event))
      .toEqual([
        { id: receipt.entrantIds![0], kind: 'team', name: 'Aurora', entrant_id: receipt.entrantIds![0], handle: 'aurora', credential_state: 'pending' },
        { id: receipt.entrantIds![1], kind: 'single', name: 'Solo Sam', entrant_id: receipt.entrantIds![1], handle: 'sam', credential_state: 'pending' },
      ]);
    await expect(execute('eventAdmin', { type: 'create_entrants', eventId: ids.event, entrants: [{ kind: 'team', name: 'AURORA', handle: 'aurora-2' }] }))
      .rejects.toMatchObject({ status: 409, message: 'An entrant named "AURORA" already exists.' });
    await expect(execute('eventAdmin', { type: 'create_entrants', eventId: ids.event, entrants: [{ kind: 'team', name: 'Borealis', handle: 'sam' }] }))
      .rejects.toMatchObject({ status: 409 });
    await expect(execute('eventAdmin', { type: 'create_entrants', eventId: ids.event, entrants: [
      { kind: 'team', name: 'Twin', handle: 'twin-1' }, { kind: 'team', name: 'TWIN', handle: 'twin-2' }] }))
      .rejects.toMatchObject({ status: 400 });

    await execute('eventAdmin', { type: 'rename_entrant', eventId: ids.event, entrantId: receipt.entrantIds![0]!, name: 'Aurora Prime' });
    expect(await rows('SELECT name FROM entrants WHERE id = ?', receipt.entrantIds![0]!)).toEqual([{ name: 'Aurora Prime' }]);
    await expect(execute('eventAdmin', { type: 'rename_entrant', eventId: ids.event, entrantId: receipt.entrantIds![0]!, name: 'solo sam' }))
      .rejects.toMatchObject({ status: 409 });
    // An entrant of the other event is not found by this event's admin.
    const [foreign] = await entrants('otherAdmin', ids.other, [['Foreign', 'team']]);
    await expect(execute('eventAdmin', { type: 'rename_entrant', eventId: ids.event, entrantId: foreign!, name: 'Mine now' }))
      .rejects.toMatchObject({ status: 409 });
    await expect(execute('eventAdmin', { type: 'rename_entrant', eventId: ids.other, entrantId: foreign!, name: 'Mine now' }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('assigns entrants to a contest, seats their sign-ins, and keeps the contest type', async () => {
    const [team, single] = await entrants('eventAdmin', ids.event, [['Aurora', 'team'], ['Solo Sam', 'single']]);
    const [foreign] = await entrants('otherAdmin', ids.other, [['Foreign', 'team']]);
    const teamsContest = await createContest('eventAdmin', ids.event, 'Teams round', 'teams');
    const singlesContest = await createContest('eventAdmin', ids.event, 'Singles round', 'singles');
    const requestId = randomUUID();
    const command: ManageCommand = { type: 'assign_entrants', contestId: teamsContest, entries: [{ entrantId: team!, location: ' Table 4 ' }] };
    const receipt = await execute('eventAdmin', command, requestId);
    expect(receipt).toEqual({ contestId: teamsContest, entrantIds: [team] });
    expect(await execute('eventAdmin', command, requestId)).toEqual(receipt);
    expect(await rows('SELECT name, location, entrant_id FROM teams WHERE session_id = ?', teamsContest))
      .toEqual([{ name: 'Aurora', location: 'Table 4', entrant_id: team }]);
    const account = (await rows<{ id: string }>('SELECT id FROM accounts WHERE entrant_id = ?', team!))[0]!.id;
    expect((await seatsOf(teamsContest)).map((seat) => [seat.account_id, seat.team_id !== null])).toEqual([[account, true]]);
    expect(await rows('SELECT action FROM admin_audit WHERE session_id = ?', teamsContest)).toEqual([{ action: 'assign_entrants' }]);
    expect(await rows('SELECT action, event_id FROM authority_audit WHERE action = ?', 'assign_entrants'))
      .toEqual([{ action: 'assign_entrants', event_id: ids.event }]);

    // The type decides who may enter. A second entry of the same entrant is refused.
    await expect(execute('eventAdmin', { type: 'assign_entrants', contestId: teamsContest, entries: [{ entrantId: single!, location: '' }] }))
      .rejects.toMatchObject({ status: 409, message: 'Solo Sam does not fit this contest. It takes teams.' });
    await expect(execute('eventAdmin', { type: 'assign_entrants', contestId: singlesContest, entries: [{ entrantId: team!, location: '' }] }))
      .rejects.toMatchObject({ status: 409, message: 'Aurora does not fit this contest. It takes single contestants.' });
    await expect(execute('eventAdmin', { type: 'assign_entrants', contestId: teamsContest, entries: [{ entrantId: team!, location: '' }] }))
      .rejects.toMatchObject({ status: 409, message: 'Aurora is already in this contest.' });
    // An entrant of another event, and a contest of another event.
    await expect(execute('eventAdmin', { type: 'assign_entrants', contestId: teamsContest, entries: [{ entrantId: foreign!, location: '' }] }))
      .rejects.toMatchObject({ status: 409 });
    await expect(execute('eventAdmin', { type: 'assign_entrants', contestId: ids.otherContest, entries: [{ entrantId: team!, location: '' }] }))
      .rejects.toMatchObject({ status: 403 });
    await expect(execute('contestAdmin', command)).rejects.toMatchObject({ status: 403 });

    // A mixed contest takes both. A contest type that would exclude an entry is refused.
    await execute('eventAdmin', { type: 'update_contest', contestId: singlesContest, name: 'Mixed round', contestType: 'mixed', schedule: testSchedule });
    await execute('eventAdmin', { type: 'assign_entrants', contestId: singlesContest, entries: [{ entrantId: team!, location: 'A' }, { entrantId: single!, location: 'B' }] });
    await expect(execute('eventAdmin', { type: 'update_contest', contestId: singlesContest, name: 'Singles round', contestType: 'singles', schedule: testSchedule }))
      .rejects.toMatchObject({ status: 409, message: 'Remove the entrants that this contest type excludes first.' });
    await expect(run(`UPDATE sessions SET contest_type = 'singles' WHERE id = ?`, singlesContest))
      .rejects.toThrow(/Remove the entrants that this contest type excludes first/);
    await execute('eventAdmin', { type: 'unassign_entrant', contestId: singlesContest, entrantId: team! });
    await execute('eventAdmin', { type: 'update_contest', contestId: singlesContest, name: 'Singles round', contestType: 'singles', schedule: testSchedule });
    expect(await rows('SELECT contest_type, name FROM sessions WHERE id = ?', singlesContest)).toEqual([{ contest_type: 'singles', name: 'Singles round' }]);
  });

  it('refuses to unassign an entrant that has an issue, and removes the seat of one that has none', async () => {
    const [team, other] = await entrants('eventAdmin', ids.event, [['Aurora', 'team'], ['Borealis', 'team']]);
    await execute('eventAdmin', { type: 'assign_entrants', contestId: ids.contest, entries: [{ entrantId: team!, location: '' }, { entrantId: other!, location: '' }] });
    const [entry] = await rows<{ id: string }>('SELECT id FROM teams WHERE session_id = ? AND entrant_id = ?', ids.contest, team!);
    await addIssue(ids.contest, entry!.id, 'Devices');
    await expect(execute('eventAdmin', { type: 'unassign_entrant', contestId: ids.contest, entrantId: team! }))
      .rejects.toMatchObject({ status: 409, message: 'Aurora has 1 issue and stays in the contest.' });
    expect((await seatsOf(ids.contest)).filter((seat) => seat.team_id !== null)).toHaveLength(2);
    await execute('eventAdmin', { type: 'unassign_entrant', contestId: ids.contest, entrantId: other! });
    expect((await seatsOf(ids.contest)).filter((seat) => seat.team_id !== null)).toHaveLength(1);
    expect(await rows('SELECT count(*) AS n FROM entrants WHERE id = ?', other!)).toEqual([{ n: 1 }]);
    await expect(execute('eventAdmin', { type: 'unassign_entrant', contestId: ids.contest, entrantId: other! }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('lets only an event admin or a webmaster assign staff, and keeps entrants and other events out', async () => {
    const [person] = (await execute('eventAdmin', { type: 'create_people', eventId: ids.event, people: [{ handle: 'pat', name: 'Pat' }] })).accountIds!;
    const [team] = await entrants('eventAdmin', ids.event, [['Aurora', 'team']]);
    const command: ManageCommand = { type: 'assign_staff', contestId: ids.contest, accountId: person!, roles: ['volunteer', 'jury'], admin: false };
    // A contest admin runs its contest, but does not choose who staffs it.
    await expect(execute('contestAdmin', command)).rejects.toMatchObject({ status: 403 });
    await expect(execute('volunteer', command)).rejects.toMatchObject({ status: 403 });
    const requestId = randomUUID();
    const versionBefore = (await rows<{ version: number }>('SELECT version FROM sessions WHERE id = ?', ids.contest))[0]!.version;
    const receipt = await execute('eventAdmin', command, requestId);
    expect(await execute('eventAdmin', command, requestId)).toEqual(receipt);
    expect(await rows('SELECT team_id, is_admin FROM memberships WHERE session_id = ? AND account_id = ?', ids.contest, person!))
      .toEqual([{ team_id: null, is_admin: 0 }]);
    expect(await rows('SELECT role FROM membership_roles WHERE session_id = ? AND account_id = ? ORDER BY role', ids.contest, person!))
      .toEqual([{ role: 'jury' }, { role: 'volunteer' }]);
    expect((await rows<{ version: number }>('SELECT version FROM sessions WHERE id = ?', ids.contest))[0]!.version).toBeGreaterThan(versionBefore);
    expect(await rows('SELECT action, target FROM admin_audit WHERE session_id = ?', ids.contest))
      .toEqual([{ action: 'assign_membership', target: person }]);
    expect(await rows(`SELECT audience FROM audience_sequences WHERE session_id = ? ORDER BY audience`, ids.contest))
      .toEqual([{ audience: `account:${person}` }, { audience: 'staff' }]);

    // The last admin may leave. A new assignment replaces the roles.
    await execute('webmaster', { type: 'assign_staff', contestId: ids.contest, accountId: person!, roles: [], admin: true });
    expect(await rows('SELECT is_admin FROM memberships WHERE session_id = ? AND account_id = ?', ids.contest, person!)).toEqual([{ is_admin: 1 }]);
    expect(await rows('SELECT count(*) AS n FROM membership_roles WHERE session_id = ? AND account_id = ?', ids.contest, person!)).toEqual([{ n: 0 }]);
    await execute('eventAdmin', { type: 'unassign_staff', contestId: ids.contest, accountId: caller('contestAdmin').accountId });
    await execute('eventAdmin', { type: 'unassign_staff', contestId: ids.contest, accountId: person! });
    expect(await seatsOf(ids.contest)).toEqual([]);
    await expect(execute('eventAdmin', { type: 'unassign_staff', contestId: ids.contest, accountId: person! }))
      .rejects.toMatchObject({ status: 409 });

    // An entrant's sign-in, an account of another event, and a webmaster cannot take a staff seat.
    const entrantAccount = (await rows<{ id: string }>('SELECT id FROM accounts WHERE entrant_id = ?', team!))[0]!.id;
    for (const accountId of [entrantAccount, caller('otherAdmin').accountId, caller('webmaster').accountId]) {
      await expect(execute('eventAdmin', { ...command, accountId })).rejects.toMatchObject({ status: 409 });
    }
    expect(await rows('SELECT event_id FROM accounts WHERE id = ?', caller('webmaster').accountId)).toEqual([{ event_id: null }]);
    await expect(execute('eventAdmin', { ...command, roles: [], admin: false })).rejects.toMatchObject({ status: 400 });
  });

  it('creates a contest that follows its schedule, and keeps the schedule apart from the intake mode', async () => {
    const created = await execute('eventAdmin', { type: 'create_contest', eventId: ids.event, name: 'Scheduled', contestType: 'teams',
      schedule: { startsAt: '2030-03-01T01:00:00.000Z', endsAt: '2030-03-01T04:00:00.000Z', graceMinutes: 15 }, categories: ['Other'] });
    const id = created.contestId!;
    expect(await rows('SELECT starts_at, ends_at, grace_minutes, intake_follows_schedule FROM sessions WHERE id = ?', id))
      .toEqual([{ starts_at: '2030-03-01T01:00:00.000Z', ends_at: '2030-03-01T04:00:00.000Z', grace_minutes: 15, intake_follows_schedule: 1 }]);
    // Offsets and missing milliseconds become the one stored form.
    await execute('eventAdmin', { type: 'update_contest', contestId: id, name: 'Scheduled', contestType: 'teams',
      schedule: { startsAt: '2030-03-01T09:00:00+08:00', endsAt: '2030-03-01T12:30:00+08:00', graceMinutes: 0 } });
    expect(await rows('SELECT starts_at, ends_at FROM sessions WHERE id = ?', id))
      .toEqual([{ starts_at: '2030-03-01T01:00:00.000Z', ends_at: '2030-03-01T04:30:00.000Z' }]);
    // Staff hold intake by hand. A new schedule leaves the mode alone.
    await execute('contestAdmin', { type: 'set_intake', contestId: ids.contest, mode: 'closed' });
    await execute('eventAdmin', { type: 'set_intake', contestId: id, mode: 'open' });
    await execute('eventAdmin', { type: 'update_contest', contestId: id, name: 'Scheduled', contestType: 'teams',
      schedule: { startsAt: '2030-03-01T02:00:00.000Z', endsAt: '2030-03-01T05:00:00.000Z', graceMinutes: 0 } });
    expect(await rows('SELECT intake_follows_schedule, intake_open FROM sessions WHERE id = ?', id)).toEqual([{ intake_follows_schedule: 0, intake_open: 1 }]);
    expect((await manage.event(caller('eventAdmin'), ids.event)).contests.find((contest) => contest.id === id))
      .toMatchObject({ mode: 'open', intake: { open: true, reason: 'override_open', changesAt: null } });
    await execute('eventAdmin', { type: 'set_intake', contestId: id, mode: 'schedule' });
    expect((await manage.event(caller('eventAdmin'), ids.event)).contests.find((contest) => contest.id === id))
      .toMatchObject({ mode: 'schedule', intake: { open: false, reason: 'before_start', changesAt: '2030-03-01T02:00:00.000Z' }, schedule: { graceMinutes: 0 } });
  });

  it('renames a contest with no schedule and leaves its schedule empty when the command omits one', async () => {
    expect(await rows('SELECT starts_at, ends_at FROM sessions WHERE id = ?', ids.contest)).toEqual([{ starts_at: null, ends_at: null }]);
    await execute('eventAdmin', { type: 'update_contest', contestId: ids.contest, name: 'Renamed only', contestType: 'teams' });
    expect(await rows('SELECT name, starts_at, ends_at FROM sessions WHERE id = ?', ids.contest))
      .toEqual([{ name: 'Renamed only', starts_at: null, ends_at: null }]);
    // A scheduled contest keeps its schedule the same way.
    const created = await execute('eventAdmin', { type: 'create_contest', eventId: ids.event, name: 'Keeps', contestType: 'teams',
      schedule: { startsAt: '2030-03-01T01:00:00.000Z', endsAt: '2030-03-01T04:00:00.000Z', graceMinutes: 15 }, categories: ['Other'] });
    await execute('eventAdmin', { type: 'update_contest', contestId: created.contestId!, name: 'Kept', contestType: 'teams' });
    expect(await rows('SELECT name, starts_at, ends_at, grace_minutes FROM sessions WHERE id = ?', created.contestId!))
      .toEqual([{ name: 'Kept', starts_at: '2030-03-01T01:00:00.000Z', ends_at: '2030-03-01T04:00:00.000Z', grace_minutes: 15 }]);
  });

  it('refuses a schedule that cannot run, and the schedule switch for a contest with no schedule', async () => {
    const create = (schedule: object) => execute('eventAdmin', { type: 'create_contest', eventId: ids.event, name: 'Bad', contestType: 'teams',
      schedule, categories: ['Other'] } as unknown as ManageCommand);
    const times = { startsAt: '2030-03-01T01:00:00.000Z', endsAt: '2030-03-01T04:00:00.000Z' };
    await expect(create({ ...times, endsAt: times.startsAt, graceMinutes: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(create({ startsAt: times.endsAt, endsAt: times.startsAt, graceMinutes: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(create({ ...times, graceMinutes: 241 })).rejects.toMatchObject({ status: 400 });
    await expect(create({ ...times, graceMinutes: 1.5 })).rejects.toMatchObject({ status: 400 });
    await expect(create({ startsAt: 'tomorrow', endsAt: times.endsAt, graceMinutes: 0 })).rejects.toMatchObject({ status: 400 });
    expect(await rows('SELECT id FROM sessions WHERE name = ?', 'Bad')).toEqual([]);
    // ids.contest has no schedule, so it cannot follow one.
    await expect(execute('contestAdmin', { type: 'set_intake', contestId: ids.contest, mode: 'schedule' }))
      .rejects.toMatchObject({ status: 409, message: 'This contest has no schedule. Set its start and end first.' });
    expect(await rows('SELECT intake_follows_schedule FROM sessions WHERE id = ?', ids.contest)).toEqual([{ intake_follows_schedule: 0 }]);
  });

  it('lets a contest admin run its own contest and no other, and refuses staff without admin', async () => {
    const [team] = await entrants('eventAdmin', ids.event, [['Aurora', 'team']]);
    await execute('eventAdmin', { type: 'assign_entrants', contestId: ids.contest, entries: [{ entrantId: team!, location: 'Desk' }] });
    expect(await execute('contestAdmin', { type: 'set_intake', contestId: ids.contest, mode: 'open' })).toEqual({});
    expect(await rows('SELECT intake_open FROM sessions WHERE id = ?', ids.contest)).toEqual([{ intake_open: 1 }]);
    await execute('contestAdmin', { type: 'set_image_limits', contestId: ids.contest, fileMegabytes: 20, count: 8, totalMegabytes: 40 });
    expect(await rows('SELECT max_image_bytes, max_images_per_issue, max_image_bytes_per_issue FROM sessions WHERE id = ?', ids.contest))
      .toEqual([{ max_image_bytes: 20 * 1048576, max_images_per_issue: 8, max_image_bytes_per_issue: 40 * 1048576 }]);
    await expect(execute('contestAdmin', { type: 'set_image_limits', contestId: ids.contest, fileMegabytes: 50, count: 8, totalMegabytes: 40 }))
      .rejects.toMatchObject({ status: 400 });
    await execute('contestAdmin', { type: 'set_categories', contestId: ids.contest, categories: ['Network', 'Other'] });
    expect(await rows('SELECT categories FROM sessions WHERE id = ?', ids.contest)).toEqual([{ categories: '["Network","Other"]' }]);
    await execute('contestAdmin', { type: 'set_location', contestId: ids.contest, entrantId: team!, location: 'Table 9' });
    expect(await rows('SELECT location FROM teams WHERE session_id = ?', ids.contest)).toEqual([{ location: 'Table 9' }]);
    expect((await rows<{ action: string }>('SELECT action FROM admin_audit WHERE session_id = ? ORDER BY at, rowid', ids.contest))
      .map((row) => row.action).sort()).toEqual(['assign_entrants', 'set_categories', 'set_image_limits', 'set_intake', 'set_location']);
    // The category list stays while an issue uses a category in it.
    const [entry] = await rows<{ id: string }>('SELECT id FROM teams WHERE session_id = ?', ids.contest);
    await addIssue(ids.contest, entry!.id, 'Network');
    await expect(execute('contestAdmin', { type: 'set_categories', contestId: ids.contest, categories: ['Other'] }))
      .rejects.toMatchObject({ status: 409, message: 'Network has 1 issue and stays in the list.' });

    for (const command of [
      { type: 'set_intake', contestId: ids.contest, mode: 'closed' },
      { type: 'set_location', contestId: ids.contest, entrantId: team!, location: 'x' },
    ] satisfies ManageCommand[]) {
      await expect(execute('volunteer', command)).rejects.toMatchObject({ status: 403 });
    }
    // The admin of one contest does not reach a contest of another event, and an event admin of one event does not reach another.
    await expect(execute('contestAdmin', { type: 'set_intake', contestId: ids.otherContest, mode: 'open' })).rejects.toMatchObject({ status: 403 });
    await expect(execute('eventAdmin', { type: 'set_intake', contestId: ids.otherContest, mode: 'open' })).rejects.toMatchObject({ status: 403 });
    await expect(execute('webmaster', { type: 'set_intake', contestId: ids.otherContest, mode: 'open' })).resolves.toEqual({});
  });

  it('refuses every write in an archived event, and still shows its console', async () => {
    await run('UPDATE events SET archived = 1 WHERE id = ?', ids.event);
    for (const command of [
      { type: 'create_people', eventId: ids.event, people: [{ handle: 'late', name: 'Late' }] },
      { type: 'create_contest', eventId: ids.event, name: 'Late', contestType: 'teams', schedule: testSchedule, categories: ['Other'] },
      { type: 'set_intake', contestId: ids.contest, mode: 'open' },
    ] satisfies ManageCommand[]) {
      await expect(execute('eventAdmin', command)).rejects.toMatchObject({ status: 403, message: 'This event is archived.' });
    }
    await expect(manage.issueCredentials(caller('eventAdmin'), randomUUID(), { eventId: ids.event, accountIds: [caller('volunteer').accountId] }))
      .rejects.toMatchObject({ status: 403 });
    expect((await manage.event(caller('eventAdmin'), ids.event)).event.archived).toBe(true);
  });

  it('issues passwords to accounts of an event under the account rule, and returns no password on a retry', async () => {
    const [team] = await entrants('eventAdmin', ids.event, [['Aurora', 'team']]);
    const [person] = (await execute('eventAdmin', { type: 'create_people', eventId: ids.event, people: [{ handle: 'pat', name: 'Pat' }] })).accountIds!;
    await execute('eventAdmin', { type: 'assign_entrants', contestId: ids.contest, entries: [{ entrantId: team!, location: '' }] });
    await execute('eventAdmin', { type: 'assign_staff', contestId: ids.contest, accountId: person!, roles: ['volunteer'], admin: false });
    const entrantAccount = (await rows<{ id: string }>('SELECT id FROM accounts WHERE entrant_id = ?', team!))[0]!.id;
    const issue = (by: Name, eventId: string | null, accountIds: string[], requestId: string = randomUUID()) =>
      manage.issueCredentials(caller(by), requestId, { eventId, accountIds });

    const requestId = randomUUID();
    const issued = await issue('eventAdmin', ids.event, [person!, entrantAccount], requestId);
    expect(issued.map(({ accountId, handle }) => ({ accountId, handle }))).toEqual([
      { accountId: person, handle: 'pat' }, { accountId: entrantAccount, handle: 'aurora' }]);
    expect(issued.every((row) => (row.temporaryPassword?.length ?? 0) >= 12)).toBe(true);
    expect(await rows('SELECT credential_state, must_change, credential_generation FROM accounts WHERE id = ?', person!))
      .toEqual([{ credential_state: 'ready', must_change: 1, credential_generation: 2 }]);
    expect(await issue('eventAdmin', ids.event, [person!, entrantAccount], requestId)).toEqual([
      { accountId: person, handle: 'pat', temporaryPassword: null }, { accountId: entrantAccount, handle: 'aurora', temporaryPassword: null }]);
    expect(await rows('SELECT count(*) AS n FROM command_assertions')).toEqual([{ n: 0 }]);

    // A contest admin may issue for accounts that sit only in contests it administers.
    await expect(issue('contestAdmin', ids.event, [entrantAccount])).resolves.toHaveLength(1);
    await expect(issue('contestAdmin', ids.event, [person!])).resolves.toHaveLength(1);
    await expect(issue('contestAdmin', ids.event, [caller('eventAdmin').accountId])).rejects.toMatchObject({ status: 403 });
    await expect(issue('volunteer', ids.event, [entrantAccount])).rejects.toMatchObject({ status: 403 });
    // Another event's admin, an account of another event, and a webmaster by event ID are refused.
    await expect(issue('otherAdmin', ids.event, [person!])).rejects.toMatchObject({ status: 403 });
    await expect(issue('eventAdmin', ids.event, [caller('otherAdmin').accountId])).rejects.toMatchObject({ status: 403 });
    await expect(issue('eventAdmin', ids.event, [caller('webmaster').accountId])).rejects.toMatchObject({ status: 403 });
    await expect(issue('eventAdmin', ids.event, [caller('eventAdmin').accountId])).rejects.toMatchObject({ status: 400 });
    await expect(issue('eventAdmin', null, [person!])).rejects.toMatchObject({ status: 403 });
    // A webmaster issues for an event's accounts by naming the event.
    await expect(issue('webmaster', ids.event, [caller('eventAdmin').accountId])).resolves.toHaveLength(1);
    await expect(issue('webmaster', ids.other, [person!])).rejects.toMatchObject({ status: 403 });
  });

  it('refuses an issue when the caller loses its authority before the batch commits', async () => {
    const racing = new D1ManageService({ prepare: (sql) => db.prepare(sql), batch: async (statements) => {
      await run(`DELETE FROM grants WHERE scope = 'event' AND account_id = ?`, caller('eventAdmin').accountId);
      return db.batch(statements);
    } }, fastPasswords);
    const target = caller('volunteer').accountId;
    await expect(racing.issueCredentials(caller('eventAdmin'), randomUUID(), { eventId: ids.event, accountIds: [target] }))
      .rejects.toMatchObject({ status: 409 });
    expect(await rows('SELECT credential_generation FROM accounts WHERE id = ?', target)).toEqual([{ credential_generation: 1 }]);
  });

  /** A service whose first batch runs `before` first, so that a change lands between the reads and the batch. */
  const racingService = (before: () => Promise<unknown>) => {
    let fired = false;
    return new D1ManageService({ prepare: (sql) => db.prepare(sql), batch: async (statements) => {
      if (!fired) {
        fired = true;
        await before();
      }
      return db.batch(statements);
    } }, fastPasswords);
  };

  it('returns no password to the request that loses a race with a retry of itself', async () => {
    const target = caller('volunteer').accountId;
    const input = { eventId: ids.event, accountIds: [target] };
    const requestId = randomUUID();
    const racing = racingService(async () => {
      // The retry commits first and returns the passwords. The racing request must not return its own.
      expect((await manage.issueCredentials(caller('eventAdmin'), requestId, input))[0]!.temporaryPassword).toBeTruthy();
    });
    expect(await racing.issueCredentials(caller('eventAdmin'), requestId, input))
      .toEqual([{ accountId: target, handle: 'volunteer', temporaryPassword: null }]);
    expect(await rows('SELECT credential_generation FROM accounts WHERE id = ?', target)).toEqual([{ credential_generation: 2 }]);
  });

  it('refuses a contest admin an account that also sits in a contest it does not administer, or in an archived event', async () => {
    const second = await createContest('eventAdmin', ids.event, 'Second', 'teams');
    const [person] = (await execute('eventAdmin', { type: 'create_people', eventId: ids.event, people: [{ handle: 'pat', name: 'Pat' }] })).accountIds!;
    const issue = () => manage.issueCredentials(caller('contestAdmin'), randomUUID(), { eventId: ids.event, accountIds: [person!] });
    await execute('eventAdmin', { type: 'assign_staff', contestId: ids.contest, accountId: person!, roles: ['volunteer'], admin: false });
    await expect(issue()).resolves.toHaveLength(1);
    await execute('eventAdmin', { type: 'assign_staff', contestId: second, accountId: person!, roles: ['volunteer'], admin: false });
    await expect(issue()).rejects.toMatchObject({ status: 403 });
    await execute('eventAdmin', { type: 'unassign_staff', contestId: second, accountId: person! });
    await expect(issue()).resolves.toHaveLength(1);
    await run('UPDATE events SET archived = 1 WHERE id = ?', ids.event);
    await expect(issue()).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    ['its credential generation changes', 'UPDATE accounts SET credential_generation = credential_generation + 1 WHERE id = ?', 2],
    ['it is disabled', 'UPDATE accounts SET disabled = 1 WHERE id = ?', 1],
  ])('refuses an issue when the target changes before the batch commits: %s', async (_name, change, generation) => {
    const target = caller('volunteer').accountId;
    const racing = racingService(() => run(change, target));
    await expect(racing.issueCredentials(caller('eventAdmin'), randomUUID(), { eventId: ids.event, accountIds: [target] }))
      .rejects.toMatchObject({ status: 409 });
    expect(await rows('SELECT credential_generation, must_change FROM accounts WHERE id = ?', target))
      .toEqual([{ credential_generation: generation, must_change: 0 }]);
  });

  it.each([
    ['expired', 'UPDATE logins SET expires_at = unixepoch() - 1 WHERE account_id = ?'],
    ['revoked', 'UPDATE logins SET revoked = 1 WHERE account_id = ?'],
    ['must change its password', 'UPDATE accounts SET must_change = 1 WHERE id = ?'],
    ['pending', `UPDATE accounts SET credential_state = 'pending' WHERE id = ?`],
  ])('refuses an issue when the caller login is %s at the final check', async (_name, change) => {
    const target = caller('volunteer').accountId;
    const racing = racingService(() => run(change, caller('eventAdmin').accountId));
    await expect(racing.issueCredentials(caller('eventAdmin'), randomUUID(), { eventId: ids.event, accountIds: [target] }))
      .rejects.toMatchObject({ status: 409 });
    expect(await rows('SELECT credential_generation, must_change FROM accounts WHERE id = ?', target))
      .toEqual([{ credential_generation: 1, must_change: 0 }]);
  });

  it('shows an event admin and a webmaster the console, and nobody else', async () => {
    const [team, single] = await entrants('eventAdmin', ids.event, [['Aurora', 'team'], ['Solo Sam', 'single']]);
    const contest = await createContest('eventAdmin', ids.event, 'Mixed round', 'mixed');
    await execute('eventAdmin', { type: 'assign_entrants', contestId: contest, entries: [{ entrantId: team!, location: 'T1' }, { entrantId: single!, location: 'T2' }] });
    await execute('eventAdmin', { type: 'assign_staff', contestId: contest, accountId: caller('volunteer').accountId, roles: ['specialist'], admin: false });
    const view = await manage.event(caller('eventAdmin'), ids.event);
    expect(view.event).toEqual({ id: ids.event, name: 'Fictional event', code: 'fictional-event', timeZone: 'UTC', archived: false });
    expect(view.manage).toBe('event');
    expect(view.admins).toEqual([caller('eventAdmin').accountId]);
    expect(view.people.map((person) => person.handle).sort()).toEqual(['contestadmin', 'eventadmin', 'volunteer']);
    expect(view.entrants.map(({ name, kind, handle }) => ({ name, kind, handle }))).toEqual([
      { name: 'Aurora', kind: 'team', handle: 'aurora' }, { name: 'Solo Sam', kind: 'single', handle: 'solo-sam' }]);
    expect(view.contests.map(({ name, contestType, mode }) => ({ name, contestType, mode })))
      .toEqual([{ name: 'Live 1', contestType: 'teams', mode: 'closed' }, { name: 'Mixed round', contestType: 'mixed', mode: 'schedule' }]);
    expect(view.staffAssignments).toEqual(expect.arrayContaining([
      { contestId: contest, accountId: caller('volunteer').accountId, admin: false, roles: ['specialist'] },
      { contestId: ids.contest, accountId: caller('contestAdmin').accountId, admin: true, roles: [] },
    ]));
    expect(view.entries.filter((entry) => entry.contestId === contest).map((entry) => entry.location).sort()).toEqual(['T1', 'T2']);
    expect(view.audit.map((entry) => entry.action)).toContain('assign_entrants');
    expect((await manage.event(caller('webmaster'), ids.event)).manage).toBe('site');
    for (const by of ['contestAdmin', 'volunteer', 'otherAdmin'] as const) {
      await expect(manage.event(caller(by), ids.event)).rejects.toMatchObject({ status: 403 });
    }
    await expect(manage.event(caller('eventAdmin'), 'not-an-event')).rejects.toMatchObject({ status: 400 });
    await expect(manage.event(caller('eventAdmin'), randomUUID())).rejects.toMatchObject({ status: 403 });
    // Without an ID, an event admin reads the own event. A webmaster has none, and a volunteer may not read it.
    expect((await manage.event(caller('eventAdmin'))).event.id).toBe(ids.event);
    await expect(manage.event(caller('webmaster'))).rejects.toMatchObject({ status: 400 });
    await expect(manage.event(caller('volunteer'))).rejects.toMatchObject({ status: 403 });
  });

  /** One valid command of every type, so a new type fails to compile until it has a sample here. */
  const samples = (): Record<ManageCommand['type'], ManageCommand> => {
    const [event, contest, account, entrant] = [ids.event, ids.contest, randomUUID(), randomUUID()];
    return {
      create_event: { type: 'create_event', name: 'New', code: 'new-event', timeZone: 'UTC', firstAdmin: { handle: 'chief', name: 'Chief' } },
      add_webmaster: { type: 'add_webmaster', person: { handle: 'newcomer', name: 'Newcomer' } },
      remove_webmaster: { type: 'remove_webmaster', accountId: account },
      set_webmaster_reads: { type: 'set_webmaster_reads', restricted: true },
      update_event: { type: 'update_event', eventId: event, name: 'New', code: 'new-code', timeZone: 'UTC' },
      set_event_admin: { type: 'set_event_admin', eventId: event, accountId: account, admin: true },
      create_people: { type: 'create_people', eventId: event, people: [{ handle: 'person', name: 'Person' }] },
      create_entrants: { type: 'create_entrants', eventId: event, entrants: [{ kind: 'team', name: 'Team', handle: 'team' }] },
      rename_entrant: { type: 'rename_entrant', eventId: event, entrantId: entrant, name: 'Renamed' },
      create_contest: { type: 'create_contest', eventId: event, name: 'New', contestType: 'teams', schedule: testSchedule, categories: ['Other'] },
      update_contest: { type: 'update_contest', contestId: contest, name: 'New', contestType: 'teams', schedule: testSchedule },
      assign_entrants: { type: 'assign_entrants', contestId: contest, entries: [{ entrantId: entrant, location: '' }] },
      unassign_entrant: { type: 'unassign_entrant', contestId: contest, entrantId: entrant },
      assign_staff: { type: 'assign_staff', contestId: contest, accountId: account, roles: ['jury'], admin: false },
      unassign_staff: { type: 'unassign_staff', contestId: contest, accountId: account },
      set_intake: { type: 'set_intake', contestId: contest, mode: 'open' },
      set_image_limits: { type: 'set_image_limits', contestId: contest, fileMegabytes: 10, count: 4, totalMegabytes: 40 },
      set_categories: { type: 'set_categories', contestId: contest, categories: ['Other'] },
      set_location: { type: 'set_location', contestId: contest, entrantId: entrant, location: 'Desk' },
      join_contest: { type: 'join_contest', contestId: contest },
      set_handle: { type: 'set_handle', eventId: event, accountId: account, handle: 'renamed' },
    };
  };

  it('refuses every command to the account one level below its requirement, before it reads anything else', async () => {
    const below: Record<'site' | 'event' | 'contest', Name> = { site: 'eventAdmin', event: 'contestAdmin', contest: 'volunteer' };
    const commands = samples();
    for (const type of Object.keys(commands) as Array<ManageCommand['type']>) {
      const command = commands[type];
      const requirement = requirementOf[type](command as never);
      // An account command lets every account of the event in, and the plan refuses the one it may not manage.
      if (!('level' in requirement)) continue;
      const refused = below[requirement.level];
      await expect(execute(refused, command), `${type} by ${refused}`).rejects.toMatchObject({ status: 403 });
    }
    expect(await rows('SELECT count(*) AS n FROM manage_receipts')).toEqual([{ n: 0 }]);
    expect(await rows('SELECT count(*) AS n FROM events')).toEqual([{ n: 2 }]);
  });
});

describe('the requirement of every command', () => {
  const event = { scope: 'event', eventId: 'e' } as const;
  const contest = { scope: 'contest', contestId: 'c' } as const;
  const commands = {
    create_event: [{ target: { scope: 'site' }, level: 'site' }],
    add_webmaster: [{ target: { scope: 'site' }, level: 'site' }],
    remove_webmaster: [{ target: { scope: 'site' }, level: 'site' }],
    set_webmaster_reads: [{ target: { scope: 'site' }, level: 'site' }],
    update_event: [{ target: event, level: 'event' }],
    set_event_admin: [{ target: event, level: 'event' }],
    create_people: [{ target: event, level: 'event' }],
    create_entrants: [{ target: event, level: 'event' }],
    rename_entrant: [{ target: event, level: 'event' }],
    create_contest: [{ target: event, level: 'event' }],
    update_contest: [{ target: contest, level: 'event' }],
    assign_entrants: [{ target: contest, level: 'event' }],
    unassign_entrant: [{ target: contest, level: 'event' }],
    assign_staff: [{ target: contest, level: 'event' }],
    unassign_staff: [{ target: contest, level: 'event' }],
    set_intake: [{ target: contest, level: 'contest' }],
    set_image_limits: [{ target: contest, level: 'contest' }],
    set_categories: [{ target: contest, level: 'contest' }],
    set_location: [{ target: contest, level: 'contest' }],
    join_contest: [{ target: contest, level: 'site' }],
    set_handle: [{ target: event, account: 'a' }],
  } as const;

  it.each(Object.entries(commands))('%s needs the authority that the design names', (type, [expected]) => {
    // The fields that a requirement reads are the same for every command: e, c, and a.
    const fields = { eventId: 'e', contestId: 'c', accountId: 'a' };
    const read = requirementOf[type as ManageCommand['type']] as (command: object) => unknown;
    expect(read({ type, ...fields })).toEqual(expected);
  });
});
