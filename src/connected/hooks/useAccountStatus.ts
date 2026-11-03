import { useEffect, useRef, useState } from "react";
import { backend } from "@/backend";
import type { AccountStatus } from "@/backend/contracts";
import { errorMessage } from "@/backend/errors";
import { startRefreshSchedule } from "./refreshSchedule";

/** Password and session state of the signed-in account. */
export interface AccountState {
  /** Undefined while the first check for this user runs. */
  account: AccountStatus | undefined;
  error: string;
  /** Clears the result and checks the account again. */
  recheck: () => void;
  /** Checks the account again and keeps the shown result until the answer arrives. */
  refresh: () => Promise<void>;
}

/**
 * Checks the account on the refresh schedule, so a password reset by an
 * organizer signs out other devices. Pass `live` as true while the live
 * channel is connected: the check then runs every 60 seconds, not every 10.
 */
export function useAccountStatus(
  userId: string | undefined,
  live: boolean,
): AccountState {
  const [account, setAccount] = useState<AccountStatus>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const check = useRef<() => Promise<void>>(undefined);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setAccount(undefined);
    async function refreshAccount() {
      try {
        const next = await backend.auth.accountStatus();
        if (!active) return;
        setAccount(next);
        setError("");
      } catch (cause) {
        if (active) setError(errorMessage(cause));
      }
    }
    void refreshAccount();
    check.current = refreshAccount;
    return () => {
      active = false;
      check.current = undefined;
    };
  }, [userId, attempt]);
  useEffect(() => {
    if (!userId) return;
    return startRefreshSchedule({
      refresh: () => void check.current?.(),
      connected: live,
      window,
      document,
    });
  }, [userId, live]);
  return {
    account,
    error,
    recheck: () => setAttempt((value) => value + 1),
    refresh: () => check.current?.() ?? Promise.resolve(),
  };
}
