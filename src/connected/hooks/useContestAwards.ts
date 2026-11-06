import { useState } from "react";
import { backend } from "@/backend";
import type { ContestAwardCommand } from "@/backend/contracts";
import { errorMessage } from "@/backend/errors";

/** Runs the contest-wide award commands of one contest and shows the last error. */
export interface ContestAwardRunner {
  busy: boolean;
  error: string;
  /** Resolves to true when the server records the command. */
  run: (command: ContestAwardCommand) => Promise<boolean>;
}

// Outside the component, because a refused read removes the console and its hooks. The ID of a command
// whose response was lost must outlive that, so the retry gets the first receipt and the form clears.
// A page reload or an edited explanation loses the ID. The server then refuses the retry, because one
// award of each size can wait for confirmation (`contest_awards_unconfirmed`). A confirmation keeps its ID for the same reason.
const pending = new Map<string, string>();

/**
 * A repeated command keeps its request ID until it succeeds, so a lost
 * response never records a second award. `refresh` reads the snapshot again
 * after a recorded command.
 */
export function useContestAwards(sessionId: string, refresh: () => Promise<void>): ContestAwardRunner {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return {
    busy,
    error,
    run: async (command) => {
      if (busy) return false;
      const key = `${sessionId}:${JSON.stringify(command)}`;
      const requestId = pending.get(key) ?? crypto.randomUUID();
      pending.set(key, requestId);
      setBusy(true);
      setError("");
      try {
        await backend.contestAwards.execute(sessionId, requestId, command);
        pending.delete(key);
        await refresh();
        return true;
      } catch (cause) {
        setError(errorMessage(cause));
        // The refusal may mean that the list is stale, so show the award that was recorded. The form keeps its text.
        await refresh().catch(() => undefined);
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}
