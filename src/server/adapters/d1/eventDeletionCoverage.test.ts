import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_OWN_ROWS, ACCOUNT_ROWS_IN_A_CONTEST, advanceRows, CONTEST_ACTIVITY, fenceStatements } from '../cloudflare/eventDeletion';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import { bound } from './assertions';
import type { D1Connection } from './connection';
import {
  maskedRow, readTables, rowsNaming, seedEvent, seedInstallation, seedWebmaster, tableNames, type SeededEvent,
  type SeededWebmaster, type TableRows,
} from './eventDeletionHarness';
import { applyMigrations } from './testFixture';

const connectorConfig = process.env.MINSKY_CONNECTOR_D1_CONFIG;
const remote = Boolean(connectorConfig);
const configPath = connectorConfig ?? 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';
vi.setConfig({ testTimeout: remote ? 600_000 : 120_000, hookTimeout: remote ? 600_000 : 120_000 });

/**
 * The tables that name an event, a contest, or an account, directly or through
 * another such table. The schema decides, so a new table joins this list by itself.
 */
async function referencingTables(db: D1Connection, tables: readonly string[]): Promise<Set<string>> {
  const parents = new Map<string, string[]>();
  for (const table of tables) {
    const { results } = await db.prepare(`PRAGMA foreign_key_list("${table}")`).all<{ table: string }>();
    parents.set(table, results.map((row) => row.table));
  }
  const reached = new Set(['events', 'sessions', 'accounts']);
  for (let grew = true; grew;) {
    grew = false;
    for (const [table, names] of parents) {
      if (!reached.has(table) && names.some((name) => reached.has(name))) {
        reached.add(table);
        grew = true;
      }
    }
  }
  return reached;
}

/** The tables that an `ON DELETE CASCADE` chain reaches from one parent. */
async function cascadeChildren(db: D1Connection, tables: readonly string[], parent: string): Promise<Set<string>> {
  const edges: Array<{ child: string; parent: string }> = [];
  for (const table of tables) {
    const { results } = await db.prepare(`PRAGMA foreign_key_list("${table}")`).all<{ table: string; on_delete: string }>();
    edges.push(...results.filter((row) => row.on_delete === 'CASCADE').map((row) => ({ child: table, parent: row.table })));
  }
  const reached = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const edge of edges) {
      if (!reached.has(edge.child) && (edge.parent === parent || reached.has(edge.parent))) {
        reached.add(edge.child);
        grew = true;
      }
    }
  }
  return reached;
}

/** Under a contest, the tables that stay the size of the roster. The contest row's own cascade removes them. */
const ROSTER_SIZED = ['audience_sequences', 'credential_scopes', 'grants', 'membership_roles', 'memberships', 'session_issue_sequences', 'teams'];
/** Under a contest, the tables whose rows go with a chunk of their parent, and not with the contest row. */
const CHUNKED_WITH_A_PARENT = ['announcement_image_deletions', 'announcement_images', 'awards', 'command_receipts', 'history', 'image_deletions', 'issue_images', 'resolutions'];

function rowSet(tables: ReadonlyMap<string, TableRows[]>): Map<string, Set<string>> {
  return new Map([...tables].map(([table, rows]) => [table, new Set(rows.map(maskedRow))]));
}

describe('event deletion coverage', () => {
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
    const alone = rowSet(await readTables(db, tables));

    const deleted = await seedEvent(db, webmaster);
    const heldInstallation = await seedInstallation(db, deleted);
    const seeded = rowsNaming(await readTables(db, tables), deleted.ids);
    const required = await referencingTables(db, tables);
    expect(required.size).toBeGreaterThan(25);
    // The singleton names the site's first event, so only a database without one can seed it.
    if (!heldInstallation) required.delete('installation');
    expect([...required].filter((table) => !seeded.has(table))).toEqual([]);
    expect((await bound(db, 'SELECT unready_seats FROM sessions WHERE id = ?', deleted.live).first<{ unready_seats: number }>())?.unready_seats).toBe(1);

    await deleteRows(deleted);

    const after = rowSet(await readTables(db, tables));
    const differences: string[] = [];
    const ours = [...kept.ids, ...deleted.ids, webmaster.accountId];
    for (const table of tables) {
      const before = alone.get(table)!;
      const now = after.get(table)!;
      const changed = [...[...before].filter((row) => !now.has(row)), ...[...now].filter((row) => !before.has(row))];
      differences.push(...changed.filter((row) => !remote || ours.some((id) => row.includes(id))).map((row) => `${table}: ${row}`));
    }
    const allowed = [
      new RegExp(`^event_deletions: .*"event_id":"${deleted.eventId}"`),
      new RegExp(`^event_deletion_targets: .*"event_id":"${deleted.eventId}"`),
      // The audited join of the deleted event's contest is a site record.
      /^authority_audit: \{[^{]*"event_id":null/,
      // Seeding moved the site setting's version, and each join and each removed join moves the webmaster's.
      /^site_settings: /,
      new RegExp(`^accounts: .*"id":"${webmaster.accountId}"`),
    ];
    expect(differences.filter((row) => !allowed.some((rule) => rule.test(row)))).toEqual([]);
    await forget(deleted);

    await deleteRows(kept);
    await forget(kept);
  });

  it('classifies every table that a contest delete cascades into, so a new one must choose', async () => {
    const classified = [...CONTEST_ACTIVITY.map(({ table }) => table), ...ROSTER_SIZED, ...CHUNKED_WITH_A_PARENT].sort();
    expect([...await cascadeChildren(db, tables, 'sessions')].sort()).toEqual(classified);
  });

  it('classifies every table that an account delete cascades into as a block or as its own data', async () => {
    const classified = [...ACCOUNT_ROWS_IN_A_CONTEST.map(({ table }) => table), ...ACCOUNT_OWN_ROWS,
      // A role belongs to a seat, and a seat blocks.
      'membership_roles'].sort();
    expect([...await cascadeChildren(db, tables, 'accounts')].sort()).toEqual(classified);
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
