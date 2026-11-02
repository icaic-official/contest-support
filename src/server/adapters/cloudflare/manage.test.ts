import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { ManageCommand } from '../../../backend/contracts';
import type { Caller } from '../../authentication';
import type { D1Binding, D1Connection, D1Value } from '../d1/connection';
import { applyMigrations } from '../d1/testFixture';
import { D1ApplicationService } from './application';
import { D1AuthenticationService } from './authentication';
import { createBetterAuthIdentity } from './identity';
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
    const command: ManageCommand = { type: 'add_webmaster', person: { username: 'New-Webmaster', name: 'Fictional newcomer' } };
    const receipt = await execute('first', command, requestId);
    expect(receipt.accountIds).toHaveLength(1);
    const [added] = receipt.accountIds!;
    expect(await execute('first', command, requestId)).toEqual(receipt);
    expect((await manage.site(caller('first'))).webmasters).toContainEqual(
      { id: added, name: 'Fictional newcomer', username: 'new-webmaster', ready: false });
    expect(await rows('SELECT action, actor, actor_name, target, event_id FROM authority_audit')).toEqual([{
      action: 'add_webmaster', actor: caller('first').accountId, actor_name: 'Fictional first', target: added, event_id: null,
    }]);
    await expect(execute('first', { type: 'set_webmaster_reads', restricted: true }, requestId))
      .rejects.toMatchObject({ status: 409, message: 'This request was already used for another change. Refresh and try again.' });
    await expect(execute('second', { type: 'add_webmaster', person: { username: 'new-webmaster', name: 'Copy' } }))
      .rejects.toMatchObject({ status: 409, message: 'That username is taken. Choose another.' });
    expect(await rows("SELECT count(*) AS n FROM accounts WHERE username = 'new-webmaster'")).toEqual([{ n: 1 }]);
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
    const command: ManageCommand = { type: 'add_webmaster', person: { username: 'lost-response', name: 'Fictional' } };
    const receipt = await new D1ManageService(lossy, fastPasswords).execute(caller('first'), requestId, command);
    expect(await execute('first', command, requestId)).toEqual(receipt);
    expect(await rows("SELECT id FROM accounts WHERE username = 'lost-response'")).toEqual([{ id: receipt.accountIds![0] }]);
  });

  it('refuses everyone but webmasters', async () => {
    await expect(manage.site(caller('contestAdmin'))).rejects.toMatchObject({ status: 403 });
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
    expect((await manage.site(caller('first'))).contestsToJoin).toEqual([]);

    await execute('second', { type: 'set_webmaster_reads', restricted: true });
    const site = await manage.site(caller('first'));
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
    expect((await manage.site(caller('first'))).contestsToJoin.map((contest) => contest.id)).toEqual([ids.otherContest]);
    expect((await application.snapshot(caller('second'), ids.contest)).membership).toBeNull();

    // A join persists while the restriction is off and on again (owner decision 9).
    await execute('second', { type: 'set_webmaster_reads', restricted: false });
    expect((await manage.site(caller('first'))).contestsToJoin).toEqual([]);
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
    await expect(manage.site(caller('second'))).rejects.toMatchObject({ status: 403 });
    expect(await rows('SELECT revoked FROM logins WHERE account_id = ?', caller('second').accountId)).toEqual([{ revoked: 1 }]);
    expect(await rows('SELECT scope FROM grants WHERE account_id = ?', caller('second').accountId)).toEqual([]);
    expect((await manage.site(caller('first'))).webmasters.map((webmaster) => webmaster.id)).toEqual([caller('first').accountId]);

    await expect(execute('first', { type: 'remove_webmaster', accountId: caller('first').accountId })).rejects.toMatchObject(lastWebmaster);
    await expect(execute('first', { type: 'remove_webmaster', accountId: caller('contestAdmin').accountId }))
      .rejects.toMatchObject({ status: 409, message: 'That account is not a webmaster. Refresh the page.' });
    await expect(run(`DELETE FROM grants WHERE scope = 'site' AND account_id = ?`, caller('first').accountId))
      .rejects.toThrow(/The last webmaster cannot be removed/);

    const { accountIds } = await execute('first', { type: 'add_webmaster', person: { username: 'pending', name: 'Fictional pending' } });
    await expect(execute('first', { type: 'remove_webmaster', accountId: caller('first').accountId }))
      .rejects.toMatchObject({ status: 409, message: 'Give another webmaster a password before you remove yourself.' });
    await run("UPDATE accounts SET credential_state = 'ready' WHERE id = ?", accountIds![0]!);
    await execute('first', { type: 'remove_webmaster', accountId: caller('first').accountId });
    await expect(manage.site(caller('first'))).rejects.toMatchObject({ status: 403 });
    expect(await rows('SELECT revoked FROM logins WHERE account_id = ?', caller('first').accountId)).toEqual([{ revoked: 0 }]);
    expect(await rows("SELECT action, actor, target FROM authority_audit WHERE action = 'remove_webmaster' ORDER BY at, rowid")).toEqual([
      { action: 'remove_webmaster', actor: caller('first').accountId, target: caller('second').accountId },
      { action: 'remove_webmaster', actor: caller('first').accountId, target: caller('first').accountId },
    ]);
  });

  it('issues a new webmaster a password in one batch, and a retry returns the account without it', async () => {
    const { accountIds } = await execute('first', { type: 'add_webmaster', person: { username: 'newcomer', name: 'Fictional newcomer' } });
    const added = accountIds![0]!;
    const requestId = randomUUID();
    const issuing = new D1ManageService(db, passwordHasher);
    const [issued] = await issuing.issueCredentials(caller('first'), requestId, [added]);
    expect(issued).toMatchObject({ accountId: added, username: 'newcomer' });
    expect(issued!.temporaryPassword).toMatch(/^.{12,}$/);
    expect((await manage.site(caller('first'))).webmasters).toContainEqual(expect.objectContaining({ id: added, ready: true }));
    const authentication = new D1AuthenticationService(db, createBetterAuthIdentity(db, {
      origin: 'http://127.0.0.1:8788', secret: randomSecret(), secureCookies: false,
    }), passwordHasher);
    const signed = await authentication.signIn('newcomer', issued!.temporaryPassword!);
    const current = await authentication.current(new Headers({ cookie: signed.cookie.split(';')[0]! }));
    expect(current?.user.id).toBe(added);
    expect(current?.status.must_change).toBe(true);
    expect(await issuing.issueCredentials(caller('first'), requestId, [added]))
      .toEqual([{ accountId: added, username: 'newcomer', temporaryPassword: null }]);
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
