import { type ReactNode, useEffect, useMemo, useState } from "react";
import { type Issue, type Snapshot, unresolvedTime } from "./model";
import { type JuryRow, type JurySection, juryWorklists } from "./jury";
import { clockDuration } from "./ui";

const sections: Array<{ id: JurySection; title: string; description: string }> =
  [
    {
      id: "decision",
      title: "Needs decision",
      description:
        "Resolved issues without an award decision. Oldest resolution first.",
    },
    {
      id: "application",
      title: "Pending external application",
      description:
        "Recorded decisions awaiting confirmation. Oldest decision first.",
    },
  ];
const statusNames = {
  open: "Open",
  claimed: "In progress",
  escalated: "Awaiting specialist",
  resolved: "Resolved",
};

/** Presents the jury's outstanding work using the existing issue detail actions. */
export function JuryWorklist({
  state,
  now,
  renderDetail,
}: {
  state: Snapshot;
  now: number;
  renderDetail: (issue: Issue, back: () => void) => ReactNode;
}) {
  const lists = useMemo(() => juryWorklists(state), [state]);
  const [selection, setSelection] = useState<{
    id: string;
    number: number;
    section: JurySection;
  }>();
  const [notice, setNotice] = useState("");
  const selected = selection
    ? [...lists.decision, ...lists.application].find(
        (row) => row.issue.id === selection.id,
      )
    : undefined;

  function returnFocus(id: string, section: JurySection) {
    window.requestAnimationFrame(() => {
      const target =
        document
          .getElementById(`jury-${section}`)
          ?.querySelector<HTMLButtonElement>(`#jury-issue-${id}`) ??
        document.getElementById(`jury-${section}-heading`);
      target?.focus();
    });
  }

  useEffect(() => {
    if (!selection || selected) return;
    setSelection(undefined);
    setNotice(
      `ISS-${selection.number} is no longer in the worklist. Its current status has been refreshed.`,
    );
    returnFocus(selection.id, selection.section);
  }, [selection, selected]);

  if (selection && selected) {
    return (
      <div className="jury-detail">
        {renderDetail(selected.issue, () => {
          setSelection(undefined);
          returnFocus(selection.id, selection.section);
        })}
      </div>
    );
  }

  return (
    <div className="jury-worklist">
      <p role="status" className="notice">
        {notice}
      </p>
      {sections.map((section) => (
        <section
          key={section.id}
          id={`jury-${section.id}`}
          className="jury-section"
          aria-labelledby={`jury-${section.id}-heading`}
        >
          <div className="jury-section-heading">
            <h2 id={`jury-${section.id}-heading`} tabIndex={-1}>
              {section.title}{" "}
              <span className="jury-count">{lists[section.id].length}</span>
            </h2>
            <p>{section.description}</p>
          </div>
          {lists[section.id].length ? (
            <ol className="jury-rows">
              {lists[section.id].map((row) => (
                <li key={row.issue.id}>
                  <JuryItem
                    row={row}
                    now={now}
                    open={() => {
                      setNotice("");
                      setSelection({
                        id: row.issue.id,
                        number: row.issue.number,
                        section: section.id,
                      });
                      window.requestAnimationFrame(() =>
                        document.getElementById("issue-heading")?.focus(),
                      );
                    }}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <p className="jury-empty">
              {section.id === "decision"
                ? "No resolved issues need a decision."
                : "No awards are awaiting external application."}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function JuryItem({
  row,
  now,
  open,
}: {
  row: JuryRow;
  now: number;
  open: () => void;
}) {
  const { issue, team, resolution, award } = row;
  return (
    <article className="jury-row" aria-label={`Issue ISS-${issue.number}`}>
      <div className="jury-identity">
        <strong className="jury-reference">ISS-{issue.number}</strong>
        <span className={`status ${issue.status}`}>
          {statusNames[issue.status]}
        </span>
        {award && issue.status !== "resolved" && (
          <span className="jury-warning">Reopened</span>
        )}
        <strong>{team?.name ?? "Team unavailable"}</strong>
        <span className="muted">{team?.location}</span>
        <span className="category-name">{issue.category}</span>
      </div>
      <div className="jury-evidence">
        <span className="context-label">
          {award ? "Award resolution" : "Current resolution"}
        </span>
        <p className="jury-preview">
          {resolution?.summary ?? "Resolution unavailable"}
        </p>
        {resolution && (
          <p className="jury-attribution">
            Resolved by {resolution.actor_name} ·{" "}
            <time dateTime={resolution.at}>
              {new Date(resolution.at).toLocaleString()}
            </time>
          </p>
        )}
        {resolution?.reopened_at && (
          <p className="jury-warning">
            This award relates to an earlier resolution.
          </p>
        )}
      </div>
      <div className="jury-decision">
        {award && (
          <>
            <strong>{award.minutes} minutes awarded</strong>
            <p className="jury-preview">{award.explanation}</p>
            <p className="jury-attribution">
              Recorded by {award.actor_name} ·{" "}
              <time dateTime={award.at}>
                {new Date(award.at).toLocaleString()}
              </time>
            </p>
          </>
        )}
        <dl>
          <dt>Unresolved time</dt>
          <dd>{clockDuration(unresolvedTime(issue, row.resolutions, now))}</dd>
        </dl>
      </div>
      <button
        id={`jury-issue-${issue.id}`}
        className="quiet jury-open"
        aria-label={`View issue ISS-${issue.number}`}
        onClick={open}
      >
        View issue
      </button>
    </article>
  );
}
