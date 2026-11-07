import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_ROWS_IN_A_CONTEST } from '../cloudflare/eventDeletion';
import { bound } from './assertions';
import type { D1Binding } from './connection';
import { changedRows, deletionSuite, readTables, rowsNaming, seedEvent, seedInertSeat, type SeededEvent, type SeededWebmaster } from './eventDeletionHarness';

describe('event deletion', () => {
  const suite = deletionSuite();
  const { deleteRows, fence, forget, rows, runToEnd, stores } = suite;
  let db: D1Binding;
  let webmaster: SeededWebmaster;
  let tables: string[];
  beforeAll(() => { ({ db, webmaster, tables } = suite.opened()); });

  describe('the legacy installation row', () => {
    type Placement = (event: SeededEvent, other: SeededEvent) => [owner: string, eventId: string, sessionId: string];
    const naming: Array<[string, Placement]> = [
      ['its owner', (event, other) => [event.eventAdmin.accountId, other.eventId, other.practice]],
      ['its contest', (event, other) => [other.eventAdmin.accountId, other.eventId, event.practice]],
      ['its event', (event, other) => [other.eventAdmin.accountId, event.eventId, other.practice]],
    ];

    async function withInstallation(placement: Placement, check: (event: SeededEvent) => Promise<void>): Promise<void> {
      // The row is one for the whole site, so a database that holds one cannot run this test.
      if ((await rows('SELECT 1 FROM installation')).length > 0) return;
      const event = await seedEvent(db, webmaster);
      const other = await seedEvent(db, webmaster);
      await bound(db, 'INSERT INTO installation (singleton, id, owner_account_id, event_id, session_id) VALUES (1, ?, ?, ?, ?)',
        randomUUID(), ...placement(event, other)).run();
      try {
        await fence(db, event);
        await check(event);
      } finally {
        await bound(db, 'DELETE FROM installation').run();
      }
      await deleteRows(db, event);
      await runToEnd(stores().env, other);
      await forget(event);
      await forget(other);
    }

    for (const [label, placement] of naming) {
      it(`goes when it names the event by ${label}, so it blocks nothing`, async () => {
        await withInstallation(placement, async (event) => {
          expect(await rows('SELECT 1 FROM installation')).toEqual([]);
          expect(await deleteRows(db, event)).toBe('rows_done');
        });
      });
    }

    it('stays when it names only another event', async () => {
      await withInstallation((_, other) => [other.eventAdmin.accountId, other.eventId, other.practice], async (event) => {
        expect(await rows('SELECT 1 FROM installation')).toHaveLength(1);
        expect(await deleteRows(db, event)).toBe('rows_done');
      });
    });
  });

  describe('legacy data that crosses events', () => {
    async function blockedName(event: SeededEvent): Promise<string | null | undefined> {
      return (await rows<{ blocked: string | null }>('SELECT blocked FROM event_deletions WHERE event_id = ?', event.eventId))[0]?.blocked;
    }

    const contestRowsOfAnAccount: Record<string, (accountId: string, other: SeededEvent) => Promise<void>> = {
      announcement_receipts: async (accountId, other) => {
        const announcement = (await rows<{ id: string }>('SELECT id FROM announcements WHERE session_id = ?', other.live))[0]!.id;
        await bound(db, `INSERT INTO announcement_receipts (actor, request_id, session_id, command, announcement_id)
          VALUES (?, ?, ?, '{}', ?)`, accountId, randomUUID(), other.live, announcement).run();
      },
      command_receipts: async (accountId, other) => {
        const issue = (await rows<{ id: string }>('SELECT id FROM issues WHERE session_id = ? LIMIT 1', other.live))[0]!.id;
        await bound(db, `INSERT INTO command_receipts (actor, request_id, session_id, command, issue_id)
          VALUES (?, ?, ?, '{}', ?)`, accountId, randomUUID(), other.live, issue).run();
      },
      credential_scopes: async (accountId, other) => {
        await bound(db, `INSERT INTO credential_scopes (account_id, session_id, operation_id, issued_from, issued_until)
          VALUES (?, ?, ?, '2031-01-01T09:00:00.000Z', '2031-01-01T12:00:00.000Z')`, accountId, other.live, randomUUID()).run();
      },
      // Without its audit row, no key refuses the cascade, so only the check of the contest stops it.
      account_operations: async (accountId, other) => {
        const operation = randomUUID();
        await bound(db, `INSERT INTO account_operations (id, account_id, actor, session_id, action, state)
          VALUES (?, ?, ?, ?, 'reset_password', 'completed')`, operation, accountId, other.contestAdmin.accountId, other.practice).run();
        await bound(db, 'DELETE FROM admin_audit WHERE id = ?', operation).run();
      },
    };

    for (const { table, column } of ACCOUNT_ROWS_IN_A_CONTEST.filter((row) => row.table !== 'memberships')) {
      it(`blocks on a row of ${table} in another event, without a cascade`, async () => {
        const event = await seedEvent(db, webmaster);
        const other = await seedEvent(db, webmaster);
        await contestRowsOfAnAccount[table]!(event.volunteer.accountId, other);
        const before = rowsNaming(await readTables(db, tables), other.ids);
        await fence(db, event);
        expect(await deleteRows(db, event)).toBe('blocked');
        expect(await blockedName(event)).toBe(event.volunteer.accountId);
        expect(Object.fromEntries(rowsNaming(await readTables(db, tables), other.ids))).toEqual(Object.fromEntries(before));
        await bound(db, `DELETE FROM ${table} WHERE ${column} = ?`, event.volunteer.accountId).run();
        expect(await deleteRows(db, event)).toBe('rows_done');
        await runToEnd(stores().env, other);
        await forget(event);
        await forget(other);
      });
    }

    it('blocks on a scoped operation between two of its accounts when no audit row names it, and the row stays', async () => {
      const event = await seedEvent(db, webmaster);
      const other = await seedEvent(db, webmaster);
      // The actor sorts first, so its retry alone runs the delete of the operation.
      const [actorId, accountId] = [event.volunteer.accountId, event.contestAdmin.accountId].sort() as [string, string];
      const operation = randomUUID();
      await bound(db, `INSERT INTO account_operations (id, account_id, actor, session_id, action, state)
        VALUES (?, ?, ?, ?, 'set_username', 'completed')`, operation, accountId, actorId, other.practice).run();
      // 0009 added the audit trigger with no backfill, so an older operation has no audit row.
      await bound(db, 'DELETE FROM admin_audit WHERE id = ?', operation).run();
      await fence(db, event);
      expect(await deleteRows(db, event)).toBe('blocked');
      expect(await blockedName(event)).toBe(actorId);
      expect(await rows('SELECT session_id FROM account_operations WHERE id = ?', operation)).toEqual([{ session_id: other.practice }]);
      await bound(db, 'DELETE FROM account_operations WHERE id = ?', operation).run();
      expect(await deleteRows(db, event)).toBe('rows_done');
      await runToEnd(stores().env, other);
      await forget(event);
      await forget(other);
    });

    it('blocks two deletions on each other through operations with no contest, until the statement in the operator guide removes them', async () => {
      const [first, second] = [await seedEvent(db, webmaster), await seedEvent(db, webmaster)];
      const [a, b] = [first.volunteer.accountId, second.volunteer.accountId];
      await bound(db, `INSERT INTO account_operations (id, account_id, actor, session_id, action, state) VALUES
        (?, ?, ?, NULL, 'set_username', 'completed'), (?, ?, ?, NULL, 'set_username', 'completed')`, randomUUID(), b, a, randomUUID(), a, b).run();
      await fence(db, first);
      await fence(db, second);
      for (let round = 0; round < 2; round += 1) {
        expect(await deleteRows(db, first)).toBe('blocked');
        expect(await deleteRows(db, second)).toBe('blocked');
      }
      await bound(db, `DELETE FROM account_operations WHERE session_id IS NULL AND actor IN (SELECT id FROM accounts WHERE event_id IN (?1, ?2))
        AND account_id IN (SELECT id FROM accounts WHERE event_id IN (?1, ?2))`, first.eventId, second.eventId).run();
      expect(await deleteRows(db, first)).toBe('rows_done');
      expect(await deleteRows(db, second)).toBe('rows_done');
      await forget(first);
      await forget(second);
    });

    it('writes only one access row to the outbox of another event for an inert seat there', async () => {
      const event = await seedEvent(db, webmaster);
      const other = await seedEvent(db, webmaster);
      const legacy = await seedInertSeat(db, event, other.practice);
      const before = rowsNaming(await readTables(db, tables), other.ids);
      await fence(db, event);
      const changes = changedRows(before, rowsNaming(await readTables(db, tables), other.ids));
      expect(Object.keys(changes).sort()).toEqual(['audience_sequences', 'notifications']);
      for (const { removed, added } of Object.values(changes)) {
        expect(removed).toEqual([]);
        expect(added).toEqual([expect.stringContaining(`"audience":"account:${legacy}"`)]);
      }
      await bound(db, 'DELETE FROM memberships WHERE account_id = ?', legacy).run();
      await deleteRows(db, event);
      await runToEnd(stores().env, other);
      await forget(event);
      await forget(other);
    });

    it('moves only the access version of an account of another event with an inert seat in this one', async () => {
      const event = await seedEvent(db, webmaster);
      const other = await seedEvent(db, webmaster);
      const legacy = await seedInertSeat(db, other, event.practice);
      const before = rowsNaming(await readTables(db, tables), other.ids);
      const version = async () => (await rows<{ access_version: number }>('SELECT access_version FROM accounts WHERE id = ?', legacy))[0]?.access_version ?? 0;
      const versionBefore = await version();
      await fence(db, event);
      expect(await deleteRows(db, event)).toBe('rows_done');
      const changes = changedRows(before, rowsNaming(await readTables(db, tables), other.ids));
      expect(Object.keys(changes)).toEqual(['accounts']);
      const withoutVersion = (row: string) => row.replace(/"access_version":\d+/, '');
      expect(changes.accounts?.added.map(withoutVersion)).toEqual(changes.accounts?.removed.map(withoutVersion));
      expect(changes.accounts?.added).toEqual([expect.stringContaining(legacy)]);
      expect(await version()).toBe(versionBefore + 1);
      expect(await rows('SELECT revoked FROM logins WHERE account_id = ?', legacy)).toEqual([{ revoked: 0 }]);
      await runToEnd(stores().env, other);
      await forget(event);
      await forget(other);
    });

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
        await fence(db, event);
        const before = rowsNaming(await readTables(db, tables), other.ids);
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
});
