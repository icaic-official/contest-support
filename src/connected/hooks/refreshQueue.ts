/**
 * Runs the session reads one at a time, in the order that callers asked.
 * An older response then cannot overwrite a newer one.
 *
 * A read that is queued but has not started yet is shared. It starts after
 * every caller that joined it, so each caller still gets data that is newer
 * than its own request. A burst of live hints then costs one read that runs and
 * at most one more behind it, not one read for each hint.
 */
export interface RefreshQueue {
  /**
   * Resolves when a read that starts after this call has finished. `scope`
   * names the session generation. Callers of another scope never share a read.
   * If `read` rejects, its callers get the rejection. Later reads still run.
   */
  read(scope: number, read: () => Promise<void>): Promise<void>;
  /** Runs `work` after everything queued so far. It is never shared. */
  after<T>(work: () => T): Promise<T>;
}

export function createRefreshQueue(): RefreshQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let waiting: { scope: number; done: Promise<void> } | undefined;
  return {
    read(scope, read) {
      if (waiting?.scope === scope) return waiting.done;
      const entry = {
        scope,
        done: tail.then(() => {
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
    after<T>(work: () => T): Promise<T> {
      const done = tail.then(work);
      tail = done.then(
        () => undefined,
        () => undefined,
      );
      return done;
    },
  };
}
