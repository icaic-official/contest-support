import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import { assertion, bound, deleteAssertions, isAssertionFailure } from './assertions';
import type { D1Connection } from './connection';
import { applyMigrations } from './testFixture';

describe('D1 assertions', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    const platform = await openStoreDatabase({ configPath: 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc', remoteBindings: false });
    db = platform.db;
    dispose = platform.dispose;
    await applyMigrations(db);
  });

  afterAll(async () => { await dispose?.(); });

  const ids = async () => (await bound(db, 'SELECT id FROM command_assertions').all<{ id: string }>()).results.map((row) => row.id).sort();

  it('deletes only the rows of its own batch', async () => {
    const mine = randomUUID();
    const other = randomUUID();
    await db.batch([mine, `${mine}:state`, `${mine}:access`, other, `${other}:state`]
      .map((id) => assertion(db, id, 'SELECT 1')));
    await db.batch([deleteAssertions(db, mine)]);
    expect(await ids()).toEqual([other, `${other}:state`].sort());
    await db.batch([deleteAssertions(db, other)]);
    expect(await ids()).toEqual([]);
  });

  it('rolls the batch back when a condition finds no row', async () => {
    const failure = await db.batch([assertion(db, randomUUID(), 'SELECT 1 WHERE 0')]).catch((error: unknown) => error);
    expect(isAssertionFailure(failure)).toBe(true);
    expect(isAssertionFailure(new Error('other'))).toBe(false);
    expect(await ids()).toEqual([]);
  });
});
