import { type Dispatch, type SetStateAction, useEffect } from "react";
import { formData, text } from "../../connected/forms";
import {
  isStaff,
  isSupport,
  type Snapshot,
  unresolvedTime,
} from "../../connected/model";
import { clockDuration, Icon } from "../../connected/ui";
import { TeamSearch } from "./TeamSearch";
import {
  issueVisibleForTeam,
  submitTeamId,
  type TeamSelection,
} from "./teamSearch";
import { IssueDetail } from "./IssueDetail";
import type { IssueAction } from "./actions";
import { statusNames } from "./status";

export interface IssuesView {
  selected: string;
  filter: string;
  teamSelection: TeamSelection;
  reportOpen: boolean;
}

export function IssuesPage({
  state,
  view,
  setView,
  connected,
  now,
  act,
  refresh,
}: {
  state: Snapshot;
  view: IssuesView;
  setView: Dispatch<SetStateAction<IssuesView>>;
  connected: boolean;
  now: number;
  act: IssueAction;
  refresh: () => Promise<void>;
}) {
  const { selected, filter, teamSelection, reportOpen } = view;
  const m = state.membership;
  const juryOnly =
    m && m.roles.includes("jury") && !isSupport(m) && !m.is_admin;
  const canSearchTeams = Boolean(m && !m.team_id && isStaff(m));
  const visible = state.issues.filter((issue) =>
    issueVisibleForTeam(issue, null, "all", Boolean(juryOnly)),
  );
  const filtered = state.issues.filter((issue) =>
    issueVisibleForTeam(issue, teamSelection.teamId, filter, Boolean(juryOnly)),
  );
  const issue = filtered.find((i) => i.id === selected) ?? filtered[0];
  const selectedId = issue?.id;
  useEffect(() => {
    if (selectedId && selectedId !== selected) {
      setView((current) => ({ ...current, selected: selectedId }));
    }
  }, [selectedId, selected, setView]);
  if (!m || !state.session) return null;
  const canReport = m.team_id || isSupport(m);
  const queueTitle = m.team_id
    ? "My team’s issues"
    : juryOnly
      ? "Award review"
      : "Issue Queue";
  return (
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
            <span className={`live-dot ${connected ? "" : "inactive"}`} />
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
              onSelection={(teamSelection) =>
                setView((current) => ({ ...current, teamSelection }))
              }
              variant="inline"
            />
          )}
          {!juryOnly && (
            <label className="filter-label">
              Status
              <select
                value={filter}
                onChange={(event) => {
                  const filter = event.target.value;
                  setView((current) => ({
                    ...current,
                    filter,
                  }));
                }}
              >
                <option value="all">All statuses</option>
                {Object.entries(statusNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
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
                setView((current) => ({
                  ...current,
                  reportOpen: !current.reportOpen,
                }));
                if (!reportOpen)
                  window.requestAnimationFrame(() =>
                    document.getElementById("report-heading")?.focus(),
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
                  setView((current) => ({ ...current, reportOpen: false }));
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
                  {state.teams.find((t) => t.id === m.team_id)?.name} ·{" "}
                  {state.teams.find((t) => t.id === m.team_id)?.location}
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
                  ...(m.team_id ? {} : { team_id: teamId ?? undefined }),
                }).then((ok) => {
                  if (ok) {
                    form.reset();
                    setView((current) => ({ ...current, reportOpen: false }));
                    document.getElementById("report-toggle")?.focus();
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
                <legend className="sr-only">Issue submission</legend>
                {!m.team_id && (
                  <TeamSearch
                    id="report-team-search"
                    label="Affected team"
                    teams={state.teams}
                    issues={state.issues}
                    selection={teamSelection}
                    onSelection={(teamSelection) =>
                      setView((current) => ({ ...current, teamSelection }))
                    }
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
                  <textarea name="description" required maxLength={2000} />
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
          {filtered.length} {filtered.length === 1 ? "issue" : "issues"} ·
          newest first
        </p>
        <div className="issue-table-head" aria-hidden="true">
          <span>Issue / status</span>
          <span>Category / description</span>
          <span>Team / location</span>
          <span>Owner / time</span>
        </div>
        <div className="issue-list">
          {filtered.map((item) => {
            const team = state.teams.find((team) => team.id === item.team_id);
            return (
              <button
                key={item.id}
                className={`issue-card ${issue?.id === item.id ? "selected" : ""}`}
                aria-pressed={issue?.id === item.id}
                onClick={() => {
                  setView((current) => ({ ...current, selected: item.id }));
                  if (window.matchMedia("(max-width: 1200px)").matches) {
                    window.requestAnimationFrame(() =>
                      document.getElementById("issue-heading")?.focus(),
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
                  <span className="category-name">{item.category}</span>
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
          refresh={refresh}
        />
      ) : (
        <section className="detail detail-empty">
          <Icon name="issues" />
          <h2>A clear view of every issue.</h2>
          <p>
            Select a report to follow its progress, conversation and outcome.
          </p>
        </section>
      )}
    </div>
  );
}
