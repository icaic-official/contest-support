import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import type { D1Connection, D1Value } from './connection';
import { applyMigrations } from './testFixture';

const eventRoster = '0019_event_roster.sql';
const statements: string[] = splitSqlQuery(readFileSync(fileURLToPath(new URL(`./migrations/${eventRoster}`, import.meta.url)), 'utf8'));

/**
 * The `test:d1` fixture applies a file in one batch, so a deferred key never
 * fires between its statements. Here each statement commits alone, which is the
 * worst case if the provider does not apply the file atomically.
 */
describe('0019 applied one statement at a time', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  const run = (sql: string, ...values: D1Value[]) => db.prepare(sql).bind(...values).run();
  const all = async <T>(sql: string, ...values: D1Value[]) => (await db.prepare(sql).bind(...values).all<T>()).results;
  const applyEach = async (list: readonly string[] = statements) => {
    for (const sql of list) await db.prepare(sql).run();
  };
  const addEvent = async () => {
    const id = randomUUID();
    await run('INSERT INTO events (id, name) VALUES (?, ?)', id, `Event ${id}`);
    return id;
  };
  const addContest = async (eventId: string) => {
    const id = randomUUID();
    await run('INSERT INTO sessions (id, event_id, name) VALUES (?, ?, ?)', id, eventId, `Contest ${id}`);
    return id;
  };
  const addTeam = async (contest: string, name: string) => {
    const id = randomUUID();
    await run('INSERT INTO teams (id, session_id, name) VALUES (?, ?, ?)', id, contest, name);
    return id;
  };
  const addAccount = async () => {
    const id = randomUUID();
    await run('INSERT INTO accounts (id, name, username, must_change) VALUES (?, ?, ?, 0)', id, 'Fictional person', `u-${id.slice(0, 12)}`);
    return id;
  };
  const seat = (contest: string, account: string, team: string | null, admin = 0) =>
    run('INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, ?, ?)', contest, account, team, admin);
  const entrantOf = async (team: string) =>
    (await all<{ entrant_id: string }>('SELECT entrant_id FROM teams WHERE id = ?', team))[0]?.entrant_id;
  const linkOf = async (account: string) =>
    (await all<{ entrant_id: string | null }>('SELECT entrant_id FROM accounts WHERE id = ?', account))[0]?.entrant_id;

  beforeEach(async () => {
    ({ db, dispose } = await openStoreDatabase({
      configPath: 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc', remoteBindings: false,
    }));
    await applyMigrations(db, (name) => name < eventRoster);
  });
  afterEach(async () => { await dispose?.(); });

  it('commits every statement on real-shaped data, with no help from a deferred key', async () => {
    const eventId = await addEvent();
    const [a, b] = [await addContest(eventId), await addContest(eventId)];
    const aurora = await addTeam(a, 'Aurora');
    const again = await addTeam(b, 'aurora ');
    const cedar = await addTeam(a, 'Cedar');
    const member = await addAccount();
    await seat(a, member, aurora);
    await seat(b, member, again);
    await applyEach();
    expect(await entrantOf(aurora)).toBe(aurora);
    expect(await entrantOf(again)).toBe(aurora);
    expect(await entrantOf(cedar)).toBe(cedar);
    expect(await all('PRAGMA foreign_key_check')).toEqual([]);
    expect(await all('SELECT id FROM teams WHERE entrant_id IS NULL')).toEqual([]);
  });

  it('refuses a retry at its first statement after a partial apply, and leaves the data', async () => {
    const eventId = await addEvent();
    const contest = await addContest(eventId);
    const team = await addTeam(contest, 'Aurora');
    const backfilled = statements.findIndex((sql) => sql.startsWith('UPDATE accounts SET entrant_id'));
    await applyEach(statements.slice(0, backfilled));
    expect(await entrantOf(team)).toBe(team);
    await expect(applyEach()).rejects.toThrow(/already exists/);
    expect(await all('SELECT id FROM entrants')).toEqual([{ id: team }]);
  });

  it('merges three same-named teams that share accounts only in a chain', async () => {
    const eventId = await addEvent();
    const [a, b, c] = [await addContest(eventId), await addContest(eventId), await addContest(eventId)];
    const first = await addTeam(a, 'Aurora');
    const second = await addTeam(b, 'Aurora');
    const third = await addTeam(c, 'AURORA');
    const [left, right] = [await addAccount(), await addAccount()];
    await seat(a, left, first);
    await seat(b, left, second);
    await seat(b, right, second);
    await seat(c, right, third);
    await applyEach();
    expect([await entrantOf(first), await entrantOf(second), await entrantOf(third)]).toEqual([first, first, first]);
    expect(await all('SELECT id FROM entrants')).toEqual([{ id: first }]);
    expect(await all('SELECT name FROM teams WHERE id = ?', third)).toEqual([{ name: 'Aurora' }]);
    expect([await linkOf(left), await linkOf(right)]).toEqual([first, first]);
  });

  it('merges a chain whose oldest team shares nothing with the middle team', async () => {
    const eventId = await addEvent();
    const [a, b, c] = [await addContest(eventId), await addContest(eventId), await addContest(eventId)];
    const oldest = await addTeam(a, 'Aurora');
    const middle = await addTeam(b, 'Aurora');
    const newest = await addTeam(c, 'Aurora');
    const [one, two] = [await addAccount(), await addAccount()];
    await seat(a, one, oldest);
    await seat(c, one, newest);
    await seat(c, two, newest);
    await seat(b, two, middle);
    await applyEach();
    expect([await entrantOf(oldest), await entrantOf(middle), await entrantOf(newest)]).toEqual([oldest, oldest, oldest]);
  });

  it('keeps unrelated same-named teams apart', async () => {
    const eventId = await addEvent();
    const [a, b, c] = [await addContest(eventId), await addContest(eventId), await addContest(eventId)];
    const first = await addTeam(a, 'Aurora');
    const second = await addTeam(b, 'Aurora');
    const stranger = await addTeam(c, 'Aurora');
    const [shared, other] = [await addAccount(), await addAccount()];
    await seat(a, shared, first);
    await seat(b, shared, second);
    await seat(c, other, stranger);
    await applyEach();
    expect(await entrantOf(second)).toBe(first);
    expect(await entrantOf(stranger)).toBe(stranger);
  });

  it('never links a staff account to an entrant, so its entrant has no sign-in to reset', async () => {
    const eventId = await addEvent();
    const [staffed, played] = [await addContest(eventId), await addContest(eventId)];
    const team = await addTeam(played, 'Aurora');
    const person = await addAccount();
    await seat(staffed, person, null, 1);
    await seat(played, person, team);
    await applyEach();
    expect(await linkOf(person)).toBeNull();
    expect(await all('SELECT session_id, team_id, is_admin FROM memberships WHERE account_id = ? ORDER BY is_admin', person))
      .toEqual([{ session_id: played, team_id: team, is_admin: 0 }, { session_id: staffed, team_id: null, is_admin: 1 }]);
    expect(await all('SELECT id FROM accounts WHERE entrant_id = ?', team)).toEqual([]);
  });

  describe('then the previous Worker', () => {
    it('cannot tie a webmaster to an event with a team seat', async () => {
      const eventId = await addEvent();
      const contest = await addContest(eventId);
      const team = await addTeam(contest, 'Aurora');
      const webmaster = await addAccount();
      await run(`INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', 'fixture')`, webmaster);
      await applyEach();
      await seat(contest, webmaster, team);
      expect(await all('SELECT event_id, entrant_id FROM accounts WHERE id = ?', webmaster)).toEqual([{ event_id: null, entrant_id: null }]);
    });

    it('does not link a staff member who takes a team seat in another contest', async () => {
      const eventId = await addEvent();
      const [staffed, played] = [await addContest(eventId), await addContest(eventId)];
      const team = await addTeam(played, 'Aurora');
      const person = await addAccount();
      await seat(staffed, person, null, 1);
      await applyEach();
      await seat(played, person, team);
      expect(await linkOf(person)).toBeNull();
    });

    it('cannot put a new team in a singles contest', async () => {
      const eventId = await addEvent();
      const contest = await addContest(eventId);
      await applyEach();
      await run(`UPDATE sessions SET contest_type = 'singles' WHERE id = ?`, contest);
      await expect(run('INSERT INTO teams (id, session_id, name) VALUES (?, ?, ?)', randomUUID(), contest, 'Late team'))
        .rejects.toThrow(/cannot enter this contest/);
    });

    it('restores a removed seat on the same team, and is refused on another team or as staff', async () => {
      const eventId = await addEvent();
      const contest = await addContest(eventId);
      const [team, other] = [await addTeam(contest, 'Aurora'), await addTeam(contest, 'Cedar')];
      const member = await addAccount();
      await seat(contest, member, team);
      await applyEach();
      await run('DELETE FROM memberships WHERE session_id = ? AND account_id = ?', contest, member);
      await expect(seat(contest, member, other)).rejects.toThrow(/holds only its own entries/);
      await expect(seat(contest, member, null)).rejects.toThrow(/holds only its own entries/);
      await seat(contest, member, team);
    });
  });
});
