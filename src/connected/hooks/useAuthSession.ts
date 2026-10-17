import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { client, requireClient } from "../client";

/** The signed-in Supabase user and the sign-out action. */
export interface AuthSession {
  user: User | undefined;
  /** True until the stored session has been restored. */
  loading: boolean;
  /** The last session restore or sign-out error. */
  error: string;
  signOut: () => void;
}

/** Restores the stored session and follows later sign-in and sign-out events. */
export function useAuthSession(): AuthSession {
  const [user, setUser] = useState<User>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!client) {
      setLoading(false);
      return;
    }
    let active = true;
    const { data: subscription } = client.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) return;
        setUser(session?.user);
        setLoading(false);
      },
    );
    void client.auth.getSession().then(({ data, error: cause }) => {
      if (!active) return;
      setUser(data.session?.user);
      if (cause) setError(cause.message);
      setLoading(false);
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);
  function signOut() {
    void requireClient()
      .auth.signOut()
      .then(({ error: cause }) => {
        if (cause) setError(cause.message);
      });
  }
  return { user, loading, error, signOut };
}
