import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { requireBackend } from "@/backend";
import type { SessionSummary } from "@/backend/contracts";
import { errorMessage } from "@/backend/errors";
import type { Snapshot } from "../model";

export type { SessionSummary };

/** Shared session data for every UI. Read it; do not copy it into state. */
export interface SessionData {
  sessions: SessionSummary[];
  /** The selected session, or "" before the first refresh. */
  sessionId: string;
  /** Undefined while loading, after an error, or without a membership. */
  snapshot: Snapshot | undefined;
  /** False until a refresh for the selected session has finished. */
  loaded: boolean;
  /** The last refresh error. The snapshot is cleared when it is set. */
  refreshError: string;
  /** True while the live update channel is connected. */
  connected: boolean;
  /**
   * Counts live change signals and reconnects. Independent reads, such as
   * announcements, load again when it changes.
   */
  updates: number;
  /** Server time minus local time, in milliseconds. Pass it to useNow. */
  clockOffset: Readonly<RefObject<number>>;
  /** Reads the memberships, sessions and snapshot again, in order. */
  refresh: () => Promise<void>;
  /** Changes the session and discards data from the previous one. */
  selectSession: (sessionId: string) => void;
}

/**
 * Loads the person's sessions and the selected session snapshot. It refreshes
 * on Realtime changes, every 10 seconds, on focus and when the browser comes
 * back online.
 */
export function useSessionSnapshot(userId: string): SessionData {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [state, setState] = useState<Snapshot>();
  const [loaded, setLoaded] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [connected, setConnected] = useState(false);
  const [updates, setUpdates] = useState(0);
  const clockOffset = useRef(0);
  const generation = useRef(0);
  const refreshQueue = useRef<Promise<void>>(Promise.resolve());
  const refresh = useCallback(() => {
    const run = generation.current;
    // Serialize reads so an older Realtime response cannot overwrite a newer
    // revision. A write waits for its own refresh before enabling controls.
    const task = refreshQueue.current.then(async () => {
      try {
        const list = await requireBackend().workflows.sessions(userId);
        const nextSession = list.some((s) => s.id === sessionId)
          ? sessionId
          : (list[0]?.id ?? "");
        const next = nextSession
          ? await requireBackend().workflows.snapshot(nextSession)
          : undefined;
        if (run !== generation.current) return;
        setSessions(list);
        setSessionId(nextSession);
        setState(next?.membership ? next : undefined);
        if (next) {
          clockOffset.current = Date.parse(next.server_time) - Date.now();
        }
        setRefreshError("");
      } catch (cause) {
        if (run !== generation.current) return;
        // Clear cached data on access/network failure; never display stale permissions.
        setState(undefined);
        setRefreshError(errorMessage(cause));
      }
      setLoaded(true);
    });
    refreshQueue.current = task;
    return task;
  }, [sessionId, userId]);
  useEffect(() => {
    void refresh();
    setConnected(false);
    // The first refresh selects a session. Empty IDs produce invalid live filters.
    const unsubscribe = sessionId
      ? requireBackend().updates.subscribe({
          sessionId,
          userId,
          onChange: () => {
            setUpdates((count) => count + 1);
            void refresh();
          },
          onConnection: (isConnected) => {
            setConnected(isConnected);
            if (isConnected) {
              setUpdates((count) => count + 1);
              void refresh();
            }
          },
        })
      : undefined;
    // Poll current membership as a backstop: a revoked subscriber receives no further data.
    const interval = window.setInterval(() => {
      void refresh();
    }, 10000);
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    return () => {
      // This is a request counter, not a React DOM ref. Invalidate pending reads.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      window.clearInterval(interval);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
      unsubscribe?.();
    };
  }, [refresh, sessionId, userId]);
  const selectSession = useCallback((next: string) => {
    generation.current++;
    setState(undefined);
    setLoaded(false);
    setSessionId(next);
  }, []);
  return {
    sessions,
    sessionId,
    snapshot: state,
    loaded,
    refreshError,
    connected,
    updates,
    clockOffset,
    refresh,
    selectSession,
  };
}
