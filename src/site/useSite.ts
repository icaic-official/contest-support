import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "@/backend";
import type {
  IssuedCredential,
  ManageCommand,
  ManageReceipt,
  SiteOverview,
} from "@/backend/contracts";
import { errorMessage } from "@/backend/errors";
import type { SessionData } from "@/connected/hooks/useSessionSnapshot";

/** The site read and its commands, for webmasters. */
export interface SiteState {
  /** Undefined while loading, after an error, and for a person who is not a webmaster. */
  site: SiteOverview | undefined;
  loaded: boolean;
  /** Why the last read failed. */
  readError: string;
  /** Why the last command failed. */
  error: string;
  /** True while a command runs. */
  busy: boolean;
  reload: () => Promise<void>;
  /** Resolves to the receipt, or to undefined after an error. */
  execute: (command: ManageCommand) => Promise<ManageReceipt | undefined>;
  /** Resolves to the issued credential, or to undefined after an error. */
  issue: (accountId: string) => Promise<IssuedCredential | undefined>;
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
  const reload = useCallback(async () => {
    try {
      const next = await backend.manage.site();
      setSite(next ?? undefined);
      setReadError(next ? "" : "Only a webmaster can open the site page.");
    } catch (cause) {
      setSite(undefined);
      setReadError(errorMessage(cause));
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const run = useCallback(
    async <T>(
      key: string,
      send: (requestId: string) => Promise<T>,
    ): Promise<T | undefined> => {
      const requestId = pending.current.get(key) ?? crypto.randomUUID();
      pending.current.set(key, requestId);
      setBusy(true);
      setError("");
      try {
        const result = await send(requestId);
        pending.current.delete(key);
        return result;
      } catch (cause) {
        setError(errorMessage(cause));
        return undefined;
      } finally {
        await reload();
        setBusy(false);
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
    async (accountId: string) =>
      (
        await run(`issue:${accountId}`, (requestId) =>
          backend.manage.issueCredentials(requestId, { eventId: null, accountIds: [accountId] }),
        )
      )?.[0],
    [run],
  );
  return { site, loaded, readError, error, busy, reload, execute, issue };
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
