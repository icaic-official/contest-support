import { useRef, useState } from "react";
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

/**
 * A repeated command keeps its request ID until it succeeds, so a lost
 * response never records a second award. `refresh` reads the snapshot again
 * after a recorded command.
 */
export function useContestAwards(sessionId: string, refresh: () => Promise<void>): ContestAwardRunner {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ key: string; requestId: string }>(undefined);
  return {
    busy,
    error,
    run: async (command) => {
      if (busy) return false;
      const key = `${sessionId}:${JSON.stringify(command)}`;
      const requestId = pending.current?.key === key ? pending.current.requestId : crypto.randomUUID();
      pending.current = { key, requestId };
      setBusy(true);
      setError("");
      try {
        await backend.contestAwards.execute(sessionId, requestId, command);
        pending.current = undefined;
        await refresh();
        return true;
      } catch (cause) {
        setError(errorMessage(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}
