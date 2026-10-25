import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import { snapshotSql as announcementSnapshotSql } from '../cloudflare/announcements';
import { currentAccessSql, snapshotSql } from '../cloudflare/application';
import type { D1Connection } from './connection';
import { applyMigrations } from './testFixture';

const configPath = 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';

const id = '00000000-0000-4000-8000-000000000001';
function bindCount(sql: string): number { return (sql.match(/\?/g) ?? []).length; }

const queries: Record<string, string> = {
  'session snapshot': snapshotSql,
  'announcement snapshot': announcementSnapshotSql,
  'current access': currentAccessSql,
};

describe('D1 query plans', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    const platform = await openStoreDatabase({ configPath, remoteBindings: false });
    db = platform.db;
    dispose = platform.dispose;
    await applyMigrations(db);
  });
  afterAll(async () => { await dispose?.(); });

  /**
   * SQLite reports a scan of a real table as `SCAN <alias>`, with or without an index.
   * Scans of constant rows, subquery results, and json_each stay in memory.
   */
  async function fullScans(sql: string): Promise<string[]> {
    const plan = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...Array<string>(bindCount(sql)).fill(id))
      .all<{ detail: string }>();
    return plan.results.map((row) => row.detail)
      .filter((detail) => detail.startsWith('SCAN ') && !/^SCAN (?:CONSTANT ROW|\(subquery-\d+\)|json_each)/.test(detail));
  }

  for (const [name, sql] of Object.entries(queries)) {
    it(`${name} does not scan a growing table`, async () => {
      expect(await fullScans(sql)).toEqual([]);
    });
  }
});
