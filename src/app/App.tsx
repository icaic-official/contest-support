import { useEffect, useRef, useState } from "react";
import { backend, backendSetupMessage, requireBackend } from "../backend";
import type { AccountIdentity, AccountStatus } from "../backend/contracts";
import { errorMessage } from "../backend/errors";
import { Brand } from "../connected/ui";
import { PasswordForm } from "../features/account/PasswordForm";
import { SignInPage } from "../features/authentication/SignInPage";
import { Workspace } from "./Workspace";
import type { PendingWorkflowRequest } from "./workflowRequest";

export function App() {
  const [user, setUser] = useState<AccountIdentity>();
  const [loading, setLoading] = useState(true);
  const [passwordSetup, setPasswordSetup] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<AccountStatus>();
  const [accountError, setAccountError] = useState("");
  const [accountRetry, setAccountRetry] = useState(0);
  // Account checks hide the workspace. Keep uncertain writes for the same actor.
  const pendingRequest = useRef<PendingWorkflowRequest | undefined>(undefined);
  const userId = user?.id;
  useEffect(() => {
    if (!backend) {
      setLoading(false);
      return;
    }
    let active = true;
    function acceptUser(nextUser: AccountIdentity | undefined) {
      if (!active) return;
      if (pendingRequest.current?.actorId !== nextUser?.id) {
        pendingRequest.current = undefined;
      }
      setUser(nextUser);
      setLoading(false);
      if (!nextUser) setPasswordSetup(false);
    }
    const unsubscribe = backend.auth.subscribe(acceptUser);
    void backend.auth
      .currentUser()
      .then(acceptUser)
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
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setAccount(undefined);
    async function refreshAccount() {
      try {
        const next = await requireBackend().auth.accountStatus();
        if (!active) return;
        setAccount(next);
        setAccountError("");
      } catch (cause) {
        if (active) setAccountError(errorMessage(cause));
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
  }, [userId, accountRetry]);
  function signOut() {
    void requireBackend()
      .auth.signOut()
      .catch((cause: unknown) => {
        setError(errorMessage(cause));
      });
  }
  const dashboardReady =
    !!user &&
    !!account?.session_valid &&
    !account.must_change &&
    !passwordSetup &&
    !accountError;
  return (
    <div
      className={`app-shell ${dashboardReady ? "workspace-shell" : "auth-shell"}`}
    >
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      {user && !dashboardReady && (
        <header className="account-gate-header">
          <Brand />
          <button className="quiet" onClick={signOut}>
            Sign out
          </button>
        </header>
      )}
      <main id="main" className="connected-main" tabIndex={-1}>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Restoring your session…</p>
        ) : !backend ? (
          <p role="alert">{backendSetupMessage}</p>
        ) : !user ? (
          <SignInPage />
        ) : accountError ? (
          <section className="panel auth-panel">
            <p role="alert">{accountError}</p>
            <button onClick={() => setAccountRetry((value) => value + 1)}>
              Retry account check
            </button>
          </section>
        ) : !account ? (
          <p role="status">Checking account access…</p>
        ) : !account.session_valid ? (
          <section className="panel auth-panel">
            <h1>Sign in again</h1>
            <p>
              Your password was reset. Sign out and use the new credentials from
              your organizer.
            </p>
          </section>
        ) : passwordSetup || account.must_change ? (
          <PasswordForm
            required={account.must_change}
            done={() => {
              setPasswordSetup(false);
              setAccount(undefined);
              setAccountRetry((value) => value + 1);
            }}
          />
        ) : (
          <Workspace
            key={user.id}
            user={user}
            username={account.username}
            pendingRequest={pendingRequest}
            changePassword={() => setPasswordSetup(true)}
            signOut={signOut}
          />
        )}
      </main>
      {!dashboardReady && (
        <footer className="auth-footer">
          Minsky · Development deployment ·{" "}
          <a
            href="https://minsky-docs.icaic-minsky.workers.dev"
            target="_blank"
            rel="noopener noreferrer"
          >
            Documentation <span className="sr-only">(opens in a new tab)</span>
            ↗
          </a>
        </footer>
      )}
    </div>
  );
}
