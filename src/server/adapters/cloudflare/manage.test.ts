import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { EventCode, Handle, ManageCommand } from '../../../backend/contracts';
import type { Caller } from '../../authentication';
import type { D1Binding, D1Connection, D1Value } from '../d1/connection';
import { applyMigrations } from '../d1/testFixture';
import { D1ApplicationService } from './application';
import { D1AuthenticationService } from './authentication';
import { createBetterAuthIdentity } from './identity';
import { loginKeyFor } from './credentials';
import { D1ManageService } from './manage';
import { passwordHasher, randomSecret, type PasswordHasher } from './password';

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
    const [issued] = await issuing.issueCredentials(caller('first'), requestId, [added]);
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
    expect(await issuing.issueCredentials(caller('first'), requestId, [added]))
      .toEqual([{ accountId: added, handle: 'newcomer', temporaryPassword: null }]);
    expect(await rows("SELECT action, state, actor FROM account_operations WHERE account_id = ?", added))
      .toEqual([{ action: 'reset_password', state: 'completed', actor: caller('first').accountId }]);
    expect(await rows("SELECT json_extract(detail, '$.accountIds') AS accounts FROM authority_audit WHERE action = 'issue_passwords'"))
      .toEqual([{ accounts: JSON.stringify([added]) }]);
    await expect(issuing.issueCredentials(caller('first'), requestId, [caller('second').accountId]))
      .rejects.toMatchObject({ status: 409, message: 'This request was already used for another change. Refresh and try again.' });
  });

  it('resets another webmaster and refuses the own account, other accounts, and other callers', async () => {
    const issue = (person: Person, accountIds: unknown) => manage.issueCredentials(caller(person), randomUUID(), accountIds);
    await expect(issue('first', [caller('first').accountId])).rejects.toMatchObject({ status: 400 });
    await expect(issue('first', [caller('contestAdmin').accountId])).rejects.toMatchObject({ status: 409 });
    await expect(issue('contestAdmin', [caller('first').accountId])).rejects.toMatchObject({ status: 403 });
    await expect(issue('first', Array.from({ length: 9 }, () => randomUUID()))).rejects.toMatchObject({ status: 400 });
    const second = caller('second').accountId;
    const failing = new D1ManageService({ prepare: (sql) => db.prepare(sql), batch: () => Promise.reject(new Error('private detail')) },
      fastPasswords);
    await expect(failing.issueCredentials(caller('first'), randomUUID(), [second]))
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
    expect((await authentication.current(headers))?.status).toEqual({ handle: 'desk-volunteer', must_change: false, session_valid: true });
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
    const admin = await signIn('contestadmin');
    await expect(authentication.account(admin, ids.contest, { action: 'reset_password', userId: legacy }))
      .rejects.toMatchObject({ status: 409, message: 'Set a username before resetting this account.' });
    expect(await rows('SELECT credential_state FROM accounts WHERE id = ?', legacy)).toEqual([{ credential_state: 'ready' }]);
    expect(await rename('contestAdmin', legacy, 'desk-legacy')).toEqual({});
    const reset = await authentication.account(admin, ids.contest, { action: 'reset_password', userId: legacy });
    expect(reset.signIn).toEqual({ kind: 'event', code: await eventCode() });
    const signedIn = await authentication.current(await signIn('desk-legacy', reset.temporaryPassword));
    expect(signedIn).toMatchObject({ user: { id: legacy }, status: { handle: 'desk-legacy', must_change: true } });
    expect(await rows('SELECT a.username, b.username AS identity FROM accounts a JOIN ba_user b ON b.id = a.id WHERE a.id = ?', legacy))
      .toEqual([{ username: loginKeyFor(legacy), identity: loginKeyFor(legacy) }]);
  });
});
