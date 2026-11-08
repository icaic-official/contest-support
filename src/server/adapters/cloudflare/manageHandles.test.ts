import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventCode, Handle, SignInTarget } from '../../../backend/contracts';
import type { Caller } from '../../authentication';
import type { D1Binding, D1Value } from '../d1/connection';
import { applyMigrations } from '../d1/testFixture';
import { D1AuthenticationService } from './authentication';
import { createBetterAuthIdentity } from './identity';
import { loginKeyFor } from './credentials';
import { D1ManageService } from './manage';
import { passwordHasher, randomSecret, type PasswordHasher } from './password';
import { openLocalPlatform } from './tooling/store-database.mjs';

const fastPasswords: PasswordHasher = { hash: async () => 'fictional-test-hash', verify: async () => false };

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
    const platform = await openLocalPlatform<{ DB: D1Binding }>('wrangler.auth-ci.jsonc');
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
    await run('DELETE FROM membership_roles WHERE account_id = ?', caller('volunteer').accountId);
    await run('DELETE FROM memberships WHERE account_id = ?', caller('volunteer').accountId);
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
