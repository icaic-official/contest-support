import {
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useMatch,
} from "react-router";
import { requireBackend } from "../backend";
import type { AccountIdentity } from "../backend/contracts";
import { errorMessage, WorkflowRejectedError } from "../backend/errors";
import {
  type Command,
  isStaff,
  isSupport,
  type Snapshot,
} from "../connected/model";
import { Brand, Icon } from "../connected/ui";
import { AccountPage } from "../features/account/AccountPage";
import { AdministrationPage } from "../features/administration/AdministrationPage";
import type { ActionOptions } from "../features/issues/actions";
import { IssuesPage, type IssuesView } from "../features/issues/IssuesPage";
import { initialTeamSelection } from "../features/issues/teamSearch";
import { JuryPage } from "../features/jury/JuryPage";
import type { PendingWorkflowRequest } from "./workflowRequest";

export function Workspace({
  user,
  username,
  changePassword,
  signOut,
  pendingRequest: pending,
}: {
  user: AccountIdentity;
  username: string | null;
  changePassword: () => void;
  signOut: () => void;
  pendingRequest: RefObject<PendingWorkflowRequest | undefined>;
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
  const [issuesView, setIssuesView] = useState<IssuesView>({
    selected: "",
    filter: "all",
    teamSelection: initialTeamSelection(),
    reportOpen: false,
  });
  const [navigationOpen, setNavigationOpen] = useState(false);
  const { key: locationKey } = useLocation();
  const juryView = useMatch("/jury") !== null;
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const clockOffset = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Keep retry metadata across the account gate, but discard callbacks
      // that refer to forms in this workspace after those forms unmount.
      if (pending.current?.actorId === user.id) {
        pending.current.onSuccess = undefined;
      }
    };
  }, [pending, user.id]);
  const generation = useRef(0);
  const refreshQueue = useRef<Promise<void>>(Promise.resolve());
  const refresh = useCallback(() => {
    const run = generation.current;
    // Serialize reads so an older Realtime response cannot overwrite a newer
    // revision. A write waits for its own refresh before enabling controls.
    const task = refreshQueue.current.then(async () => {
      try {
        const list = await requireBackend().workflows.sessions(user.id);
        const nextSession = list.some((s) => s.id === session)
          ? session
          : (list[0]?.id ?? "");
        const next = nextSession
          ? await requireBackend().workflows.snapshot(nextSession)
          : undefined;
        if (run !== generation.current) return;
        setSessions(list);
        setSession(nextSession);
        setState(next?.membership ? next : undefined);
        // Keep a team choice only while its session, access, and team remain valid.
        setIssuesView((current) => {
          const member = next?.membership;
          if (
            nextSession !== session ||
            !member ||
            member.team_id ||
            !isStaff(member) ||
            (current.teamSelection.teamId &&
              !next?.teams.some(
                (team) => team.id === current.teamSelection.teamId,
              ))
          ) {
            return { ...current, teamSelection: initialTeamSelection() };
          }
          return current;
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
    // The first refresh selects a session. Empty IDs produce invalid live filters.
    const unsubscribe = session
      ? requireBackend().updates.subscribe({
          sessionId: session,
          userId: user.id,
          onChange: () => {
            void refresh();
          },
          onConnection: (isConnected) => {
            setConnected(isConnected);
            if (isConnected) void refresh();
          },
        })
      : undefined;
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
      unsubscribe?.();
    };
  }, [refresh, session, user.id]);
  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(Date.now() + clockOffset.current),
      1000,
    );
    return () => window.clearInterval(interval);
  }, []);
  async function act(
    command: Command,
    { retry = false, onSuccess }: ActionOptions = {},
  ): Promise<boolean> {
    if (!mounted.current || inFlight.current || (!retry && pending.current)) {
      return false;
    }
    if (retry && pending.current?.actorId !== user.id) return false;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    setError("");
    const request =
      retry && pending.current
        ? pending.current
        : {
            actorId: user.id,
            sessionId: session,
            request: crypto.randomUUID(),
            command,
            onSuccess,
          };
    pending.current = request;
    try {
      const id = await requireBackend().workflows.execute(
        request.sessionId,
        request.request,
        request.command,
      );
      if (pending.current !== request || !mounted.current) return false;
      pending.current = undefined;
      // A retry must complete the original form's cleanup before enabling edits.
      request.onSuccess?.();
      await refresh();
      if (!mounted.current) return false;
      if (!juryView) {
        setIssuesView((current) => ({
          ...current,
          selected: id,
          filter: command.type === "reopen" ? "claimed" : current.filter,
        }));
      }
      setNotice("Action recorded in shared history.");
      return true;
    } catch (cause) {
      if (pending.current !== request || !mounted.current) return false;
      // Known server rejections are definitive. Transport failures retain the same
      // request UUID for an explicit retry, including submissions and messages.
      if (cause instanceof WorkflowRejectedError) {
        pending.current = undefined;
      }
      await refresh();
      if (!mounted.current) return false;
      setError(errorMessage(cause));
      return false;
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const m = state?.membership;
  const juryOnly =
    m && m.roles.includes("jury") && !isSupport(m) && !m.is_admin;
  useEffect(() => {
    setNavigationOpen(false);
    const frame = window.requestAnimationFrame(() =>
      document.getElementById("workspace-heading")?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [locationKey, state?.session?.id]);

  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    // Links retain native new-tab behavior. Pending writes still block edits.
    if (busy || pending.current) event.preventDefault();
  }
  const identity =
    state?.members.find((member) => member.person.id === user.id)?.person
      .name ??
    (m?.team_id
      ? state?.teams.find((team) => team.id === m.team_id)?.name
      : undefined) ??
    user.name ??
    username ??
    user.email ??
    "Your account";
  const roleNames = m?.team_id
    ? "Contestant"
    : [...(m?.roles ?? []), ...(m?.is_admin ? ["admin"] : [])]
        .map((role) => role.charAt(0).toUpperCase() + role.slice(1))
        .join(" · ");
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
                  setIssuesView({
                    selected: "",
                    filter: "all",
                    teamSelection: initialTeamSelection(),
                    reportOpen: false,
                  });
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
          <NavLink
            to="/issues"
            end
            aria-disabled={busy || !!pending.current}
            onClick={navigate}
          >
            <Icon name="issues" />
            {m?.team_id
              ? "My team’s issues"
              : juryOnly
                ? "Award review"
                : "Issues"}
          </NavLink>
          {m?.roles.includes("jury") && (
            <NavLink
              to="/jury"
              end
              aria-disabled={busy || !!pending.current}
              onClick={navigate}
            >
              <Icon name="issues" />
              Jury worklist
            </NavLink>
          )}
          {m?.is_admin && (
            <NavLink
              to="/administration"
              end
              aria-disabled={busy || !!pending.current}
              onClick={navigate}
            >
              <Icon name="settings" />
              Administration
            </NavLink>
          )}
          <NavLink
            to="/account"
            end
            aria-disabled={busy || !!pending.current}
            onClick={navigate}
          >
            <Icon name="account" />
            My account
          </NavLink>
          <a
            href="https://minsky-docs.icaic-minsky.workers.dev"
            target="_blank"
            rel="noopener noreferrer"
          >
            Documentation <span className="sr-only">(opens in a new tab)</span>
            ↗
          </a>
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
              if (command) void act(command, { retry: true });
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
            <fieldset
              className="workspace"
              disabled={busy || !!pending.current}
            >
              <legend className="sr-only">Contest workflow</legend>
              <Routes>
                <Route path="/" element={<Navigate to="/issues" replace />} />
                <Route
                  path="/issues"
                  element={
                    <IssuesPage
                      state={state}
                      view={issuesView}
                      setView={setIssuesView}
                      connected={connected}
                      now={now}
                      act={act}
                      refresh={refresh}
                    />
                  }
                />
                <Route
                  path="/administration"
                  element={
                    m.is_admin ? (
                      <AdministrationPage state={state} refresh={refresh} />
                    ) : (
                      <Navigate to="/issues" replace />
                    )
                  }
                />
                <Route
                  path="/jury"
                  element={
                    m.roles.includes("jury") ? (
                      <JuryPage
                        key={state.session.id}
                        state={state}
                        now={now}
                        act={act}
                        refresh={refresh}
                      />
                    ) : (
                      <Navigate to="/issues" replace />
                    )
                  }
                />
                <Route
                  path="/account"
                  element={
                    <AccountPage
                      state={state}
                      user={user}
                      username={username}
                      changePassword={changePassword}
                    />
                  }
                />
                <Route
                  path="*"
                  element={
                    <section className="panel">
                      <h1 id="workspace-heading" tabIndex={-1}>
                        Page not found
                      </h1>
                      <p>This application page does not exist.</p>
                      <Link to="/issues">Return to issues</Link>
                    </section>
                  }
                />
              </Routes>
            </fieldset>
          </>
        )}
      </div>
    </div>
  );
}
