/**
 * Runs the session reads of one scope one at a time, in the order that callers
 * asked. An older response then cannot overwrite a newer one.
 *
 * A read that is queued but has not started yet is shared. It starts after
 * every caller that joined it, so each caller still gets data that is newer
 * than its own request. A burst of live hints then costs one read that runs and
 * at most one more behind it, not one read for each hint.
 *
 * A scope names a session generation, and it only grows. The caller discards
 * the results of an older scope, so a call of a newer scope never waits for
 * one. A read that hangs then holds back only the reads of its own scope.
 */
export interface RefreshQueue {
  /**
   * Resolves when a read that starts after this call has finished. Callers of
   * another scope never share a read.
   * If `read` rejects, its callers get the rejection. Later reads still run.
   */
  read(scope: number, read: () => Promise<void>): Promise<void>;
  /** Runs `work` after everything of its scope queued so far. It is never shared. */
  after<T>(scope: number, work: () => T): Promise<T>;
}

export function createRefreshQueue(): RefreshQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let tailScope: number | undefined;
  let waiting: { scope: number; done: Promise<void> } | undefined;
  function tailFor(scope: number): Promise<unknown> {
    if (scope !== tailScope) {
      tailScope = scope;
      tail = Promise.resolve();
    }
    return tail;
  }
  return {
    read(scope, read) {
      if (waiting?.scope === scope) return waiting.done;
      const entry = {
        scope,
        done: tailFor(scope).then(() => {
          // The read starts now, so a later caller needs a new one.
          if (waiting === entry) waiting = undefined;
          return read();
        }),
      };
      waiting = entry;
      // A rejected read reaches only its own callers. Reads queued after it still run.
      tail = entry.done.catch(() => undefined);
      return entry.done;
    },
    after<T>(scope: number, work: () => T): Promise<T> {
      const done = tailFor(scope).then(work);
      tail = done.then(
        () => undefined,
        () => undefined,
      );
      return done;
    },
  };
}
