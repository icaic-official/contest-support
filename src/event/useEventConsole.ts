import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "@/backend";
import type { EventConsole, ManageCommand, ManageReceipt } from "@/backend/contracts";
import { errorMessage } from "@/backend/errors";
import { keepFocus, useRefreshOnReturn } from "@/connected/hooks/useRefreshOnReturn";
import { issueBatches } from "./eventModel";

/** One account on the credential sheet. */
export interface CredentialRow {
  accountId: string;
  /** Shown once. Null until a batch returns, and after a retry finds the issue already done. */
  password: string | null;
  /** The handle that the server returned. Null until a batch returns. */
  handle: string | null;
  state: "waiting" | "issued" | "lost" | "failed";
}

export interface CredentialSheetState {
  rows: readonly CredentialRow[];
  busy: boolean;
  error: string;
}

export interface EventConsoleState {
  /** Undefined until the first read succeeds. A later failed read keeps the last overview. */
  console: EventConsole | undefined;
  loaded: boolean;
  readError: string;
  /** Why the last command failed. */
  error: string;
  clearError: () => void;
  busy: boolean;
  reload: () => Promise<void>;
  /** Resolves to the receipt, or to undefined after an error. */
  execute: (command: ManageCommand) => Promise<ManageReceipt | undefined>;
  sheet: CredentialSheetState | undefined;
  /** Issues passwords in batches of ISSUE_BATCH and opens the credential sheet. */
  issue: (accountIds: readonly string[]) => Promise<void>;
  dismissSheet: () => void;
}

/**
 * Reads one event console and runs its commands. Without an event ID, it reads
 * the caller's own event. A command that fails keeps its request ID, so
 * trying the same change again cannot apply it twice. A batch of credentials
 * works the same way. A batch that returned without passwords is a lost
 * response: "Issue again" sends a new request ID for those accounts.
 */
export function useEventConsole(eventId: string | undefined): EventConsoleState {
  const [overview, setOverview] = useState<EventConsole>();
  const [loaded, setLoaded] = useState(false);
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<CredentialSheetState>();
  // Controls stay enabled while a command runs, so the focused one keeps focus. This stops a second send.
  const running = useRef(false);
  const pending = useRef(new Map<string, string>());
  const sheetRows = useRef<readonly CredentialRow[]>([]);
  // The event that the first read found. Commands and credential requests name it.
  const [resolvedId, setResolvedId] = useState(eventId);
  const reload = useCallback(async () => {
    try {
      const next = await backend.manage.event(eventId);
      setOverview(next);
      setResolvedId(next.event.id);
      setReadError("");
    } catch (cause) {
      setReadError(errorMessage(cause));
    }
    setLoaded(true);
  }, [eventId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useRefreshOnReturn(reload, running);
  const requestId = (key: string) => {
    const id = pending.current.get(key) ?? crypto.randomUUID();
    pending.current.set(key, id);
    return id;
  };
  const execute = useCallback(
    async (command: ManageCommand) => {
      if (running.current) return undefined;
      running.current = true;
      const key = JSON.stringify(command);
      setBusy(true);
      setError("");
      try {
        const receipt = await backend.manage.execute(requestId(key), command);
        // A later change ended every earlier attempt, so none of their IDs may answer a new try.
        pending.current.clear();
        return receipt;
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
  const issue = useCallback(
    async (accountIds: readonly string[]) => {
      if (!resolvedId || accountIds.length === 0 || running.current) return;
      running.current = true;
      const fresh = (accountId: string): CredentialRow => ({ accountId, password: null, handle: null, state: "waiting" });
      // Earlier rows stay on the sheet, so an issue again keeps the passwords already shown.
      const known = new Set(sheetRows.current.map((row) => row.accountId));
      let rows: CredentialRow[] = [
        ...sheetRows.current.map((row) => (accountIds.includes(row.accountId) ? fresh(row.accountId) : row)),
        ...accountIds.filter((id) => !known.has(id)).map(fresh),
      ];
      const show = (nextRows: CredentialRow[], busyNow: boolean, message = "") => {
        rows = nextRows;
        sheetRows.current = nextRows;
        setSheet({ rows, busy: busyNow, error: message });
      };
      show(rows, true);
      for (const batch of issueBatches(accountIds)) {
        const key = `issue:${batch.join(",")}`;
        try {
          const issued = await backend.manage.issueCredentials(requestId(key), { eventId: resolvedId, accountIds: batch });
          pending.current.delete(key);
          show(
            rows.map((row) => {
              const found = issued.find((item) => item.accountId === row.accountId);
              if (!found) return row;
              return {
                accountId: row.accountId,
                handle: found.handle,
                password: found.temporaryPassword,
                state: found.temporaryPassword === null ? "lost" : "issued",
              };
            }),
            true,
          );
        } catch (cause) {
          show(
            rows.map((row) => (row.state === "waiting" || batch.includes(row.accountId) ? { ...row, state: "failed" } : row)),
            false,
            errorMessage(cause),
          );
          break;
        }
      }
      setSheet((current) => (current ? { ...current, busy: false } : current));
      await reload();
      running.current = false;
    },
    [reload, resolvedId],
  );
  const dismissSheet = useCallback(() => {
    sheetRows.current = [];
    setSheet(undefined);
  }, []);
  const clearError = useCallback(() => setError(""), []);
  return { console: overview, loaded, readError, error, clearError, busy, reload, execute, sheet, issue, dismissSheet };
}
