import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';
import type { Caller } from '../../authentication';
import { D1ManageService } from '../cloudflare/manage';
import type { PasswordHasher } from '../cloudflare/password';
import { intakeStateSql, parseIntake } from '../cloudflare/schedule';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import type { D1Connection, D1Value } from './connection';
import { D1Fixture, applyMigrations } from './testFixture';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const configPath = 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';
const passwords: PasswordHasher = { hash: async () => 'fictional-test-hash', verify: async () => false };
const at = (minutes: number) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${minutes >= 0 ? '+' : ''}${minutes} minutes')`;

describe('live password rule', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  let fixture: D1Fixture;
  let created = false;
  let manage: D1ManageService;
  let organizer: Caller;

  const run = (sql: string, ...values: D1Value[]) => db.prepare(sql).bind(...values).run();
  const one = async <T>(sql: string, ...values: D1Value[]) => db.prepare(sql).bind(...values).first<T>();

  beforeAll(async () => {
    ({ db, dispose } = await openStoreDatabase({ configPath, remoteBindings: false }));
    await applyMigrations(db);
  });
  afterAll(async () => { await dispose?.(); });

  beforeEach(async () => {
    created = false;
    fixture = new D1Fixture(db, configPath, true);
    await fixture.create();
    created = true;
    manage = new D1ManageService(db, passwords);
    organizer = fixture.staff;
    for (const account of [fixture.contestant, fixture.otherContestant]) {
      await run('UPDATE accounts SET username = ?, handle = ? WHERE id = ?', `u-${account.accountId.slice(0, 12)}`, `u-${account.accountId.slice(0, 12)}`, account.accountId);
    }
    await run("INSERT INTO grants (scope, event_id, account_id, granted_by) VALUES ('event', ?, ?, ?)",
      fixture.eventId, organizer.accountId, organizer.accountId);
  });
  afterEach(async () => {
    if (!created) return;
    await fixture.cleanup();
  });

  /** A live contest from `start` to `end` minutes from now that seats the fixture's two contestants. */
  async function liveContest(start: number, end: number, grace = 0) {
    const id = randomUUID();
    await run(`INSERT INTO sessions (id, event_id, name, kind, starts_at, ends_at, grace_minutes, intake_follows_schedule)
      VALUES (?, ?, ?, 'live', ${at(start)}, ${at(end)}, ?, 1)`, id, fixture.eventId, `Live ${id.slice(0, 8)}`, grace);
    // D1 seats each entrant's sign-ins when an entry appears.
    for (const from of [fixture.teamId, fixture.otherTeamId]) {
      await run(`INSERT INTO teams (id, session_id, name, entrant_id)
        SELECT ?, ?, name, entrant_id FROM teams WHERE id = ?`, randomUUID(), id, from);
    }
    return id;
  }
  const issue = (contestId: string | null, accountIds: string[], requestId: string = randomUUID()) =>
    manage.issueCredentials(organizer, requestId, { eventId: fixture.eventId, accountIds, contestId });
  const unready = async (id: string) => (await one<{ unready_seats: number }>('SELECT unready_seats FROM sessions WHERE id = ?', id))!.unready_seats;
  const recount = async (id: string) => (await one<{ n: number }>(`SELECT count(*) AS n FROM memberships m WHERE m.session_id = ? AND m.team_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM credential_scopes c WHERE c.account_id = m.account_id AND c.session_id = m.session_id)`, id))!.n;
  /** An issue signs the contestants out, so this reads the fragment that every snapshot and submit uses. */
  const intake = async (id: string) => parseIntake((await one<{ state: string }>(`SELECT ${intakeStateSql('s')} AS state FROM sessions s WHERE s.id = ?`, id))!.state);
  const both = () => [fixture.contestant.accountId, fixture.otherContestant.accountId];
  /** The fixture contests take intake from their switch, so they do not conflict here. */
  const closeFixtureContests = () => run('UPDATE sessions SET intake_open = 0 WHERE id IN (?, ?)', fixture.sessionId, fixture.secondSessionId);

  it('keeps a running live contest closed until the last seat is issued, and no override opens it', async () => {
    await closeFixtureContests();
    const live = await liveContest(-10, 60);
    expect(await intake(live)).toMatchObject({ open: false, reason: 'awaiting_live_passwords', changesAt: null });
    await run('UPDATE sessions SET intake_follows_schedule = 0, intake_open = 1 WHERE id = ?', live);
    expect((await intake(live)).open).toBe(false);
    await run('UPDATE sessions SET intake_follows_schedule = 1 WHERE id = ?', live);

    await issue(live, [fixture.contestant.accountId]);
    expect(await unready(live)).toBe(1);
    expect((await intake(live)).open).toBe(false);
    await issue(live, [fixture.otherContestant.accountId]);
    expect(await unready(live)).toBe(0);
    expect(await intake(live)).toMatchObject({ open: true, reason: 'running' });
  });

  it('keeps readiness through a self change and loses it through a reset by either Worker', async () => {
    await closeFixtureContests();
    const live = await liveContest(-10, 60);
    await issue(live, both());
    await run(`INSERT INTO account_operations (id, account_id, actor, action, state) VALUES (?, ?, ?, 'change_password', 'completed')`,
      randomUUID(), fixture.contestant.accountId, fixture.contestant.accountId);
    expect((await intake(live)).open).toBe(true);

    // The previous Worker's reset writes only this row. It knows nothing of scopes.
    await run(`INSERT INTO account_operations (id, account_id, actor, action, state) VALUES (?, ?, ?, 'reset_password', 'pending')`,
      randomUUID(), fixture.otherContestant.accountId, organizer.accountId);
    expect(await unready(live)).toBe(1);
    expect((await intake(live)).reason).toBe('awaiting_live_passwords');

    await issue(live, [fixture.otherContestant.accountId]);
    expect((await intake(live)).open).toBe(true);
    await expect(issue(null, [fixture.contestant.accountId])).rejects.toMatchObject({ status: 409 });
    await run('UPDATE sessions SET intake_follows_schedule = 0, intake_open = 0 WHERE id = ?', live);
    await manage.issueCredentials(organizer, randomUUID(), { eventId: fixture.eventId, accountIds: [fixture.contestant.accountId], contestId: null, voidLivePasswords: true });
    expect(await unready(live)).toBe(1);
  });

  it('opens overlapping live contests with one issue and not a later contest', async () => {
    await closeFixtureContests();
    const first = await liveContest(-10, 60, 5);
    const overlapping = await liveContest(30, 120);
    const touching = await liveContest(65, 90);
    const later = await liveContest(2000, 2100);
    await issue(first, both());
    expect(await unready(first)).toBe(0);
    expect(await unready(overlapping)).toBe(0);
    expect(await recount(overlapping)).toBe(0);
    // `at` reads the clock once per statement, so "touching" can start a moment after the window. Both count as not overlapping.
    expect(await unready(touching)).toBe(2);
    expect(await unready(later)).toBe(2);
  });

  it('refuses an issue that would sign a contestant out of an open contest outside its set', async () => {
    const open = await liveContest(-10, 60);
    await closeFixtureContests();
    await issue(open, both());
    const later = await liveContest(2000, 2100);
    const sheet = issue(later, [fixture.contestant.accountId]);
    await expect(sheet).rejects.toMatchObject({ status: 409 });
    await expect(sheet).rejects.toThrow(/Reporting is open in Live /);
    expect(await unready(open)).toBe(0);

    await issue(open, [fixture.contestant.accountId]);
    expect((await intake(open)).open).toBe(true);
  });

  it('lets the named practice contest take a lost-password reset while it is open', async () => {
    await run('UPDATE sessions SET intake_open = 1 WHERE id = ?', fixture.sessionId);
    await expect(issue(null, [fixture.contestant.accountId])).rejects.toMatchObject({ status: 409 });
    expect((await issue(fixture.sessionId, [fixture.contestant.accountId]))[0]!.temporaryPassword).toBeTruthy();
  });

  it('lets an account with no password take its first one while its contest is open', async () => {
    await run(`UPDATE accounts SET credential_state = 'pending' WHERE id = ?`, fixture.contestant.accountId);
    await run('UPDATE sessions SET intake_open = 1 WHERE id = ?', fixture.sessionId);
    expect((await issue(null, [fixture.contestant.accountId]))[0]!.temporaryPassword).toBeTruthy();
  });

  it('refuses a target that does not seat the account', async () => {
    await closeFixtureContests();
    const live = await liveContest(-10, 60);
    await run('DELETE FROM memberships WHERE session_id = ? AND account_id = ?', live, fixture.contestant.accountId);
    await expect(issue(live, [fixture.contestant.accountId])).rejects.toMatchObject({ status: 409 });
  });

  it('replays a lost response without passwords, and the replay issues nothing more', async () => {
    await closeFixtureContests();
    const live = await liveContest(-10, 60);
    const requestId = randomUUID();
    const first = await issue(live, both(), requestId);
    expect(first.every((row) => row.temporaryPassword)).toBe(true);
    const generation = await one<{ credential_generation: number }>('SELECT credential_generation FROM accounts WHERE id = ?', both()[0]!);
    const again = await issue(live, both(), requestId);
    expect(again.every((row) => row.temporaryPassword === null)).toBe(true);
    expect(await one('SELECT credential_generation FROM accounts WHERE id = ?', both()[0]!)).toEqual(generation);
    await expect(issue(null, both(), requestId)).rejects.toMatchObject({ status: 409 });
  });

  it('does not change the contest version, so in-flight staff commands survive an issue', async () => {
    await closeFixtureContests();
    const live = await liveContest(-10, 60);
    const version = () => one('SELECT version FROM sessions WHERE id = ?', live);
    const before = await version();
    await issue(live, both());
    expect(await version()).toEqual(before);
  });

  it('fixes the kind and requires a schedule for a live contest', async () => {
    const live = await liveContest(10, 60);
    await expect(run("UPDATE sessions SET kind = 'practice' WHERE id = ?", live)).rejects.toThrow();
    await expect(run('UPDATE sessions SET starts_at = NULL, ends_at = NULL WHERE id = ?', live)).rejects.toThrow();
    await expect(run("INSERT INTO sessions (id, event_id, kind) VALUES (?, ?, 'live')", randomUUID(), fixture.eventId)).rejects.toThrow();
  });

  it('keeps the count exact through random seat and scope changes', async () => {
    await closeFixtureContests();
    const live = await liveContest(10, 60);
    const accounts = both();
    let seed = 42;
    const pick = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let step = 0; step < 60; step += 1) {
      const account = accounts[pick(2)]!;
      const seated = await one<{ team_id: string | null }>('SELECT team_id FROM memberships WHERE session_id = ? AND account_id = ?', live, account);
      const team = (await one<{ id: string }>(`SELECT t.id FROM teams t JOIN accounts a ON a.entrant_id = t.entrant_id
        WHERE t.session_id = ? AND a.id = ?`, live, account))!.id;
      switch (pick(4)) {
        case 0:
          await run(`INSERT OR IGNORE INTO credential_scopes (account_id, session_id, operation_id, issued_from, issued_until)
            VALUES (?, ?, ?, ${at(10)}, ${at(60)})`, account, live, randomUUID());
          break;
        case 1:
          await run('DELETE FROM credential_scopes WHERE account_id = ? AND session_id = ?', account, live);
          break;
        case 2:
          if (seated) await run('DELETE FROM memberships WHERE session_id = ? AND account_id = ?', live, account);
          break;
        default:
          if (!seated) await run('INSERT INTO memberships (session_id, account_id, team_id) VALUES (?, ?, ?)', live, account, team);
      }
      expect(await unready(live)).toBe(await recount(live));
    }
  });

  it('refuses to move a seat to another account, so the count cannot drift', async () => {
    const live = await liveContest(10, 60);
    await expect(run('UPDATE memberships SET account_id = ? WHERE session_id = ? AND account_id = ?',
      organizer.accountId, live, fixture.contestant.accountId)).rejects.toThrow();
  });

  describe('a schedule move', () => {
    const iso = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
    const move = (id: string, start: number, end: number, graceMinutes = 0) =>
      manage.execute(organizer, randomUUID(), {
        type: 'update_contest', contestId: id, name: `Live ${id.slice(0, 8)}`, contestType: 'teams',
        schedule: { startsAt: iso(start), endsAt: iso(end), graceMinutes },
      });

    it('voids the passwords when a contest moves off the window they were issued for', async () => {
      await closeFixtureContests();
      const live = await liveContest(60, 120);
      await issue(live, both());
      expect(await unready(live)).toBe(0);
      await move(live, 3 * 1440, 3 * 1440 + 60);
      expect(await unready(live)).toBe(2);
      expect(await recount(live)).toBe(2);
    });

    it('keeps a running contest open through an end extension and a shift that still overlaps', async () => {
      await closeFixtureContests();
      const live = await liveContest(-10, 60);
      await issue(live, both());
      await move(live, -10, 300, 15);
      expect((await intake(live)).open).toBe(true);
      await move(live, -5, 400);
      expect(await intake(live)).toMatchObject({ open: true, reason: 'running' });
    });

    it('does not let small repeated shifts walk away from an issue', async () => {
      await closeFixtureContests();
      const live = await liveContest(60, 120);
      await issue(live, both());
      for (const shift of [30, 50]) {
        await move(live, 60 + shift, 120 + shift);
        expect(await unready(live)).toBe(0);
      }
      await move(live, 121, 181);
      expect(await unready(live)).toBe(2);
    });

    it('voids only the moved contest of an overlapping issue, against the window issued for', async () => {
      await closeFixtureContests();
      const first = await liveContest(60, 120);
      const second = await liveContest(90, 150);
      await issue(first, both());
      await move(second, 125, 180);
      expect(await unready(second)).toBe(2);
      expect(await unready(first)).toBe(0);
    });

    it('refuses a move that voids passwords while its new window keeps the contest running', async () => {
      await closeFixtureContests();
      const walking = await liveContest(-10, 60);
      await issue(walking, both());
      await run('UPDATE credential_scopes SET issued_until = ? WHERE session_id = ?', iso(-5), walking);
      await expect(move(walking, -4, 60)).rejects.toMatchObject({ status: 409 });
      expect((await intake(walking)).open).toBe(true);
      // A move that ends the running period is the organizer's visible choice.
      await move(walking, 70, 130);
      expect(await unready(walking)).toBe(2);
    });
  });

  describe('a late seat in a running live contest', () => {
    async function bareEntrant() {
      const entrant = randomUUID();
      await run(`INSERT INTO entrants (id, event_id, kind, name) VALUES (?, ?, 'team', ?)`, entrant, fixture.eventId, `Late ${entrant.slice(0, 8)}`);
      return entrant;
    }
    async function freshEntrant() {
      const entrant = await bareEntrant();
      const account = randomUUID();
      await run(`INSERT INTO accounts (id, name, username, handle, event_id, entrant_id, must_change) VALUES (?, 'Late', ?, ?, ?, ?, 0)`,
        account, `u-${account.slice(0, 12)}`, `u-${account.slice(0, 12)}`, fixture.eventId, entrant);
      return { entrant, account };
    }
    const teamNotices = async (id: string) => (await db.prepare(`SELECT audience FROM notifications WHERE session_id = ? AND audience LIKE 'team:%'`).bind(id).all<{ audience: string }>()).results.length;
    const clearNotices = (id: string) => run('DELETE FROM notifications WHERE session_id = ?', id);

    async function openContest() {
      await closeFixtureContests();
      const live = await liveContest(-10, 60);
      await issue(live, both());
      return live;
    }

    it('refuses assign_entrants without closeReporting, and with it closes, notifies, and names the accounts', async () => {
      const live = await openContest();
      await clearNotices(live);
      const { entrant, account } = await freshEntrant();
      const assign = (extra: object) => manage.execute(organizer, randomUUID(), {
        type: 'assign_entrants', contestId: live, entries: [{ entrantId: entrant, location: '' }], ...extra,
      });
      await expect(assign({})).rejects.toMatchObject({ status: 409 });
      expect((await intake(live)).open).toBe(true);
      const receipt = await assign({ closeReporting: true });
      expect(receipt.accountIds).toEqual([account]);
      expect(await intake(live)).toMatchObject({ open: false, reason: 'awaiting_live_passwords' });
      expect(await teamNotices(live)).toBeGreaterThanOrEqual(3);
    });

    it('does not ask when the assigned entrant has no sign-in, or the contest is practice', async () => {
      const live = await openContest();
      const entrant = await bareEntrant();
      await manage.execute(organizer, randomUUID(), { type: 'assign_entrants', contestId: live, entries: [{ entrantId: entrant, location: '' }] });
      expect((await intake(live)).open).toBe(true);
      await run('UPDATE sessions SET intake_open = 1 WHERE id = ?', fixture.sessionId);
      const late = await freshEntrant();
      await manage.execute(organizer, randomUUID(), { type: 'assign_entrants', contestId: fixture.sessionId, entries: [{ entrantId: late.entrant, location: '' }] });
    });

    it('refuses add_entrant_sign_in without closeReporting, and with it closes and notifies', async () => {
      const live = await openContest();
      const entrant = await bareEntrant();
      await manage.execute(organizer, randomUUID(), { type: 'assign_entrants', contestId: live, entries: [{ entrantId: entrant, location: '' }] });
      await clearNotices(live);
      const handle = `late-${entrant.slice(0, 6)}`;
      const add = (extra: object) => manage.execute(organizer, randomUUID(), { type: 'add_entrant_sign_in', eventId: fixture.eventId, entrantId: entrant, handle, ...extra });
      await expect(add({})).rejects.toMatchObject({ status: 409 });
      await add({ closeReporting: true });
      expect((await intake(live)).open).toBe(false);
      expect(await teamNotices(live)).toBeGreaterThanOrEqual(3);
    });

    it('tells every team when removing the last waiting seat opens the contest', async () => {
      const live = await openContest();
      const { entrant } = await freshEntrant();
      await manage.execute(organizer, randomUUID(), { type: 'assign_entrants', contestId: live, entries: [{ entrantId: entrant, location: '' }], closeReporting: true });
      await clearNotices(live);
      await manage.execute(organizer, randomUUID(), { type: 'unassign_entrant', contestId: live, entrantId: entrant });
      expect((await intake(live)).open).toBe(true);
      expect(await teamNotices(live)).toBeGreaterThanOrEqual(2);
    });
  });

  describe('a password for a later contest', () => {
    it('refuses to void a scope of a contest that has not ended, unless the request says so', async () => {
      await closeFixtureContests();
      const dayOne = await liveContest(60, 120);
      const dayThree = await liveContest(3 * 1440, 3 * 1440 + 60);
      await issue(dayOne, both());
      const sheet = () => issue(dayThree, [fixture.contestant.accountId]);
      await expect(sheet()).rejects.toMatchObject({ status: 409 });
      await expect(sheet()).rejects.toThrow(/stop working in Live /);
      expect(await unready(dayOne)).toBe(0);
      await manage.issueCredentials(organizer, randomUUID(), { eventId: fixture.eventId, accountIds: [fixture.contestant.accountId], contestId: dayThree, voidLivePasswords: true });
      expect(await unready(dayOne)).toBe(1);
      expect(await unready(dayThree)).toBe(1);
    });

    it('does not ask about a contest that has ended', async () => {
      await closeFixtureContests();
      const over = await liveContest(-300, -200);
      const next = await liveContest(60, 120);
      await issue(over, both());
      await expect(issue(next, both())).resolves.toHaveLength(2);
    });

    it('tells the organizer to close one contest when two open contests block each other', async () => {
      await closeFixtureContests();
      const live = await liveContest(-10, 60);
      await issue(live, both());
      await run('UPDATE sessions SET intake_open = 1 WHERE id = ?', fixture.sessionId);
      await expect(issue(live, [fixture.contestant.accountId])).rejects.toThrow(/Close one contest, then issue/);
    });
  });
});

const liveFile = '0022_live_credentials.sql';
const statements: string[] = splitSqlQuery(readFileSync(fileURLToPath(new URL(`./migrations/${liveFile}`, import.meta.url)), 'utf8'));

/** Each statement commits alone, with the previous Worker's writes between them. */
describe('0022 applied one statement at a time', () => {
  it('stays usable after every prefix and ends with an exact count', async () => {
    const { db, dispose } = await openStoreDatabase({ configPath, remoteBindings: false });
    try {
      await applyMigrations(db, (name) => name < liveFile);
      const run = (sql: string, ...values: D1Value[]) => db.prepare(sql).bind(...values).run();
      const eventId = randomUUID();
      const contest = randomUUID();
      await run('INSERT INTO events (id, name) VALUES (?, ?)', eventId, 'Fictional event');
      await run('INSERT INTO sessions (id, event_id, name) VALUES (?, ?, ?)', contest, eventId, 'Fictional contest');
      const addAccount = async () => {
        const id = randomUUID();
        await run('INSERT INTO accounts (id, name, username, event_id, must_change) VALUES (?, ?, ?, ?, 0)', id, 'Fictional person', `u-${id.slice(0, 12)}`, eventId);
        return id;
      };
      const seatNew = async () => {
        const team = randomUUID();
        const account = await addAccount();
        await run('INSERT INTO teams (id, session_id, name) VALUES (?, ?, ?)', team, contest, `Team ${team}`);
        await run('INSERT INTO memberships (session_id, account_id, team_id) VALUES (?, ?, ?)', contest, account, team);
        return account;
      };
      const seats = [await seatNew(), await seatNew()];
      for (const sql of statements) {
        await db.prepare(sql).run();
        const fresh = await seatNew();
        const gone = seats.shift()!;
        await run(`INSERT INTO account_operations (id, account_id, actor, action, state) VALUES (?, ?, ?, 'reset_password', 'completed')`, randomUUID(), fresh, fresh);
        await run('DELETE FROM memberships WHERE session_id = ? AND account_id = ?', contest, gone);
        await run('UPDATE sessions SET grace_minutes = grace_minutes + 1 WHERE id = ?', contest);
        seats.push(fresh);
      }
      const final = await db.prepare(`SELECT unready_seats AS stored, (SELECT count(*) FROM memberships m WHERE m.session_id = s.id AND m.team_id IS NOT NULL) AS counted
        FROM sessions s WHERE id = ?`).bind(contest).first<{ stored: number; counted: number }>();
      expect(final!.stored).toBe(final!.counted);
      expect(final!.stored).toBe(seats.length);
    } finally {
      await dispose();
    }
  });
});
