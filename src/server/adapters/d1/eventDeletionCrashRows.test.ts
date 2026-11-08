import { beforeAll, describe, expect, it } from 'vitest';
import type { D1Binding, D1Connection } from './connection';
import { crashingEnvironment, crashPoints, deletionSuite, seedEvent, type SeededEvent, type SeededWebmaster } from './eventDeletionHarness';

describe('event deletion', () => {
  const suite = deletionSuite();
  const { deleteRows, fence, footprint, forget, rows, stores } = suite;
  let db: D1Binding;
  let webmaster: SeededWebmaster;
  beforeAll(() => { ({ db, webmaster } = suite.opened()); });

  describe('a crash in the rows step', () => {
    it('at any call of the rows step with chunks of 1 converges to the same state', async () => {
      const converge = async (connection: D1Connection, event: SeededEvent) => {
        if (!(await rows('SELECT 1 FROM event_deletions WHERE event_id = ?', event.eventId)).length) await fence(connection, event);
        expect(await deleteRows(connection, event, 1)).toBe('rows_done');
      };
      const clean = await seedEvent(db, webmaster);
      const counter = crashingEnvironment(stores().env, Number.MAX_SAFE_INTEGER, 'never ran');
      await converge(counter.env.DB, clean);
      const expected = await footprint(clean);
      await forget(clean);
      for (const { at, mode } of crashPoints(counter.writes())) {
        const event = await seedEvent(db, webmaster);
        await expect(converge(crashingEnvironment(stores().env, at, mode).env.DB, event), `call ${at}, ${mode}`).rejects.toThrow();
        await converge(db, event);
        expect(await footprint(event), `call ${at}, ${mode}`).toEqual(expected);
        await forget(event);
      }
    });
  });
});
