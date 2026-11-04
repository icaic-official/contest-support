import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "@/backend";
import type {
  IssuedCredential,
  ManageCommand,
  ManageReceipt,
  SiteOverview,
} from "@/backend/contracts";
import { errorMessage } from "@/backend/errors";
import { keepFocus, useRefreshOnReturn } from "@/connected/hooks/useRefreshOnReturn";
import type { SessionData } from "@/connected/hooks/useSessionSnapshot";

/** The site read and its commands, for webmasters. */
export interface SiteState {
  /** Undefined while loading and for a person who is not a webmaster. A later failed read keeps the last overview. */
  site: SiteOverview | undefined;
  loaded: boolean;
  /** Why the last read failed. */
  readError: string;
  /** Why the last command failed. */
  error: string;
  clearError: () => void;
  /** True while a command runs. */
  busy: boolean;
  reload: () => Promise<void>;
  /** Resolves to the receipt, or to undefined after an error. */
  execute: (command: ManageCommand) => Promise<ManageReceipt | undefined>;
  /**
   * Resolves to the issued credential, or to undefined after an error. Without
   * an event ID, the account is another webmaster.
   */
  issue: (accountId: string, eventId?: string) => Promise<IssuedCredential | undefined>;
}

/**
 * Reads the site and runs its commands. A command that fails keeps its
 * request ID, so trying the same change again cannot apply it twice. A new
 * change, and a new password after a success, get a new request ID.
 */
export function useSite(): SiteState {
  const [site, setSite] = useState<SiteOverview>();
  const [loaded, setLoaded] = useState(false);
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(new Map<string, string>());
  // Controls stay enabled while a command runs, so the focused one keeps focus. This stops a second send.
  const running = useRef(false);
  const reload = useCallback(async () => {
    try {
      const next = await backend.manage.site();
      setSite(next ?? undefined);
      setReadError(next ? "" : "Only a webmaster can open the site page.");
    } catch (cause) {
      setReadError(errorMessage(cause));
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  useRefreshOnReturn(reload, running);
  const run = useCallback(
    async <T>(
      key: string,
      send: (requestId: string) => Promise<T>,
    ): Promise<T | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      const requestId = pending.current.get(key) ?? crypto.randomUUID();
      pending.current.set(key, requestId);
      setBusy(true);
      setError("");
      try {
        const result = await send(requestId);
        // A later change ended every earlier attempt, so none of their IDs may answer a new try.
        pending.current.clear();
        return result;
      } catch (cause) {
        setError(errorMessage(cause));
        return undefined;
      } finally {
        await reload();
        running.current = false;
        setBusy(false);
        keepFocus();
      }
    },
    [reload],
  );
  const execute = useCallback(
    (command: ManageCommand) =>
      run(JSON.stringify(command), (requestId) =>
        backend.manage.execute(requestId, command),
      ),
    [run],
  );
  const issue = useCallback(
    async (accountId: string, eventId?: string) =>
      (
        await run(`issue:${accountId}`, (requestId) =>
          backend.manage.issueCredentials(requestId, { eventId: eventId ?? null, accountIds: [accountId] }),
        )
      )?.[0],
    [run],
  );
  const clearError = useCallback(() => setError(""), []);
  return { site, loaded, readError, error, clearError, busy, reload, execute, issue };
}

/**
 * Joins one contest, then reads the contests again and opens that one.
 * Resolves to false when the server refused or the outcome is unknown.
 */
export async function joinContest(
  state: Pick<SiteState, "execute">,
  data: Pick<SessionData, "refresh" | "selectSession">,
  contestId: string,
): Promise<boolean> {
  if (!(await state.execute({ type: "join_contest", contestId }))) return false;
  await data.refresh();
  data.selectSession(contestId);
  return true;
}
