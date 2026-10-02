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
import { duration } from "../domain";

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
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="demo-bar">
        <strong>MINSKY · DEVELOPMENT</strong>
        <span>Shared contest support</span>
      </div>
      <header className="app-header">
        <a className="brand" href="#main">
          <span className="brand-mark">m</span>
          <span>
            minsky<small>Contest support, connected.</small>
          </span>
        </a>
        {user && (
          <div className="header-controls">
            <span className="account-name">
              {account?.username ?? user.email}
            </span>
            <button className="quiet" onClick={() => setPasswordSetup(true)}>
              Change password
            </button>
            <button
              className="quiet"
              onClick={() => {
                void requireClient()
                  .auth.signOut()
                  .then(({ error: cause }) => {
                    if (cause) setError(cause.message);
                  });
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main id="main" tabIndex={-1}>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        {loading
          ? <p role="status">Restoring your session…</p>
          : !client
          ? (
            <p role="alert">
              Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in
              .env.local. See docs/cloud-onboarding.md.
            </p>
          )
          : !user
          ? <SignIn />
          : accountError
          ? (
            <section className="panel auth-panel">
              <p role="alert">{accountError}</p>
              <button onClick={() => setAccountRetry((value) => value + 1)}>
                Retry account check
              </button>
            </section>
          )
          : !account
          ? <p role="status">Checking account access…</p>
          : !account.session_valid
          ? (
            <section className="panel auth-panel">
              <h1>Sign in again</h1>
              <p>
                Your password was reset. Sign out and use the new credentials
                from your organizer.
              </p>
            </section>
          )
          : passwordSetup || account.must_change
          ? (
            <PasswordForm
              required={account.must_change}
              done={() => {
                setPasswordSetup(false);
                setAccount(undefined);
                setAccountRetry((value) => value + 1);
              }}
            />
          )
          : <Dashboard key={user.id} user={user} />}
        <footer>
          Minsky · Development deployment
          <span>External contest clocks are managed separately.</span>
        </footer>
      </main>
    </>
  );
}

function SignIn() {
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="sign-in-layout">
      <section className="sign-in-intro" aria-labelledby="welcome-heading">
        <p className="eyebrow">Contest support</p>
        <h2 id="welcome-heading">
          Keep every team <br />in the running.
        </h2>
        <p>
          A place for teams to ask for help and for staff to carry each issue
          through to resolution.
        </p>
        <figure className="handoff-illustration">
          <svg viewBox="0 40 480 180" fill="none" aria-hidden="true">
            <path
              className="route-guide"
              d="M40 60H440M40 130H440M40 200H440"
            />
            <path
              className="route-secondary"
              d="M40 60H115Q145 60 145 90V170Q145 200 175 200H440"
            />
            <path
              className="route-primary"
              d="M40 130H205Q235 130 235 100V90Q235 60 265 60H315Q345 60 345 90V100Q345 130 375 130H440"
            />
            <circle className="route-node" cx="40" cy="60" r="9" />
            <circle className="route-node" cx="40" cy="200" r="9" />
            <rect
              className="route-station"
              x="17"
              y="107"
              width="46"
              height="46"
              rx="14"
            />
            <path className="station-symbol" d="M31 130H49M40 121V139" />
            <rect
              className="route-station"
              x="217"
              y="107"
              width="46"
              height="46"
              rx="14"
            />
            <path
              className="station-symbol"
              d="M230 125H249M230 135H249M244 120L249 125L244 130M235 130L230 135L235 140"
            />
            <rect
              className="route-finish"
              x="417"
              y="107"
              width="46"
              height="46"
              rx="14"
            />
            <path className="finish-symbol" d="M429 130L437 138L452 122" />
            <circle className="route-node" cx="440" cy="200" r="9" />
          </svg>
          <figcaption>
            <span>Report a problem</span>
            <span>Find the right help</span>
            <span>Keep going</span>
          </figcaption>
        </figure>
        <p className="sign-in-guidance">
          Contestants, support staff and jury share one workflow, with the right
          view for each role.
        </p>
      </section>
      <section className="panel auth-panel">
        <h1>Sign in to Minsky</h1>
        <p>Use the username and password provided by your organizer.</p>
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
              Username<input
                name="username"
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
            <p className="field-help">
              Existing accounts can use their original email until a username is
              assigned.
            </p>
            <label>
              Password<input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </label>
            <button type="submit">{busy ? "Signing in…" : "Sign in"}</button>
          </fieldset>
        </form>
        <button
          className="quiet"
          aria-expanded={help}
          aria-controls="sign-in-help"
          onClick={() => setHelp(!help)}
        >
          Forgot password?
        </button>
        <p id="sign-in-help" role="status" className="field-help" hidden={!help}>
          Contact your contest organizer. They will verify your identity and
          give you a new temporary password.
        </p>
        {error && <p className="alert" role="alert">{error}</p>}
      </section>
    </div>
  );
}

function PasswordForm(
  { done, required }: { done: () => void; required: boolean },
) {
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
            Current password<input
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
        <button className="quiet" onClick={done}>Return to dashboard</button>
      )}
    </section>
  );
}

function Dashboard({ user }: { user: User }) {
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
        if (next)
          clockOffset.current = Date.parse(next.server_time) - Date.now();
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
      )
        pending.current = undefined;
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
  const visible =
    state?.issues.filter((i) => !juryOnly || i.status === "resolved") ?? [];
  const filtered = visible.filter(
    (i) => filter === "all" || i.status === filter,
  );
  const issue = filtered.find((i) => i.id === selected) ?? filtered[0];
  return (
    <>
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
      {sessions.length > 1 && (
        <label>
          Contest session
          <select
            value={session}
            disabled={busy || !!pending.current}
            onChange={(e) => {
              generation.current++;
              setState(undefined);
              setSession(e.target.value);
              setSelected("");
              setFilter("all");
            }}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!state || !m || !state.session
        ? (
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
        )
        : (
          <>
            <div className="session">
              <span>{state.event?.name}</span>
              <span aria-hidden="true">/</span>
              <span>{state.session.name}</span>
            </div>
            <div className="page-heading">
              <div>
                <p className="eyebrow">
                  {m.team_id
                    ? "Team contestant"
                    : [...m.roles, ...(m.is_admin ? ["admin"] : [])].join(
                      " + ",
                    )}
                </p>
                <h1>
                  {m.team_id
                    ? "A little help, right here."
                    : juryOnly
                    ? "Review. Decide. Record."
                    : "Keep the contest moving."}
                </h1>
                <p>
                  {m.team_id
                    ? "Report a problem, follow updates, and review your team’s time awards."
                    : juryOnly
                    ? "Review resolved reports and record time award decisions."
                    : "Claim reports, coordinate handoffs, and keep teams informed."}
                </p>
              </div>
              <span
                className={`intake-status ${
                  state.session.intake_open ? "is-open" : ""
                }`}
              >
                Contestant intake{" "}
                {state.session.intake_open ? "open" : "closed"}
              </span>
            </div>
            {state.event?.archived && (
              <p className="alert">
                This event is archived. Records are read only.
              </p>
            )}
            <fieldset
              className="workspace"
              disabled={busy || !!pending.current}
            >
              <legend className="sr-only">Contest workflow</legend>
              {m.is_admin && <AdminPanel state={state} refresh={refresh} />}
              {(m.team_id || isSupport(m)) && (
                <section className="panel submission">
                  <div className="submission-intro">
                    <p className="eyebrow">
                      {m.team_id ? "Ask for help" : "Report for a team"}
                    </p>
                    <h2>Report an issue</h2>
                    <p>
                      {state.session.intake_open
                        ? "Contestant intake is open."
                        : "Contestant intake is closed. Staff can still submit for a team."}
                    </p>
                    {m.team_id && (
                      <p className="location">
                        {state.teams.find((t) => t.id === m.team_id)?.name} ·
                        {" "}
                        {state.teams.find((t) => t.id === m.team_id)?.location}
                      </p>
                    )}
                  </div>
                  <form
                    onSubmit={(event) => {
                      const form = event.currentTarget;
                      const data = formData(event);
                      void act({
                        type: "submit",
                        category: text(data, "category"),
                        description: text(data, "description"),
                        ...(m.team_id ? {} : { team_id: text(data, "team") }),
                      }).then((ok) => {
                        if (ok) form.reset();
                      });
                    }}
                  >
                    <fieldset
                      disabled={state.event?.archived ||
                        (!!m.team_id && !state.session.intake_open)}
                    >
                      <legend className="sr-only">Issue submission</legend>
                      {!m.team_id && (
                        <label>
                          Affected team
                          <select name="team" required>
                            {state.teams.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} · {t.location}
                              </option>
                            ))}
                          </select>
                        </label>
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
                      <button type="submit">Submit issue</button>
                    </fieldset>
                  </form>
                </section>
              )}
              <div className="metrics">
                <div>
                  <strong>{visible.length}</strong>
                  <span>Issues in view</span>
                </div>
                <div>
                  <strong>
                    {visible.filter((i) => i.status !== "resolved").length}
                  </strong>
                  <span>Awaiting resolution</span>
                </div>
                <div>
                  <strong>
                    {state.awards.filter((a) => !a.applied_at).length}
                  </strong>
                  <span>Pending application</span>
                </div>
              </div>
              <div className="work-grid">
                <section className="panel queue">
                  <div className="panel-heading">
                    <h2>
                      {m.team_id
                        ? "Your team’s issues"
                        : juryOnly
                        ? "Resolved issues"
                        : "Support queue"}
                    </h2>
                    <span
                      className="count"
                      aria-label={`${filtered.length} issues`}
                    >
                      {filtered.length}
                    </span>
                  </div>
                  {!juryOnly && (
                    <div className="filter">
                      <label>
                        Status filter
                        <select
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">All statuses</option>
                          {Object.entries(statusNames).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                  <div className="issue-list">
                    {filtered.map((i) => (
                      <button
                        key={i.id}
                        className={`issue-card ${
                          issue?.id === i.id ? "selected" : ""
                        }`}
                        aria-pressed={issue?.id === i.id}
                        onClick={() => setSelected(i.id)}
                      >
                        <span className="card-top">
                          <span>
                            ISS-{i.number} · {i.category}
                          </span>
                          <span className={`status ${i.status}`}>
                            {statusNames[i.status]}
                          </span>
                        </span>
                        <strong>{i.description}</strong>
                        <span>
                          {state.teams.find((t) => t.id === i.team_id)?.name} ·
                          {" "}
                          {state.teams.find((t) => t.id === i.team_id)
                            ?.location}
                        </span>
                        <span className="card-bottom">
                          <span>{i.owner_name ?? "Unassigned"}</span>
                          <span>
                            {duration(
                              unresolvedTime(i, state.resolutions, now),
                            )}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {!filtered.length && (
                    <div className="empty">
                      <h3>No issues in this view.</h3>
                      <p>
                        {visible.length
                          ? "Choose another status to see more reports."
                          : "Reports will appear here when they are submitted."}
                      </p>
                    </div>
                  )}
                </section>
                {issue && (
                  <IssueDetail
                    key={issue.id}
                    issue={issue}
                    state={state}
                    member={m}
                    now={now}
                    act={act}
                  />
                )}
              </div>
            </fieldset>
          </>
        )}
    </>
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
  const support = isSupport(m);
  const staff = isStaff(m);
  const owner = support && issue.owner === m.user_id;
  const active = issue.status !== "resolved";
  const award = state.awards.find((a) => a.issue_id === issue.id);
  const records = state.resolutions.filter((r) => r.issue_id === issue.id);
  const base = { issue_id: issue.id, revision: issue.revision };
  return (
    <section
      className="panel detail"
      aria-label={`Issue details ISS-${issue.number}`}
    >
      <fieldset className="detail-actions" disabled={state.event?.archived}>
        <legend className="sr-only">Issue actions and history</legend>
        <div className="panel-heading">
          <p className="eyebrow">
            ISS-{issue.number} / {issue.category}
          </p>
          <span className={`status ${issue.status}`}>
            {statusNames[issue.status]}
          </span>
        </div>
        <h2>{issue.description}</h2>
        <p className="location">
          {state.teams.find((t) => t.id === issue.team_id)?.name} ·{" "}
          {state.teams.find((t) => t.id === issue.team_id)?.location}
        </p>
        <dl className="facts">
          <div>
            <dt>Current owner</dt>
            <dd>{issue.owner_name ?? "Unassigned"}</dd>
          </div>
          <div>
            <dt>Unresolved time · {active ? "running" : "stopped"}</dt>
            <dd>{duration(unresolvedTime(issue, state.resolutions, now))}</dd>
          </div>
          <div>
            <dt>First assignment</dt>
            <dd>
              {issue.first_assigned_at
                ? duration(
                    Date.parse(issue.first_assigned_at) -
                      Date.parse(issue.created_at),
                  )
                : "Not yet assigned"}
            </dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>
              {formatDate(issue.created_at)} · {issue.reporter_name}
            </dd>
          </div>
        </dl>
        {issue.status === "escalated" && (
          <p className="handoff">
            Specialist handoff requested. {issue.owner_name} remains responsible
            until acceptance.
          </p>
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
          {m.roles.includes("specialist") &&
            issue.status === "escalated" &&
            issue.owner !== m.user_id && (
              <button
                onClick={() => {
                  void act({ type: "accept", ...base });
                }}
              >
                Accept handoff
              </button>
            )}
        </div>
        {active && (m.team_id || support || m.roles.includes("jury")) && (
          <form
            className="section-form"
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
                if (ok) form.reset();
              });
            }}
          >
            <h3>Conversation</h3>
            {staff && (
              <label>
                Message visibility
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
              <textarea name="message" required maxLength={2000} />
            </label>
            <button type="submit">Send message</button>
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
        <section className="activity">
          <h3>{m.team_id ? "Team activity" : "Activity history"}</h3>
          <ol>
            {state.history
              .filter((h) => h.issue_id === issue.id)
              .slice()
              .reverse()
              .map((h) => (
                <li key={h.id}>
                  <div>
                    <strong>{h.actor_name}</strong>
                    <time dateTime={h.at}>{formatDate(h.at)}</time>
                  </div>
                  <p>{h.text}</p>
                  {h.visibility === "internal" && (
                    <span className="internal-label">Staff only</span>
                  )}
                </li>
              ))}
          </ol>
        </section>
      </fieldset>
    </section>
  );
}

function AdminPanel(
  { state, refresh }: { state: Snapshot; refresh: () => Promise<void> },
) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<
    { username: string; password: string }
  >();
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
      result.error && "context" in result.error &&
      result.error.context instanceof Response
    ) {
      const body: unknown = await result.error.context.json();
      if (body && typeof body === "object" && "error" in body) {
        return { error: { message: String(body.error) } };
      }
    }
    if (!result.error && result.data?.temporary_password) {
      const parsed = z.object({ temporary_password: z.string() }).parse(
        result.data,
      );
      const target = state.members.find((m) =>
        m.person.id === text(data, "user")
      );
      setCredentials({
        username: text(data, "username") || target?.person.username ||
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
            Account username<input readOnly value={credentials.username} />
          </label>
          <label>
            Temporary password<input
              readOnly
              value={credentials.password}
              autoComplete="off"
            />
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
                })
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
                Display name<input
                  name="name"
                  required
                  maxLength={200}
                  placeholder="Team Aurora or Alex Morgan"
                />
              </label>
              <label>
                Username<input
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
                        ? state.teams.find((t) =>
                          t.id === m.team_id
                        )?.name ??
                          "Team contestant"
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
                        Assign username<input
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
                        })
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
                          ) return;
                          const data = new FormData();
                          data.set("user", person.id);
                          void run(() =>
                            account("reset_password", data)
                          );
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
                            })
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
                })
              );
            }}
          >
            <label>
              Auth user UUID<input name="user" required />
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
                  .name ?? a.actor} · {formatDate(a.at)}
              </li>
            ))}
          </ul>
        </details>
      </fieldset>
      {error && <p role="alert" className="alert">{error}</p>}
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
        <select name="team" value={team} onChange={(event) => setTeam(event.target.value)}>
          <option value="">Staff account</option>
          {state.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <p className="field-help">
        {team ? "This account can submit and view issues for the selected team." : "Choose the permissions this staff member needs."}
      </p>
      {!team && <fieldset className="staff-options"><legend>Staff permissions</legend>
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
        <input name="admin" type="checkbox" defaultChecked={member?.is_admin} />
        Admin
      </label>
      </fieldset>}
    </>
  );
}
