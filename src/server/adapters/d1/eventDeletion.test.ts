import { randomUUID } from 'node:crypto';
import { attachmentPath } from '../../../connected/imageFile';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EventCode, Handle, ManageCommand } from '../../../backend/contracts';
import { AuthenticationError } from '../../authentication';
import { D1ApplicationService } from '../cloudflare/application';
import { D1AuthenticationService } from '../cloudflare/authentication';
import { createBetterAuthIdentity } from '../cloudflare/identity';
import { D1ManageService } from '../cloudflare/manage';
import { passwordHasher, type PasswordHasher } from '../cloudflare/password';
import { contestDataBindings, contestDataSql, resolveAuthority, signInAccountSql } from '../cloudflare/authority';
import {
  advanceDeletions, advanceRows, CLAIM_DELETION_SQL, CONTEST_ACTIVITY, fenceStatements, ROWS_UNIT_CALLS, type DeletionEnvironment, type RowsProgress,
} from '../cloudflare/eventDeletion';
import { eraseLiveContest } from '../cloudflare/live';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import { bound } from './assertions';
import type { D1Binding, D1Connection } from './connection';
import {
  crashingEnvironment, FakeBucket, FakeLiveNamespace, fillStores, interceptCalls, readTables, rowsNaming, seedEvent, seedInertSeat, seedWebmaster,
  tableNames, type CrashMode, type SeededEvent, type SeededWebmaster,
} from './eventDeletionHarness';
import { applyMigrations } from './testFixture';

const connectorConfig = process.env.MINSKY_CONNECTOR_D1_CONFIG;
const remote = Boolean(connectorConfig);
const configPath = connectorConfig ?? 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';
// Each hosted request waits for the runner's reviewed interval.
vi.setConfig({ testTimeout: remote ? 3_600_000 : 300_000, hookTimeout: remote ? 600_000 : 120_000 });

const fastPasswords: PasswordHasher = { hash: async () => 'fictional-test-hash', verify: async () => false };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

describe('event deletion', () => {
  let db: D1Binding;
  let dispose: () => Promise<void>;
  let webmaster: SeededWebmaster;
  let tables: string[];

  beforeAll(async () => {
    const platform = await openStoreDatabase({ configPath, remoteBindings: remote });
    db = platform.db;
    dispose = platform.dispose;
    if (!remote) await applyMigrations(db);
    webmaster = await seedWebmaster(db);
    tables = await tableNames(db);
  });
  afterAll(async () => { await dispose?.(); });

  const actor = () => ({ id: webmaster.accountId, name: webmaster.name });
  const rows = async <T>(sql: string, ...values: Array<string | number | null>) => (await bound(db, sql, ...values).all<T>()).results;

  async function fence(connection: D1Connection, event: SeededEvent, typed = event.name): Promise<void> {
    await connection.batch(fenceStatements(connection, actor(), event.eventId, typed, randomUUID()));
  }

  async function deleteRows(connection: D1Connection, event: SeededEvent, limit?: number): Promise<RowsProgress> {
    for (;;) {
      const progress = await advanceRows(connection, event.eventId, limit);
      if (progress !== 'more') return progress;
    }
  }

  /** The journal and targets of one event, which a finished test no longer needs. */
  async function forget(event: SeededEvent): Promise<void> {
    await db.batch([
      bound(db, 'DELETE FROM event_deletion_targets WHERE event_id = ?', event.eventId),
      bound(db, 'DELETE FROM event_deletions WHERE event_id = ?', event.eventId),
    ]);
  }

  /** The rows that still name this event, with each ID replaced by its seed position, so two seeds compare equal. */
  async function footprint(event: SeededEvent): Promise<Record<string, string[]>> {
    const found = rowsNaming(await readTables(db, tables), event.ids);
    const position = new Map(event.ids.map((id, index) => [id, `<${index}>`]));
    return Object.fromEntries([...found].map(([table, table_rows]) => [table, table_rows.map((row) =>
      row.replaceAll(event.code, '<code>').replace(UUID, (id) => position.get(id) ?? '<uuid>')).sort()]));
  }

  describe('the fence', () => {
    it('refuses a wrong name and changes nothing', async () => {
      const event = await seedEvent(db, webmaster);
      const before = await footprint(event);
      await expect(fence(db, event, `${event.name} `)).rejects.toThrow(/valid = 1/);
      expect(await footprint(event)).toEqual(before);
      await fence(db, event);
      await deleteRows(db, event);
      await forget(event);
    });

    it('stops every reader of the event at once, and a repeat changes nothing', async () => {
      const event = await seedEvent(db, webmaster);
      const signInRow = () => bound(db, signInAccountSql.event, event.contestant.handle, event.code).first();
      const application = new D1ApplicationService(db);
      const window = { from: '2031-01-01T00:00:00.000Z', to: '2031-01-02T00:00:00.000Z' };
      expect(await signInRow()).not.toBeNull();
      expect((await application.contests(webmaster, { window })).map((contest) => contest.id)).toContain(event.live);
      expect(await resolveAuthority(db, event.volunteer, { scope: 'contest', contestId: event.live })).toBeDefined();
      expect(await resolveAuthority(db, webmaster, { scope: 'event', eventId: event.eventId })).toBeDefined();

      await fence(db, event);

      expect(await signInRow()).toBeNull();
      expect((await application.contests(webmaster, { window })).map((contest) => contest.id)).not.toContain(event.live);
      expect(await application.contests(event.volunteer, { window })).toEqual([]);
      expect(await resolveAuthority(db, event.volunteer, { scope: 'contest', contestId: event.live })).toBeUndefined();
      expect(await resolveAuthority(db, webmaster, { scope: 'contest', contestId: event.live })).toBeUndefined();
      expect(await resolveAuthority(db, webmaster, { scope: 'event', eventId: event.eventId })).toBeUndefined();
      expect(await resolveAuthority(db, event.eventAdmin, { scope: 'event', eventId: event.eventId })).toBeUndefined();
      expect(await bound(db, contestDataSql('caller'), ...contestDataBindings(event.contestant, event.live)).first()).toBeNull();

      expect(await rows('SELECT DISTINCT revoked FROM logins WHERE account_id IN (SELECT id FROM accounts WHERE event_id = ?)', event.eventId))
        .toEqual([{ revoked: 1 }]);
      expect(await rows('SELECT revoked FROM logins WHERE account_id = ?', webmaster.accountId)).toEqual([{ revoked: 0 }]);
      expect(await rows('SELECT archived FROM events WHERE id = ?', event.eventId)).toEqual([{ archived: 1 }]);
      expect(await rows(`SELECT kind, count(*) AS n FROM event_deletion_targets WHERE event_id = ? GROUP BY kind ORDER BY kind`, event.eventId))
        .toEqual([{ kind: 'account', n: event.accounts.length }, { kind: 'avatar_owner', n: 1 }, { kind: 'contest', n: 2 }]);
      expect(await rows(`SELECT DISTINCT session_id FROM notifications WHERE audience = 'staff' AND delivered = 0
        AND session_id IN (?, ?) ORDER BY session_id`, event.practice, event.live))
        .toEqual([event.practice, event.live].sort().map((session_id) => ({ session_id })));

      const fenced = await footprint(event);
      await expect(fence(db, event)).rejects.toThrow(/valid = 1/);
      expect(await footprint(event)).toEqual(fenced);
      await deleteRows(db, event);
      await forget(event);
    });
  });

  describe('the delete_event command', () => {
    const manage = () => new D1ManageService(db, fastPasswords);
    const command = (event: SeededEvent, confirmName = event.name): ManageCommand =>
      ({ type: 'delete_event', eventId: event.eventId, confirmName });

    it('refuses everyone but a webmaster, and a wrong name, without a change', async () => {
      const event = await seedEvent(db, webmaster);
      const before = await footprint(event);
      for (const caller of [event.eventAdmin, event.contestAdmin, event.volunteer, event.contestant]) {
        await expect(manage().execute(caller, randomUUID(), command(event))).rejects.toMatchObject({ status: 403 });
      }
      await expect(manage().execute(webmaster, randomUUID(), command(event, `${event.name}x`)))
        .rejects.toMatchObject({ status: 409, message: 'The name does not match. Type the event name exactly.' });
      await expect(manage().execute(webmaster, randomUUID(), { type: 'delete_event', eventId: randomUUID(), confirmName: 'Nobody' }))
        .rejects.toMatchObject({ status: 409, message: 'That event no longer exists. Refresh the page.' });
      await expect(manage().execute(webmaster, randomUUID(), { type: 'delete_event', eventId: 'not-an-event', confirmName: 'Nobody' }))
        .rejects.toMatchObject({ status: 400 });
      expect(await footprint(event)).toEqual(before);
      await fence(db, event);
      await deleteRows(db, event);
      await forget(event);
    });

    it('fences once, writes one site audit row, and answers a replay with its receipt', async () => {
      const event = await seedEvent(db, webmaster);
      const requestId = randomUUID();
      const receipt = await manage().execute(webmaster, requestId, command(event));
      expect(receipt).toEqual({ eventId: event.eventId });
      expect(await manage().execute(webmaster, requestId, command(event))).toEqual(receipt);
      await expect(manage().execute(webmaster, randomUUID(), command(event)))
        .rejects.toMatchObject({ status: 409, message: 'This event is already being deleted.' });
      expect(await rows(`SELECT event_id, actor, actor_name, detail FROM authority_audit WHERE action = 'delete_event' AND target = ?`, event.eventId))
        .toEqual([{ event_id: null, actor: webmaster.accountId, actor_name: webmaster.name,
          detail: JSON.stringify({ name: event.name, code: event.code }) }]);
      expect(await rows('SELECT requested_by, requested_by_name, step, lease_until FROM event_deletions WHERE event_id = ?', event.eventId))
        .toEqual([{ requested_by: webmaster.accountId, requested_by_name: webmaster.name, step: 'rows', lease_until: 0 }]);
      await deleteRows(db, event);
      await bound(db, `DELETE FROM manage_receipts WHERE actor = ? AND request_id = ?`, webmaster.accountId, requestId).run();
      await forget(event);
    });

    it('gives a fenced event code the refusal of an unknown code', async () => {
      const event = await seedEvent(db, webmaster);
      const identity = createBetterAuthIdentity(db, { origin: 'http://127.0.0.1:8788', secret: 's'.repeat(64), secureCookies: false });
      const auth = new D1AuthenticationService(db, identity, passwordHasher);
      const refusal = async (code: string) => {
        const error = await auth.signIn({ kind: 'event', code: code as EventCode }, event.contestant.handle as Handle, 'a-wrong-password').catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(AuthenticationError);
        return { status: (error as AuthenticationError).status, message: (error as AuthenticationError).message };
      };
      const unknown = await refusal(`unknown-${randomUUID().slice(0, 8)}`);
      await fence(db, event);
      expect(await refusal(event.code)).toEqual(unknown);
      await deleteRows(db, event);
      await bound(db, `DELETE FROM authentication_limits WHERE key LIKE ?`, `handle:code:%:${event.contestant.handle}`).run();
      await forget(event);
    });

    it('shows progress on the site page, and omits the event from its list', async () => {
      const event = await seedEvent(db, webmaster);
      const shown = async () => (await manage().site(webmaster))?.deletions.find((deletion) => deletion.eventId === event.eventId);
      expect(await shown()).toBeUndefined();
      expect((await manage().site(webmaster))?.events.map((item) => item.id)).toContain(event.eventId);
      await fence(db, event);
      expect((await manage().site(webmaster))?.events.map((item) => item.id)).not.toContain(event.eventId);
      expect(await shown()).toMatchObject({
        eventName: event.name, eventCode: event.code, step: 'rows', requestedByName: webmaster.name, blockedBy: null,
        filesDueAt: null, finishedAt: null, remaining: 2 + event.accounts.length,
      });
      const { bucket, live, env } = stores();
      fillStores(event, bucket, live);
      await advanceDeletions(env);
      const waiting = await shown();
      expect(waiting).toMatchObject({ step: 'files', remaining: 3, finishedAt: null });
      expect(Date.parse(waiting?.filesDueAt ?? '') - Date.now()).toBeGreaterThan(60 * 60_000);
      await runToEnd(env, event);
      expect(await shown()).toMatchObject({ step: 'done', remaining: 0 });
      expect((await shown())?.finishedAt).toEqual(expect.any(String));
      await forget(event);
    });

    it('names the blocking account on the site page', async () => {
      const event = await seedEvent(db, webmaster);
      const other = await seedEvent(db, webmaster);
      const legacy = await seedInertSeat(db, event, other.practice);
      await fence(db, event);
      const { env } = stores();
      await advanceDeletions(env);
      const deletion = (await manage().site(webmaster))?.deletions.find((item) => item.eventId === event.eventId);
      const blockedAccount = (await rows<{ handle: string }>('SELECT handle FROM accounts WHERE id = ?', legacy))[0];
      expect(deletion?.blockedBy).toEqual({ name: 'Fictional legacy', handle: blockedAccount?.handle });
      await bound(db, 'DELETE FROM memberships WHERE account_id = ?', legacy).run();
      await runToEnd(env, event);
      await fence(db, other);
      await deleteRows(db, other);
      await forget(event);
      await forget(other);
    });
  });

  describe('the rows step', () => {
    for (const limit of [100, 1]) {
      it(`leaves only the journal and the site records with chunks of ${limit}`, async () => {
        const event = await seedEvent(db, webmaster);
        await fence(db, event);
        expect(await deleteRows(db, event, limit)).toBe('rows_done');
        const left = await footprint(event);
        expect(Object.keys(left).sort()).toEqual(['authority_audit', 'event_deletion_targets', 'event_deletions']);
        expect(left.authority_audit!.every((row) => row.includes('"event_id":null'))).toBe(true);
        expect(await rows('SELECT step, blocked FROM event_deletions WHERE event_id = ?', event.eventId))
          .toEqual([{ step: 'live', blocked: null }]);
        expect(await rows('SELECT DISTINCT done FROM event_deletion_targets WHERE event_id = ? AND kind = ?', event.eventId, 'contest'))
          .toEqual([{ done: 0 }]);
        expect(await rows(`SELECT key FROM authentication_limits WHERE key IN (?, ?)`,
          `handle:${event.eventId}:${event.contestant.handle}`, `change:${event.contestant.accountId}`)).toEqual([]);
        expect(await deleteRows(db, event, limit)).toBe('rows_done');
        await forget(event);
      });
    }

    /** What a long contest leaves: an outbox that nothing deletes, and an audit trail. */
    async function seedLongContest(contest: string, actorId: string, count: number): Promise<void> {
      const series = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})`;
      await db.batch([
        bound(db, `INSERT INTO audience_sequences (session_id, audience, sequence) VALUES (?, 'staff', 1)
          ON CONFLICT (session_id, audience) DO NOTHING`, contest),
        bound(db, `${series} INSERT INTO notifications (id, session_id, audience, sequence, delivered)
          SELECT lower(hex(randomblob(16))), ?, 'staff', 1000 + i, 1 FROM n`, contest),
        bound(db, `${series} INSERT INTO admin_audit (id, session_id, actor, action)
          SELECT lower(hex(randomblob(16))), ?, ?, 'save_member' FROM n`, contest, actorId),
      ]);
    }

    async function countInContest(table: string, contest: string): Promise<number> {
      return (await rows<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE session_id = ?`, contest))[0]?.n ?? 0;
    }

    it('removes a long contest in bounded statements, so the contest row cascades no outbox and no audit', async () => {
      const event = await seedEvent(db, webmaster);
      await seedLongContest(event.live, event.contestAdmin.accountId, 2500);
      await fence(db, event);
      const largest = { notifications: 0, admin_audit: 0 };
      for (;;) {
        const before = { notifications: await countInContest('notifications', event.live), admin_audit: await countInContest('admin_audit', event.live) };
        const progress = await advanceRows(db, event.eventId);
        largest.notifications = Math.max(largest.notifications, before.notifications - await countInContest('notifications', event.live));
        largest.admin_audit = Math.max(largest.admin_audit, before.admin_audit - await countInContest('admin_audit', event.live));
        if (progress === 'rows_done') break;
        expect(progress).toBe('more');
      }
      expect(largest).toEqual({ notifications: 1000, admin_audit: 1000 });
      await forget(event);
    });

    it('removes at most one row of each activity table in a unit with chunks of 1', async () => {
      const event = await seedEvent(db, webmaster);
      await seedLongContest(event.live, event.contestAdmin.accountId, 3);
      await fence(db, event);
      const counts = async () => Promise.all(CONTEST_ACTIVITY.map(async ({ table }) =>
        await countInContest(table, event.practice) + await countInContest(table, event.live)));
      for (;;) {
        const before = await counts();
        const progress = await advanceRows(db, event.eventId, 1);
        const after = await counts();
        expect(before.reduce((sum, count, index) => sum + count - (after[index] ?? 0), 0)).toBeLessThanOrEqual(1);
        if (progress === 'rows_done') break;
      }
      await forget(event);
    });

    for (const limit of [undefined, 1]) {
      it(`spends no more than ROWS_UNIT_CALLS in a unit with chunks of ${limit ?? 'the default'}`, async () => {
        const event = await seedEvent(db, webmaster);
        await fence(db, event);
        const counter = crashingEnvironment(stores().env, Number.MAX_SAFE_INTEGER, 'never ran');
        for (;;) {
          const before = counter.calls();
          const progress = await advanceRows(counter.env.DB, event.eventId, limit);
          expect(counter.calls() - before).toBeLessThanOrEqual(ROWS_UNIT_CALLS);
          if (progress === 'rows_done') break;
        }
        await forget(event);
      });
    }
  });

  /** One environment per test, so that each test reads its own files and live state. */
  function stores(): { bucket: FakeBucket; live: FakeLiveNamespace; env: DeletionEnvironment } {
    const bucket = new FakeBucket();
    const live = new FakeLiveNamespace(db);
    return { bucket, live, env: { DB: db, IMAGES: bucket, LIVE_UPDATES: live } };
  }

  async function finished(event: SeededEvent): Promise<boolean> {
    return (await rows(`SELECT 1 FROM event_deletions WHERE event_id = ? AND step = 'done'`, event.eventId)).length > 0;
  }

  /** What a passing hour and an expired lease do, which a test cannot wait for. */
  async function passTime(event: SeededEvent): Promise<void> {
    await bound(db, `UPDATE event_deletions SET lease_until = 0,
      rows_done_at = CASE WHEN rows_done_at IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-66 minutes') END
      WHERE event_id = ? AND finished_at IS NULL`, event.eventId).run();
  }

  /** Fences unless a journal row exists, then runs ticks until the deletion is done. Every step starts from the current state. */
  async function runToEnd(env: DeletionEnvironment, event: SeededEvent): Promise<void> {
    if (!(await rows('SELECT 1 FROM event_deletions WHERE event_id = ?', event.eventId)).length) await fence(env.DB, event);
    for (let tick = 0; tick < 100; tick += 1) {
      await passTime(event);
      await advanceDeletions(env);
      if (await finished(event)) return;
    }
    throw new Error('The deletion did not finish.');
  }

  describe('a crash', () => {
    const modes: CrashMode[] = ['never ran', 'response lost'];

    it('at any D1, R2, or Durable Object call converges to the same state', async () => {
      const clean = await seedEvent(db, webmaster);
      const cleanStores = stores();
      fillStores(clean, cleanStores.bucket, cleanStores.live);
      const counter = crashingEnvironment(cleanStores.env, Number.MAX_SAFE_INTEGER, 'never ran');
      await runToEnd(counter.env, clean);
      const total = counter.calls();
      const expected = await footprint(clean);
      expect(Object.keys(expected).sort()).toEqual(['authority_audit', 'event_deletions']);
      expect(cleanStores.bucket.objects.size).toBe(0);
      await forget(clean);
      expect(total).toBeGreaterThan(30);
      for (let at = 1; at <= total; at += 1) {
        for (const mode of modes) {
          const label = `call ${at}, ${mode}`;
          const event = await seedEvent(db, webmaster);
          const { bucket, live, env } = stores();
          fillStores(event, bucket, live);
          bucket.add(['control/other-event/file']);
          await expect(runToEnd(crashingEnvironment(env, at, mode).env, event), label).rejects.toThrow();
          await runToEnd(env, event);
          expect(await footprint(event), label).toEqual(expected);
          expect([...bucket.objects], label).toEqual(['control/other-event/file']);
          expect([event.practice, event.live].every((contest) => live.state(contest).empty), label).toBe(true);
          await forget(event);
        }
      }
    });

    it('at any call of the rows step with chunks of 1 converges to the same state', async () => {
      const converge = async (connection: D1Connection, event: SeededEvent) => {
        if (!(await rows('SELECT 1 FROM event_deletions WHERE event_id = ?', event.eventId)).length) await fence(connection, event);
        expect(await deleteRows(connection, event, 1)).toBe('rows_done');
      };
      const clean = await seedEvent(db, webmaster);
      const counter = crashingEnvironment(stores().env, Number.MAX_SAFE_INTEGER, 'never ran');
      await converge(counter.env.DB, clean);
      const total = counter.calls();
      const expected = await footprint(clean);
      await forget(clean);
      for (let at = 1; at <= total; at += 1) {
        for (const mode of modes) {
          const event = await seedEvent(db, webmaster);
          await expect(converge(crashingEnvironment(stores().env, at, mode).env.DB, event), `call ${at}, ${mode}`).rejects.toThrow();
          await converge(db, event);
          expect(await footprint(event), `call ${at}, ${mode}`).toEqual(expected);
          await forget(event);
        }
      }
    });
  });

  describe('concurrent runners', () => {
    it('reach the same end when two run at once', async () => {
      const clean = await seedEvent(db, webmaster);
      await runToEnd(stores().env, clean);
      const expected = await footprint(clean);
      await forget(clean);
      const event = await seedEvent(db, webmaster);
      const { bucket, live, env } = stores();
      fillStores(event, bucket, live);
      await fence(db, event);
      for (let tick = 0; tick < 20 && !await finished(event); tick += 1) {
        await passTime(event);
        await Promise.all([advanceDeletions(env), advanceDeletions(env)]);
      }
      expect(await footprint(event)).toEqual(expected);
      expect(bucket.objects.size).toBe(0);
      await forget(event);
    });

    it('reach the same end when two share the rows step', async () => {
      const event = await seedEvent(db, webmaster);
      await fence(db, event);
      expect(await Promise.all([deleteRows(db, event, 1), deleteRows(db, event, 1)])).toEqual(['rows_done', 'rows_done']);
      await forget(event);
    });

    /** A runner that stops just before the first call that matches, until the test releases it. */
    function pausingAt(pattern: RegExp) {
      let entered: () => void = () => undefined;
      let release: () => void = () => undefined;
      const atCall = new Promise<void>((resolve) => { entered = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      let paused = false;
      return {
        atCall,
        release,
        db: interceptCalls(db, async (sql) => {
          if (!paused && sql.some((text) => pattern.test(text))) {
            paused = true;
            entered();
            await released;
          }
        }),
      };
    }

    it('do not let a stale rows runner skip the files of a contest', async () => {
      const event = await seedEvent(db, webmaster);
      const { bucket, live, env } = stores();
      fillStores(event, bucket, live);
      await fence(db, event);
      await bound(db, 'DELETE FROM issues WHERE session_id IN (?, ?)', event.practice, event.live).run();
      const stale = pausingAt(/^DELETE FROM sessions/);
      const running = advanceRows(stale.db, event.eventId);
      await stale.atCall;
      await passTime(event);
      await advanceDeletions(env);
      expect((await rows<{ step: string }>('SELECT step FROM event_deletions WHERE event_id = ?', event.eventId))[0]?.step).toBe('files');
      stale.release();
      await running;
      expect(await rows(`SELECT id FROM event_deletion_targets WHERE event_id = ? AND kind = 'contest' AND done = 1`, event.eventId)).toEqual([]);
      await runToEnd(env, event);
      expect(bucket.objects.size).toBe(0);
      await forget(event);
    });

    it('do not let a stale live runner skip the files of a contest', async () => {
      const event = await seedEvent(db, webmaster);
      const { bucket, live, env } = stores();
      fillStores(event, bucket, live);
      await fence(db, event);
      await deleteRows(db, event);
      const stale = pausingAt(/SET done = 1/);
      const running = advanceDeletions({ ...env, DB: stale.db });
      await stale.atCall;
      await passTime(event);
      await advanceDeletions(env);
      expect((await rows<{ step: string }>('SELECT step FROM event_deletions WHERE event_id = ?', event.eventId))[0]?.step).toBe('done');
      await forget(event);
      stale.release();
      await running;
      expect(bucket.objects.size).toBe(0);
    });
  });

  describe('a stale live runner', () => {
    it('stops erasing once the step has moved', async () => {
      const event = await seedEvent(db, webmaster);
      const { bucket, live, env } = stores();
      fillStores(event, bucket, live);
      await fence(db, event);
      await deleteRows(db, event);
      let entered: () => void = () => undefined;
      let release: () => void = () => undefined;
      const atRead = new Promise<void>((resolve) => { entered = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      let paused = false;
      const holding = interceptCalls(db, async (sql) => {
        if (!paused && sql.some((text) => text.includes("kind = 'contest' AND done = 0"))) {
          paused = true;
          entered();
          await released;
        }
      });
      const counter = crashingEnvironment({ ...env, DB: holding }, Number.MAX_SAFE_INTEGER, 'never ran');
      const running = advanceDeletions(counter.env);
      await atRead;
      await passTime(event);
      await advanceDeletions(env);
      release();
      await running;
      expect(counter.calls()).toBeLessThan(12);
      await runToEnd(env, event);
      await forget(event);
    });
  });

  describe('the live step', () => {
    it('refuses to erase a contest that exists, or that no journal names', async () => {
      const event = await seedEvent(db, webmaster);
      const { live } = stores();
      live.state(event.live).fill(event.live);
      await expect(eraseLiveContest({ LIVE_UPDATES: live }, event.eventId, event.live)).rejects.toThrow('not erased');
      await fence(db, event);
      await expect(eraseLiveContest({ LIVE_UPDATES: live }, event.eventId, event.live)).rejects.toThrow('not erased');
      expect(live.state(event.live).empty).toBe(false);
      await deleteRows(db, event);
      await eraseLiveContest({ LIVE_UPDATES: live }, event.eventId, event.live);
      expect(live.state(event.live).empty).toBe(true);
      await forget(event);
      await expect(eraseLiveContest({ LIVE_UPDATES: live }, event.eventId, event.live)).rejects.toThrow('not erased');
    });
  });

  describe('the files step', () => {
    it('makes no R2 call and no claim for 65 minutes after the rows go', async () => {
      const event = await seedEvent(db, webmaster);
      const { bucket, live, env } = stores();
      fillStores(event, bucket, live);
      await fence(db, event);
      const calls: string[] = [];
      const counted: DeletionEnvironment = { ...env, IMAGES: {
        list: (options) => { calls.push(options.prefix); return bucket.list(options); },
        delete: (keys) => bucket.delete(keys),
      } };
      await advanceDeletions(counted);
      expect(calls).toEqual([]);
      const row = (await rows<{ step: string; wait: number }>(`SELECT step, lease_until - unixepoch(rows_done_at) AS wait FROM event_deletions WHERE event_id = ?`, event.eventId))[0];
      expect(row).toEqual({ step: 'files', wait: 3900 });
      expect(await bound(db, CLAIM_DELETION_SQL, 55).first()).toBeNull();
      await runToEnd(env, event);
      await forget(event);
    });

    it('covers the keys of issue images, announcement images, and avatars, and follows every page', async () => {
      const event = await seedEvent(db, webmaster);
      const { bucket, live, env } = stores();
      fillStores(event, bucket, live);
      expect(event.objects).toContainEqual(attachmentPath(event.practice, event.objects[0]!.split('/')[1]!, event.objects[0]!.split('/')[2]!, 'original'));
      expect(event.objects.filter((key) => key.startsWith(`${event.live}/announcements/`))).toHaveLength(1);
      expect(event.objects.filter((key) => key.startsWith(`accounts/${event.eventAdmin.accountId}/`))).toHaveLength(1);
      bucket.pageSize = 2;
      bucket.add([1, 2, 3, 4, 5].map((n) => `${event.practice}/many/${n}`));
      bucket.emptyFirstPage.add(`${event.live}/`);
      bucket.add(['control/file', `${event.practice}-not-this-contest/file`]);
      await runToEnd(env, event);
      expect([...bucket.objects].sort()).toEqual([`${event.practice}-not-this-contest/file`, 'control/file'].sort());
      await forget(event);
    });

    it('marks a prefix done only after a complete listing finds no object', async () => {
      const event = await seedEvent(db, webmaster);
      const { bucket, live, env } = stores();
      fillStores(event, bucket, live);
      await fence(db, event);
      await advanceDeletions(env);
      await passTime(event);
      bucket.pageSize = 1;
      const marksBeforeEmpty: number[] = [];
      const watching: DeletionEnvironment = { ...env, IMAGES: {
        list: async (options) => {
          const page = await bucket.list(options);
          if (page.objects.length > 0) {
            marksBeforeEmpty.push((await rows(`SELECT 1 FROM event_deletion_targets WHERE event_id = ? AND done = 1 AND kind = 'contest' AND ? LIKE id || '/%'`,
              event.eventId, options.prefix)).length);
          }
          return page;
        },
        delete: (keys) => bucket.delete(keys),
      } };
      await advanceDeletions(watching);
      expect(marksBeforeEmpty.every((marked) => marked === 0)).toBe(true);
      expect(marksBeforeEmpty.length).toBeGreaterThan(0);
      expect(await finished(event)).toBe(true);
      await forget(event);
    });
  });

  describe('the budget', () => {
    it('stops at its count of calls, and later ticks finish', async () => {
      const event = await seedEvent(db, webmaster);
      const { bucket, live, env } = stores();
      fillStores(event, bucket, live);
      await fence(db, event);
      const counter = crashingEnvironment(env, Number.MAX_SAFE_INTEGER, 'never ran');
      await advanceDeletions(counter.env, { milliseconds: 20_000, calls: 4 });
      expect(counter.calls()).toBeLessThan(12);
      expect(await finished(event)).toBe(false);
      for (let tick = 0; tick < 100 && !await finished(event); tick += 1) {
        await passTime(event);
        await advanceDeletions(env, { milliseconds: 20_000, calls: 4 });
      }
      expect(await finished(event)).toBe(true);
      await forget(event);
    });

    it('stops at its time, and leaves the lease for a later tick', async () => {
      const event = await seedEvent(db, webmaster);
      const { env } = stores();
      await fence(db, event);
      await advanceDeletions(env, { milliseconds: 0, calls: 400 });
      expect(await rows('SELECT lease_until FROM event_deletions WHERE event_id = ?', event.eventId)).toEqual([{ lease_until: 0 }]);
      await runToEnd(env, event);
      await forget(event);
    });

    it('lets one failing deletion leave the others to finish, and then reports the failure', async () => {
      const failing = await seedEvent(db, webmaster);
      const other = await seedEvent(db, webmaster);
      const { bucket, live, env } = stores();
      fillStores(failing, bucket, live);
      fillStores(other, bucket, live);
      await fence(db, failing);
      await fence(db, other);
      await advanceDeletions(env);
      await passTime(failing);
      await passTime(other);
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await expect(advanceDeletions({ ...env, IMAGES: {
        list: async (options) => {
          if (options.prefix.startsWith(failing.practice) || options.prefix.startsWith(failing.live) || options.prefix.includes(failing.eventAdmin.accountId)) {
            throw new Error('Storage unavailable.');
          }
          return bucket.list(options);
        },
        delete: (keys) => bucket.delete(keys),
      } })).rejects.toThrow('requires another attempt');
      expect(logged.mock.calls.map(([line]) => JSON.parse(String(line)) as object))
        .toContainEqual(expect.objectContaining({ event: 'deletion.advance_failed', eventId: failing.eventId }));
      logged.mockRestore();
      expect(await finished(other)).toBe(true);
      expect(await finished(failing)).toBe(false);
      await runToEnd(env, failing);
      await forget(failing);
      await forget(other);
    });
  });

  describe('statement plans', () => {
    it('searches every statement of a complete deletion through an index', async () => {
      const event = await seedEvent(db, webmaster);
      const { bucket, live, env } = stores();
      fillStores(event, bucket, live);
      const recorded = new Map<string, readonly (string | number | null)[]>();
      const recording: DeletionEnvironment = { ...env, DB: interceptCalls(db, async (sql, values) => {
        sql.forEach((text, index) => recorded.set(text, values[index] ?? []));
      }) };
      await runToEnd(recording, event);
      expect(recorded.size).toBeGreaterThan(15);
      const scans: string[] = [];
      for (const [sql, values] of recorded) {
        const plan = await bound(db, `EXPLAIN QUERY PLAN ${sql}`, ...values).all<{ detail: string }>();
        for (const { detail } of plan.results) {
          // A scan of the installation table reads its one row.
          if (/^SCAN /.test(detail) && !/^SCAN (?:CONSTANT ROW|\(subquery-\d+\)|json_each|installation\b)/.test(detail)) {
            scans.push(`${detail}: ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
          }
        }
      }
      expect(scans).toEqual([]);
      await forget(event);
    });
  });

  describe('a second event', () => {
    it('keeps every row that names it, its files, and its live state', async () => {
      const event = await seedEvent(db, webmaster);
      const other = await seedEvent(db, webmaster);
      const { bucket, live, env } = stores();
      fillStores(event, bucket, live);
      fillStores(other, bucket, live);
      const before = rowsNaming(await readTables(db, tables), other.ids);
      await runToEnd(env, event);
      const after = rowsNaming(await readTables(db, tables), other.ids);
      expect(Object.fromEntries(after)).toEqual(Object.fromEntries(before));
      expect([...bucket.objects].sort()).toEqual([...other.objects].sort());
      for (const contest of [other.practice, other.live]) expect(live.state(contest).empty).toBe(false);
      await runToEnd(env, other);
      await forget(event);
      await forget(other);
    });
  });

  describe('legacy data that crosses events', () => {
    async function blockedName(event: SeededEvent): Promise<string | null | undefined> {
      return (await rows<{ blocked: string | null }>('SELECT blocked FROM event_deletions WHERE event_id = ?', event.eventId))[0]?.blocked;
    }

    for (const limit of [100, 1]) {
      it(`blocks on an actor outside the event and finishes after the blocker goes, with chunks of ${limit}`, async () => {
        const event = await seedEvent(db, webmaster);
        const other = await seedEvent(db, webmaster);
        const historyId = randomUUID();
        const issue = (await rows<{ id: string }>('SELECT id FROM issues WHERE session_id = ? LIMIT 1', other.live))[0]!.id;
        await bound(db, `INSERT INTO history (id, issue_id, actor, actor_name, at, text, visibility)
          VALUES (?, ?, ?, 'Legacy', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'Legacy', 'public')`, historyId, issue, event.volunteer.accountId).run();
        const before = rowsNaming(await readTables(db, tables), other.ids);
        await fence(db, event);
        expect(await deleteRows(db, event, limit)).toBe('blocked');
        expect(await blockedName(event)).toBe(event.volunteer.accountId);
        expect(await rows<{ retry: number }>(`SELECT lease_until - unixepoch() > 3500 AS retry FROM event_deletions WHERE event_id = ?`, event.eventId))
          .toEqual([{ retry: 1 }]);
        const accountIds = event.accounts.map((account) => account.accountId).sort();
        const remaining = (await rows<{ id: string }>(`SELECT id FROM accounts WHERE event_id = ? ORDER BY id`, event.eventId)).map(({ id }) => id);
        expect(remaining).toEqual(accountIds.slice(accountIds.indexOf(event.volunteer.accountId)));
        expect(Object.fromEntries(rowsNaming(await readTables(db, tables), other.ids))).toEqual(Object.fromEntries(before));
        await bound(db, 'DELETE FROM history WHERE id = ?', historyId).run();
        expect(await deleteRows(db, event, limit)).toBe('rows_done');
        expect(await blockedName(event)).toBeNull();
        await fence(db, other);
        await deleteRows(db, other);
        await forget(event);
        await forget(other);
      });

      it(`blocks on an inert seat in another event, without a cascade, with chunks of ${limit}`, async () => {
        const event = await seedEvent(db, webmaster);
        const other = await seedEvent(db, webmaster);
        const legacy = await seedInertSeat(db, event, other.practice);
        const before = rowsNaming(await readTables(db, tables), other.ids);
        await fence(db, event);
        expect(await deleteRows(db, event, limit)).toBe('blocked');
        expect(await blockedName(event)).toBe(legacy);
        expect(Object.fromEntries(rowsNaming(await readTables(db, tables), other.ids))).toEqual(Object.fromEntries(before));
        await bound(db, 'DELETE FROM memberships WHERE account_id = ? AND session_id = ?', legacy, other.practice).run();
        expect(await deleteRows(db, event, limit)).toBe('rows_done');
        await fence(db, other);
        await deleteRows(db, other);
        await forget(event);
        await forget(other);
      });

      it(`blocks on an operation on an account outside the targets, with chunks of ${limit}`, async () => {
        const event = await seedEvent(db, webmaster);
        const other = await seedEvent(db, webmaster);
        const operation = randomUUID();
        await bound(db, `INSERT INTO account_operations (id, account_id, actor, session_id, action, state)
          VALUES (?, ?, ?, NULL, 'set_username', 'completed')`, operation, other.volunteer.accountId, event.waiting.accountId).run();
        await fence(db, event);
        expect(await deleteRows(db, event, limit)).toBe('blocked');
        expect(await blockedName(event)).toBe(event.waiting.accountId);
        expect(await rows('SELECT id FROM account_operations WHERE id = ?', operation)).toHaveLength(1);
        await bound(db, 'DELETE FROM account_operations WHERE id = ?', operation).run();
        expect(await deleteRows(db, event, limit)).toBe('rows_done');
        await fence(db, other);
        await deleteRows(db, other);
        await forget(event);
        await forget(other);
      });
    }
  });

  describe('the journal triggers', () => {
    it('moves forward one step at a time and keeps naming the same event', async () => {
      const event = await seedEvent(db, webmaster);
      await fence(db, event);
      for (const step of ['files', 'done', 'rows']) {
        await expect(bound(db, `UPDATE event_deletions SET step = ?, rows_done_at = 'x', finished_at = CASE WHEN ? = 'done' THEN 'x' END WHERE event_id = ?`,
          step, step, event.eventId).run()).rejects.toThrow();
      }
      for (const column of ['event_id', 'event_name', 'event_code', 'requested_by']) {
        await expect(bound(db, `UPDATE event_deletions SET ${column} = 'other' WHERE event_id = ?`, event.eventId).run()).rejects.toThrow(/names its event for good/);
      }
      await deleteRows(db, event);
      await expect(bound(db, `UPDATE event_deletions SET step = 'rows', rows_done_at = NULL WHERE event_id = ?`, event.eventId).run()).rejects.toThrow(/forward one step/);
      await forget(event);
    });
  });
});
