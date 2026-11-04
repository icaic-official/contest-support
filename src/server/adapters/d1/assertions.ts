import type { D1Connection, D1Statement, D1Value } from './connection';

/** Prepares `sql` and binds `values` in one step. */
export function bound(db: D1Connection, sql: string, ...values: D1Value[]): D1Statement {
  return db.prepare(sql).bind(...values);
}

/**
 * Inserts a row that the table's `CHECK (valid = 1)` rejects when `sql` finds no row.
 * A failed check rolls back the whole batch.
 */
export function assertion(db: D1Connection, id: string, sql: string, ...values: D1Value[]): D1Statement {
  return bound(db, `INSERT INTO command_assertions (id, valid) VALUES (?, CASE WHEN EXISTS (${sql}) THEN 1 ELSE 0 END)`, id, ...values);
}

/** True when an assertion made the batch fail, so the batch rolled back without side effects. */
export function isAssertionFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes('CHECK constraint failed: valid = 1');
}

/**
 * Deletes the assertion rows of one batch: `<id>` and every `<id>:<suffix>`.
 * ';' follows ':' in byte order, so one index range covers them. It reads fewer rows than an `IN` list.
 * Use it only when every assertion ID of the batch has this form and `id` has a fixed length, such as a UUID.
 */
export function deleteAssertions(db: D1Connection, id: string): D1Statement {
  return bound(db, 'DELETE FROM command_assertions WHERE id >= ? AND id < ?', id, `${id};`);
}
