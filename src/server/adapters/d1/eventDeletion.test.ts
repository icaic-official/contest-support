import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { D1ApplicationService } from '../cloudflare/application';
import { contestDataBindings, contestDataSql, resolveAuthority, signInAccountSql } from '../cloudflare/authority';
import { advanceRows, fenceStatements, type RowsProgress } from '../cloudflare/eventDeletion';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import { bound } from './assertions';
import type { D1Connection, D1Statement } from './connection';
import {
  readTables, rowsNaming, seedEvent, seedInertSeat, seedWebmaster, tableNames, type SeededEvent, type SeededWebmaster,
} from './eventDeletionHarness';
import { applyMigrations } from './testFixture';

const connectorConfig = process.env.MINSKY_CONNECTOR_D1_CONFIG;
const remote = Boolean(connectorConfig);
const configPath = connectorConfig ?? 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';
// Each hosted request waits for the runner's reviewed interval.
vi.setConfig({ testTimeout: remote ? 3_600_000 : 300_000, hookTimeout: remote ? 600_000 : 120_000 });

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

describe('event deletion', () => {
  let db: D1Connection;
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
  });

  describe('a crash', () => {
    type CrashMode = 'never ran' | 'response lost';

    /** The process dies at call `at`: that call throws, with or without its effect, and every later call throws. */
    function crashing(connection: D1Connection, at: number, mode: CrashMode): { db: D1Connection; calls: () => number } {
      let calls = 0;
      const enter = async <T>(run: () => Promise<T>): Promise<T> => {
        calls += 1;
        if (calls > at) throw new Error('The process is gone.');
        if (calls < at) return run();
        if (mode === 'response lost') await run();
        throw new Error('The process died at this call.');
      };
      const parts = new WeakMap<object, D1Statement>();
      const wrap = (inner: D1Statement): D1Statement => {
        const wrapped: D1Statement = {
          bind: (...values) => wrap(inner.bind(...values)),
          first: <T>() => enter(() => inner.first<T>()),
          all: <T>() => enter(() => inner.all<T>()),
          run: () => enter(() => inner.run()),
        };
        parts.set(wrapped, inner);
        return wrapped;
      };
      return {
        calls: () => calls,
        db: {
          prepare: (sql) => wrap(connection.prepare(sql)),
          batch: (statements) => enter(() => connection.batch(statements.map((statement) => parts.get(statement)!))),
        },
      };
    }

    async function fenced(event: SeededEvent): Promise<boolean> {
      return (await rows('SELECT 1 FROM event_deletions WHERE event_id = ?', event.eventId)).length > 0;
    }

    /** Fences unless a journal row exists, then deletes the rows. Both steps start from the current state. */
    async function converge(connection: D1Connection, event: SeededEvent, limit?: number): Promise<void> {
      if (!await fenced(event)) await fence(connection, event);
      expect(await deleteRows(connection, event, limit)).toBe('rows_done');
    }

    for (const limit of [100, 1]) {
      it(`at any call of the fence and the rows step, with chunks of ${limit}, converges to the same state`, async () => {
        const clean = await seedEvent(db, webmaster);
        const counter = crashing(db, Number.MAX_SAFE_INTEGER, 'never ran');
        await converge(counter.db, clean, limit);
        const total = counter.calls();
        const expected = await footprint(clean);
        await forget(clean);
        expect(total).toBeGreaterThan(5);
        const modes: CrashMode[] = ['never ran', 'response lost'];
        for (let at = 1; at <= total; at += 1) {
          for (const mode of modes) {
            const event = await seedEvent(db, webmaster);
            const crash = crashing(db, at, mode);
            await expect(converge(crash.db, event, limit), `call ${at}, ${mode}`).rejects.toThrow();
            await converge(db, event, limit);
            expect(await footprint(event), `call ${at}, ${mode}`).toEqual(expected);
            await forget(event);
          }
        }
      });
    }
  });

  describe('concurrent runners', () => {
    it('reach the same end when two run at once', async () => {
      const clean = await seedEvent(db, webmaster);
      await fence(db, clean);
      await deleteRows(db, clean);
      const expected = await footprint(clean);
      await forget(clean);
      const event = await seedEvent(db, webmaster);
      await fence(db, event);
      expect(await Promise.all([deleteRows(db, event, 1), deleteRows(db, event, 1)])).toEqual(['rows_done', 'rows_done']);
      expect(await footprint(event)).toEqual(expected);
      await forget(event);
    });

    it('do not let a stale runner mark a contest done after the step moved on', async () => {
      const event = await seedEvent(db, webmaster);
      await fence(db, event);
      await bound(db, 'DELETE FROM issues WHERE session_id IN (?, ?)', event.practice, event.live).run();
      let entered: () => void = () => undefined;
      let release: () => void = () => undefined;
      const atBatch = new Promise<void>((resolve) => { entered = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      const holding: D1Connection = {
        prepare: (sql) => db.prepare(sql),
        batch: async (statements) => {
          entered();
          await released;
          return db.batch(statements);
        },
      };
      const stale = advanceRows(holding, event.eventId);
      await atBatch;
      expect(await deleteRows(db, event)).toBe('rows_done');
      release();
      await stale;
      expect(await rows(`SELECT id FROM event_deletion_targets WHERE event_id = ? AND kind = 'contest' AND done = 1`, event.eventId)).toEqual([]);
      await forget(event);
    });
  });

  describe('a second event', () => {
    it('keeps every row that names it, apart from site records', async () => {
      const event = await seedEvent(db, webmaster);
      const other = await seedEvent(db, webmaster);
      const before = rowsNaming(await readTables(db, tables), other.ids);
      await fence(db, event);
      await deleteRows(db, event);
      const after = rowsNaming(await readTables(db, tables), other.ids);
      expect(Object.fromEntries(after)).toEqual(Object.fromEntries(before));
      await fence(db, other);
      await deleteRows(db, other);
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
