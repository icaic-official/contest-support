import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { backend } from "@/backend";
import type { ContestSummary } from "@/backend/contracts";
import { errorMessage } from "@/backend/errors";
import { defaultContest, orderContests } from "../contestList";
import { keepUnchanged } from "../keepUnchanged";
import type { Snapshot } from "../model";
import { contestOfSearch, searchWithContest } from "../navigation";
import { createRefreshQueue } from "./refreshQueue";
import { boundaryDelay, startRefreshSchedule } from "./refreshSchedule";

/** A contest that the person may open. */
export type SessionSummary = ContestSummary;

/** Shared session data for every UI. Read it; do not copy it into state. */
export interface SessionData {
  /**
   * The contests that the person may open. The first read fills it before the
   * snapshot arrives, so it can be full while `sessionId` is "" and `loaded`
   * is false. A later read changes it with `sessionId`, so `sessionId` is
   * either "" or in this list.
   */
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
  /**
   * Shows a snapshot that a command response carried, in order with the reads.
   * Resolves to false when the caller must call `refresh` instead.
   */
  applySnapshot: (sessionId: string, snapshot: Snapshot) => Promise<boolean>;
  /** Changes the session and discards data from the previous one. */
  selectSession: (sessionId: string) => void;
}

/** True while the tab is in the background. The refresh schedule reads again when it returns. */
function inBackground(): boolean {
  return document.visibilityState === "hidden";
}

/**
 * Loads the person's sessions and the selected session snapshot. The first
 * read opens the contest that `?contest=` names, else the one that runs now,
 * else the next one. `sessionId` is the only record of the choice. For a
 * person with several contests the address holds a copy, so a reload keeps
 * the choice. The hook reads the address once, when it starts.
 *
 * It refreshes on live changes, on focus, when the tab becomes visible and
 * when the browser comes back online. A timer refreshes every 60 seconds, with
 * the live channel down or connected. The timer also drives the independent
 * reads: each tick adds one to `updates`.
 */
export function useSessionSnapshot(userId: string): SessionData {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [state, setState] = useState<Snapshot>();
  const [loaded, setLoaded] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [connected, setConnected] = useState(false);
  const [updates, setUpdates] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  // The contest that the address named when the page loaded. A read honors it
  // until one read succeeds. A later access loss then falls back to the default.
  const addressed = useRef(contestOfSearch(location.search));
  const clockOffset = useRef(0);
  // Server time of the newest snapshot shown. An older snapshot never replaces it.
  const shownAt = useRef(0);
  const generation = useRef(0);
  // The session that the last read selected, so the subscribe effect does not
  // read it again straight after that read.
  const readFor = useRef<string>(undefined);
  const [queue] = useState(createRefreshQueue);
  const refresh = useCallback(() => {
    const run = generation.current;
    // Serialize reads so an older Realtime response cannot overwrite a newer
    // revision. A write waits for its own refresh before enabling controls.
    // A read that has not started yet serves every caller that arrives before it starts.
    return queue.read(run, async () => {
      // Set when the list arrives, so that a failed snapshot read can still show it.
      let listed: { list: SessionSummary[]; nextSession: string } | undefined;
      try {
        const list = orderContests(await backend.workflows.contests());
        // Only a listed ID reaches the snapshot read and the live channel.
        const isListed = (id: string) => list.some((s) => s.id === id);
        const seed = addressed.current;
        const nextSession = isListed(sessionId)
          ? sessionId
          : seed !== undefined && isListed(seed)
            ? seed
            : (defaultContest(list, Date.now() + clockOffset.current)?.id ?? "");
        listed = { list, nextSession };
        // The first list goes out before the snapshot read, so that a screen
        // that needs only the list, such as the site page, never waits on the
        // snapshot. A later list goes out early only when the open contest
        // stays in it. Otherwise the picker would have no open row for one read.
        // The selected ID always waits for the snapshot. A change of it
        // restarts the effect below, which drops this read.
        if (run === generation.current && (sessionId === "" || nextSession === sessionId)) {
          setSessions((shown) => keepUnchanged(shown, list));
        }
        const next = nextSession
          ? await backend.workflows.snapshot(nextSession)
          : undefined;
        if (run !== generation.current) return;
        readFor.current = nextSession;
        addressed.current = undefined;
        setSessions((shown) => keepUnchanged(shown, list));
        setSessionId(nextSession);
        setState((shown) => (next?.membership ? keepUnchanged(shown, next) : undefined));
        if (next) {
          clockOffset.current = Date.parse(next.server_time) - Date.now();
          shownAt.current = Date.parse(next.server_time);
        }
        setRefreshError("");
      } catch (cause) {
        if (run !== generation.current) return;
        // The picker on the no-access screen is the way out of a contest that fails.
        if (listed) {
          const { list, nextSession } = listed;
          readFor.current = nextSession;
          setSessions((shown) => keepUnchanged(shown, list));
          setSessionId(nextSession);
        }
        // Clear cached data on access/network failure; never display stale permissions.
        setState(undefined);
        setRefreshError(errorMessage(cause));
      }
      setLoaded(true);
    });
  }, [queue, sessionId]);
  const applySnapshot = useCallback(
    (forSession: string, next: Snapshot) => {
      const run = generation.current;
      return queue.after(() => {
        if (run !== generation.current || forSession !== sessionId) return false;
        if (!next.membership) return false;
        const at = Date.parse(next.server_time);
        // A read that finished first already includes this command.
        if (at < shownAt.current) return true;
        shownAt.current = at;
        clockOffset.current = at - Date.now();
        setState((shown) => keepUnchanged(shown, next));
        setRefreshError("");
        setLoaded(true);
        return true;
      });
    },
    [queue, sessionId],
  );
  useEffect(() => {
    if (readFor.current !== sessionId) void refresh();
    setConnected(false);
    // The first refresh selects a session. Empty IDs produce invalid live filters.
    const unsubscribe = sessionId
      ? backend.updates.subscribe({
          sessionId,
          userId,
          // A hidden page shows nothing. It reads once when the person returns.
          onChange: () => {
            if (inBackground()) return;
            setUpdates((count) => count + 1);
            void refresh();
          },
          // A drop can mean that the server revoked access, so read at once.
          onConnection: (isConnected) => {
            setConnected(isConnected);
            if (inBackground()) return;
            setUpdates((count) => count + 1);
            void refresh();
          },
        })
      : undefined;
    return () => {
      // This is a request counter, not a React DOM ref. Invalidate pending reads.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      unsubscribe?.();
    };
  }, [refresh, sessionId, userId]);
  // Poll current membership as a backstop: a revoked subscriber receives no further data.
  // The timer keeps running when the session changes, so it reads the latest refresh.
  const tick = useRef<() => void>(undefined);
  useEffect(() => {
    tick.current = () => {
      if (inBackground()) return;
      setUpdates((count) => count + 1);
      void refresh();
    };
  }, [refresh]);
  useEffect(
    () =>
      startRefreshSchedule({
        refresh: () => tick.current?.(),
        connected,
        window,
        document,
      }),
    [connected],
  );
  // Refresh when the schedule changes the contest's intake or end. Time sends
  // no live hint, so the browser waits for the boundary and adds a random delay.
  const changesAt = state?.clock?.intake.changes_at;
  useEffect(() => {
    const delay = boundaryDelay(changesAt, Date.now(), clockOffset.current);
    if (delay === undefined) return undefined;
    const timer = window.setTimeout(() => tick.current?.(), delay);
    return () => window.clearTimeout(timer);
  }, [changesAt]);
  // The address follows the choice and never decides it. A replace adds no
  // history entry. The hash, the router state and the other parameters stay,
  // because the account page reads the hash and the state to place focus.
  const several = sessions.length > 1;
  useEffect(() => {
    if (!sessionId || !several) return;
    if (contestOfSearch(location.search) === sessionId) return;
    // `BrowserRouter` renders a navigation in a transition, after `history` has
    // written it. A replace from this older location would overwrite that entry.
    // So this waits, and the `location` dependency runs it again on commit. The
    // hash stays out, because the skip link writes one that the router never sees.
    if (location.pathname !== window.location.pathname || location.search !== window.location.search) {
      return;
    }
    const state: unknown = location.state;
    void navigate(
      {
        pathname: location.pathname,
        search: searchWithContest(location.search, sessionId),
        hash: location.hash,
      },
      { replace: true, state },
    );
  }, [location, navigate, sessionId, several]);
  const selectSession = useCallback((next: string) => {
    generation.current++;
    readFor.current = undefined;
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
    applySnapshot,
    selectSession,
  };
}
