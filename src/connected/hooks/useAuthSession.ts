import { useEffect, useState } from "react";
import { backend, requireBackend } from "@/backend";
import type { AccountIdentity } from "@/backend/contracts";
import { errorMessage } from "@/backend/errors";

/** The signed-in account and the sign-out action. */
export interface AuthSession {
  user: AccountIdentity | undefined;
  /** True until the stored session has been restored. */
  loading: boolean;
  /** The last session restore or sign-out error. */
  error: string;
  signOut: () => void;
}

/** Restores the stored session and follows later sign-in and sign-out events. */
export function useAuthSession(): AuthSession {
  const [user, setUser] = useState<AccountIdentity>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!backend) {
      setLoading(false);
      return;
    }
    let active = true;
    const unsubscribe = backend.auth.subscribe((nextUser) => {
      if (!active) return;
      setUser(nextUser);
      // A new sign-in replaces an earlier restore or sign-out error.
      if (nextUser) setError("");
      setLoading(false);
    });
    void backend.auth
      .currentUser()
      .then((nextUser) => {
        if (!active) return;
        setUser(nextUser);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(errorMessage(cause));
        setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  function signOut() {
    void requireBackend()
      .auth.signOut()
      .catch((cause: unknown) => {
        setError(errorMessage(cause));
      });
  }
  return { user, loading, error, signOut };
}
