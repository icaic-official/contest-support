import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { errorMessage, requireClient, snapshot } from "../client";
import { membershipSchema, type Snapshot } from "../model";

/** A contest session where the signed-in person has a membership. */
export interface SessionSummary {
  id: string;
  name: string;
}

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
  /** True while the Realtime channel is subscribed. */
  connected: boolean;
  /** Server time minus local time, in milliseconds. Pass it to useNow. */
  clockOffset: Readonly<RefObject<number>>;
  /** Reads the memberships, sessions and snapshot again, in order. */
  refresh: () => Promise<void>;
  /** Changes the session and discards data from the previous one. */
  selectSession: (sessionId: string) => void;
}

const sessionListSchema = z.array(
  z.object({ id: z.string().uuid(), name: z.string() }),
);

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
  const clockOffset = useRef(0);
  const generation = useRef(0);
  const refreshQueue = useRef<Promise<void>>(Promise.resolve());
  const refresh = useCallback(() => {
    const run = generation.current;
    // Serialize reads so an older Realtime response cannot overwrite a newer
    // revision. A write waits for its own refresh before enabling controls.
    const task = refreshQueue.current.then(async () => {
      try {
        const membershipsResult = await requireClient()
          .from("memberships")
          .select("*")
          .eq("user_id", userId);
        if (membershipsResult.error) throw membershipsResult.error;
        const members = z.array(membershipSchema).parse(membershipsResult.data);
        const sessionResult = await requireClient()
          .from("sessions")
          .select("id,name")
          .in(
            "id",
            members.map((m) => m.session_id),
          );
        if (sessionResult.error) throw sessionResult.error;
        const list = sessionListSchema.parse(sessionResult.data);
        const nextSession = list.some((s) => s.id === sessionId)
          ? sessionId
          : (list[0]?.id ?? "");
        const next = nextSession ? await snapshot(nextSession) : undefined;
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
    const channel = requireClient()
      .channel(`session-${sessionId}-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "changes",
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          void refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `id=eq.${sessionId}`,
        },
        () => {
          void refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "staff_changes",
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") void refresh();
      });
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
      void requireClient().removeChannel(channel);
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
    clockOffset,
    refresh,
    selectSession,
  };
}
