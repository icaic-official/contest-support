import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Caller } from '../../authentication';
import { WorkflowService } from '../../workflow';
import type { Command } from '../../../connected/model';
import { D1ApplicationService } from '../cloudflare/application';
import { D1ContestAwardService } from '../cloudflare/contestAwards';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import type { D1Connection, D1Value } from './connection';
import { D1ApplicationStore } from './store';
import { D1Fixture, applyMigrations } from './testFixture';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const configPath = 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';

/** A SQL instant `minutes` from D1's clock. The tests move time by writing schedules relative to now. */
const at = (minutes: number) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${minutes >= 0 ? '+' : ''}${minutes} minutes')`;

describe('contest schedule, clock, time awards, and intake', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  let fixture: D1Fixture;
  let created = false;
  let application: D1ApplicationService;
  let awards: D1ContestAwardService;

  const run = (sql: string, ...values: D1Value[]) => db.prepare(sql).bind(...values).run();

  beforeAll(async () => {
    const platform = await openStoreDatabase({ configPath, remoteBindings: false });
    db = platform.db;
    dispose = platform.dispose;
    await applyMigrations(db);
  });
  afterAll(async () => { await dispose?.(); });

  beforeEach(async () => {
    created = false;
    fixture = new D1Fixture(db, configPath, true);
    await fixture.create();
    created = true;
    application = new D1ApplicationService(db);
    awards = new D1ContestAwardService(db);
    // The specialist can confirm an application. The staff account is a jury member and can also grant.
    await run("INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'jury')", fixture.sessionId, fixture.staff.accountId);
  });
  afterEach(async () => { if (created) await fixture.cleanup(); });

  /** Puts the contest on a schedule that began `start` minutes from now and ends `end` minutes from now. */
  async function follow(start: number, end: number, grace = 0, sessionId = fixture.sessionId) {
    await run(`UPDATE sessions SET starts_at = ${at(start)}, ends_at = ${at(end)}, grace_minutes = ?,
      intake_follows_schedule = 1 WHERE id = ?`, grace, sessionId);
  }

  async function clockOf(caller: Caller) {
    const view = await application.snapshot(caller, fixture.sessionId);
    return { open: view.session!.intake_open, clock: view.clock! };
  }

  /** Records a resolved issue with an award of `minutes`, confirmed or not. */
  async function award(minutes: number, confirmed: boolean, issueId = fixture.issueId) {
    const resolution = randomUUID();
    await run(`INSERT INTO resolutions (id, session_id, issue_id, actor, actor_name, at, summary)
      VALUES (?, ?, ?, ?, 'Fictional jury', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'Fictional fix')`,
    resolution, fixture.sessionId, issueId, fixture.staff.accountId);
    await run(`INSERT INTO awards (id, session_id, issue_id, resolution_id, minutes, explanation, actor, actor_name, at,
      applied_at, applied_by, applied_name) VALUES (?, ?, ?, ?, ?, 'Fictional award', ?, 'Fictional jury',
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ${confirmed ? "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" : 'NULL'}, ?, ?)`,
    randomUUID(), fixture.sessionId, issueId, resolution, minutes, fixture.staff.accountId,
    confirmed ? fixture.staff.accountId : null, confirmed ? 'Fictional staff' : null);
  }

  it('follows the schedule before the start, while running, in grace, and after the end', async () => {
    await follow(30, 90, 15);
    expect((await clockOf(fixture.contestant)).open).toBe(false);
    expect((await clockOf(fixture.contestant)).clock.intake).toMatchObject({ open: false, reason: 'before_start' });
    // The next change is the start.
    const before = (await clockOf(fixture.contestant)).clock;
    expect(Date.parse(before.intake.changes_at!) - Date.parse(before.schedule!.starts_at)).toBe(0);

    await follow(-30, 30, 15);
    expect(await clockOf(fixture.contestant)).toMatchObject({ open: true, clock: { intake: { open: true, reason: 'running' } } });

    await follow(-60, -5, 15);
    const grace = await clockOf(fixture.contestant);
    expect(grace).toMatchObject({ open: true, clock: { intake: { open: true, reason: 'grace' } } });
    expect(Date.parse(grace.clock.intake.changes_at!) - Date.parse(grace.clock.schedule!.ends_at)).toBe(15 * 60_000);

    await follow(-90, -30, 15);
    expect(await clockOf(fixture.contestant)).toMatchObject({
      open: false, clock: { intake: { open: false, reason: 'ended', changes_at: null } } });
  });

  it('shows staff the contest end and no personal end time', async () => {
    await follow(-30, 30);
    const staff = (await clockOf(fixture.staff)).clock;
    expect(staff).toMatchObject({ follows_schedule: true, personal_end_at: null, extra_minutes: 0 });
    const contestant = (await clockOf(fixture.contestant)).clock;
    expect(contestant.personal_end_at).toBe(contestant.schedule!.ends_at);
  });

  it('keeps the manual switch for a contest with no schedule, and lets an override hold the schedule', async () => {
    expect(await clockOf(fixture.contestant)).toMatchObject({
      open: false, clock: { schedule: null, follows_schedule: false, intake: { reason: 'override_closed', changes_at: null } } });
    await run('UPDATE sessions SET intake_open = 1 WHERE id = ?', fixture.sessionId);
    expect(await clockOf(fixture.contestant)).toMatchObject({ open: true, clock: { intake: { reason: 'override_open' } } });
    // A finished schedule stays held open by the override. Returning to the schedule closes it.
    await follow(-90, -30);
    await run('UPDATE sessions SET intake_follows_schedule = 0 WHERE id = ?', fixture.sessionId);
    expect(await clockOf(fixture.contestant)).toMatchObject({ open: true, clock: { follows_schedule: false, intake: { reason: 'override_open' } } });
    await run('UPDATE sessions SET intake_follows_schedule = 1 WHERE id = ?', fixture.sessionId);
    expect(await clockOf(fixture.contestant)).toMatchObject({ open: false, clock: { intake: { reason: 'ended' } } });
  });

  it('extends a contestant by the minutes that staff confirmed, and by nothing else', async () => {
    await follow(-60, -5);
    expect((await clockOf(fixture.contestant)).open).toBe(false);
    // An award that staff decided but did not confirm adds no time. Minsky changes no external clock.
    await award(20, false);
    expect(await clockOf(fixture.contestant)).toMatchObject({ open: false, clock: { extra_minutes: 0 } });
    await run('DELETE FROM resolutions WHERE session_id = ?', fixture.sessionId);
    await award(20, true);
    const extended = await clockOf(fixture.contestant);
    expect(extended).toMatchObject({ open: true, clock: { extra_minutes: 20, intake: { open: true, reason: 'running' } } });
    expect(Date.parse(extended.clock.personal_end_at!) - Date.parse(extended.clock.schedule!.ends_at)).toBe(20 * 60_000);
    // Another team's contestant, and the staff, keep the contest end.
    expect(await clockOf(fixture.otherContestant)).toMatchObject({ open: false, clock: { extra_minutes: 0 } });
    expect((await clockOf(fixture.staff)).clock.personal_end_at).toBeNull();
  });

  it('adds the grace period to the personal end', async () => {
    await follow(-60, -25, 10);
    await award(20, true);
    // The end was 25 minutes ago, the extra time ends 5 minutes ago, and the grace period runs 10 more minutes.
    expect(await clockOf(fixture.contestant)).toMatchObject({ open: true, clock: { intake: { reason: 'grace' } } });
    await run('UPDATE awards SET minutes = 10 WHERE session_id = ?', fixture.sessionId);
    expect(await clockOf(fixture.contestant)).toMatchObject({ open: false, clock: { intake: { reason: 'ended' } } });
  });

  describe('contest-wide awards', () => {
    const grant = { type: 'grant', minutes: 15, explanation: 'Network outage in the hall.' } as const;

    it('gives every contestant confirmed minutes, and shows contestants only the confirmed award', async () => {
      await follow(-60, -5);
      const id = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
      expect((await application.snapshot(fixture.staff, fixture.sessionId)).contest_awards).toMatchObject([{ id, minutes: 15, applied_at: null }]);
      expect((await application.snapshot(fixture.contestant, fixture.sessionId)).contest_awards).toEqual([]);
      expect(await clockOf(fixture.contestant)).toMatchObject({ open: false, clock: { extra_minutes: 0 } });

      await awards.execute(fixture.specialist, fixture.sessionId, randomUUID(), { type: 'apply', awardId: id });
      for (const contestant of [fixture.contestant, fixture.otherContestant]) {
        expect(await clockOf(contestant)).toMatchObject({ open: true, clock: { extra_minutes: 15 } });
        expect((await application.snapshot(contestant, fixture.sessionId)).contest_awards).toMatchObject([{ id, minutes: 15 }]);
      }
      expect((await clockOf(fixture.staff)).clock.personal_end_at).toBeNull();
    });

    it('adds a contest-wide award to the awards of one issue', async () => {
      await follow(-60, -5);
      await award(10, true);
      const id = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
      await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), { type: 'apply', awardId: id });
      expect((await clockOf(fixture.contestant)).clock.extra_minutes).toBe(25);
      expect((await clockOf(fixture.otherContestant)).clock.extra_minutes).toBe(15);
    });

    it('lets only jury grant and only support or jury confirm', async () => {
      await expect(awards.execute(fixture.specialist, fixture.sessionId, randomUUID(), grant)).rejects.toMatchObject({ status: 403 });
      await expect(awards.execute(fixture.contestant, fixture.sessionId, randomUUID(), grant)).rejects.toMatchObject({ status: 403 });
      const id = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
      await expect(awards.execute(fixture.contestant, fixture.sessionId, randomUUID(), { type: 'apply', awardId: id }))
        .rejects.toMatchObject({ status: 403 });
      // The staff account holds a role in the second contest too, but the award belongs to the first.
      await expect(awards.execute(fixture.staff, fixture.secondSessionId, randomUUID(), { type: 'apply', awardId: id }))
        .rejects.toMatchObject({ status: 409 });
      expect(await fixture.rows('SELECT applied_at FROM contest_awards WHERE id = ?', id)).toEqual([{ applied_at: null }]);
    });

    describe('one unconfirmed award of each size', () => {
      const waiting = { status: 409, message: 'An award of this length is waiting for confirmation.' };
      const count = async () => (await fixture.rows('SELECT id FROM contest_awards WHERE session_id = ?', fixture.sessionId)).length;

      it('refuses a new request ID with the same minutes, even with another explanation, and replays the first receipt first', async () => {
        const requestId = randomUUID();
        const first = await awards.execute(fixture.staff, fixture.sessionId, requestId, grant);
        await expect(awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant)).rejects.toMatchObject(waiting);
        await expect(awards.execute(fixture.staff, fixture.sessionId, randomUUID(), { ...grant, explanation: 'Edited text.' }))
          .rejects.toMatchObject(waiting);
        expect(await awards.execute(fixture.staff, fixture.sessionId, requestId, grant)).toBe(first);
        expect(await count()).toBe(1);
        expect(await fixture.rows('SELECT id FROM admin_audit WHERE action = ?', 'contest_award')).toHaveLength(1);
      });

      it('refuses the same minutes from another actor', async () => {
        await run("INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'jury')", fixture.sessionId, fixture.specialist.accountId);
        await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
        await expect(awards.execute(fixture.specialist, fixture.sessionId, randomUUID(), grant)).rejects.toMatchObject(waiting);
        expect(await count()).toBe(1);
      });

      it('allows other minutes, another contest, and the same minutes once the first is confirmed', async () => {
        const first = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
        await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), { ...grant, minutes: 20 });
        await run("INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'jury')", fixture.secondSessionId, fixture.staff.accountId);
        await awards.execute(fixture.staff, fixture.secondSessionId, randomUUID(), grant);
        await awards.execute(fixture.specialist, fixture.sessionId, randomUUID(), { type: 'apply', awardId: first });
        await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
        expect(await fixture.rows('SELECT id FROM contest_awards WHERE session_id = ? AND minutes = 15', fixture.sessionId)).toHaveLength(2);
        expect(await count()).toBe(3);
      });

      it('records one of two concurrent grants with new request IDs and refuses the other', async () => {
        const results = await Promise.allSettled([
          awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant),
          awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant),
        ]);
        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        const refused = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        expect(refused?.reason).toMatchObject(waiting);
        expect(await count()).toBe(1);
        expect(await fixture.rows('SELECT id FROM admin_audit WHERE action = ?', 'contest_award')).toHaveLength(1);
      });
    });

    it('writes a repeated grant once, and refuses a request ID that names another award', async () => {
      const requestId = randomUUID();
      const first = await awards.execute(fixture.staff, fixture.sessionId, requestId, grant);
      const results = await Promise.all([
        awards.execute(fixture.staff, fixture.sessionId, requestId, grant),
        awards.execute(fixture.staff, fixture.sessionId, requestId, grant),
      ]);
      expect(results).toEqual([first, first]);
      expect(await fixture.rows('SELECT id FROM contest_awards WHERE session_id = ?', fixture.sessionId)).toHaveLength(1);
      await expect(awards.execute(fixture.staff, fixture.sessionId, requestId, { ...grant, minutes: 99 }))
        .rejects.toMatchObject({ status: 409 });
      expect(await fixture.rows('SELECT id FROM admin_audit WHERE action = ?', 'contest_award')).toHaveLength(1);
    });

    it('confirms once, replays the same confirmation, and refuses a second confirmer', async () => {
      const id = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
      const requestId = randomUUID();
      const results = await Promise.all([
        awards.execute(fixture.specialist, fixture.sessionId, requestId, { type: 'apply', awardId: id }),
        awards.execute(fixture.specialist, fixture.sessionId, requestId, { type: 'apply', awardId: id }),
      ]);
      expect(results).toEqual([id, id]);
      const [row] = await fixture.rows('SELECT applied_by, applied_request FROM contest_awards WHERE id = ?', id);
      expect(row).toMatchObject({ applied_by: fixture.specialist.accountId, applied_request: requestId });
      expect(await fixture.rows('SELECT id FROM admin_audit WHERE action = ?', 'contest_award_applied')).toHaveLength(1);
      await expect(awards.execute(fixture.staff, fixture.sessionId, randomUUID(), { type: 'apply', awardId: id }))
        .rejects.toMatchObject({ status: 409 });
      // The decision and the confirmation never change afterwards.
      await expect(run('UPDATE contest_awards SET minutes = 1 WHERE id = ?', id)).rejects.toThrow(/final/);
    });

    describe('withdrawing an unconfirmed award', () => {
      const withdraw = (id: string) => ({ type: 'withdraw', awardId: id }) as const;
      const stateOf = async (id: string) => (await fixture.rows(
        'SELECT applied_at, withdrawn_at, withdrawn_by, withdrawn_request FROM contest_awards WHERE id = ?', id))[0]!;

      it('keeps the row, frees the size, hides it from contestants, and gives no time', async () => {
        await follow(-60, -5);
        const id = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
        const requestId = randomUUID();
        expect(await awards.execute(fixture.staff, fixture.sessionId, requestId, withdraw(id))).toBe(id);
        expect(await stateOf(id)).toMatchObject({ applied_at: null, withdrawn_by: fixture.staff.accountId, withdrawn_request: requestId });
        expect((await stateOf(id)).withdrawn_at).toBeTruthy();
        const staffView = (await application.snapshot(fixture.staff, fixture.sessionId)).contest_awards;
        expect(staffView).toMatchObject([{ id, withdrawn_at: expect.any(String) as string, withdrawn_name: expect.any(String) as string }]);
        expect((await application.snapshot(fixture.contestant, fixture.sessionId)).contest_awards).toEqual([]);
        expect(await clockOf(fixture.contestant)).toMatchObject({ open: false, clock: { extra_minutes: 0 } });
        // The same size can be granted again, and the withdrawn row stays.
        const again = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
        expect(again).not.toBe(id);
        expect(await fixture.rows('SELECT id FROM contest_awards WHERE session_id = ?', fixture.sessionId)).toHaveLength(2);
        expect(await fixture.rows('SELECT action FROM admin_audit WHERE action = ?', 'contest_award_withdrawn')).toHaveLength(1);
      });

      it('replays its own receipt without a second write, and refuses another request', async () => {
        const id = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
        const requestId = randomUUID();
        const results = await Promise.all([
          awards.execute(fixture.staff, fixture.sessionId, requestId, withdraw(id)),
          awards.execute(fixture.staff, fixture.sessionId, requestId, withdraw(id)),
        ]);
        expect(results).toEqual([id, id]);
        expect(await awards.execute(fixture.staff, fixture.sessionId, requestId, withdraw(id))).toBe(id);
        expect(await fixture.rows('SELECT id FROM admin_audit WHERE action = ?', 'contest_award_withdrawn')).toHaveLength(1);
        await expect(awards.execute(fixture.staff, fixture.sessionId, randomUUID(), withdraw(id))).rejects.toMatchObject({ status: 409 });
      });

      it('lets only jury withdraw, and only in the contest of the award', async () => {
        const id = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
        for (const caller of [fixture.specialist, fixture.contestant, fixture.otherContestant]) {
          await expect(awards.execute(caller, fixture.sessionId, randomUUID(), withdraw(id))).rejects.toMatchObject({ status: 403 });
        }
        await run("INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'jury')", fixture.secondSessionId, fixture.staff.accountId);
        await expect(awards.execute(fixture.staff, fixture.secondSessionId, randomUUID(), withdraw(id))).rejects.toMatchObject({ status: 409 });
        expect((await stateOf(id)).withdrawn_at).toBeNull();
      });

      it('never withdraws a confirmed award and never confirms a withdrawn one', async () => {
        const confirmed = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
        await awards.execute(fixture.specialist, fixture.sessionId, randomUUID(), { type: 'apply', awardId: confirmed });
        await expect(awards.execute(fixture.staff, fixture.sessionId, randomUUID(), withdraw(confirmed))).rejects.toMatchObject({ status: 409 });
        await expect(run("UPDATE contest_awards SET withdrawn_at = 'x', withdrawn_by = ?, withdrawn_name = 'x', withdrawn_request = 'x' WHERE id = ?",
          fixture.staff.accountId, confirmed)).rejects.toThrow(/final|not both/);

        const withdrawn = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), { ...grant, minutes: 30 });
        await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), withdraw(withdrawn));
        await expect(awards.execute(fixture.specialist, fixture.sessionId, randomUUID(), { type: 'apply', awardId: withdrawn }))
          .rejects.toMatchObject({ status: 409 });
        await expect(run("UPDATE contest_awards SET applied_at = 'x', applied_by = ?, applied_name = 'x', applied_request = 'x' WHERE id = ?",
          fixture.staff.accountId, withdrawn)).rejects.toThrow(/final|not both/);
        expect((await stateOf(withdrawn)).applied_at).toBeNull();
      });

      it('refuses a half-written or doubled outcome in the table itself', async () => {
        const id = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
        await expect(run("UPDATE contest_awards SET withdrawn_at = 'x' WHERE id = ?", id)).rejects.toThrow(/not both/);
        await expect(run(`UPDATE contest_awards SET withdrawn_at = 'x', withdrawn_by = ?, withdrawn_name = 'x', withdrawn_request = 'x',
          applied_at = 'x', applied_by = ?, applied_name = 'x', applied_request = 'x' WHERE id = ?`, fixture.staff.accountId, fixture.staff.accountId, id))
          .rejects.toThrow(/not both/);
        expect((await stateOf(id)).withdrawn_at).toBeNull();
      });

      it('lets exactly one of a concurrent confirm and withdraw win', async () => {
        for (let round = 0; round < 5; round += 1) {
          const id = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), { ...grant, minutes: 40 + round });
          const results = await Promise.allSettled([
            awards.execute(fixture.specialist, fixture.sessionId, randomUUID(), { type: 'apply', awardId: id }),
            awards.execute(fixture.staff, fixture.sessionId, randomUUID(), withdraw(id)),
          ]);
          expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
          const state = await stateOf(id);
          expect([state.applied_at !== null, state.withdrawn_at !== null].sort()).toEqual([false, true]);
        }
      });

      it('refuses a withdrawal in an archived event', async () => {
        const id = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
        await run('UPDATE events SET archived = 1 WHERE id = ?', fixture.eventId);
        await expect(awards.execute(fixture.staff, fixture.sessionId, randomUUID(), withdraw(id))).rejects.toMatchObject({ status: 409 });
      });

      it('notifies the staff and every team', async () => {
        const id = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
        await run('DELETE FROM notifications WHERE session_id = ?', fixture.sessionId);
        await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), withdraw(id));
        const audiences = (await fixture.rows('SELECT audience FROM notifications WHERE session_id = ? AND audience NOT LIKE ?', fixture.sessionId, 'account:%'))
          .map((row) => row.audience).sort();
        expect(audiences).toEqual(['staff', `team:${fixture.teamId}`, `team:${fixture.otherTeamId}`].sort());
      });

      // The previous Worker's statements, copied from the release before migration 0021. They stay fixed.
      describe('the previous Worker on the same database', () => {
        const previousConfirm = (id: string) => run(`UPDATE contest_awards SET applied_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), applied_by = ?,
          applied_name = 'Previous', applied_request = ? WHERE id = ? AND session_id = ? AND applied_at IS NULL`,
        fixture.specialist.accountId, randomUUID(), id, fixture.sessionId);
        const previousGrant = (minutes: number) => run(`INSERT INTO contest_awards (id, session_id, request_id, minutes, explanation, actor, actor_name, at)
          SELECT ?, ?, ?, ?, 'Previous grant', id, name, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM accounts WHERE id = ?`,
        randomUUID(), fixture.sessionId, randomUUID(), minutes, fixture.staff.accountId);

        it('cannot confirm a withdrawn award, and can grant the size that the withdrawal freed', async () => {
          const id = await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
          await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), withdraw(id));
          await expect(previousConfirm(id)).rejects.toThrow(/final|not both/);
          await previousGrant(15);
          expect(await fixture.rows('SELECT id FROM contest_awards WHERE session_id = ? AND minutes = 15', fixture.sessionId)).toHaveLength(2);
        });

        it('still holds one waiting award of each size', async () => {
          await previousGrant(25);
          await expect(previousGrant(25)).rejects.toThrow(/UNIQUE constraint failed: contest_awards.session_id, contest_awards.minutes/);
        });
      });
    });

    it('refuses minutes and text that the record cannot hold', async () => {
      for (const bad of [{ minutes: 0 }, { minutes: 1441 }, { minutes: 1.5 }, { explanation: '   ' }, { explanation: 'x'.repeat(2001) }]) {
        await expect(awards.execute(fixture.staff, fixture.sessionId, randomUUID(), { ...grant, ...bad }))
          .rejects.toMatchObject({ status: 400 });
      }
    });

    it('notifies the staff and every team of the contest', async () => {
      await awards.execute(fixture.staff, fixture.sessionId, randomUUID(), grant);
      const audiences = (await fixture.rows('SELECT audience FROM notifications WHERE session_id = ? AND audience NOT LIKE ?', fixture.sessionId, 'account:%'))
        .map((row) => row.audience).sort();
      expect(audiences).toEqual(['staff', `team:${fixture.teamId}`, `team:${fixture.otherTeamId}`].sort());
    });
  });

  describe('a submit across the close', () => {
    const submit: Command = { type: 'submit', category: 'Devices', description: 'Fictional report' };

    it('retries when the contest closes between the read and the batch, and then rejects it', async () => {
      await follow(-30, 5);
      const store = new D1ApplicationStore(db);
      const requestId = randomUUID();
      const read = await store.read(fixture.contestant, fixture.sessionId, requestId, submit);
      expect(read?.state.session.intake_open).toBe(true);
      // The contest ends between the read and the batch.
      await run(`UPDATE sessions SET ends_at = ${at(-1)} WHERE id = ?`, fixture.sessionId);
      expect(await store.commit(fixture.contestant, fixture.sessionId, requestId, submit, read!,
        { type: 'submit', issueId: null, teamId: fixture.teamId, submission: { category: 'Devices', description: 'x' },
          history: { text: 'x', visibility: 'public' } })).toEqual({ outcome: 'retry' });
      expect(await fixture.rows('SELECT id FROM issues WHERE session_id = ? AND description = ?', fixture.sessionId, 'x')).toEqual([]);
    });

    it('rejects the submit through the service when the retry finds intake closed', async () => {
      await follow(-30, 5);
      let moved = false;
      const racing: D1Connection = {
        prepare: (sql) => db.prepare(sql),
        batch: async (statements) => {
          if (!moved) {
            moved = true;
            await run(`UPDATE sessions SET ends_at = ${at(-1)} WHERE id = ?`, fixture.sessionId);
          }
          return db.batch(statements);
        },
      };
      const result = await new WorkflowService(new D1ApplicationStore(racing)).execute(
        fixture.contestant, fixture.sessionId, randomUUID(), submit);
      expect(result).toEqual({ outcome: 'rejected', reason: 'access' });
      expect(await fixture.rows('SELECT id FROM issues WHERE session_id = ? AND description = ?', fixture.sessionId, 'Fictional report')).toEqual([]);
    });

    it('lets a contestant with confirmed extra time submit after the contest end, and staff submit while it is closed', async () => {
      await follow(-60, -5);
      const service = new WorkflowService(new D1ApplicationStore(db));
      expect(await service.execute(fixture.contestant, fixture.sessionId, randomUUID(), submit)).toEqual({ outcome: 'rejected', reason: 'access' });
      await award(20, true);
      expect(await service.execute(fixture.contestant, fixture.sessionId, randomUUID(), submit)).toMatchObject({ outcome: 'committed' });
      // The other team's contestant stays closed, and staff are not held by intake at all.
      expect(await service.execute(fixture.otherContestant, fixture.sessionId, randomUUID(), submit)).toEqual({ outcome: 'rejected', reason: 'access' });
      expect(await service.execute(fixture.staff, fixture.sessionId, randomUUID(), { ...submit, team_id: fixture.otherTeamId }))
        .toMatchObject({ outcome: 'committed' });
    });
  });

  describe('overlapping contests and the calendar', () => {
    it('gives each overlapping contest its own intake', async () => {
      await follow(-30, 30);
      await follow(-10, -5, 0, fixture.secondSessionId);
      expect((await application.snapshot(fixture.staff, fixture.sessionId)).clock!.intake.reason).toBe('running');
      expect((await application.snapshot(fixture.staff, fixture.secondSessionId)).clock!.intake.reason).toBe('ended');
    });

    it('lists the scheduled contests of the caller\'s event that overlap a window, including one the caller cannot open', async () => {
      await follow(-30, 30);
      await follow(150, 180, 0, fixture.secondSessionId);
      const closed = randomUUID();
      const otherEvent = randomUUID();
      const otherContest = randomUUID();
      await run('INSERT INTO sessions (id, event_id, name, starts_at, ends_at, intake_follows_schedule) VALUES (?, ?, ?, ?, ?, 1)',
        closed, fixture.eventId, 'No seat', new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 3_600_000).toISOString());
      await run('INSERT INTO events (id) VALUES (?)', otherEvent);
      await run('INSERT INTO sessions (id, event_id, name, starts_at, ends_at, intake_follows_schedule) VALUES (?, ?, ?, ?, ?, 1)',
        otherContest, otherEvent, 'Elsewhere', new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 3_600_000).toISOString());
      try {
        const window = { from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 7_200_000).toISOString() };
        const listed = await application.contests(fixture.staff, { window });
        // The second contest starts after the window ends. Another event's contest is never listed.
        expect(listed.map((contest) => [contest.id, contest.canOpen]).sort()).toEqual(
          [[fixture.sessionId, true], [closed, false]].sort());
        expect(listed.find((contest) => contest.id === closed)).toMatchObject({
          name: 'No seat', manage: 'none', schedule: { graceMinutes: 0 }, intake: { open: true, reason: 'running' } });
        const wide = await application.contests(fixture.staff, { window: { from: window.from, to: new Date(Date.now() + 86_400_000).toISOString() } });
        expect(wide.map((contest) => contest.id)).toContain(fixture.secondSessionId);
        expect(wide.map((contest) => contest.id)).not.toContain(otherContest);
        // A contestant sees the same list of the event, and can open only its own contest.
        const contestant = await application.contests(fixture.contestant, { window });
        expect(contestant.map((contest) => [contest.id, contest.canOpen]).sort()).toEqual(
          [[fixture.sessionId, true], [closed, false]].sort());
        // A contest with no schedule appears only in the list of its event.
        expect((await application.contests(fixture.staff, { eventId: fixture.eventId })).map((contest) => contest.id).sort())
          .toEqual([fixture.sessionId, fixture.secondSessionId].sort());
        expect((await application.contests(fixture.staff, { window }))[0]!.schedule).not.toBeNull();
      } finally {
        await run('DELETE FROM sessions WHERE id IN (?, ?)', closed, otherContest);
        await run('DELETE FROM events WHERE id = ?', otherEvent);
      }
    });
  });

  describe('the schedule records', () => {
    const insert = (start: string | null, end: string | null, follows: number, id = randomUUID()) => run(
      'INSERT INTO sessions (id, event_id, starts_at, ends_at, intake_follows_schedule) VALUES (?, ?, ?, ?, ?)',
      id, fixture.eventId, start, end, follows);

    it('refuses a schedule that ends before it starts, an instant in another format, or a follow switch without a schedule', async () => {
      await expect(insert('2026-11-03T10:00:00.000Z', '2026-11-03T09:00:00.000Z', 1)).rejects.toThrow(/start before its end/);
      await expect(insert('2026-11-03T10:00:00.000Z', '2026-11-03T10:00:00.000Z', 1)).rejects.toThrow(/start before its end/);
      await expect(insert('2026-11-03 09:00', '2026-11-03T10:00:00.000Z', 1)).rejects.toThrow(/start before its end/);
      await expect(insert('not a time', '2026-11-03T10:00:00.000Z', 1)).rejects.toThrow(/start before its end/);
      await expect(insert(null, null, 1)).rejects.toThrow(/start before its end/);
      await expect(insert('2026-11-03T09:00:00.000Z', null, 0)).rejects.toThrow(/start before its end/);
      await expect(run('UPDATE sessions SET intake_follows_schedule = 1 WHERE id = ?', fixture.sessionId)).rejects.toThrow(/start before its end/);
      await expect(run('UPDATE sessions SET grace_minutes = 241 WHERE id = ?', fixture.sessionId)).rejects.toThrow(/CHECK/);
      const valid = randomUUID();
      await insert('2026-11-03T09:00:00.000Z', '2026-11-03T10:00:00.000Z', 1, valid);
      await run('DELETE FROM sessions WHERE id = ?', valid);
    });

    it('counts a schedule change in the contest version', async () => {
      const [{ version: before }] = await fixture.rows('SELECT version FROM sessions WHERE id = ?', fixture.sessionId) as [{ version: number }];
      await follow(0, 60);
      const [{ version: after }] = await fixture.rows('SELECT version FROM sessions WHERE id = ?', fixture.sessionId) as [{ version: number }];
      expect(after).toBeGreaterThan(before);
    });

    it('never counts more than a year of extra minutes', async () => {
      await follow(-60, -5);
      await award(2_147_483_647, true);
      expect(await clockOf(fixture.contestant)).toMatchObject({ open: true, clock: { extra_minutes: 525_600 } });
    });
  });
});
