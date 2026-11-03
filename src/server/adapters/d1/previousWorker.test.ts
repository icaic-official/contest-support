import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import type { D1Connection, D1Value } from './connection';
import { applyMigrations } from './testFixture';

const configPath = 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';
const scopedAuthority = '0017_scoped_authority.sql';
const eventSignIn = '0018_event_sign_in.sql';

/**
 * The previous Worker's statements, copied from the releases before the scoped
 * authority schema and before the event sign-in schema. They stay fixed when
 * the current code changes.
 */
const previousWorker = {
  createAccount: (db: D1Connection, actor: string, sessionId: string, account: { id: string; username: string; teamId?: string }) => [
    db.prepare(`INSERT INTO accounts (id, name, username, must_change, credential_state, credential_operation)
      VALUES (?, ?, ?, 1, 'pending', ?)`).bind(account.id, `Fictional ${account.username}`, account.username, `op-${account.id}`),
    db.prepare('INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, ?, ?)')
      .bind(sessionId, account.id, account.teamId ?? null, 0),
    db.prepare(`INSERT INTO account_operations (id, account_id, actor, session_id, action, state) VALUES (?, ?, ?, ?, ?, 'pending')`)
      .bind(`op-${account.id}`, account.id, actor, sessionId, 'create_account'),
  ],
  saveMember: (db: D1Connection, sessionId: string, accountId: string) =>
    db.prepare(`INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id, account_id) DO UPDATE SET team_id = excluded.team_id, is_admin = excluded.is_admin`)
      .bind(sessionId, accountId, null, 0),
  resetPassword: (db: D1Connection, actor: string, sessionId: string, target: string) => {
    const operationId = randomUUID();
    return [
      db.prepare(`UPDATE account_operations SET state = 'superseded' WHERE account_id = ? AND state = 'pending'`).bind(target),
      db.prepare(`UPDATE accounts SET must_change = 1, credential_state = 'pending', credential_operation = ?,
        credential_generation = credential_generation + 1 WHERE id = ?`).bind(operationId, target),
      db.prepare('UPDATE logins SET revoked = 1 WHERE account_id = ?').bind(target),
      db.prepare('DELETE FROM ba_session WHERE userId = ?').bind(target),
      db.prepare(`INSERT INTO account_operations (id, account_id, actor, session_id, action, state)
        VALUES (?, ?, ?, ?, 'reset_password', 'pending')`).bind(operationId, target, actor, sessionId),
    ];
  },
  signInSql: 'SELECT * FROM accounts WHERE username = ?',
  setUsername: (db: D1Connection, actor: string, sessionId: string, target: string, username: string) => [
    db.prepare('UPDATE accounts SET username = ? WHERE id = ?').bind(username, target),
    db.prepare(`INSERT INTO account_operations (id, account_id, actor, session_id, action, state, completed_at)
      VALUES (?, ?, ?, ?, 'set_username', 'completed', unixepoch())`).bind(randomUUID(), target, actor, sessionId),
  ],
  addWebmaster: (db: D1Connection, actor: string, account: { id: string; username: string }) => [
    db.prepare(`INSERT INTO accounts (id, name, username, must_change, credential_state)
      VALUES (?, ?, ?, 1, 'pending')`).bind(account.id, `Fictional ${account.username}`, account.username),
    db.prepare(`INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', ?)`).bind(account.id, actor),
  ],
};

async function open(): Promise<{ db: D1Connection; dispose: () => Promise<void> }> {
  return openStoreDatabase({ configPath, remoteBindings: false });
}

function writer(db: D1Connection) {
  return {
    run: (sql: string, ...values: D1Value[]) => db.prepare(sql).bind(...values).run(),
    first: <T>(sql: string, ...values: D1Value[]) => db.prepare(sql).bind(...values).first<T>(),
    all: async <T>(sql: string, ...values: D1Value[]) => (await db.prepare(sql).bind(...values).all<T>()).results,
  };
}

function addAccount(db: D1Connection, id: string, username: string) {
  return db.prepare('INSERT INTO accounts (id, name, username, must_change) VALUES (?, ?, ?, 0)')
    .bind(id, `Fictional ${username}`, username).run();
}

describe('the previous Worker on the scoped authority schema', () => {
  describe('on data written before the migration', () => {
    let db: D1Connection;
    let dispose: () => Promise<void>;
    const ids = {
      bootstrap: randomUUID(), other: randomUUID(),
      practice: randomUUID(), live: randomUUID(), otherContest: randomUUID(),
      owner: randomUUID(), crossing: randomUUID(), otherStaff: randomUUID(), orphan: randomUUID(),
      organizer: randomUUID(), playtest: randomUUID(),
    };

    beforeAll(async () => {
      ({ db, dispose } = await open());
      await applyMigrations(db, (name) => name < scopedAuthority);
      const { run } = writer(db);
      await run('INSERT INTO events (id, name) VALUES (?, ?), (?, ?)', ids.bootstrap, 'Bootstrap event', ids.other, 'Other event');
      await run('INSERT INTO sessions (id, event_id, name) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)',
        ids.practice, ids.bootstrap, 'Practice', ids.live, ids.bootstrap, 'Live', ids.otherContest, ids.other, 'Other');
      const usernames = { owner: ids.owner, crossing: ids.crossing, otherstaff: ids.otherStaff, orphan: ids.orphan,
        organizer: ids.organizer, 'playtest-admin': ids.playtest };
      for (const [username, id] of Object.entries(usernames)) await addAccount(db, id, username);
      // Before the migration, D1 accepted a membership in any event.
      await run(`INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, 1), (?, ?, 0), (?, ?, 0), (?, ?, 0), (?, ?, 0),
        (?, ?, 1), (?, ?, 1)`,
      ids.practice, ids.owner, ids.practice, ids.crossing, ids.live, ids.crossing, ids.otherContest, ids.crossing,
      ids.otherContest, ids.otherStaff, ids.practice, ids.organizer, ids.live, ids.playtest);
      await run(`INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'jury')`, ids.live, ids.playtest);
      await run('INSERT INTO installation (singleton, id, owner_account_id, event_id, session_id) VALUES (1, ?, ?, ?, ?)',
        randomUUID(), ids.owner, ids.bootstrap, ids.practice);
      await applyMigrations(db, (name) => name >= scopedAuthority);
    });
    afterAll(async () => { await dispose?.(); });

    it('keeps every membership and places each account in the event of most of its memberships', async () => {
      const { all } = writer(db);
      const placed = await all<{ id: string; event_id: string }>('SELECT id, event_id FROM accounts');
      expect(Object.fromEntries(placed.map((row) => [row.id, row.event_id]))).toEqual({
        [ids.owner]: ids.bootstrap, [ids.crossing]: ids.bootstrap, [ids.otherStaff]: ids.other, [ids.orphan]: ids.bootstrap,
        [ids.organizer]: null, [ids.playtest]: null,
      });
      expect(await all('SELECT session_id FROM memberships WHERE account_id = ?', ids.crossing)).toHaveLength(3);
    });

    it('promotes organizer and playtest-admin to webmasters who keep their admin memberships', async () => {
      const { all } = writer(db);
      expect(await all(`SELECT account_id, granted_by FROM grants WHERE scope = 'site' ORDER BY account_id`))
        .toEqual([ids.organizer, ids.playtest].sort().map((id) => ({ account_id: id, granted_by: 'migration:0017' })));
      expect(await all('SELECT session_id, is_admin FROM memberships WHERE account_id IN (?, ?) ORDER BY session_id', ids.organizer, ids.playtest))
        .toEqual([{ session_id: ids.practice, is_admin: 1 }, { session_id: ids.live, is_admin: 1 }]
          .sort((left, right) => left.session_id.localeCompare(right.session_id)));
      expect(await all(`SELECT target FROM authority_audit WHERE event_id IS NULL AND action = 'promote_webmaster' ORDER BY target`))
        .toEqual([ids.organizer, ids.playtest].sort().map((target) => ({ target })));
      const versions = await all<{ id: string; access_version: number }>('SELECT id, access_version FROM accounts WHERE id IN (?, ?)', ids.owner, ids.organizer);
      const version = (id: string) => versions.find((row) => row.id === id)?.access_version;
      expect(version(ids.organizer), 'the grant moves the access version of a promoted account').toBe((version(ids.owner) ?? 0) + 1);
    });

    it('cannot let a contest admin with another name reset a promoted webmaster', async () => {
      const before = await writer(db).first('SELECT credential_generation FROM accounts WHERE id = ?', ids.organizer);
      await expect(db.batch(previousWorker.resetPassword(db, ids.owner, ids.practice, ids.organizer)))
        .rejects.toThrow(/Only a webmaster, or an event admin of the same event/);
      expect(await writer(db).first('SELECT credential_generation FROM accounts WHERE id = ?', ids.organizer)).toEqual(before);
    });

    it('places an account that it creates in the event of its first contest', async () => {
      const created = randomUUID();
      await db.batch(previousWorker.createAccount(db, ids.owner, ids.live, { id: created, username: 'newstaff' }));
      expect(await writer(db).first('SELECT event_id FROM accounts WHERE id = ?', created)).toEqual({ event_id: ids.bootstrap });
    });

    it('cannot attach an account of another event to a contest', async () => {
      await expect(previousWorker.saveMember(db, ids.practice, ids.otherStaff).run()).rejects.toThrow(/own event/);
      expect(await writer(db).first('SELECT 1 FROM memberships WHERE session_id = ? AND account_id = ?', ids.practice, ids.otherStaff))
        .toBeNull();
    });

    it('signs in by username through the unique username index', async () => {
      const plan = await db.prepare(`EXPLAIN QUERY PLAN ${previousWorker.signInSql}`).bind('owner').all<{ detail: string }>();
      expect(plan.results.map((row) => row.detail).join('\n')).toContain('accounts_username (username=?)');
      expect(await writer(db).all(previousWorker.signInSql, 'crossing')).toHaveLength(1);
    });

    it('deletes an event and its accounts in one batch, but never leaves an account without its event', async () => {
      const { first, run } = writer(db);
      // The key is checked at commit. Local D1 then reports an internal error, not the constraint name.
      await expect(run('DELETE FROM events WHERE id = ?', ids.other)).rejects.toThrow();
      expect(await first('SELECT event_id FROM accounts WHERE id = ?', ids.otherStaff)).toEqual({ event_id: ids.other });
      await db.batch([
        db.prepare('DELETE FROM events WHERE id = ?').bind(ids.other),
        db.prepare('DELETE FROM accounts WHERE id = ?').bind(ids.otherStaff),
      ]);
      expect(await first('SELECT id FROM events WHERE id = ?', ids.other)).toBeNull();
      expect(await first('SELECT id FROM accounts WHERE id = ?', ids.otherStaff)).toBeNull();
    });
  });

  describe('on data where the two names are not contest admins', () => {
    let db: D1Connection;
    let dispose: () => Promise<void>;
    const ids = { event: randomUUID(), contest: randomUUID(), team: randomUUID(), organizer: randomUUID(), playtest: randomUUID(), admin: randomUUID() };

    beforeAll(async () => {
      ({ db, dispose } = await open());
      await applyMigrations(db, (name) => name < scopedAuthority);
      const { run } = writer(db);
      await run('INSERT INTO events (id, name) VALUES (?, ?)', ids.event, 'Self-hosted event');
      await run('INSERT INTO sessions (id, event_id, name) VALUES (?, ?, ?)', ids.contest, ids.event, 'Main');
      await run('INSERT INTO teams (id, session_id, name) VALUES (?, ?, ?)', ids.team, ids.contest, 'Organizer team');
      await addAccount(db, ids.organizer, 'organizer');
      await addAccount(db, ids.playtest, 'playtest-admin');
      await addAccount(db, ids.admin, 'admin');
      await run('INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, ?, 0), (?, ?, NULL, 0), (?, ?, NULL, 1)',
        ids.contest, ids.organizer, ids.team, ids.contest, ids.playtest, ids.contest, ids.admin);
      await run(`INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')`, ids.contest, ids.playtest);
      await run('INSERT INTO installation (singleton, id, owner_account_id, event_id, session_id) VALUES (1, ?, ?, ?, ?)',
        randomUUID(), ids.admin, ids.event, ids.contest);
      await applyMigrations(db, (name) => name >= scopedAuthority);
    });
    afterAll(async () => { await dispose?.(); });

    it('promotes nobody, and every account stays in its event', async () => {
      const { all } = writer(db);
      expect(await all('SELECT account_id FROM grants')).toEqual([]);
      expect(await all('SELECT id FROM accounts WHERE event_id IS NOT ?', ids.event)).toEqual([]);
      expect(await all('SELECT is_admin FROM memberships WHERE account_id = ?', ids.admin)).toEqual([{ is_admin: 1 }]);
    });
  });

  describe('on a site with one contest', () => {
    let db: D1Connection;
    let dispose: () => Promise<void>;
    const event = randomUUID();
    const contest = randomUUID();
    const people = { webmaster: randomUUID(), eventAdmin: randomUUID(), contestAdmin: randomUUID(), volunteer: randomUUID() };

    beforeAll(async () => {
      ({ db, dispose } = await open());
      await applyMigrations(db);
      const { run } = writer(db);
      await run('INSERT INTO events (id, name) VALUES (?, ?)', event, 'Only event');
      await run('INSERT INTO sessions (id, event_id, name) VALUES (?, ?, ?)', contest, event, 'Only contest');
      for (const [name, id] of Object.entries(people)) await addAccount(db, id, name.toLowerCase());
      await run(`INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', 'fixture')`, people.webmaster);
      await run('UPDATE accounts SET event_id = ? WHERE id = ?', event, people.eventAdmin);
      await run(`INSERT INTO grants (account_id, scope, event_id, granted_by) VALUES (?, 'event', ?, 'fixture')`, people.eventAdmin, event);
      // The webmaster keeps the admin membership, as a promoted account does.
      await run('INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, 1), (?, ?, 1), (?, ?, 1), (?, ?, 0)',
        contest, people.webmaster, contest, people.eventAdmin, contest, people.contestAdmin, contest, people.volunteer);
      await run(`INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')`, contest, people.volunteer);
    });
    afterAll(async () => { await dispose?.(); });

    const credentials = (id: string) => writer(db).first<{ credential_generation: number; credential_state: string }>(
      'SELECT credential_generation, credential_state FROM accounts WHERE id = ?', id);

    it('cannot let a contest admin reset a webmaster or an event admin, and changes nothing', async () => {
      for (const target of [people.webmaster, people.eventAdmin]) {
        const before = await credentials(target);
        await expect(db.batch(previousWorker.resetPassword(db, people.contestAdmin, contest, target)))
          .rejects.toThrow(/Only a webmaster, or an event admin of the same event/);
        expect(await credentials(target)).toEqual(before);
      }
    });

    it('still lets a contest admin reset a volunteer, and a webmaster reset an event admin', async () => {
      await db.batch(previousWorker.resetPassword(db, people.contestAdmin, contest, people.volunteer));
      await db.batch(previousWorker.resetPassword(db, people.webmaster, contest, people.eventAdmin));
      expect((await credentials(people.volunteer))?.credential_state).toBe('pending');
      expect((await credentials(people.eventAdmin))?.credential_state).toBe('pending');
    });
  });

  describe('on the event sign-in schema', () => {
    let db: D1Connection;
    let dispose: () => Promise<void>;
    const ids = {
      first: randomUUID(), second: randomUUID(), firstContest: randomUUID(), secondContest: randomUUID(),
      staff: randomUUID(), webmaster: randomUUID(), orphan: randomUUID(), unnamed: randomUUID(), current: randomUUID(),
    };

    beforeAll(async () => {
      ({ db, dispose } = await open());
      await applyMigrations(db, (name) => name < eventSignIn);
      const { run } = writer(db);
      await run('INSERT INTO events (id, name) VALUES (?, ?), (?, ?)', ids.first, 'First event', ids.second, 'Second event');
      await run('INSERT INTO sessions (id, event_id, name) VALUES (?, ?, ?), (?, ?, ?)',
        ids.firstContest, ids.first, 'First contest', ids.secondContest, ids.second, 'Second contest');
      await addAccount(db, ids.staff, 'staff');
      await run('INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, 1)', ids.firstContest, ids.staff);
      await db.batch(previousWorker.addWebmaster(db, ids.webmaster, { id: ids.webmaster, username: 'webmaster' }));
      await addAccount(db, ids.orphan, 'orphan');
      await run('INSERT INTO accounts (id, name, must_change) VALUES (?, ?, 0)', ids.unnamed, 'Fictional unnamed');
      await run('INSERT INTO memberships (session_id, account_id) VALUES (?, ?)', ids.firstContest, ids.unnamed);
      await run(`INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')`, ids.firstContest, ids.unnamed);
      await applyMigrations(db, (name) => name >= eventSignIn);
      // An account that the new Worker creates: an opaque login key and a typed handle.
      await run('INSERT INTO accounts (id, name, username, handle, event_id, must_change) VALUES (?, ?, ?, ?, ?, 0)',
        ids.current, 'Fictional current', ids.current.replaceAll('-', ''), 'team01', ids.first);
    });
    afterAll(async () => { await dispose?.(); });

    it('gives every event a distinct random code and the UTC time zone', async () => {
      const events = await writer(db).all<{ code: string; time_zone: string }>('SELECT code, time_zone FROM events');
      expect(events).toHaveLength(2);
      for (const event of events) {
        expect(event.code).toMatch(/^e[0-9a-f]{16}$/);
        expect(event.time_zone).toBe('UTC');
      }
      expect(new Set(events.map((event) => event.code)).size).toBe(2);
    });

    it('gives each legacy account its username as handle, except an account with no event and no site grant', async () => {
      const handles = await writer(db).all<{ id: string; username: string | null; handle: string | null }>(
        'SELECT id, username, handle FROM accounts WHERE id IN (?, ?, ?, ?)', ids.staff, ids.webmaster, ids.orphan, ids.unnamed);
      expect(Object.fromEntries(handles.map((row) => [row.id, [row.username, row.handle]]))).toEqual({
        [ids.staff]: ['staff', 'staff'], [ids.webmaster]: ['webmaster', 'webmaster'],
        [ids.orphan]: ['orphan', null], [ids.unnamed]: [null, null],
      });
    });

    it('gives an event that the previous Worker inserts a code', async () => {
      const event = randomUUID();
      await writer(db).run('INSERT INTO events (id, name) VALUES (?, ?)', event, 'Previous Worker event');
      expect((await writer(db).first<{ code: string }>('SELECT code FROM events WHERE id = ?', event))?.code)
        .toMatch(/^e[0-9a-f]{16}$/);
    });

    it('gives an account that the previous Worker creates its username as handle in the event of its contest', async () => {
      const created = randomUUID();
      await db.batch(previousWorker.createAccount(db, ids.staff, ids.firstContest, { id: created, username: 'newstaff' }));
      expect(await writer(db).first('SELECT event_id, handle FROM accounts WHERE id = ?', created))
        .toEqual({ event_id: ids.first, handle: 'newstaff' });
    });

    it('refuses a previous Worker account whose username is a handle in the same event, and accepts it in another', async () => {
      const refused = randomUUID();
      await expect(db.batch(previousWorker.createAccount(db, ids.staff, ids.firstContest, { id: refused, username: 'team01' })))
        .rejects.toThrow(/UNIQUE constraint failed: accounts\.event_id, accounts\.handle/);
      expect(await writer(db).first('SELECT id FROM accounts WHERE id = ?', refused)).toBeNull();
      const elsewhere = randomUUID();
      await db.batch(previousWorker.createAccount(db, ids.staff, ids.secondContest, { id: elsewhere, username: 'team01' }));
      expect(await writer(db).first('SELECT event_id, handle FROM accounts WHERE id = ?', elsewhere))
        .toEqual({ event_id: ids.second, handle: 'team01' });
    });

    it('gives a username that the previous Worker sets to the handle', async () => {
      await db.batch(previousWorker.setUsername(db, ids.staff, ids.firstContest, ids.unnamed, 'named-later'));
      expect(await writer(db).first('SELECT username, handle FROM accounts WHERE id = ?', ids.unnamed))
        .toEqual({ username: 'named-later', handle: 'named-later' });
    });

    it('gives a webmaster that the previous Worker adds a site handle', async () => {
      const added = randomUUID();
      await db.batch(previousWorker.addWebmaster(db, ids.webmaster, { id: added, username: 'second-webmaster' }));
      expect(await writer(db).first('SELECT event_id, handle FROM accounts WHERE id = ?', added))
        .toEqual({ event_id: null, handle: 'second-webmaster' });
    });

    it('signs in a legacy account by username, and finds no account by the handle of a newer account', async () => {
      const plan = await db.prepare(`EXPLAIN QUERY PLAN ${previousWorker.signInSql}`).bind('staff').all<{ detail: string }>();
      expect(plan.results.map((row) => row.detail).join('\n')).toContain('accounts_username (username=?)');
      expect(await writer(db).all(previousWorker.signInSql, 'staff')).toHaveLength(1);
      const typed = await writer(db).all<{ id: string }>(previousWorker.signInSql, 'team01');
      expect(typed.map((row) => row.id)).not.toContain(ids.current);
    });

    it('signs a renamed legacy account in by its old username, even after another account takes that handle', async () => {
      const { run, all } = writer(db);
      // set_handle writes only the handle.
      await run('UPDATE accounts SET handle = ? WHERE id = ?', 'desk-staff', ids.staff);
      const taker = randomUUID();
      await run('INSERT INTO accounts (id, name, username, handle, event_id, must_change) VALUES (?, ?, ?, ?, ?, 0)',
        taker, 'Fictional taker', taker.replaceAll('-', ''), 'staff', ids.first);
      expect((await all<{ id: string }>(previousWorker.signInSql, 'staff')).map((row) => row.id)).toEqual([ids.staff]);
    });
  });
});
