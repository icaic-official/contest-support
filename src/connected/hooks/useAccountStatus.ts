import { useEffect, useState } from "react";
import { requireBackend } from "@/backend";
import type { AccountStatus } from "@/backend/contracts";
import { errorMessage } from "@/backend/errors";

/** Password and session state of the signed-in account. */
export interface AccountState {
  /** Undefined while the first check for this user runs. */
  account: AccountStatus | undefined;
  error: string;
  /** Clears the result and checks the account again. */
  recheck: () => void;
}

/**
 * Checks the account every 10 seconds and when the window gets focus, so a
 * password reset by an organizer signs out other devices.
 */
export function useAccountStatus(userId: string | undefined): AccountState {
  const [account, setAccount] = useState<AccountStatus>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setAccount(undefined);
    async function refreshAccount() {
      try {
        const next = await requireBackend().auth.accountStatus();
        if (!active) return;
        setAccount(next);
        setError("");
      } catch (cause) {
        if (active) setError(errorMessage(cause));
      }
    }
    void refreshAccount();
    const interval = window.setInterval(() => {
      void refreshAccount();
    }, 10000);
    window.addEventListener("focus", refreshAccount);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshAccount);
    };
  }, [userId, attempt]);
  return {
    account,
    error,
    recheck: () => setAttempt((value) => value + 1),
  };
}
