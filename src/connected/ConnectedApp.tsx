import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import {
  type AccountStatus,
  accountStatus,
  client,
  errorMessage,
  execute,
  loginIdentifier,
  requireClient,
  snapshot,
} from "./client";
import {
  type Command,
  isStaff,
  type Issue,
  isSupport,
  type Membership,
  membershipSchema,
  type Snapshot,
  unresolvedTime,
} from "./model";
import { z } from "zod";
import { TeamSearch } from "./TeamSearch";
import {
  initialTeamSelection,
  issueVisibleForTeam,
  submitTeamId,
} from "./teamSearch";
import { Brand, clockDuration, Icon } from "./ui";

const statusNames = {
  open: "Open",
  claimed: "In progress",
  escalated: "Awaiting specialist",
  resolved: "Resolved",
};
const resolutions = [
  "Resolved without comment",
  "Service restored",
  "Device issue resolved",
  "Problem statement clarified",
];
const formatDate = (value: string) => new Date(value).toLocaleString();
function formData(event: FormEvent<HTMLFormElement>): FormData {
  event.preventDefault();
  return new FormData(event.currentTarget);
}
function text(data: FormData, name: string): string {
  return String(data.get(name) ?? "");
}

export function ConnectedApp() {
  const [user, setUser] = useState<User>();
  const [loading, setLoading] = useState(true);
  const [passwordSetup, setPasswordSetup] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<AccountStatus>();
  const [accountError, setAccountError] = useState("");
  const [accountRetry, setAccountRetry] = useState(0);
  const userId = user?.id;
  useEffect(() => {
    if (!client) {
      setLoading(false);
      return;
    }
    let active = true;
    const { data: subscription } = client.auth.onAuthStateChange(
      (event, session) => {
        if (!active) return;
        setUser(session?.user);
        setLoading(false);
        if (event === "SIGNED_OUT") setPasswordSetup(false);
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
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setAccount(undefined);
    async function refreshAccount() {
      try {
        const next = await accountStatus();
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
    void requireClient()
      .auth.signOut()
      .then(({ error: cause }) => {
        if (cause) setError(cause.message);
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
        ) : !client ? (
          <p role="alert">
            Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in
            .env.local. See docs/cloud-onboarding.md.
          </p>
        ) : !user ? (
          <SignIn />
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
          <Dashboard
            key={user.id}
            user={user}
            username={account.username}
            changePassword={() => setPasswordSetup(true)}
            signOut={signOut}
          />
        )}
      </main>
      {!dashboardReady && (
        <footer className="auth-footer">Minsky · Development deployment</footer>
      )}
    </div>
  );
}

function SignIn() {
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  return (
    <section
      id="sign-in"
      className="sign-in-panel"
      aria-labelledby="sign-in-heading"
    >
      <Brand />
      <h1 id="sign-in-heading">Sign in</h1>
      <p className="sign-in-subtitle">Access your contest workspace.</p>
      <form
        onSubmit={(event) => {
          const data = formData(event);
          setBusy(true);
          setError("");
          void (async () => {
            try {
              const result = await requireClient().auth.signInWithPassword({
                email: loginIdentifier(text(data, "username")),
                password: text(data, "password"),
              });
              if (result.error) throw result.error;
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <fieldset disabled={busy}>
          <legend className="sr-only">Account credentials</legend>
          <label>
            Username
            <input
              name="username"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Enter your username"
            />
          </label>
          <div className="password-field">
            <label htmlFor="sign-in-password">Password</label>
            <div className="password-input">
              <input
                id="sign-in-password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                aria-controls="sign-in-password"
                onClick={() => setShowPassword(!showPassword)}
              >
                <Icon name={showPassword ? "eye-off" : "eye"} />
              </button>
            </div>
          </div>
          <button className="sign-in-submit" type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <p className="sign-in-help">
        Accounts are created by contest organizers.
        <br />
        Need access or a password reset?
        <br />
        <span>Contact your contest organizers.</span>
      </p>
    </section>
  );
}

function PasswordForm({
  done,
  required,
}: {
  done: () => void;
  required: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="panel auth-panel">
      <h1>
        {required ? "Change your temporary password" : "Change your password"}
      </h1>
      <p>
        {required
          ? "Choose your own password before accessing the contest."
          : "Enter your current password and choose a new one."}
      </p>
      <form
        onSubmit={(event) => {
          const data = formData(event);
          if (text(data, "password") !== text(data, "confirm")) {
            setError("Passwords must match.");
            return;
          }
          if (text(data, "current") === text(data, "password")) {
            setError("Choose a different password.");
            return;
          }
          setBusy(true);
          setError("");
          void (async () => {
            try {
              const updated = await requireClient().auth.updateUser({
                password: text(data, "password"),
                current_password: text(data, "current"),
              });
              if (updated.error) throw updated.error;
              const completed = await requireClient().rpc(
                "complete_password_change",
              );
              if (completed.error) throw completed.error;
              done();
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <fieldset disabled={busy}>
          <legend className="sr-only">New password</legend>
          <label>
            Current password
            <input
              name="current"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm password
            <input
              name="confirm"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
            />
          </label>
          <button type="submit">Save password</button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {!required && (
        <button className="quiet" onClick={done}>
          Return to dashboard
        </button>
      )}
    </section>
  );
}

function Dashboard({
  user,
  username,
  changePassword,
  signOut,
}: {
  user: User;
  username: string | null;
  changePassword: () => void;
  signOut: () => void;
}) {
  const [sessions, setSessions] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [session, setSession] = useState("");
  const [state, setState] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("all");
  const [teamSelection, setTeamSelection] = useState(initialTeamSelection);
  const [view, setView] = useState<"issues" | "admin" | "account">("issues");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const clockOffset = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef<{ request: string; command: Command } | undefined>(
    undefined,
  );
  const generation = useRef(0);
  const refreshQueue = useRef<Promise<void>>(Promise.resolve());
  const refresh = useCallback(() => {
    const run = generation.current;
    // Serialize reads so an older Realtime response cannot overwrite a newer
    // revision. A write waits for its own refresh before enabling controls.
    const task = refreshQueue.current.then(async () => {
      try {
        const membershipsResult = await requireClient()
          .from("memberships")
          .select("*")
          .eq("user_id", user.id);
        if (membershipsResult.error) throw membershipsResult.error;
        const members = z.array(membershipSchema).parse(membershipsResult.data);
        const sessionResult = await requireClient()
          .from("sessions")
          .select("id,name")
          .in(
            "id",
            members.map((m) => m.session_id),
          );
        if (sessionResult.error) throw sessionResult.error;
        const list = z
          .array(z.object({ id: z.string().uuid(), name: z.string() }))
          .parse(sessionResult.data);
        const nextSession = list.some((s) => s.id === session)
          ? session
          : (list[0]?.id ?? "");
        const next = nextSession ? await snapshot(nextSession) : undefined;
        if (run !== generation.current) return;
        setSessions(list);
        setSession(nextSession);
        setState(next?.membership ? next : undefined);
        // Keep a choice only while its session, staff access, and team remain valid.
        setTeamSelection((selection) => {
          const member = next?.membership;
          if (
            nextSession !== session ||
            !member ||
            member.team_id ||
            !isStaff(member) ||
            (selection.teamId &&
              !next?.teams.some((team) => team.id === selection.teamId))
          ) {
            return initialTeamSelection();
          }
          return selection;
        });
        if (next) {
          clockOffset.current = Date.parse(next.server_time) - Date.now();
        }
        setRefreshError("");
      } catch (cause) {
        if (run !== generation.current) return;
        // Clear cached data on access/network failure; never display stale permissions.
        setState(undefined);
        setRefreshError(errorMessage(cause));
      }
    });
    refreshQueue.current = task;
    return task;
  }, [session, user.id]);
  useEffect(() => {
    void refresh();
    setConnected(false);
    const channel = requireClient()
      .channel(`session-${session}-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "changes",
          filter: `session_id=eq.${session}`,
        },
        () => {
          void refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `id=eq.${session}`,
        },
        () => {
          void refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "staff_changes",
          filter: `session_id=eq.${session}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") void refresh();
      });
    // Poll current membership as a backstop: a revoked subscriber receives no further data.
    const interval = window.setInterval(() => {
      void refresh();
    }, 10000);
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    return () => {
      // This is a request counter, not a React DOM ref. Invalidate pending reads.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      window.clearInterval(interval);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
      void requireClient().removeChannel(channel);
    };
  }, [refresh, session, user.id]);
  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(Date.now() + clockOffset.current),
      1000,
    );
    return () => window.clearInterval(interval);
  }, []);
  async function act(command: Command, retry = false): Promise<boolean> {
    if (inFlight.current || (!retry && pending.current)) return false;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    setError("");
    const request =
      retry && pending.current
        ? pending.current
        : { request: crypto.randomUUID(), command };
    pending.current = request;
    try {
      const id = await execute(session, request.request, request.command);
      pending.current = undefined;
      await refresh();
      setSelected(id);
      if (command.type === "reopen") setFilter("claimed");
      setNotice("Action recorded in shared history.");
      return true;
    } catch (cause) {
      // Known server rejections are definitive. Transport failures retain the same
      // request UUID for an explicit retry, including submissions and messages.
      if (
        cause &&
        typeof cause === "object" &&
        "code" in cause &&
        typeof cause.code === "string" &&
        cause.code
      ) {
        pending.current = undefined;
      }
      await refresh();
      setError(errorMessage(cause));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const m = state?.membership;
  const juryOnly =
    m && m.roles.includes("jury") && !isSupport(m) && !m.is_admin;
  const canSearchTeams = Boolean(m && !m.team_id && isStaff(m));
  const visible =
    state?.issues.filter((issue) =>
      issueVisibleForTeam(issue, null, "all", Boolean(juryOnly)),
    ) ?? [];
  const filtered =
    state?.issues.filter((issue) =>
      issueVisibleForTeam(
        issue,
        teamSelection.teamId,
        filter,
        Boolean(juryOnly),
      ),
    ) ?? [];
  const issue = filtered.find((i) => i.id === selected) ?? filtered[0];
  const activeView = view === "admin" && !m?.is_admin ? "issues" : view;
  function navigate(next: typeof view) {
    setView(next);
    setNavigationOpen(false);
    window.requestAnimationFrame(() =>
      document.getElementById("workspace-heading")?.focus(),
    );
  }
  const identity =
    state?.members.find((member) => member.person.id === user.id)?.person
      .name ??
    (m?.team_id
      ? state?.teams.find((team) => team.id === m.team_id)?.name
      : undefined) ??
    (typeof user.user_metadata.name === "string"
      ? user.user_metadata.name
      : undefined) ??
    username ??
    user.email ??
    "Your account";
  const roleNames = m?.team_id
    ? "Contestant"
    : [...(m?.roles ?? []), ...(m?.is_admin ? ["admin"] : [])]
        .map((role) => role.charAt(0).toUpperCase() + role.slice(1))
        .join(" · ");
  const canReport = m && (m.team_id || isSupport(m));
  const queueTitle = m?.team_id
    ? "My team’s issues"
    : juryOnly
      ? "Award review"
      : "Issue Queue";
  return (
    <div className="dashboard-layout">
      <aside className="sidebar">
        <div className="sidebar-heading">
          <Brand />
          <button
            className="quiet navigation-toggle"
            aria-expanded={navigationOpen}
            aria-controls="workspace-navigation"
            onClick={() => setNavigationOpen(!navigationOpen)}
          >
            Menu
          </button>
        </div>
        <div className="sidebar-context">
          <span className="context-label">Contest session</span>
          <p className="event-name">{state?.event?.name ?? "Your contest"}</p>
          {sessions.length > 1 ? (
            <label>
              <span className="sr-only">Contest session</span>
              <select
                value={session}
                disabled={busy || !!pending.current}
                onChange={(event) => {
                  generation.current++;
                  setState(undefined);
                  setSession(event.target.value);
                  setSelected("");
                  setFilter("all");
                  setTeamSelection(initialTeamSelection());
                  setReportOpen(false);
                }}
              >
                {sessions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="session-name">
              {state?.session?.name ?? "Checking access…"}
            </p>
          )}
          {state?.session && (
            <p className="sidebar-intake">
              <span
                className={`live-dot ${state.session.intake_open ? "" : "inactive"}`}
              />
              Contestant intake {state.session.intake_open ? "open" : "closed"}
            </p>
          )}
          <p className="mobile-development">Development deployment</p>
        </div>
        <nav
          id="workspace-navigation"
          className={`sidebar-navigation ${navigationOpen ? "is-open" : ""}`}
          aria-label="Workspace navigation"
        >
          <button
            disabled={busy || !!pending.current}
            aria-current={activeView === "issues" ? "page" : undefined}
            onClick={() => navigate("issues")}
          >
            <Icon name="issues" />
            {m?.team_id
              ? "My team’s issues"
              : juryOnly
                ? "Award review"
                : "Issues"}
          </button>
          {m?.is_admin && (
            <button
              disabled={busy || !!pending.current}
              aria-current={activeView === "admin" ? "page" : undefined}
              onClick={() => navigate("admin")}
            >
              <Icon name="settings" />
              Administration
            </button>
          )}
          <button
            disabled={busy || !!pending.current}
            aria-current={activeView === "account" ? "page" : undefined}
            onClick={() => navigate("account")}
          >
            <Icon name="account" />
            My account
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-person">
            <span className="avatar" aria-hidden="true">
              {identity
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part.charAt(0))
                .join("")
                .toUpperCase()}
            </span>
            <div>
              <strong>{identity}</strong>
              <span>{roleNames}</span>
            </div>
          </div>
          <button className="sign-out" onClick={signOut}>
            <Icon name="logout" />
            Sign out
          </button>
          <p className="development-label">Development deployment</p>
        </div>
      </aside>
      <div className="workspace-content">
        {refreshError && (
          <p role="alert" className="alert">
            {refreshError}
          </p>
        )}
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        <p role="status" className="notice">
          {notice}
        </p>
        {pending.current && !busy && (
          <button
            onClick={() => {
              const command = pending.current?.command;
              if (command) void act(command, true);
            }}
          >
            Retry last request
          </button>
        )}
        {!state || !m || !state.session ? (
          <section className="panel access-panel">
            <h1>Session access</h1>
            <p>
              No session data is available. If your account was just created,
              ask an organizer to assign your membership.
            </p>
            <button
              onClick={() => {
                void refresh();
              }}
            >
              Refresh access
            </button>
          </section>
        ) : (
          <>
            {state.event?.archived && (
              <p className="alert">
                This event is archived. Records are read only.
              </p>
            )}
            {activeView !== "issues" && (
              <div className="page-heading settings-heading">
                <div>
                  <h1 id="workspace-heading" tabIndex={-1}>
                    {activeView === "admin" ? "Administration" : "My account"}
                  </h1>
                  <p>
                    {activeView === "admin"
                      ? "Manage session access, accounts and contestant intake."
                      : "Your sign-in details and session permissions."}
                  </p>
                </div>
              </div>
            )}
            <fieldset
              className="workspace"
              disabled={busy || !!pending.current}
            >
              <legend className="sr-only">Contest workflow</legend>
              {activeView === "admin" && m.is_admin && (
                <AdminPanel state={state} refresh={refresh} />
              )}
              {activeView === "account" && (
                <section className="panel account-panel">
                  <h2>Sign-in and access</h2>
                  <dl className="account-details">
                    <div>
                      <dt>Username</dt>
                      <dd>{username ?? user.email}</dd>
                    </div>
                    <div>
                      <dt>Session</dt>
                      <dd>{state.session.name}</dd>
                    </div>
                    <div>
                      <dt>Permissions</dt>
                      <dd>
                        {m.team_id
                          ? `Contestant · ${
                              state.teams.find((team) => team.id === m.team_id)
                                ?.name ?? "Your team"
                            }`
                          : [...m.roles, ...(m.is_admin ? ["admin"] : [])].join(
                              " + ",
                            )}
                      </dd>
                    </div>
                  </dl>
                  <button onClick={changePassword}>Change password</button>
                  <p className="field-help">
                    Contact your organizer if your team assignment or
                    permissions need to change.
                  </p>
                </section>
              )}
              {activeView === "issues" && (
                <div className="work-grid">
                  <section className="queue" aria-label="Issue queue">
                    <div className="page-heading queue-heading">
                      <div>
                        <h1 id="workspace-heading" tabIndex={-1}>
                          {queueTitle}
                        </h1>
                        <p>
                          {m.team_id
                            ? "Contest workspace"
                            : juryOnly
                              ? "Resolved issues and time awards"
                              : "Support workspace"}
                        </p>
                      </div>
                      <div className="connection-status">
                        <span
                          className={`live-dot ${connected ? "" : "inactive"}`}
                        />
                        <span>{connected ? "Live" : "Connecting"}</span>
                        <time>
                          {new Date(now).toLocaleTimeString([], {
                            hour12: false,
                          })}
                        </time>
                      </div>
                    </div>
                    <div className="queue-toolbar">
                      {canSearchTeams && (
                        <TeamSearch
                          id="queue-team-search"
                          label="Find a team"
                          teams={state.teams}
                          issues={state.issues}
                          selection={teamSelection}
                          onSelection={setTeamSelection}
                          variant="inline"
                        />
                      )}
                      {!juryOnly && (
                        <label className="filter-label">
                          Status
                          <select
                            value={filter}
                            onChange={(event) => setFilter(event.target.value)}
                          >
                            <option value="all">All statuses</option>
                            {Object.entries(statusNames).map(
                              ([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      )}
                      {canReport && (
                        <button
                          id="report-toggle"
                          className="report-button"
                          aria-expanded={reportOpen}
                          aria-controls="issue-report"
                          disabled={
                            state.event?.archived ||
                            (!!m.team_id && !state.session.intake_open)
                          }
                          onClick={() => {
                            setReportOpen(!reportOpen);
                            if (!reportOpen)
                              window.requestAnimationFrame(() =>
                                document
                                  .getElementById("report-heading")
                                  ?.focus(),
                              );
                          }}
                        >
                          <Icon name="plus" />
                          {m.team_id ? "Report an issue" : "Report for team"}
                        </button>
                      )}
                    </div>
                    {reportOpen && canReport && (
                      <section id="issue-report" className="panel submission">
                        <div className="submission-intro">
                          <p className="eyebrow">
                            {m.team_id ? "Ask for help" : "Report for a team"}
                          </p>
                          <h2 id="report-heading" tabIndex={-1}>
                            Report an issue
                          </h2>
                          <button
                            type="button"
                            className="quiet"
                            onClick={() => {
                              setReportOpen(false);
                              document.getElementById("report-toggle")?.focus();
                            }}
                          >
                            Cancel report
                          </button>
                          <p>
                            {state.session.intake_open
                              ? "Contestant intake is open."
                              : "Contestant intake is closed. Staff can still submit for a team."}
                          </p>
                          {m.team_id && (
                            <p className="location">
                              {
                                state.teams.find((t) => t.id === m.team_id)
                                  ?.name
                              }{" "}
                              ·{" "}
                              {
                                state.teams.find((t) => t.id === m.team_id)
                                  ?.location
                              }
                            </p>
                          )}
                        </div>
                        <form
                          onSubmit={(event) => {
                            const form = event.currentTarget;
                            const data = formData(event);
                            const teamId = submitTeamId(teamSelection);
                            if (!m.team_id && !teamId) return;
                            void act({
                              type: "submit",
                              category: text(data, "category"),
                              description: text(data, "description"),
                              ...(m.team_id
                                ? {}
                                : { team_id: teamId ?? undefined }),
                            }).then((ok) => {
                              if (ok) {
                                form.reset();
                                setReportOpen(false);
                                document
                                  .getElementById("report-toggle")
                                  ?.focus();
                              }
                            });
                          }}
                        >
                          <fieldset
                            disabled={
                              state.event?.archived ||
                              (!!m.team_id && !state.session.intake_open)
                            }
                          >
                            <legend className="sr-only">
                              Issue submission
                            </legend>
                            {!m.team_id && (
                              <TeamSearch
                                id="report-team-search"
                                label="Affected team"
                                teams={state.teams}
                                issues={state.issues}
                                selection={teamSelection}
                                onSelection={setTeamSelection}
                                variant="field"
                              />
                            )}
                            <label>
                              Category
                              <select name="category">
                                {state.session.categories.map((c) => (
                                  <option key={c}>{c}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              What’s happening?
                              <textarea
                                name="description"
                                required
                                maxLength={2000}
                              />
                            </label>
                            <button
                              type="submit"
                              disabled={!m.team_id && !teamSelection.teamId}
                            >
                              Submit issue
                            </button>
                          </fieldset>
                        </form>
                      </section>
                    )}
                    <p className="queue-caption">
                      {filtered.length}{" "}
                      {filtered.length === 1 ? "issue" : "issues"} · newest
                      first
                    </p>
                    <div className="issue-table-head" aria-hidden="true">
                      <span>Issue / status</span>
                      <span>Category / description</span>
                      <span>Team / location</span>
                      <span>Owner / time</span>
                    </div>
                    <div className="issue-list">
                      {filtered.map((item) => {
                        const team = state.teams.find(
                          (team) => team.id === item.team_id,
                        );
                        return (
                          <button
                            key={item.id}
                            className={`issue-card ${issue?.id === item.id ? "selected" : ""}`}
                            aria-pressed={issue?.id === item.id}
                            onClick={() => {
                              setSelected(item.id);
                              if (
                                window.matchMedia("(max-width: 1200px)").matches
                              ) {
                                window.requestAnimationFrame(() =>
                                  document
                                    .getElementById("issue-heading")
                                    ?.focus(),
                                );
                              }
                            }}
                          >
                            <span className="issue-cell">
                              <strong>ISS-{item.number}</strong>
                              <span className={`status ${item.status}`}>
                                {statusNames[item.status]}
                              </span>
                            </span>
                            <span className="description-cell">
                              <span className="category-name">
                                {item.category}
                              </span>
                              <span>{item.description}</span>
                            </span>
                            <span className="team-cell">
                              <strong>{team?.name}</strong>
                              <span className="muted">{team?.location}</span>
                            </span>
                            <span className="owner-cell">
                              <strong>{item.owner_name ?? "Unassigned"}</strong>
                              <span className="muted">Unresolved</span>
                              <span className="queue-duration">
                                {clockDuration(
                                  unresolvedTime(item, state.resolutions, now),
                                )}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {!filtered.length && (
                      <div className="empty">
                        <Icon name="issues" />
                        <h3>No issues in this view.</h3>
                        <p>
                          {teamSelection.teamId
                            ? "This team has no issues in the current view."
                            : visible.length
                              ? "Choose another status to see more reports."
                              : "Reports will appear here when they are submitted."}
                        </p>
                      </div>
                    )}
                    <p className="queue-footer">
                      {filtered.length} of {visible.length} issues
                    </p>
                  </section>
                  {issue ? (
                    <IssueDetail
                      key={issue.id}
                      issue={issue}
                      state={state}
                      member={m}
                      now={now}
                      act={act}
                    />
                  ) : (
                    <section className="detail detail-empty">
                      <Icon name="issues" />
                      <h2>A clear view of every issue.</h2>
                      <p>
                        Select a report to follow its progress, conversation and
                        outcome.
                      </p>
                    </section>
                  )}
                </div>
              )}
            </fieldset>
          </>
        )}
      </div>
    </div>
  );
}

function IssueDetail({
  issue,
  state,
  member: m,
  now,
  act,
}: {
  issue: Issue;
  state: Snapshot;
  member: Membership;
  now: number;
  act: (command: Command) => Promise<boolean>;
}) {
  const [resolution, setResolution] = useState("");
  const [minutes, setMinutes] = useState("");
  const [message, setMessage] = useState("");
  const support = isSupport(m);
  const staff = isStaff(m);
  const owner = support && issue.owner === m.user_id;
  const active = issue.status !== "resolved";
  const award = state.awards.find((a) => a.issue_id === issue.id);
  const records = state.resolutions.filter((r) => r.issue_id === issue.id);
  const team = state.teams.find((item) => item.id === issue.team_id);
  const history = state.history.filter(
    (item) =>
      item.issue_id === issue.id &&
      (!m.team_id || item.visibility === "public"),
  );
  const base = { issue_id: issue.id, revision: issue.revision };
  const activity = (
    <section className="activity">
      <div className="activity-heading">
        <h3>Activity</h3>
        <span>{history.length} events</span>
      </div>
      <ol>
        {history.map((item) => (
          <li
            key={item.id}
            className={item.visibility === "internal" ? "internal-event" : ""}
          >
            {item.visibility === "internal" && <Icon name="lock" />}
            <div className="activity-meta">
              <strong>{item.actor_name}</strong>
              <time dateTime={item.at} title={formatDate(item.at)}>
                {new Date(item.at).toLocaleTimeString([], {
                  hour12: false,
                })}
              </time>
            </div>
            {item.visibility === "internal" && (
              <span className="internal-label">Internal note · staff only</span>
            )}
            <p>{item.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
  return (
    <section
      className="panel detail"
      aria-label={`Issue details ISS-${issue.number}`}
    >
      <button
        className="quiet back-to-queue"
        onClick={() => document.getElementById("workspace-heading")?.focus()}
      >
        Back to queue
      </button>
      <fieldset className="detail-actions" disabled={state.event?.archived}>
        <legend className="sr-only">Issue actions and history</legend>
        <p className="detail-breadcrumb">Issues / ISS-{issue.number}</p>
        <div className="detail-heading">
          <strong>ISS-{issue.number}</strong>
          <span className="category-tag">{issue.category}</span>
          <span className={`status ${issue.status}`}>
            {statusNames[issue.status]}
          </span>
        </div>
        <h2 id="issue-heading" tabIndex={-1}>
          {issue.description}
        </h2>
        <p className="detail-location">
          <span>
            <Icon name="team" />
            {team?.name}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <Icon name="pin" />
            {team?.location}
          </span>
        </p>
        <p className="sr-only">
          Submitted {formatDate(issue.created_at)} by {issue.reporter_name}
        </p>
        <dl className="facts">
          <div>
            <dt>Current owner</dt>
            <dd>{issue.owner_name ?? "Unassigned"}</dd>
          </div>
          <div>
            <dt>Unresolved time</dt>
            <dd className="elapsed-time">
              {clockDuration(unresolvedTime(issue, state.resolutions, now))}
            </dd>
            <span className="timer-state">
              <span className={`live-dot ${active ? "" : "inactive"}`} />
              {active ? "Running" : "Stopped"}
            </span>
          </div>
          <div>
            <dt>First assignment</dt>
            <dd>
              {issue.first_assigned_at
                ? clockDuration(
                    Date.parse(issue.first_assigned_at) -
                      Date.parse(issue.created_at),
                  )
                : "Unassigned"}
            </dd>
            {issue.first_assigned_at && (
              <span className="fact-caption">after submission</span>
            )}
          </div>
        </dl>
        {issue.status === "escalated" && (
          <div className="handoff">
            <Icon name="handoff" />
            <p>
              Specialist handoff requested.
              <br />
              <span>
                {issue.owner_name} remains responsible until acceptance.
              </span>
            </p>
            {m.roles.includes("specialist") && issue.owner !== m.user_id && (
              <button
                onClick={() => {
                  void act({ type: "accept", ...base });
                }}
              >
                Accept handoff
              </button>
            )}
          </div>
        )}
        <div className="actions">
          {support && issue.status === "open" && (
            <button
              onClick={() => {
                void act({ type: "claim", ...base });
              }}
            >
              Claim issue
            </button>
          )}
          {owner && issue.status === "claimed" && (
            <button
              onClick={() => {
                void act({ type: "escalate", ...base });
              }}
            >
              Escalate to specialist
            </button>
          )}
        </div>
        {active && activity}
        {active && (m.team_id || support || m.roles.includes("jury")) && (
          <form
            className="section-form reply-form"
            onSubmit={(event) => {
              const form = event.currentTarget;
              const data = formData(event);
              void act({
                type: "message",
                ...base,
                text: text(data, "message"),
                visibility:
                  text(data, "visibility") === "internal"
                    ? "internal"
                    : "public",
              }).then((ok) => {
                if (ok) {
                  form.reset();
                  setMessage("");
                }
              });
            }}
          >
            {staff && (
              <label>
                Audience
                <select name="visibility">
                  <option value="public">
                    Public reply · visible to the team
                  </option>
                  <option value="internal">Internal note · staff only</option>
                </select>
              </label>
            )}
            <label>
              {m.team_id ? "Reply to staff" : "Message"}
              <textarea
                name="message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                required
                maxLength={2000}
                placeholder={`Write an update for ${team?.name ?? "the team"}…`}
              />
            </label>
            <button type="submit" disabled={!message.trim()}>
              Send reply
            </button>
          </form>
        )}
        {active && owner && (
          <form
            className="section-form"
            onSubmit={(event) => {
              const data = formData(event);
              void act({
                type: "resolve",
                ...base,
                summary:
                  resolution === "custom" ? text(data, "summary") : resolution,
              }).then((ok) => {
                if (ok) setResolution("");
              });
            }}
          >
            <h3>Resolve this issue</h3>
            <label>
              Resolution summary · visible to the team
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose a response
                </option>
                {resolutions.map((r) => (
                  <option key={r}>{r}</option>
                ))}
                <option value="custom">Custom</option>
              </select>
            </label>
            {resolution === "custom" && (
              <label>
                Custom resolution summary
                <textarea name="summary" required maxLength={2000} />
              </label>
            )}
            <button type="submit">Resolve issue</button>
          </form>
        )}
        {records.map((r) => (
          <section className="resolution" key={r.id}>
            <h3>
              {r.reopened_at ? "Previous resolution" : "Resolution summary"}
            </h3>
            <p>{r.summary}</p>
            <small>
              Resolved by {r.actor_name} · {formatDate(r.at)}
            </small>
            {r.reopened_at && (
              <p>
                Reopened by {r.reopened_name} · {formatDate(r.reopened_at)}:{" "}
                {r.reason}
              </p>
            )}
          </section>
        ))}
        {!active && (support || m.team_id === issue.team_id) && (
          <form
            className="section-form"
            onSubmit={(event) => {
              const data = formData(event);
              void act({
                type: "reopen",
                ...base,
                reason: text(data, "reason"),
              });
            }}
          >
            <h3>Reopen this issue</h3>
            <p>
              The previous owner stays responsible. Resolved intervals are
              excluded from unresolved time.
            </p>
            <label>
              Public reopening reason
              <textarea name="reason" required maxLength={2000} />
            </label>
            <button type="submit">Reopen issue</button>
          </form>
        )}
        {!active && !award && (
          <section className="section-form">
            <h3>Time award</h3>
            <p>No award recorded. Awards are discretionary.</p>
            {m.roles.includes("jury") && (
              <form
                onSubmit={(event) => {
                  const data = formData(event);
                  void act({
                    type: "award",
                    ...base,
                    minutes: Number(
                      minutes === "custom" ? text(data, "minutes") : minutes,
                    ),
                    explanation: text(data, "explanation"),
                  });
                }}
              >
                <label>
                  Award minutes
                  <select
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Choose minutes
                    </option>
                    {[0, 5, 10, 15, 30, 60].map((n) => (
                      <option key={n} value={n}>
                        {n} minutes
                      </option>
                    ))}
                    <option value="custom">Custom</option>
                  </select>
                </label>
                {minutes === "custom" && (
                  <label>
                    Custom award minutes
                    <input
                      name="minutes"
                      type="number"
                      min={0}
                      step={1}
                      max={2147483647}
                      required
                    />
                  </label>
                )}
                <label>
                  Public award explanation
                  <textarea name="explanation" required maxLength={2000} />
                </label>
                <button type="submit">Record award</button>
              </form>
            )}
          </section>
        )}
        {award && (
          <section className="award">
            <h3>{award.minutes} minutes awarded</h3>
            <p>{award.explanation}</p>
            {records.some(
              (r) => r.id === award.resolution_id && r.reopened_at,
            ) && (
              <p>
                This decision relates to an earlier resolution. One award is
                allowed per issue.
              </p>
            )}
            <strong>
              {award.applied_at
                ? "Applied externally"
                : "Pending external application"}
            </strong>
            <p>
              Recorded by {award.actor_name} · {formatDate(award.at)}
            </p>
            {award.applied_at && (
              <p>
                Confirmed by {award.applied_name} ·{" "}
                {formatDate(award.applied_at)}
              </p>
            )}
            {!award.applied_at && (support || m.roles.includes("jury")) && (
              <form
                onSubmit={(event) => {
                  formData(event);
                  void act({ type: "apply", ...base });
                }}
              >
                <label className="checkbox">
                  <input type="checkbox" required />I confirm this award was
                  applied in the external contest system.
                </label>
                <button type="submit">Confirm applied externally</button>
              </form>
            )}
            <p>
              Minsky records confirmation only. It does not change a contest
              clock.
            </p>
          </section>
        )}
        {!active && activity}
      </fieldset>
    </section>
  );
}

function AdminPanel({
  state,
  refresh,
}: {
  state: Snapshot;
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<{
    username: string;
    password: string;
  }>();
  const guard = useRef(false);
  const session = state.session;
  if (!session) return null;
  async function run(work: () => Promise<{ error: unknown }>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setCredentials(undefined);
    try {
      const result = await work();
      if (result.error) throw result.error;
      await refresh();
      setNotice("Administration action completed.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      guard.current = false;
    }
  }
  async function account(action: string, data: FormData) {
    const result = await requireClient().functions.invoke("admin", {
      body: {
        action,
        session_id: session?.id,
        username: text(data, "username"),
        user_id: text(data, "user"),
        name: text(data, "name"),
        team_id: text(data, "team") || null,
        roles: data.getAll("role"),
        is_admin: data.has("admin"),
      },
    });
    if (
      result.error &&
      "context" in result.error &&
      result.error.context instanceof Response
    ) {
      const body: unknown = await result.error.context.json();
      if (body && typeof body === "object" && "error" in body) {
        return { error: { message: String(body.error) } };
      }
    }
    if (!result.error && result.data?.temporary_password) {
      const parsed = z
        .object({ temporary_password: z.string() })
        .parse(result.data);
      const target = state.members.find(
        (m) => m.person.id === text(data, "user"),
      );
      setCredentials({
        username:
          text(data, "username") ||
          target?.person.username ||
          "Existing email login",
        password: parsed.temporary_password,
      });
    }
    return result;
  }
  return (
    <section className="panel admin-panel">
      <div className="admin-heading">
        <div>
          <p className="eyebrow">Organizer workspace</p>
          <h2>Session administration</h2>
          <p>Manage access and keep {session.name} running.</p>
        </div>
        <span
          className={`intake-status ${session.intake_open ? "is-open" : ""}`}
        >
          Intake {session.intake_open ? "open" : "closed"}
        </span>
      </div>
      {state.event?.archived && (
        <p className="alert">
          This event is archived. Account changes are disabled.
        </p>
      )}
      {credentials && (
        <section
          className="credential-result"
          aria-label="Temporary account credentials"
        >
          <h3>Share these credentials securely</h3>
          <p>
            This password is shown for this action only. If it’s lost, issue a
            new one. The user must change it on login.
          </p>
          <label>
            Account username
            <input readOnly value={credentials.username} />
          </label>
          <label>
            Temporary password
            <input readOnly value={credentials.password} autoComplete="off" />
          </label>
          <button className="quiet" onClick={() => setCredentials(undefined)}>
            Dismiss credentials
          </button>
        </section>
      )}
      <fieldset disabled={busy || state.event?.archived}>
        <legend className="sr-only">Session administration</legend>
        <div className="admin-stats" aria-label="Issue status counts">
          {Object.entries(statusNames).map(([key, value]) => (
            <div key={key}>
              <strong>
                {state.issues.filter((i) => i.status === key).length}
              </strong>
              <span>{value}</span>
            </div>
          ))}
        </div>
        <div className="intake-controls">
          <div>
            <h3>Contestant submissions</h3>
            <p>
              Closing intake stops new contestant reports. Staff work and
              reopening remain available.
            </p>
          </div>
          <button
            onClick={() => {
              void run(async () =>
                requireClient().rpc("set_intake", {
                  p_session: session.id,
                  p_open: !session.intake_open,
                }),
              );
            }}
          >
            {session.intake_open
              ? "Close contestant intake"
              : "Open contestant intake"}
          </button>
        </div>
        <div className="admin-workspace">
          <section className="admin-section">
            <div className="admin-section-heading">
              <h3>Create an account</h3>
              <p>One account per team. Individual accounts for staff.</p>
            </div>
            <form
              onSubmit={(event) => {
                const data = formData(event);
                void run(() => account("create_account", data));
              }}
            >
              <label>
                Display name
                <input
                  name="name"
                  required
                  maxLength={200}
                  placeholder="Team Aurora or Alex Morgan"
                />
              </label>
              <label>
                Username
                <input
                  name="username"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="team-aurora"
                />
              </label>
              <p className="field-help">
                3–32 letters, digits, underscores or hyphens. Usernames are
                stored in lowercase.
              </p>
              <MembershipFields state={state} />
              <button type="submit">
                {busy ? "Working…" : "Create account"}
              </button>
            </form>
            <p className="field-help">
              You’ll receive a temporary password to share securely. The user
              must change it before accessing the contest.
            </p>
          </section>
          <section className="admin-section">
            <div className="admin-section-heading">
              <h3>
                Session accounts{" "}
                <span className="account-count">{state.members.length}</span>
              </h3>
              <p>Expand an account to update permissions or reset access.</p>
            </div>
            <div className="account-list">
              {state.members.map(({ membership: m, person }) => (
                <details key={person.id} className="account-entry">
                  <summary>
                    <span>
                      <strong>{person.name}</strong>
                      <small>
                        {person.username ?? "Username not assigned"}
                      </small>
                    </span>
                    <span className="account-role">
                      {m.team_id
                        ? (state.teams.find((t) => t.id === m.team_id)?.name ??
                          "Team contestant")
                        : [...m.roles, ...(m.is_admin ? ["admin"] : [])].join(
                            " + ",
                          )}
                    </span>
                  </summary>
                  {!person.username && (
                    <form
                      onSubmit={(event) => {
                        const data = formData(event);
                        data.set("user", person.id);
                        void run(() => account("set_username", data));
                      }}
                    >
                      <label>
                        Assign username
                        <input
                          name="username"
                          required
                          minLength={3}
                          maxLength={32}
                          pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}"
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                      </label>
                      <button type="submit">Set username</button>
                      <p className="field-help">
                        The existing password stays the same. Use this username
                        for future logins.
                      </p>
                    </form>
                  )}
                  <form
                    onSubmit={(event) => {
                      const data = formData(event);
                      void run(async () =>
                        requireClient().rpc("manage_member", {
                          p_session: session.id,
                          p_user: person.id,
                          p_team: text(data, "team") || null,
                          p_roles: data.getAll("role"),
                          p_admin: data.has("admin"),
                          p_remove: false,
                        }),
                      );
                    }}
                  >
                    <MembershipFields state={state} member={m} />
                    <button type="submit">Save membership</button>
                  </form>
                  <div className="account-actions">
                    {person.id !== state.membership?.user_id && (
                      <button
                        className="quiet"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Reset ${person.name}'s password? Verify their identity first. Existing sessions will lose access.`,
                            )
                          )
                            return;
                          const data = new FormData();
                          data.set("user", person.id);
                          void run(() => account("reset_password", data));
                        }}
                      >
                        Reset password
                      </button>
                    )}
                    <button
                      className="quiet danger"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Revoke ${person.name}'s access to this session?`,
                          )
                        ) {
                          void run(async () =>
                            requireClient().rpc("manage_member", {
                              p_session: session.id,
                              p_user: person.id,
                              p_remove: true,
                            }),
                          );
                        }
                      }}
                    >
                      Revoke session access
                    </button>
                  </div>
                </details>
              ))}
            </div>
          </section>
        </div>
        <details className="admin-advanced">
          <summary>Assign an existing account by ID</summary>
          <p>
            For trusted provisioning and accounts already created in Supabase.
          </p>
          <form
            onSubmit={(event) => {
              const data = formData(event);
              void run(async () =>
                requireClient().rpc("manage_member", {
                  p_session: session.id,
                  p_user: text(data, "user"),
                  p_team: text(data, "team") || null,
                  p_roles: data.getAll("role"),
                  p_admin: data.has("admin"),
                  p_remove: false,
                }),
              );
            }}
          >
            <label>
              Auth user UUID
              <input name="user" required />
            </label>
            <MembershipFields state={state} />
            <button type="submit">Assign membership</button>
          </form>
        </details>
        <details className="admin-advanced">
          <summary>Recent administration activity</summary>
          <ul>
            {state.audit.map((a) => (
              <li key={a.id}>
                {a.action.replaceAll("_", " ")} ·{" "}
                {state.members.find((m) => m.person.id === a.actor)?.person
                  .name ?? a.actor}{" "}
                · {formatDate(a.at)}
              </li>
            ))}
          </ul>
        </details>
      </fieldset>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}

function MembershipFields({
  state,
  member,
}: {
  state: Snapshot;
  member?: Membership;
}) {
  const [team, setTeam] = useState(member?.team_id ?? "");
  return (
    <>
      <label>
        Contestant team
        <select
          name="team"
          value={team}
          onChange={(event) => setTeam(event.target.value)}
        >
          <option value="">Staff account</option>
          {state.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <p className="field-help">
        {team
          ? "This account can submit and view issues for the selected team."
          : "Choose the permissions this staff member needs."}
      </p>
      {!team && (
        <fieldset className="staff-options">
          <legend>Staff permissions</legend>
          {(["volunteer", "specialist", "jury"] as const).map((role) => (
            <label key={role} className="checkbox">
              <input
                name="role"
                type="checkbox"
                value={role}
                defaultChecked={member?.roles.includes(role)}
              />
              {role}
            </label>
          ))}
          <label className="checkbox">
            <input
              name="admin"
              type="checkbox"
              defaultChecked={member?.is_admin}
            />
            Admin
          </label>
        </fieldset>
      )}
    </>
  );
}
