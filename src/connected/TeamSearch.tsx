import { useEffect } from "react";
import {
  chooseHighlightedTeam,
  chooseTeam,
  clearTeamSelection,
  closeTeamList,
  editTeamQuery,
  focusTeamQuery,
  moveTeamHighlight,
  searchTeams,
  type SearchIssue,
  type SearchTeam,
  type TeamSelection,
  unresolvedCount,
  unresolvedLabel,
} from "./teamSearch";

export function TeamSearch({
  id,
  label,
  teams,
  issues,
  selection,
  onSelection,
  variant,
}: {
  id: string;
  label: string;
  teams: readonly SearchTeam[];
  issues: readonly SearchIssue[];
  selection: TeamSelection;
  onSelection: (selection: TeamSelection) => void;
  variant: "inline" | "field";
}) {
  const result = searchTeams(teams, issues, selection.query);
  const selected = teams.find((team) => team.id === selection.teamId);
  const value =
    selection.teamId && selection.query === ""
      ? (selected?.name ?? "")
      : selection.query;
  const activeIndex =
    selection.activeIndex >= 0 &&
    selection.activeIndex < result.suggestions.length
      ? selection.activeIndex
      : -1;
  const listOpen = selection.open && selection.activeControl === id;
  const listId = `${id}-list`;
  const chosenId = `${id}-chosen`;
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({
      block: "nearest",
    });
  }, [activeIndex, id]);
  return (
    <label
      className={variant === "inline" ? "team-search-field" : undefined}
      htmlFor={id}
    >
      {label}
      <div className="team-search">
        <div className="team-search-control">
          <input
            id={id}
            role="combobox"
            type="text"
            value={value}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-autocomplete="list"
            aria-expanded={listOpen}
            aria-controls={listOpen ? listId : undefined}
            aria-activedescendant={
              listOpen && activeIndex >= 0
                ? `${id}-option-${activeIndex}`
                : undefined
            }
            aria-describedby={
              selected && selection.query === "" ? chosenId : undefined
            }
            placeholder="Name, location, or table"
            onChange={(event) =>
              onSelection(editTeamQuery(selection, event.target.value, id))
            }
            onFocus={() => onSelection(focusTeamQuery(selection, id))}
            onKeyDown={(event) => {
              if (
                (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                result.suggestions.length > 0
              ) {
                event.preventDefault();
                onSelection(
                  moveTeamHighlight(
                    { ...selection, activeControl: id },
                    event.key === "ArrowDown" ? 1 : -1,
                    result.suggestions.length,
                  ),
                );
              } else if (event.key === "Enter" && selection.open) {
                const next = chooseHighlightedTeam(
                  { ...selection, activeIndex },
                  result.suggestions.map((team) => team.id),
                );
                if (next.teamId && next.teamId !== selection.teamId) {
                  event.preventDefault();
                  onSelection(next);
                }
              } else if (event.key === "Escape") {
                event.preventDefault();
                onSelection(closeTeamList(selection));
              }
            }}
            onBlur={() => onSelection(closeTeamList(selection))}
          />
          {selection.teamId && (
            <button
              type="button"
              className="quiet team-search-clear"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelection(clearTeamSelection());
                document.getElementById(id)?.focus();
              }}
            >
              Clear team
            </button>
          )}
        </div>
        {selected && selection.query === "" && (
          <p id={chosenId} className="team-search-chosen">
            {selected.location} ·{" "}
            {unresolvedLabel(unresolvedCount(issues, selected.id))}
          </p>
        )}
        {listOpen && (
          <div className="team-suggestions" id={listId} role="listbox">
            {result.suggestions.map((team, index) => (
              <button
                key={team.id}
                id={`${id}-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelection(chooseTeam(team.id))}
              >
                <strong>{team.name}</strong>
                <span>
                  {team.location} · {unresolvedLabel(team.unresolved)}
                </span>
              </button>
            ))}
            {result.suggestions.length === 0 && (
              <p className="team-search-note" role="status">
                No matching teams.
              </p>
            )}
            {result.overflow && (
              <p className="team-search-note" role="status">
                Keep typing to narrow the list.
              </p>
            )}
          </div>
        )}
      </div>
    </label>
  );
}
