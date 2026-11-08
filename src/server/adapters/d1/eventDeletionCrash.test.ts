import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { bound } from './assertions';
import type { D1Binding } from './connection';
import { crashingEnvironment, crashPoints, deletionSuite, fillStores, seedEvent, type SeededWebmaster } from './eventDeletionHarness';

describe('event deletion', () => {
  const suite = deletionSuite();
  const { footprint, forget, runTicks, runToEnd, stores } = suite;
  let db: D1Binding;
  let webmaster: SeededWebmaster;
  beforeAll(() => { ({ db, webmaster } = suite.opened()); });

  describe('a crash', () => {
    it('at any D1, R2, or Durable Object call converges to the same state', async () => {
      const clean = await seedEvent(db, webmaster);
      const cleanStores = stores();
      fillStores(clean, cleanStores.bucket, cleanStores.live);
      const counter = crashingEnvironment(cleanStores.env, Number.MAX_SAFE_INTEGER, 'never ran');
      await runToEnd(counter.env, clean);
      const expected = await footprint(clean);
      expect(Object.keys(expected).sort()).toEqual(['authority_audit', 'event_deletions']);
      expect(cleanStores.bucket.objects.size).toBe(0);
      await forget(clean);
      expect(counter.writes().length).toBeGreaterThan(20);
      for (const { at, mode } of crashPoints(counter.writes())) {
        const label = `call ${at}, ${mode}`;
        const event = await seedEvent(db, webmaster);
        const { bucket, live, env } = stores();
        fillStores(event, bucket, live);
        bucket.add(['control/other-event/file']);
        await expect(runToEnd(crashingEnvironment(env, at, mode).env, event), label).rejects.toThrow();
        await runToEnd(env, event);
        expect(await footprint(event), label).toEqual(expected);
        expect([...bucket.objects], label).toEqual(['control/other-event/file']);
        expect([event.practice, event.live].every((contest) => live.state(contest).empty), label).toBe(true);
        await forget(event);
      }
    });

    it('at any call of a multi-page file listing leaves no file of the event, and no other file goes', async () => {
      // A journal already in the files step, because the other crash tests cover the steps before it.
      const inFilesStep = async () => {
        const event = { eventId: randomUUID() };
        const [contest, emptyPage, owner] = [randomUUID(), randomUUID(), randomUUID()];
        const { bucket, env } = stores();
        await db.batch([
          bound(db, `INSERT INTO event_deletions (event_id, event_name, event_code, requested_by, requested_by_name, step, rows_done_at)
            VALUES (?, 'Fictional', 'fictional', 'fixture', 'Fixture', 'files', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-66 minutes'))`, event.eventId),
          bound(db, `INSERT INTO event_deletion_targets (event_id, kind, id) VALUES (?, 'contest', ?), (?, 'contest', ?), (?, 'avatar_owner', ?)`,
            event.eventId, contest, event.eventId, emptyPage, event.eventId, owner),
        ]);
        bucket.pageSize = 2;
        bucket.add([1, 2, 3, 4, 5].map((n) => `${contest}/many/${n}`));
        bucket.add([`${emptyPage}/file`, `accounts/${owner}/avatar`, 'control/other-event/file']);
        bucket.emptyFirstPage.add(`${emptyPage}/`);
        return { event, bucket, env };
      };
      const clean = await inFilesStep();
      const counter = crashingEnvironment(clean.env, Number.MAX_SAFE_INTEGER, 'never ran');
      await runTicks(counter.env, clean.event);
      expect(counter.writes().length).toBeGreaterThan(8);
      expect([...clean.bucket.objects]).toEqual(['control/other-event/file']);
      await forget(clean.event);
      for (const { at, mode } of crashPoints(counter.writes())) {
        const label = `call ${at}, ${mode}`;
        const { event, bucket, env } = await inFilesStep();
        await expect(runTicks(crashingEnvironment(env, at, mode).env, event), label).rejects.toThrow();
        await runTicks(env, event);
        expect([...bucket.objects], label).toEqual(['control/other-event/file']);
        await forget(event);
      }
    });
  });
});
