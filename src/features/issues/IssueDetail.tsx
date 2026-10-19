import { useState } from "react";
import { formData, text } from "../../connected/forms";
import {
  isStaff,
  isSupport,
  type Issue,
  type Membership,
  type Snapshot,
  unresolvedTime,
} from "../../connected/model";
import { clockDuration, Icon } from "../../connected/ui";
import { IssueImages } from "./IssueImages";
import type { IssueAction } from "./actions";
import { statusNames } from "./status";

const resolutions = [
  "Resolved without comment",
  "Service restored",
  "Device issue resolved",
  "Problem statement clarified",
];
const formatDate = (value: string) => new Date(value).toLocaleString();

export function IssueDetail({
  issue,
  state,
  member: m,
  now,
  act,
  onBack,
  refresh,
}: {
  issue: Issue;
  state: Snapshot;
  member: Membership;
  now: number;
  act: IssueAction;
  refresh: () => Promise<void>;
  onBack?: () => void;
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
        className={`quiet ${onBack ? "jury-back" : "back-to-queue"}`}
        onClick={
          onBack ??
          (() => document.getElementById("workspace-heading")?.focus())
        }
      >
        {onBack ? "Back to jury worklist" : "Back to queue"}
      </button>
      <fieldset className="detail-actions" disabled={state.event?.archived}>
        <legend className="sr-only">Issue actions</legend>
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
      </fieldset>
      {state.session && (
        <IssueImages
          sessionId={state.session.id}
          issueId={issue.id}
          archived={Boolean(state.event?.archived)}
          canUpload={staff && !state.event?.archived}
          staff={staff}
          userId={m.user_id}
          limits={{
            maxImageBytes: state.session.max_image_bytes,
            maxImages: state.session.max_images_per_issue,
            maxTotalBytes: state.session.max_image_bytes_per_issue,
          }}
          attachments={state.attachments.filter(
            (item) => item.issue_id === issue.id,
          )}
          pendingRemovals={state.pending_removals.filter(
            (item) => item.issue_id === issue.id,
          )}
          onChanged={refresh}
        />
      )}
      <fieldset className="detail-actions" disabled={state.event?.archived}>
        <legend className="sr-only">Issue conversation and resolution</legend>
        {active && activity}
        {active && (m.team_id || support || m.roles.includes("jury")) && (
          <form
            className="section-form reply-form"
            onSubmit={(event) => {
              const form = event.currentTarget;
              const data = formData(event);
              void act(
                {
                  type: "message",
                  ...base,
                  text: text(data, "message"),
                  visibility:
                    text(data, "visibility") === "internal"
                      ? "internal"
                      : "public",
                },
                {
                  onSuccess: () => {
                    form.reset();
                    setMessage("");
                  },
                },
              );
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
