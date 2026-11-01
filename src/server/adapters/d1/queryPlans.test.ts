import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import { snapshotSql as announcementSnapshotSql } from '../cloudflare/announcements';
import { currentAccessForLoginsSql, currentAccessSql, sessionsListSql, snapshotSql } from '../cloudflare/application';
import { claimSql } from '../cloudflare/live';
import type { D1Connection } from './connection';
import { applyMigrations } from './testFixture';

const configPath = 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';

const id = '00000000-0000-4000-8000-000000000001';
function bindCount(sql: string): number { return (sql.match(/\?/g) ?? []).length; }

const queries: Record<string, string> = {
  'session snapshot': snapshotSql,
  'announcement snapshot': announcementSnapshotSql,
  'current access': currentAccessSql,
  'current access for live logins': currentAccessForLoginsSql,
  'sessions list': sessionsListSql,
};

// The snapshot materializes its `access` and `visible_issues` common table
// expressions and reads them as the aliases `a` and `i`. A scan of those rows
// stays in memory. readVolume.test.ts catches a scan of a real table behind an
// alias with the same name, because it counts rows read on a large session.
const materializedScans = /^SCAN (?:access|visible_issues|a|i)$/;

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
      .filter((detail) => detail.startsWith('SCAN ') && !/^SCAN (?:CONSTANT ROW|\(subquery-\d+\)|json_each)/.test(detail))
      .filter((detail) => sql !== snapshotSql || !materializedScans.test(detail));
  }

  async function plan(sql: string): Promise<string> {
    const rows = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...Array<string>(bindCount(sql)).fill(id))
      .all<{ detail: string }>();
    return rows.results.map((row) => row.detail).join('\n');
  }

  it('notification claim reads pending rows in claim order without a sort', async () => {
    const plan = await db.prepare(`EXPLAIN QUERY PLAN ${claimSql}`).bind(1, 500).all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail);
    expect(details).toContainEqual(expect.stringMatching(/^SEARCH notifications USING INDEX notifications_claim_order \(delivered=\?\)/));
    expect(details.filter((detail) => /^SCAN notifications|TEMP B-TREE/.test(detail))).toEqual([]);
  });

  for (const [name, sql] of Object.entries(queries)) {
    it(`${name} does not scan a growing table`, async () => {
      expect(await fullScans(sql)).toEqual([]);
    });
  }

  it('finds the sessions of an account through the account index', async () => {
    expect(await plan(sessionsListSql)).toContain('USING COVERING INDEX memberships_account_session (account_id=?)');
  });

  it('finds the grants of a caller through the grant indexes', async () => {
    for (const sql of [currentAccessSql, currentAccessForLoginsSql]) {
      const text = await plan(sql);
      expect(text).toContain('USING COVERING INDEX grants_event (event_id=? AND account_id=?)');
      expect(text).toMatch(/USING COVERING INDEX grants_(?:site|by_account) \(account_id=\?/);
      expect(text).toContain('USING COVERING INDEX grants_contest (session_id=? AND account_id=?)');
    }
  });

  it('finds the issues of one team and the images of visible issues through indexes', async () => {
    const text = await plan(snapshotSql);
    expect(text).toContain('USING INDEX issues_session_team (session_id=? AND team_id=?)');
    expect(text).toMatch(/USING INDEX issue_images_issue_state \(issue_id=\? AND state=\?\)/);
  });
});
