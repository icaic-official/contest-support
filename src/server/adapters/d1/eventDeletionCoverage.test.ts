import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_OWN_ROWS, ACCOUNT_ROWS_IN_A_CONTEST, advanceRows, CONTEST_ACTIVITY, fenceStatements } from '../cloudflare/eventDeletion';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import { bound } from './assertions';
import type { D1Connection } from './connection';
import {
  readTables, rowsNaming, seedEvent, seedInstallation, seedWebmaster, tableNames, type SeededEvent,
  type SeededWebmaster, type TableRows,
} from './eventDeletionHarness';
import { applyMigrations } from './testFixture';

const connectorConfig = process.env.MINSKY_CONNECTOR_D1_CONFIG;
const remote = Boolean(connectorConfig);
const configPath = connectorConfig ?? 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';
vi.setConfig({ testTimeout: remote ? 600_000 : 120_000, hookTimeout: remote ? 600_000 : 120_000 });

interface ForeignKey {
  readonly child: string;
  readonly parent: string;
  readonly onDelete: string;
}

async function foreignKeys(db: D1Connection, tables: readonly string[]): Promise<ForeignKey[]> {
  const keys: ForeignKey[] = [];
  for (const table of tables) {
    const { results } = await db.prepare(`PRAGMA foreign_key_list("${table}")`).all<{ table: string; on_delete: string }>();
    keys.push(...results.map((row) => ({ child: table, parent: row.table, onDelete: row.on_delete })));
  }
  return keys;
}

/** Every table that the given keys reach from the given parents. */
function reachedFrom(parents: readonly string[], keys: readonly ForeignKey[]): Set<string> {
  const reached = new Set(parents);
  for (let grew = true; grew;) {
    grew = false;
    for (const { child, parent } of keys) {
      if (!reached.has(child) && reached.has(parent)) {
        reached.add(child);
        grew = true;
      }
    }
  }
  return reached;
}

/**
 * The tables that name an event, a contest, or an account, directly or through
 * another such table. The schema decides, so a new table joins this list by itself.
 */
const referencingTables = (keys: readonly ForeignKey[]) => reachedFrom(['events', 'sessions', 'accounts'], keys);

/** The tables that an `ON DELETE CASCADE` chain reaches from one parent. */
function cascadeChildren(keys: readonly ForeignKey[], parent: string): Set<string> {
  const reached = reachedFrom([parent], keys.filter(({ onDelete }) => onDelete === 'CASCADE'));
  reached.delete(parent);
  return reached;
}

/** Under a contest, the tables that stay the size of the roster. The contest row's own cascade removes them. */
const ROSTER_SIZED = ['audience_sequences', 'credential_scopes', 'grants', 'membership_roles', 'memberships', 'session_issue_sequences', 'teams'];
/** Under a contest, the tables whose rows go with a chunk of their parent, and not with the contest row. */
const CHUNKED_WITH_A_PARENT = ['announcement_image_deletions', 'announcement_images', 'awards', 'command_receipts', 'history', 'image_deletions', 'issue_images', 'resolutions'];

/**
 * Directly under an event, the tables that the event row's own cascade removes in one statement.
 * Their size follows the roster and the commands that people send, and not the activity of a contest.
 */
const UNDER_THE_EVENT_ROW = ['authority_audit', 'entrants'];

/** A column that names an event, a contest, an account, or a row that lives under one of those. */
const NAMING_COLUMN = /^(?:event_id|session_id|contest_id|account_id|owner_account_id|issue_id|team_id|entrant_id|resolution_id|announcement_id|actor|owner|reporter|author|uploader|target|userId|\w+_by)$/;

/** Tables with such a column that no foreign key chain reaches, and that a deletion still covers. */
const OUTSIDE_THE_CHAINS = new Set([
  // The account batch deletes `ba_user` by ID, and these two cascade from it.
  'ba_account', 'ba_session',
  // The journal stays, and it holds no row before the fence.
  'event_deletions', 'event_deletion_targets',
  // One row for the site. It names a webmaster, and no event owns it.
  'site_settings',
]);
const NO_SEED_NEEDED = new Set(['event_deletions', 'event_deletion_targets', 'site_settings']);

async function namingTables(db: D1Connection, tables: readonly string[]): Promise<string[]> {
  const named: string[] = [];
  for (const table of tables) {
    const { results } = await db.prepare(`PRAGMA table_info("${table}")`).all<{ name: string }>();
    if (results.some(({ name }) => NAMING_COLUMN.test(name))) named.push(table);
  }
  return named;
}

/** Why the coverage test would miss each table: no chain reaches it, or the seed leaves it empty. */
function coverageGaps(named: readonly string[], reached: ReadonlySet<string>, seeded: ReadonlySet<string>): string[] {
  return named.flatMap((table) => [
    ...(reached.has(table) || OUTSIDE_THE_CHAINS.has(table) ? [] : [`${table}: no chain reaches it`]),
    ...(seeded.has(table) || NO_SEED_NEEDED.has(table) ? [] : [`${table}: the seed leaves it empty`]),
  ]);
}

/**
 * Each row, as a string, without what the seeding itself moves. Seeding an event toggles the site setting,
 * which moves its version, and each join and removed join moves the webmaster's access version.
 */
function rowSet(tables: ReadonlyMap<string, TableRows[]>, webmasterId: string): Map<string, Set<string>> {
  const steady = (table: string, row: TableRows): TableRows => {
    if (table === 'site_settings') return { ...row, version: '<moved>' };
    if (table === 'accounts' && row.id === webmasterId) return { ...row, access_version: '<moved>' };
    return row;
  };
  return new Map([...tables].map(([table, rows]) => [table, new Set(rows.map((row) => JSON.stringify(steady(table, row))))]));
}

describe('event deletion coverage', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  let webmaster: SeededWebmaster;
  let tables: string[];
  let keys: ForeignKey[];

  beforeAll(async () => {
    const platform = await openStoreDatabase({ configPath, remoteBindings: remote });
    db = platform.db;
    dispose = platform.dispose;
    if (!remote) await applyMigrations(db);
    webmaster = await seedWebmaster(db);
    tables = await tableNames(db);
    keys = await foreignKeys(db, tables);
  });
  afterAll(async () => { await dispose?.(); });

  async function deleteRows(event: SeededEvent): Promise<void> {
    await db.batch(fenceStatements(db, { id: webmaster.accountId, name: webmaster.name }, event.eventId, event.name, randomUUID()));
    for (;;) {
      const progress = await advanceRows(db, event.eventId);
      if (progress === 'rows_done') return;
      expect(progress).toBe('more');
    }
  }

  async function forget(event: SeededEvent): Promise<void> {
    await db.batch([
      bound(db, 'DELETE FROM event_deletion_targets WHERE event_id = ?', event.eventId),
      bound(db, 'DELETE FROM event_deletions WHERE event_id = ?', event.eventId),
    ]);
  }

  it('leaves only the site records of a deleted event, and every table that names one holds a seeded row', async () => {
    const kept = await seedEvent(db, webmaster);
    const alone = rowSet(await readTables(db, tables), webmaster.accountId);

    const deleted = await seedEvent(db, webmaster);
    const heldInstallation = await seedInstallation(db, deleted);
    const seeded = rowsNaming(await readTables(db, tables), deleted.ids);
    const required = referencingTables(keys);
    expect(required.size).toBeGreaterThan(25);
    // The singleton names the site's first event, so only a database without one can seed it.
    if (!heldInstallation) required.delete('installation');
    expect([...required].filter((table) => !seeded.has(table))).toEqual([]);
    const named = (await namingTables(db, tables)).filter((table) => heldInstallation || table !== 'installation');
    expect(named.length).toBeGreaterThan(25);
    expect(coverageGaps(named, required, new Set(seeded.keys()))).toEqual([]);
    expect((await bound(db, 'SELECT unready_seats FROM sessions WHERE id = ?', deleted.live).first<{ unready_seats: number }>())?.unready_seats).toBe(1);

    await deleteRows(deleted);

    const after = rowSet(await readTables(db, tables), webmaster.accountId);
    const differences: string[] = [];
    const ours = [...kept.ids, ...deleted.ids, webmaster.accountId];
    for (const table of tables) {
      const before = alone.get(table)!;
      const now = after.get(table)!;
      const changed = [...[...before].filter((row) => !now.has(row)), ...[...now].filter((row) => !before.has(row))];
      differences.push(...changed.filter((row) => !remote || ours.some((id) => row.includes(id))).map((row) => `${table}: ${row}`));
    }
    const expected: Array<[string, RegExp]> = [
      ['journal', new RegExp(`^event_deletions: .*"event_id":"${deleted.eventId}"`)],
      ['target', new RegExp(`^event_deletion_targets: .*"event_id":"${deleted.eventId}"`)],
      // The audited join of the deleted event's contest is a site record.
      ['audit', new RegExp(`^authority_audit: .*"event_id":null.*"action":"webmaster_join","target":"${deleted.live}"`)],
    ];
    const kindOf = (row: string) => expected.find(([, rule]) => rule.test(row))?.[0] ?? `unexpected ${row}`;
    const counts = differences.reduce<Record<string, number>>((tally, row) => ({ ...tally, [kindOf(row)]: (tally[kindOf(row)] ?? 0) + 1 }), {});
    expect(counts).toEqual({ journal: 1, target: 2 + deleted.accounts.length + 1, audit: 1 });
    await forget(deleted);

    // A hosted database is shared and must not grow. A local one goes with this file.
    if (remote) {
      await deleteRows(kept);
      await forget(kept);
    }
  });

  it('reports a table that names an event, a contest, or an account when no chain reaches it or the seed leaves it empty', () => {
    expect(coverageGaps(['new_table'], new Set(), new Set()))
      .toEqual(['new_table: no chain reaches it', 'new_table: the seed leaves it empty']);
    expect(coverageGaps(['new_table'], new Set(['new_table']), new Set())).toEqual(['new_table: the seed leaves it empty']);
    expect(coverageGaps(['new_table'], new Set(), new Set(['new_table']))).toEqual(['new_table: no chain reaches it']);
    expect(coverageGaps(['new_table'], new Set(['new_table']), new Set(['new_table']))).toEqual([]);
    expect(NAMING_COLUMN.test('session_id')).toBe(true);
    expect(NAMING_COLUMN.test('issue_id')).toBe(true);
    expect(NAMING_COLUMN.test('team_id')).toBe(true);
    expect(NAMING_COLUMN.test('deleted_by')).toBe(true);
    expect(NAMING_COLUMN.test('name')).toBe(false);
  });

  it('classifies every table that a contest delete cascades into, so a new one must choose', async () => {
    const classified = [...CONTEST_ACTIVITY.map(({ table }) => table), ...ROSTER_SIZED, ...CHUNKED_WITH_A_PARENT].sort();
    expect([...cascadeChildren(keys, 'sessions')].sort()).toEqual(classified);
  });

  it('classifies every table that an event delete cascades into, so a new one must choose', async () => {
    const underContests = cascadeChildren(keys, 'sessions');
    const underEvents = [...cascadeChildren(keys, 'events')].filter((table) => table !== 'sessions' && !underContests.has(table)).sort();
    expect(underEvents).toEqual(UNDER_THE_EVENT_ROW);
  });

  it('classifies every table that an account delete cascades into as a block or as its own data', async () => {
    const classified = [...ACCOUNT_ROWS_IN_A_CONTEST.map(({ table }) => table), ...ACCOUNT_OWN_ROWS,
      // A role belongs to a seat, and a seat blocks.
      'membership_roles'].sort();
    expect([...cascadeChildren(keys, 'accounts')].sort()).toEqual(classified);
  });

  it('cascades a live contest with seats with and without scopes without a failed count', async () => {
    const event = await seedEvent(db, webmaster);
    expect(await bound(db, `SELECT count(*) AS seats, (SELECT count(*) FROM credential_scopes WHERE session_id = ?) AS scopes
      FROM memberships WHERE session_id = ? AND team_id IS NOT NULL`, event.live, event.live).first())
      .toEqual({ seats: 2, scopes: 1 });
    await deleteRows(event);
    expect(await bound(db, 'SELECT id FROM sessions WHERE id = ?', event.live).first()).toBeNull();
    await forget(event);
  });
});
