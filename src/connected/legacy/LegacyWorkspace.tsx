import { useEffect, useState } from "react";
import { NoSessionAccess } from "@/screens/NoSessionAccess";
import { TeamSearch } from "../TeamSearch";
import { useNow } from "../hooks/useNow";
import { useTeamSelection } from "../hooks/useTeamSelection";
import type { WorkflowState } from "../hooks/useWorkflowState";
import { statusNames } from "../labels";
import { isStaff, isSupport, unresolvedTime } from "../model";
import type { ShellProps } from "../shell";
import {
  initialTeamSelection,
  issueVisibleForTeam,
  submitTeamId,
} from "../teamSearch";
import { Brand, clockDuration, Icon } from "../ui";
import { AdminPanel } from "./AdminPanel";
import { formData, text } from "./forms";
import { IssueDetail } from "./IssueDetail";

/** Identifies the shell that renders the pre-redesign workspace. */
export type LegacyLayout =
  "contestant" | "organiser-phone" | "organiser-desktop";

/**
 * The pre-redesign workspace: sidebar, issue queue, issue detail,
 * administration and account pages. The T0015 shells render it as a
 * placeholder until their own layouts replace it.
 */
export function LegacyWorkspace({
  shell,
  workflow,
  layout,
}: {
  shell: ShellProps;
  workflow: WorkflowState;
  layout: LegacyLayout;
}) {
  const { user, username, data, changePassword, signOut } = shell;
  const {
    sessions,
    sessionId: session,
    snapshot: state,
    refreshError,
    connected,
    refresh,
  } = data;
  const {
    command,
    selectedIssueId: selected,
    selectIssue: setSelected,
    statusFilter: filter,
    setStatusFilter: setFilter,
  } = workflow;
  const act = command.act;
  const [teamSelection, setTeamSelection] = useTeamSelection(session, state);
  const [view, setView] = useState<"issues" | "admin" | "account">("issues");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const now = useNow(data.clockOffset);
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
  // Keep the displayed issue selected when a new report arrives.
  useEffect(() => {
    if (issue && issue.id !== selected) setSelected(issue.id);
  }, [issue, selected, setSelected]);
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
  if (!state || !m || !state.session) {
    return (
      <NoSessionAccess
        data={data}
        account={username ?? user.email ?? undefined}
        signOut={signOut}
        error={command.error}
        onRetry={command.pending && !command.busy ? command.retry : undefined}
      />
    );
  }
  return (
    <div className="legacy-ui" data-ui={layout}>
      <div className="app-shell">
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
              <p className="event-name">
                {state?.event?.name ?? "Your contest"}
              </p>
              {sessions.length > 1 ? (
                <label>
                  <span className="sr-only">Contest session</span>
                  <select
                    value={session}
                    disabled={command.locked}
                    onChange={(event) => {
                      data.selectSession(event.target.value);
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
                  Contestant intake{" "}
                  {state.session.intake_open ? "open" : "closed"}
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
                disabled={command.locked}
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
                  disabled={command.locked}
                  aria-current={activeView === "admin" ? "page" : undefined}
                  onClick={() => navigate("admin")}
                >
                  <Icon name="settings" />
                  Administration
                </button>
              )}
              <button
                disabled={command.locked}
                aria-current={activeView === "account" ? "page" : undefined}
                onClick={() => navigate("account")}
              >
                <Icon name="account" />
                My account
              </button>
              <a
                href="https://minsky-docs.icaic-minsky.workers.dev"
                target="_blank"
                rel="noopener noreferrer"
              >
                Documentation{" "}
                <span className="sr-only">(opens in a new tab)</span>↗
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
            {command.error && (
              <p role="alert" className="alert">
                {command.error}
              </p>
            )}
            <p role="status" className="notice">
              {command.notice}
            </p>
            {command.pending && !command.busy && (
              <button onClick={command.retry}>Retry last request</button>
            )}
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
              <fieldset className="workspace" disabled={command.locked}>
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
                                state.teams.find(
                                  (team) => team.id === m.team_id,
                                )?.name ?? "Your team"
                              }`
                            : [
                                ...m.roles,
                                ...(m.is_admin ? ["admin"] : []),
                              ].join(" + ")}
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
                              onChange={(event) =>
                                setFilter(event.target.value)
                              }
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
                                document
                                  .getElementById("report-toggle")
                                  ?.focus();
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
                                  window.matchMedia("(max-width: 1200px)")
                                    .matches
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
                                <strong>
                                  {item.owner_name ?? "Unassigned"}
                                </strong>
                                <span className="muted">Unresolved</span>
                                <span className="queue-duration">
                                  {clockDuration(
                                    unresolvedTime(
                                      item,
                                      state.resolutions,
                                      now,
                                    ),
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
                        refresh={refresh}
                      />
                    ) : (
                      <section className="detail detail-empty">
                        <Icon name="issues" />
                        <h2>A clear view of every issue.</h2>
                        <p>
                          Select a report to follow its progress, conversation
                          and outcome.
                        </p>
                      </section>
                    )}
                  </div>
                )}
              </fieldset>
            </>
          </div>
        </div>
      </div>
    </div>
  );
}
