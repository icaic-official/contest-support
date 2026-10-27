import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "@/backend";
import { errorMessage } from "@/backend/errors";
import type {
  Announcement,
  AnnouncementCommand,
  AnnouncementImage,
  AnnouncementSnapshot,
} from "../announcementModel";
import type { SessionData } from "./useSessionSnapshot";

export interface AnnouncementData {
  announcements: readonly Announcement[];
  images: readonly AnnouncementImage[];
  /** False until a read for this session and audience has finished. */
  loaded: boolean;
  /** The last read error. Earlier records stay visible while it is set. */
  error: string;
  /** Reads again. A newer read cancels an older one. */
  refresh: () => Promise<void>;
  /** Runs a command, then waits for the refreshed records. */
  execute: (requestId: string, command: AnnouncementCommand) => Promise<void>;
}

interface Loaded {
  audience: string;
  snapshot: AnnouncementSnapshot | undefined;
  error: string;
}

const none: readonly never[] = [];

/**
 * Reads announcements independently of the issue snapshot, so a slow or failed
 * read never delays reporting or issue refreshes. A session, access, or audience
 * change drops cached records at once. Managers and readers see different
 * records, so the audience includes the manager flag.
 */
export function useAnnouncements(
  data: SessionData,
  manager: boolean,
): AnnouncementData {
  const { sessionId, updates } = data;
  const allowed = Boolean(data.snapshot?.membership);
  const audience = `${sessionId}:${manager ? "manage" : "read"}`;
  const [result, setResult] = useState<Loaded>();
  const current = useRef<AbortController>(undefined);
  // Drop records that belong to another session, audience, or lost access.
  // React discards this render and renders again before it commits.
  if (result && (result.audience !== audience || !allowed)) {
    setResult(undefined);
  }

  const refresh = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    try {
      const snapshot = await backend.announcements.snapshot(
        sessionId,
        controller.signal,
      );
      if (!controller.signal.aborted) setResult({ audience, snapshot, error: "" });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setResult((previous) => ({
        audience,
        snapshot: previous?.audience === audience ? previous.snapshot : undefined,
        error: errorMessage(cause),
      }));
    }
  }, [sessionId, audience]);

  useEffect(() => {
    if (!sessionId || !allowed) return;
    // `updates` also counts the session timer, which applies server-side expiry.
    void refresh();
    return () => current.current?.abort();
  }, [refresh, sessionId, allowed, updates]);

  const execute = useCallback(
    async (requestId: string, command: AnnouncementCommand) => {
      await backend.announcements.execute(
        sessionId,
        requestId,
        command,
      );
      await refresh();
    },
    [sessionId, refresh],
  );

  return {
    announcements: result?.snapshot?.announcements ?? none,
    images: result?.snapshot?.images ?? none,
    loaded: Boolean(result),
    error: result?.error ?? "",
    refresh,
    execute,
  };
}
