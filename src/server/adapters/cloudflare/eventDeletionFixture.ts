import { bound } from '../d1/assertions';
import type { D1Connection } from '../d1/connection';
import { advanceRows, fenceStatements, type DeletionActor } from './eventDeletion';

const FIXTURE_ACTOR: DeletionActor = { id: 'fixture', name: 'Test fixture' };

/** Fences a fixture event with the product's statements, unless a journal row exists or the event is gone. */
export async function fenceFixtureEvent(db: D1Connection, eventId: string, actor: DeletionActor = FIXTURE_ACTOR): Promise<void> {
  const row = await bound(db, `SELECT e.name, EXISTS (SELECT 1 FROM event_deletions d WHERE d.event_id = e.id) AS fenced
    FROM events e WHERE e.id = ?`, eventId).first<{ name: string; fenced: number }>();
  if (!row || row.fenced === 1) return;
  await db.batch(fenceStatements(db, actor, eventId, row.name, crypto.randomUUID()));
}

/** Runs the product's rows step to its end. A fixture never holds a blocked account, so that fails the test. */
export async function deleteFixtureRows(db: D1Connection, eventId: string): Promise<void> {
  for (;;) {
    const progress = await advanceRows(db, eventId);
    if (progress === 'rows_done') return;
    if (progress === 'blocked') throw new Error(`Fixture event ${eventId} is blocked by an account that crosses events.`);
  }
}

/** Shared test databases must not grow, so a fixture also removes its journal, which the product keeps. */
export async function forgetFixtureEvent(db: D1Connection, eventId: string): Promise<void> {
  await db.batch([
    bound(db, 'DELETE FROM event_deletion_targets WHERE event_id = ?', eventId),
    bound(db, 'DELETE FROM event_deletions WHERE event_id = ?', eventId),
  ]);
}

/** The one way a test removes an event. It repeats safely after an interrupted cleanup. */
export async function removeFixtureEvent(db: D1Connection, eventId: string, actor: DeletionActor = FIXTURE_ACTOR): Promise<void> {
  await fenceFixtureEvent(db, eventId, actor);
  await deleteFixtureRows(db, eventId);
  await forgetFixtureEvent(db, eventId);
}
