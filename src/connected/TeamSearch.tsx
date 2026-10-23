import { useEffect } from "react";
import { cn } from "@/lib/utils";
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
      className={cn(
        "grid gap-1.5 text-sm font-medium",
        variant === "inline" && "team-search-field",
      )}
      htmlFor={id}
    >
      {label}
      <div className="team-search relative font-normal">
        <div className="team-search-control flex items-center gap-2">
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
            className="h-11 w-full min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            onChange={(event) =>
              onSelection(editTeamQuery(selection, event.target.value, id))
            }
            onFocus={() => {
              const next = focusTeamQuery(selection, id);
              // Clear refocuses before React commits; do not replay unchanged state.
              if (next !== selection) onSelection(next);
            }}
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
              className="quiet team-search-clear inline-flex h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
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
          <p
            id={chosenId}
            className="team-search-chosen mt-1 text-xs text-muted-foreground"
          >
            {selected.location} ·{" "}
            {unresolvedLabel(unresolvedCount(issues, selected.id))}
          </p>
        )}
        {/*
          The list stays mounted and is hidden when it closes. If blur
          removed it, a Radix dialog or sheet would see the removal while
          focus moves and pull focus back to the dialog, so Tab would not
          reach the next control.
        */}
        <div
          className="team-suggestions absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          id={listId}
          role="listbox"
          hidden={!listOpen}
        >
          {result.suggestions.map((team, index) => (
            <button
              key={team.id}
              id={`${id}-option-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelection(chooseTeam(team.id))}
              className="flex min-h-11 w-full flex-col items-start justify-center rounded-sm px-2 py-1.5 text-left text-sm aria-selected:bg-accent aria-selected:text-accent-foreground hover:bg-accent"
            >
              <strong>{team.name}</strong>
              <span className="text-xs text-muted-foreground">
                {team.location} · {unresolvedLabel(team.unresolved)}
              </span>
            </button>
          ))}
          {result.suggestions.length === 0 && (
            <p className="team-search-note px-2 py-1.5 text-xs text-muted-foreground" role="status">
              No matching teams.
            </p>
          )}
          {result.overflow && (
            <p className="team-search-note px-2 py-1.5 text-xs text-muted-foreground" role="status">
              Keep typing to narrow the list.
            </p>
          )}
        </div>
      </div>
    </label>
  );
}
