import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import { snapshotSql as announcementSnapshotSql } from '../cloudflare/announcements';
import { calendarSql, contestsListSql, eventContestsSql, snapshotSql } from '../cloudflare/application';
import { contestDataSql, signInAccountSql } from '../cloudflare/authority';
import { claimSql } from '../cloudflare/live';
import { eventConsoleSql, siteEventsSql } from '../cloudflare/manage';
import type { D1Connection } from './connection';
import { applyMigrations } from './testFixture';

const configPath = 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';

const id = '00000000-0000-4000-8000-000000000001';
function bindCount(sql: string): number { return (sql.match(/\?/g) ?? []).length; }

const queries: Record<string, string> = {
  'session snapshot': snapshotSql,
  'announcement snapshot': announcementSnapshotSql,
  'current access': contestDataSql('caller'),
  'current access for live logins': contestDataSql('logins'),
  'contests list': contestsListSql,
  'event contests list': eventContestsSql,
  'calendar': calendarSql,
  ...Object.fromEntries(Object.entries(eventConsoleSql).map(([name, sql]) => [`event console ${name}`, sql])),
  'site events': siteEventsSql,
  'event sign-in': signInAccountSql.event,
  'site sign-in': signInAccountSql.site,
};

// Both snapshots materialize the resolver row as `access` and read it as `c`.
// The session snapshot also materializes `visible_issues`, and reads it and
// `access` as `i` and `a`. A scan of those rows stays in memory.
// readVolume.test.ts catches a scan of a real table behind an alias with the
// same name, because it counts rows read on a large session.
const materializedScans = new Map([
  [snapshotSql, /^SCAN (?:access|visible_issues|extra_minutes|a|i|c|x)(?: LEFT-JOIN)?$/],
  [announcementSnapshotSql, /^SCAN (?:access|c)$/],
  // The list materializes the caller's contests with their extra minutes as `viewer`, and reads it as `v`.
  // It must not allow `c`: `extraMinutesSql` reads `contest_awards` as `c`, so a scan of that table would pass.
  [contestsListSql, /^SCAN v$/],
  // The webmaster row holds the account's site grant, if it has one. It is one row, and it gates the site branch.
  [calendarSql, /^SCAN webmaster$/],
  // The site page lists every event, and the site has few.
  [siteEventsSql, /^SCAN e$/],
]);
// A webmaster reaches every contest of the site, so that branch of the list reads
// every contest. readVolume.test.ts shows that other callers do not read them.
const webmasterContests = /^SCAN every_contest\b/;

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
      .filter((detail) => !materializedScans.get(sql)?.test(detail))
      .filter((detail) => ![contestsListSql, eventContestsSql, calendarSql].includes(sql) || !webmasterContests.test(detail));
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

  it('finds the contests of an account through the account index', async () => {
    expect(await plan(contestsListSql)).toContain('USING COVERING INDEX memberships_account_session (account_id=?)');
  });

  it('reads each part of the event console from an event index', async () => {
    expect(await plan(eventConsoleSql.admins)).toContain('USING COVERING INDEX grants_event (event_id=?)');
    expect(await plan(eventConsoleSql.people)).toContain('USING INDEX accounts_event (event_id=?)');
    expect(await plan(eventConsoleSql.entrants)).toContain('USING INDEX entrants_event (event_id=?)');
    expect(await plan(eventConsoleSql.entrants)).toContain('USING INDEX accounts_entrant (entrant_id=?)');
    expect(await plan(eventConsoleSql.contests)).toContain('USING INDEX sessions_event (event_id=?)');
    expect(await plan(eventConsoleSql.staffAssignments)).toContain('USING INDEX sessions_event (event_id=?)');
    expect(await plan(eventConsoleSql.staffAssignments)).toMatch(/USING INDEX memberships_(?:staff|team) \(session_id=\?/);
    expect(await plan(eventConsoleSql.entries)).toContain('USING INDEX sessions_event (event_id=?)');
    expect(await plan(eventConsoleSql.audit)).toContain('USING INDEX authority_audit_scope_at (event_id=?)');
  });

  it('finds the grants of a caller through the grant indexes', async () => {
    for (const sql of [contestDataSql('caller'), contestDataSql('logins')]) {
      const text = await plan(sql);
      expect(text).toContain('USING COVERING INDEX grants_event (event_id=? AND account_id=?)');
      expect(text).toMatch(/USING COVERING INDEX grants_(?:site|by_account) \(account_id=\?/);
      expect(text).toContain('USING COVERING INDEX grants_contest (session_id=? AND account_id=?)');
    }
  });

  it('finds a sign-in account through the unique index of its namespace', async () => {
    const event = await plan(signInAccountSql.event);
    expect(event).toContain('USING INDEX events_code (code=?)');
    expect(event).toContain('USING INDEX accounts_event_handle (event_id=? AND handle=?)');
    const site = await plan(signInAccountSql.site);
    expect(site).toContain('USING INDEX accounts_site_handle (handle=?)');
    expect(site).toMatch(/USING COVERING INDEX grants_(?:site|by_account) \(account_id=\?/);
  });

  it('finds the issues of one team and the images of visible issues through indexes', async () => {
    const text = await plan(snapshotSql);
    expect(text).toContain('USING INDEX issues_session_team (session_id=? AND team_id=?)');
    expect(text).toMatch(/USING INDEX issue_images_issue_state \(issue_id=\? AND state=\?\)/);
  });
});
