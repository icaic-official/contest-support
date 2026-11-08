import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { snapshotSql as announcementSnapshotSql } from '../cloudflare/announcements';
import { snapshotSql } from '../cloudflare/application';
import { contestDataSql } from '../cloudflare/authority';

/**
 * D1 compiles every statement on every call. In the hosted gate of 2026-11-01 the
 * mean time of a statement was 0.10 ms + 3.07 x its local SQLite compile time
 * (r = 0.98 over 42 statements). SQLite compiles a common table expression again
 * at each place that names it, so a reader that names the resolver in each section
 * pays the resolver's compile on every call, once per section. At 200 users that
 * D1 time delayed every request. docs/measurements/scoped-authority-gate.md has the numbers.
 *
 * The share is the compile time that the resolver adds to a reader, counted in
 * compiles of the resolver alone. Both come from this process, so machine speed
 * cancels. The readers that failed the hosted gate measured 7.2 to 7.5 and 4.0. The
 * fixed readers measure 3.2 to 3.6 and 1.9 to 2.0. Each bound lies midway, so a
 * reader that names the resolver per section again fails, and timing noise does not.
 */
const bounds: Record<string, [sql: string, share: number]> = {
  'session snapshot': [snapshotSql, 5],
  'announcement snapshot': [announcementSnapshotSql, 2.8],
};

const resolver = contestDataSql('caller');
const migrations = fileURLToPath(new URL('./migrations/', import.meta.url));

function compiledSchema(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`${migrations}${file}`, 'utf8'));
  }
  return db;
}

/** A constant row with the resolver's columns, so a reader compiles without the resolver. */
function resolverStub(db: DatabaseSync): string {
  db.exec(`CREATE TEMP VIEW resolver_columns AS ${resolver.replaceAll('?', 'NULL')}`);
  const columns = db.prepare('PRAGMA table_info(resolver_columns)').all().map((row) => String(row.name));
  return `SELECT ${columns.map((name) => `NULL AS ${name}`).join(', ')}`;
}

/** The fastest of several rounds, because contention only adds time. */
function compileMs(db: DatabaseSync, sql: string): number {
  let fastest = Infinity;
  for (let round = 0; round < 7; round++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < 40; i++) db.prepare(sql);
    fastest = Math.min(fastest, Number(process.hrtime.bigint() - start) / 1e6 / 40);
  }
  return fastest;
}

describe('reader compile cost', () => {
  const db = compiledSchema();
  const stub = resolverStub(db);

  for (const [name, [sql, bound]] of Object.entries(bounds)) {
    // Contention on a busy machine has measured 7.07 once in six runs against a 3.3 to 4.0 norm. A reader that
    // names the resolver per section measures 7.2 or more every time, so a retry cannot hide it.
    it(`the ${name} compiles the resolver at most ${bound} times over`, { retry: 2 }, () => {
      const stubbed = sql.split(resolver).join(stub);
      expect(stubbed).not.toContain(resolver);
      const shares = Array.from({ length: 9 }, () =>
        (compileMs(db, sql) - compileMs(db, stubbed)) / compileMs(db, resolver));
      const median = shares.sort((left, right) => left - right)[4];
      expect(median).toBeLessThan(bound);
    });
  }
});
