import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import type { D1Connection, D1Value } from './connection';
import { applyMigrations } from './testFixture';

const configPath = 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';
const scopedAuthority = '0017_scoped_authority.sql';

/**
 * The previous Worker's statements, copied from the release before the scoped
 * authority schema. They stay fixed when the current code changes.
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
    };

    beforeAll(async () => {
      ({ db, dispose } = await open());
      await applyMigrations(db, (name) => name < scopedAuthority);
      const { run } = writer(db);
      await run('INSERT INTO events (id, name) VALUES (?, ?), (?, ?)', ids.bootstrap, 'Bootstrap event', ids.other, 'Other event');
      await run('INSERT INTO sessions (id, event_id, name) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)',
        ids.practice, ids.bootstrap, 'Practice', ids.live, ids.bootstrap, 'Live', ids.otherContest, ids.other, 'Other');
      const usernames = { owner: ids.owner, crossing: ids.crossing, otherstaff: ids.otherStaff, orphan: ids.orphan };
      for (const [username, id] of Object.entries(usernames)) await addAccount(db, id, username);
      // Before the migration, D1 accepted a membership in any event.
      await run(`INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, 1), (?, ?, 0), (?, ?, 0), (?, ?, 0), (?, ?, 0)`,
        ids.practice, ids.owner, ids.practice, ids.crossing, ids.live, ids.crossing, ids.otherContest, ids.crossing,
        ids.otherContest, ids.otherStaff);
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
      });
      expect(await all('SELECT session_id FROM memberships WHERE account_id = ?', ids.crossing)).toHaveLength(3);
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
});
