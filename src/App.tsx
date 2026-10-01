import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  assignmentDelay,
  canAccept,
  canAward,
  canClaim,
  canEscalate,
  canReopen,
  canResolve,
  canView,
  isJuryOnly,
  roleLabel,
  categories,
  duration,
  elapsed,
  personas,
  seed,
  teams,
  transition,
  visibleHistory,
  type Action,
  type Issue,
  type Persona,
  type State,
} from "./domain";
import { loadState, saveState } from "./storage";

const storage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) =>
    window.localStorage.setItem(key, value),
};
const statusName = {
  open: "Open",
  claimed: "In progress",
  escalated: "Awaiting specialist",
  resolved: "Resolved",
};
const resolutionChoices = [
  "Resolved without comment",
  "Service restored",
  "Device issue resolved",
  "Problem statement clarified",
];
const date = (timestamp: number) => new Date(timestamp).toLocaleString();
const teamFor = (issue: Issue) =>
  teams.find((team) => team.id === issue.teamId)!;
function fields(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return new FormData(event.currentTarget);
}

export default function App() {
  const [initial] = useState(() => loadState(storage));
  const [state, setState] = useState(initial.state);
  const current = useRef(state);
  const [loadError, setLoadError] = useState(initial.error);
  const [storageError, setStorageError] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [persona, setPersona] = useState<Persona>("aurora");
  const [selected, setSelected] = useState<string>("ISS-001");
  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!initial.error) setStorageError(saveState(storage, initial.state));
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [initial]);
  function persist(next: State) {
    current.current = next;
    setState(next);
    setStorageError(saveState(storage, next));
  }
  function act(action: Action) {
    if (loadError) return false;
    try {
      const next = transition(current.current, action, persona);
      persist(next);
      setError("");
      setNotice("Demo updated and recorded in local activity history.");
      if (action.type === "submit") {
        setSelected(next.issues[0].id);
        setNotice(`${next.issues[0].id} submitted. Timer started.`);
      }
      if (action.type === "reopen") {
        setSelected(action.issueId);
        if (filter === "resolved") setFilter("claimed");
      }
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Action could not be completed.",
      );
      return false;
    }
  }
  function reset() {
    if (
      !window.confirm(
        "Reset all local demo progress and restore fictional data?",
      )
    )
      return;
    persist(seed());
    setLoadError(undefined);
    setError("");
    setSelected("ISS-001");
    setFilter("all");
    setNotice("Demo reset to fictional seed data.");
  }
  const visible = state.issues.filter((issue) =>
    canView(issue, personas[persona]),
  );
  const filtered = visible.filter(
    (issue) => filter === "all" || issue.status === filter,
  );
  const issue = filtered.find((item) => item.id === selected) ?? filtered[0];
  const openCount = visible.filter((item) => item.status !== "resolved").length;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="demo-bar">
        <span>
          <strong>LOCAL DEMO</strong> Fictional people, teams and contest data
        </span>
        <span>Saved in this browser only</span>
      </div>
      <header className="app-header">
        <a className="brand" href="#main">
          <span className="brand-mark">m</span>
          <span>
            minsky<small>Contest support, connected.</small>
          </span>
        </a>
        <div className="persona-control">
          <label htmlFor="persona">Demo persona</label>
          <select
            id="persona"
            value={persona}
            onChange={(event) => {
              setPersona(event.target.value as Persona);
              setFilter("all");
              setError("");
              setNotice("");
            }}
          >
            {Object.entries(personas).map(([id, actor]) => (
              <option key={id} value={id}>
                {roleLabel(actor)} · {actor.name}
              </option>
            ))}
          </select>
        </div>
        <button className="quiet" onClick={reset}>
          Reset demo
        </button>
      </header>
      <main id="main" tabIndex={-1}>
        <div className="session">
          <span className="live-dot" /> FICTIONAL GROUP CONTEST <span> / </span>{" "}
          Session 01 · Discovery round
        </div>
        <div className="page-heading">
          <div>
            <p className="eyebrow">
              {personas[persona].name} / {roleLabel(personas[persona])}
            </p>
            <h1>
              {persona === "aurora"
                ? "A little help, right here."
                : isJuryOnly(personas[persona])
                  ? "Review. Decide. Record."
                  : "Keep the contest moving."}
            </h1>
            <p>
              {persona === "aurora"
                ? "Report a problem and follow your team’s progress."
                : isJuryOnly(personas[persona])
                  ? "Review resolved issues and record discretionary time awards."
                  : "Claim an issue, help a team, and keep everyone informed."}
            </p>
          </div>
          <div className="session-badge">
            Hall A + B<small>3 fictional teams</small>
          </div>
        </div>
        <p className="simulation-note">
          Persona switching simulates roles. It is not authentication or
          authorization. No external contest clock is changed.
        </p>
        {loadError && (
          <p role="alert" className="alert">
            {loadError}
          </p>
        )}
        {storageError && (
          <p role="alert" className="alert">
            {storageError}
          </p>
        )}
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        <p className="notice" role="status">
          {notice}
        </p>
        <fieldset className="workspace" disabled={!!loadError}>
          <legend className="sr-only">Contest workflow</legend>
          {persona === "aurora" && (
            <section className="panel submission">
              <div>
                <p className="eyebrow">NEED A HAND?</p>
                <h2>Report an issue</h2>
                <p>Your location comes from the session roster.</p>
                <p className="location">Team Aurora · Hall A · Desk 12</p>
              </div>
              <form
                onSubmit={(event) => {
                  const form = event.currentTarget;
                  const data = fields(event);
                  if (
                    act({
                      type: "submit",
                      category: String(data.get("category")),
                      description: String(data.get("description")),
                    })
                  )
                    form.reset();
                }}
              >
                <label>
                  Category
                  <select name="category">
                    {categories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <label>
                  What’s happening?
                  <textarea
                    name="description"
                    required
                    maxLength={2000}
                    placeholder="Tell us what you’re seeing and what you’ve tried."
                  />
                </label>
                <button type="submit">
                  Submit issue <span aria-hidden="true">↗</span>
                </button>
              </form>
            </section>
          )}
          <div className="metrics">
            <div>
              <strong>{visible.length}</strong>
              <span>
                {isJuryOnly(personas[persona])
                  ? "Resolved issues"
                  : "Issues in view"}
              </span>
            </div>
            <div>
              <strong>
                {isJuryOnly(personas[persona])
                  ? state.awards.length
                  : openCount}
              </strong>
              <span>
                {isJuryOnly(personas[persona])
                  ? "Awards recorded"
                  : "Awaiting resolution"}
              </span>
            </div>
            <div>
              <strong>
                {
                  state.awards.filter(
                    (award) =>
                      award.appliedAt === undefined &&
                      visible.some((item) => item.id === award.issueId),
                  ).length
                }
              </strong>
              <span>Awards pending application</span>
            </div>
          </div>
          <div className="work-grid">
            <section className="panel queue" aria-label="Issue queue">
              <div className="panel-heading">
                <h2>
                  {persona === "aurora"
                    ? "Your team’s issues"
                    : isJuryOnly(personas[persona])
                      ? "Resolved issues"
                      : "Support queue"}
                </h2>
                <span className="count">{filtered.length}</span>
              </div>
              {!isJuryOnly(personas[persona]) && (
                <label className="filter">
                  Status filter
                  <select
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    {Object.entries(statusName).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="issue-list">
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    className={`issue-card ${issue?.id === item.id ? "selected" : ""}`}
                    aria-pressed={issue?.id === item.id}
                    onClick={() => setSelected(item.id)}
                  >
                    <span className="card-top">
                      <span>
                        {item.id} · {item.category}
                      </span>
                      <span className={`status ${item.status}`}>
                        {statusName[item.status]}
                      </span>
                    </span>
                    <strong>{item.description}</strong>
                    <span>
                      {teamFor(item).name} · {teamFor(item).location}
                    </span>
                    <span className="card-bottom">
                      <span>
                        {item.owner ? personas[item.owner].name : "Unassigned"}
                      </span>
                      <span>{duration(elapsed(item, now))}</span>
                    </span>
                  </button>
                ))}
              </div>
              {filtered.length === 0 && (
                <p className="empty">No issues in this view.</p>
              )}
            </section>
            {issue ? (
              <IssueDetail
                key={`${persona}-${issue.id}`}
                issue={issue}
                state={state}
                persona={persona}
                now={now}
                act={act}
              />
            ) : (
              <section className="panel empty">
                <h2>All clear here</h2>
                <p>Choose another status or submit an issue to get started.</p>
              </section>
            )}
          </div>
        </fieldset>
        <footer>
          Minsky / Local workflow demo{" "}
          <span>T0001 + T0002 · Built for exploration</span>
        </footer>
      </main>
    </>
  );
}

function IssueDetail({
  issue,
  state,
  persona,
  now,
  act,
}: {
  issue: Issue;
  state: State;
  persona: Persona;
  now: number;
  act: (action: Action) => boolean;
}) {
  const [awardChoice, setAwardChoice] = useState("");
  const [resolutionChoice, setResolutionChoice] = useState("");
  const award = state.awards.find((item) => item.issueId === issue.id);
  const delay = assignmentDelay(issue);
  return (
    <section className="panel detail" aria-label={`Issue details ${issue.id}`}>
      <div className="panel-heading">
        <p className="eyebrow">
          {issue.id} / {issue.category}
        </p>
        <span className={`status ${issue.status}`}>
          {statusName[issue.status]}
        </span>
      </div>
      <h2>{issue.description}</h2>
      <p className="location">
        {teamFor(issue).name} · {teamFor(issue).location}
      </p>
      <dl className="facts">
        <div>
          <dt>Current owner</dt>
          <dd>{issue.owner ? personas[issue.owner].name : "Unassigned"}</dd>
        </div>
        <div>
          <dt>
            {issue.status === "resolved"
              ? "Unresolved time · stopped"
              : "Unresolved time · running"}
          </dt>
          <dd>{duration(elapsed(issue, now))}</dd>
        </div>
        <div>
          <dt>First assignment</dt>
          <dd>{delay === undefined ? "Not yet assigned" : duration(delay)}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{date(issue.createdAt)}</dd>
        </div>
      </dl>
      {issue.status === "escalated" && (
        <p className="handoff">
          Handoff requested: Technical specialist. {personas[issue.owner!].name}{" "}
          remains responsible until acceptance.
        </p>
      )}
      <div className="actions">
        {canClaim(issue, personas[persona]) && (
          <button onClick={() => act({ type: "claim", issueId: issue.id })}>
            Claim issue
          </button>
        )}
        {canEscalate(issue, persona) && (
          <button onClick={() => act({ type: "escalate", issueId: issue.id })}>
            Escalate to specialist
          </button>
        )}
        {canAccept(issue, persona) && (
          <button onClick={() => act({ type: "accept", issueId: issue.id })}>
            Accept handoff
          </button>
        )}
      </div>
      {issue.status !== "resolved" && (
        <>
          <form
            className="section-form"
            onSubmit={(event) => {
              const form = event.currentTarget;
              const data = fields(event);
              if (
                act({
                  type: "message",
                  issueId: issue.id,
                  text: String(data.get("message")),
                  visibility:
                    data.get("visibility") === "internal"
                      ? "internal"
                      : "public",
                })
              )
                form.reset();
            }}
          >
            <h3>Conversation</h3>
            {persona !== "aurora" && (
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
              {persona === "aurora" ? "Reply to staff" : "Message"}
              <textarea name="message" required maxLength={2000} />
            </label>
            <button className="secondary" type="submit">
              Send message
            </button>
          </form>
          {canResolve(issue, persona) && (
            <form
              className="section-form"
              onSubmit={(event) => {
                const data = fields(event);
                if (
                  act({
                    type: "resolve",
                    issueId: issue.id,
                    summary:
                      resolutionChoice === "custom"
                        ? String(data.get("summary") ?? "")
                        : resolutionChoice,
                  })
                ) {
                  setResolutionChoice("");
                }
              }}
            >
              <h3>Resolve this issue</h3>
              <label>
                Resolution summary · visible to the team
                <select
                  value={resolutionChoice}
                  onChange={(event) => setResolutionChoice(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Choose a response
                  </option>
                  {resolutionChoices.map((summary) => (
                    <option key={summary}>{summary}</option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
              </label>
              {resolutionChoice === "custom" && (
                <label>
                  Custom resolution summary · visible to the team
                  <textarea name="summary" required maxLength={2000} />
                </label>
              )}
              <button type="submit">Resolve issue</button>
            </form>
          )}
        </>
      )}
      {issue.resolutions.map((resolution) => (
        <section className="resolution" key={resolution.id}>
          <h3>
            {resolution.reopened ? "Previous resolution" : "Resolution summary"}
          </h3>
          <p>{resolution.summary}</p>
          <small>
            Resolved by {personas[resolution.actor].name} ·{" "}
            {date(resolution.at)}
          </small>
          {resolution.reopened && (
            <p>
              Reopened by {personas[resolution.reopened.actor].name} ·{" "}
              {date(resolution.reopened.at)}: {resolution.reopened.reason}
            </p>
          )}
        </section>
      ))}
      {canReopen(issue, personas[persona]) && (
        <form
          className="section-form"
          onSubmit={(event) => {
            const data = fields(event);
            act({
              type: "reopen",
              issueId: issue.id,
              reason: String(data.get("reason")),
            });
          }}
        >
          <h3>Reopen this issue</h3>
          <p>
            The current owner stays responsible. Unresolved time resumes,
            excluding time spent resolved.
          </p>
          <label>
            Public reopening reason
            <textarea name="reason" required maxLength={2000} />
          </label>
          <button type="submit">Reopen issue</button>
        </form>
      )}
      {issue.status === "resolved" && !award && (
        <section className="section-form">
          <h3>Time award</h3>
          <p>
            No award recorded. Awards are discretionary and separate from
            elapsed time.
          </p>
          {canAward(issue, personas[persona]) && (
            <form
              onSubmit={(event) => {
                const data = fields(event);
                act({
                  type: "award",
                  issueId: issue.id,
                  minutes:
                    awardChoice === "custom"
                      ? Number(data.get("minutes") || NaN)
                      : Number(awardChoice || NaN),
                  explanation: String(data.get("explanation")),
                });
              }}
            >
              <label>
                Award minutes
                <select
                  value={awardChoice}
                  onChange={(event) => setAwardChoice(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Choose minutes
                  </option>
                  {[0, 5, 10, 15, 30, 60].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
              </label>
              {awardChoice === "custom" && (
                <label>
                  Custom award minutes
                  <input
                    name="minutes"
                    type="number"
                    min="0"
                    step="1"
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
          <p className="eyebrow">
            {award.id} · {issue.id}
          </p>
          <h3>{award.minutes} minutes awarded</h3>
          <p>{award.explanation}</p>
          {issue.resolutions.some(
            (resolution) =>
              resolution.id === award.resolutionId && resolution.reopened,
          ) && (
            <p>
              This award relates to an earlier resolution. Reopening preserves
              its decision and application status. This demo allows one award
              per issue.
            </p>
          )}
          <strong>
            {award.appliedAt === undefined
              ? "Pending external application"
              : "Applied externally · simulated confirmation"}
          </strong>
          <p className="muted">
            Recorded by {personas[award.actor].name} · {date(award.at)}
          </p>
          {award.appliedAt !== undefined && (
            <p className="muted">
              Confirmed by {personas[award.appliedBy!].name} ·{" "}
              {date(award.appliedAt)}
            </p>
          )}
          {persona !== "aurora" && award.appliedAt === undefined && (
            <form
              onSubmit={(event) => {
                fields(event);
                act({ type: "apply", issueId: issue.id });
              }}
            >
              <label className="checkbox">
                <input type="checkbox" required /> I confirm external
                application for this simulation.
              </label>
              <button type="submit">Confirm applied externally</button>
            </form>
          )}
          <p className="muted">
            This demo records a confirmation only. It does not change a contest
            clock.
          </p>
        </section>
      )}
      <section className="activity">
        <h3>
          {persona === "aurora" ? "Team activity" : "Local activity history"}
        </h3>
        <ol>
          {visibleHistory(issue, persona)
            .slice()
            .reverse()
            .map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>
                    {entry.actor === "aurora"
                      ? teamFor(issue).name
                      : personas[entry.actor].name}
                  </strong>
                  <time dateTime={new Date(entry.at).toISOString()}>
                    {date(entry.at)}
                  </time>
                </div>
                <p>{entry.text}</p>
                {entry.visibility === "internal" && (
                  <span className="internal-label">Staff only</span>
                )}
              </li>
            ))}
        </ol>
      </section>
    </section>
  );
}
