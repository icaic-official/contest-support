import { useCallback, useEffect, useRef, useState } from "react";
import { requireBackend } from "@/backend";
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
  refresh: () => Promise<AnnouncementSnapshot | undefined>;
  /** Runs a command, then waits for the refreshed records. */
  execute: (requestId: string, command: AnnouncementCommand) => Promise<void>;
}

interface Loaded {
  audience: string;
  snapshot?: AnnouncementSnapshot;
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
  if (result && (result.audience !== audience || !allowed)) {
    setResult(undefined);
  }

  const refresh = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    try {
      const snapshot = await requireBackend().announcements.snapshot(
        sessionId,
        controller.signal,
      );
      if (controller.signal.aborted) return undefined;
      setResult({ audience, snapshot, error: "" });
      return snapshot;
    } catch (cause) {
      if (controller.signal.aborted) return undefined;
      setResult((previous) => ({
        audience,
        snapshot: previous?.audience === audience ? previous.snapshot : undefined,
        error: errorMessage(cause),
      }));
      return undefined;
    }
  }, [sessionId, audience]);

  useEffect(() => {
    if (!sessionId || !allowed) return;
    void refresh();
    // The poll also applies server-side expiry after a refresh or reconnect.
    const interval = window.setInterval(() => void refresh(), 10000);
    return () => {
      window.clearInterval(interval);
      current.current?.abort();
    };
  }, [refresh, sessionId, allowed, updates]);

  const execute = useCallback(
    async (requestId: string, command: AnnouncementCommand) => {
      await requireBackend().announcements.execute(
        sessionId,
        requestId,
        command,
      );
      await refresh();
    },
    [sessionId, refresh],
  );

  const shown = result?.audience === audience && allowed ? result : undefined;
  return {
    announcements: shown?.snapshot?.announcements ?? none,
    images: shown?.snapshot?.images ?? none,
    loaded: Boolean(shown),
    error: shown?.error ?? "",
    refresh,
    execute,
  };
}
