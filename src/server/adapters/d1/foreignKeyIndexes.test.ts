import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrations = fileURLToPath(new URL('./migrations/', import.meta.url));

function schema(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`${migrations}${file}`, 'utf8'));
  }
  return db;
}

interface ChildKey { table: string; columns: string[]; parent: string }

function childKeys(db: DatabaseSync): ChildKey[] {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  return tables.flatMap(({ name }) => {
    const rows = db.prepare('SELECT id, seq, "table" AS parent, "from" AS child FROM pragma_foreign_key_list(?) ORDER BY id, seq').all(String(name));
    const keys = new Map<number, ChildKey>();
    for (const row of rows) {
      const key = keys.get(Number(row.id)) ?? { table: String(name), columns: [], parent: String(row.parent) };
      key.columns.push(String(row.child));
      keys.set(Number(row.id), key);
    }
    return [...keys.values()];
  });
}

function fullyUnique(db: DatabaseSync, table: string, columns: readonly string[]): boolean {
  return db.prepare(`SELECT name FROM pragma_index_list(?) WHERE "unique" = 1 AND partial = 0`).all(table).some(({ name }) => {
    const indexed = db.prepare('SELECT name FROM pragma_index_info(?)').all(String(name)).map((row) => String(row.name));
    return indexed.length === columns.length && indexed.every((column) => columns.includes(column));
  });
}

/**
 * Why a parent delete would read more than it must, or undefined when it does not.
 * A SEARCH on part of a composite key reads every row under that prefix: an
 * index on the session alone reads the whole session's images for each deleted
 * issue. So a search must bind every key column, or bind a complete unique key.
 */
function problem(db: DatabaseSync, { table, columns }: ChildKey): string | undefined {
  const where = columns.map((column) => `"${column}" = ?`).join(' AND ');
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT 1 FROM "${table}" WHERE ${where}`).all(...columns.map(() => 'x'))
    .map((row) => String(row.detail));
  const search = plan.find((detail) => /^SEARCH /.test(detail));
  if (!search) return plan.join('; ');
  const bound = [...search.matchAll(/(\w+)=\?/g)].map((match) => match[1]!);
  if (columns.every((column) => bound.includes(column)) || fullyUnique(db, table, bound)) return undefined;
  return search;
}

describe('foreign key child indexes', () => {
  const db = schema();

  it('reads the keys from the schema', () => {
    const keys = childKeys(db);
    expect(keys.length).toBeGreaterThan(40);
    expect(keys).toContainEqual({ table: 'history', columns: ['actor'], parent: 'accounts' });
  });

  it('flags a scan and a search on part of a composite key, and accepts a complete key', () => {
    const probe = new DatabaseSync(':memory:');
    probe.exec(`CREATE TABLE child (a TEXT, b TEXT, c TEXT UNIQUE, d TEXT);
      CREATE INDEX child_a ON child(a);`);
    expect(problem(probe, { table: 'child', columns: ['d'], parent: 'p' })).toMatch(/^SCAN/);
    expect(problem(probe, { table: 'child', columns: ['a', 'b'], parent: 'p' })).toMatch(/^SEARCH/);
    expect(problem(probe, { table: 'child', columns: ['a'], parent: 'p' })).toBeUndefined();
    expect(problem(probe, { table: 'child', columns: ['b', 'c'], parent: 'p' })).toBeUndefined();
  });

  // The installation table holds one row, so its scans read one row.
  it('gives every key of every table except the installation singleton an index', () => {
    const missing = childKeys(db).filter((key) => key.table !== 'installation').flatMap((key) => {
      const reason = problem(db, key);
      return reason ? [`${key.table}(${key.columns.join(', ')}) -> ${key.parent}: ${reason}`] : [];
    });
    expect(missing).toEqual([]);
  });
});
