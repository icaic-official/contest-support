import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Snapshot, Team } from "@/connected/model";
import { normalizeTeamText } from "@/connected/teamSearch";
import { ConfirmDialog } from "./AccountAccess";
import type { SessionAdmin } from "./useSessionAdmin";
import { rosterKey } from "@/connected/roster";
import {
  addTeamsCommand,
  categoriesError,
  categoryUsage,
  compareNames,
  moveItem,
  parseTeamLines,
  setCategoriesCommand,
  teamEditError,
  teamKeptReason,
  teamLinesError,
  teamUsage,
} from "./rosterModel";

const fieldClass = "h-11 text-base md:text-sm";

/** Moves focus after React has drawn the next screen. */
function focusLater(id: string) {
  window.requestAnimationFrame(() => document.getElementById(id)?.focus());
}

/**
 * Teams of the session. An admin pastes or types one team per line to add
 * many at once, edits a team in its row, and deletes a team that has no
 * issue and no account. Every control works with the keyboard. The box keeps
 * the lines until the server records them, so a failed request loses nothing.
 */
export function TeamRosterEditor({
  state,
  admin,
  titled = true,
}: {
  state: Snapshot;
  admin: SessionAdmin;
  /** False when a heading above the editor already shows the team count. */
  titled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string>();
  const [deleting, setDeleting] = useState<Team>();
  // One ID for each typed name until the request is recorded.
  const ids = useRef(new Map<string, string>());
  const locked = admin.busy || admin.archived;
  const teams = useMemo(
    () => [...state.teams].sort((a, b) => compareNames(a.name, b.name)),
    [state.teams],
  );
  const usage = useMemo(
    () => teamUsage(state.issues, state.members),
    [state.issues, state.members],
  );
  const lines = useMemo(
    () => parseTeamLines(text, state.teams),
    [text, state.teams],
  );
  const problem = teamLinesError(lines);
  // After a lost answer the server may hold the lines already. When a refresh
  // shows every line as a team with the ID that this box sent, the add is done.
  const settled =
    lines.length > 0 &&
    lines.every((line) => {
      const sent = ids.current.get(rosterKey(line.name));
      return sent !== undefined && state.teams.some((team) => team.id === sent);
    });
  useEffect(() => {
    if (!settled) return;
    ids.current.clear();
    setText("");
  }, [settled]);
  const needle = normalizeTeamText(query);
  const shown = needle
    ? teams.filter((team) =>
        normalizeTeamText(`${team.name} ${team.location}`).includes(needle),
      )
    : teams;

  async function add() {
    if (locked || !lines.length || problem) return;
    if (await admin.editRoster(addTeamsCommand(lines, ids.current))) {
      setText("");
      ids.current.clear();
      focusLater(`${id}-lines`);
    }
  }

  return (
    <div className="space-y-6">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <Label htmlFor={`${id}-lines`}>Add teams</Label>
        <Textarea
          id={`${id}-lines`}
          value={text}
          disabled={admin.archived}
          rows={4}
          spellCheck={false}
          autoComplete="off"
          placeholder={"Aurora, Hall A desk 12\nCedar, Hall B desk 4"}
          aria-describedby={`${id}-lines-help ${id}-lines-state`}
          aria-invalid={Boolean(problem)}
          className="min-h-28 font-mono"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void add();
            }
          }}
        />
        <p id={`${id}-lines-help`} className="text-xs text-muted-foreground">
          One team on each line. Write the name, then a comma or a tab, then
          the table or location. You can paste lines from a spreadsheet. Press
          Ctrl+Enter or ⌘+Enter to add.
        </p>
        <div
          id={`${id}-lines-state`}
          role="status"
          className="space-y-1 text-sm empty:hidden"
        >
          {lines.length > 0 && (
            <p className={problem ? "text-destructive" : "text-muted-foreground"}>
              {problem ??
                `${lines.length} ${lines.length === 1 ? "team is" : "teams are"} ready to add.`}
            </p>
          )}
          {lines
            .filter((line) => line.problem)
            .slice(0, 5)
            .map((line) => (
              <p key={line.line} className="text-xs text-destructive">
                Line {line.line}, {line.name || "no name"}: {line.problem}
              </p>
            ))}
        </div>
        <Button
          type="submit"
          className="h-11"
          disabled={locked || !lines.length || Boolean(problem)}
        >
          <Plus aria-hidden="true" />
          {lines.length > 1 ? `Add ${lines.length} teams` : "Add team"}
        </Button>
      </form>
      <section
        aria-labelledby={titled ? `${id}-list` : undefined}
        aria-label={titled ? undefined : "Teams"}
        className="space-y-3"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          {titled && (
            <h3 id={`${id}-list`} className="text-sm font-semibold">
              Teams · {teams.length}
            </h3>
          )}
          <div className="relative w-full sm:max-w-xs">
            <label htmlFor={`${id}-filter`} className="sr-only">
              Filter teams
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={`${id}-filter`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or location"
              className={`${fieldClass} pl-9`}
            />
          </div>
        </div>
        {shown.length ? (
          <ul className="divide-y rounded-xl border bg-card">
            {shown.map((team) => (
              <li key={team.id} className="p-3 sm:px-4">
                {editing === team.id ? (
                  <TeamEditForm
                    team={team}
                    teams={state.teams}
                    locked={locked}
                    onSave={async (name, location) => {
                      const done = await admin.editRoster({
                        type: "update_team",
                        teamId: team.id,
                        name: name.trim(),
                        location: location.trim(),
                      });
                      if (done) {
                        setEditing(undefined);
                        focusLater(`team-edit-${team.id}`);
                      }
                    }}
                    onCancel={() => {
                      setEditing(undefined);
                      focusLater(`team-edit-${team.id}`);
                    }}
                  />
                ) : (
                  <TeamRow
                    team={team}
                    reason={teamKeptReason(usage.get(team.id))}
                    locked={locked}
                    onEdit={() => setEditing(team.id)}
                    onDelete={() => setDeleting(team)}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
            {teams.length ? "No matching teams." : "No teams yet. Add the first ones above."}
          </p>
        )}
      </section>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title={`Delete ${deleting?.name ?? "team"}?`}
        description="This removes the team from the roster. You can add it again."
        confirmLabel="Delete team"
        onConfirm={() => {
          if (!deleting) return;
          void admin
            .editRoster({ type: "delete_team", teamId: deleting.id })
            .then(() => focusLater(`${id}-filter`));
        }}
      />
    </div>
  );
}

function TeamRow({
  team,
  reason,
  locked,
  onEdit,
  onDelete,
}: {
  team: Team;
  reason: string | undefined;
  locked: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const reasonId = `team-${team.id}-reason`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1 basis-48">
        <div className="truncate font-medium">{team.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {team.location || "No location"}
        </div>
        {reason && (
          <div id={reasonId} className="text-xs text-muted-foreground">
            In use: {reason}. This team stays.
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          id={`team-edit-${team.id}`}
          type="button"
          variant="outline"
          className="h-11"
          disabled={locked}
          aria-label={`Edit ${team.name}`}
          onClick={onEdit}
        >
          <Pencil aria-hidden="true" />
          Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={locked || Boolean(reason)}
          aria-label={`Delete ${team.name}`}
          aria-describedby={reason ? reasonId : undefined}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      </div>
    </div>
  );
}

function TeamEditForm({
  team,
  teams,
  locked,
  onSave,
  onCancel,
}: {
  team: Team;
  teams: readonly Team[];
  locked: boolean;
  onSave: (name: string, location: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(team.name);
  const [location, setLocation] = useState(team.location);
  const error = teamEditError(name, location, team.id, teams);
  const changed = name.trim() !== team.name || location.trim() !== team.location;
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!locked && !error && changed) onSave(name, location);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-name`}>Team name</Label>
        <Input
          id={`${id}-name`}
          autoFocus
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={fieldClass}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-location`}>Location</Label>
        <Input
          id={`${id}-location`}
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          className={fieldClass}
        />
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" className="h-11" disabled={locked || Boolean(error) || !changed}>
          Save
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

interface CategoryItem {
  key: number;
  name: string;
  /** The saved name. A category that an issue uses keeps it. */
  original?: string;
}

/**
 * The categories that contestants choose from. A category that an issue uses
 * is fixed: it cannot be renamed or removed, because the issue keeps its name.
 * The admin edits a draft and saves the whole ordered list once.
 */
export function CategoryEditor({
  state,
  admin,
}: {
  state: Snapshot;
  admin: SessionAdmin;
}) {
  const saved = state.session?.categories ?? [];
  // The form starts again when the saved list changes.
  return (
    <CategoryForm
      key={JSON.stringify(saved)}
      saved={saved}
      issues={state.issues}
      admin={admin}
    />
  );
}

function CategoryForm({
  saved,
  issues,
  admin,
}: {
  saved: readonly string[];
  issues: Snapshot["issues"];
  admin: SessionAdmin;
}) {
  const id = useId();
  const next = useRef(saved.length);
  const [items, setItems] = useState<CategoryItem[]>(() =>
    saved.map((name, key) => ({ key, name, original: name })),
  );
  const [fresh, setFresh] = useState("");
  const usage = useMemo(() => categoryUsage(issues), [issues]);
  const locked = admin.busy || admin.archived;
  const names = items.map((item) => item.name);
  const error = categoriesError(names);
  const changed = names.join("\n") !== saved.join("\n");

  function add() {
    const name = fresh.trim();
    if (!name) return;
    setItems((current) => [...current, { key: next.current++, name }]);
    setFresh("");
    focusLater(`${id}-new`);
  }

  function move(index: number, to: number) {
    const key = items[index].key;
    setItems(moveItem(items, index, to));
    // A button at the edge of the list is disabled, so focus its partner.
    const up = to < index;
    const atEdge = up ? to === 0 : to === items.length - 1;
    focusLater(`${id}-${key}-${up !== atEdge ? "up" : "down"}`);
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!locked && !error && changed) {
          void admin.editRoster(setCategoriesCommand(names));
        }
      }}
    >
      <ul className="divide-y rounded-xl border bg-card">
        {items.map((item, index) => {
          const used = item.original ? usage.get(item.original) : undefined;
          const fieldId = `${id}-${item.key}`;
          return (
            <li key={item.key} className="space-y-1 p-3">
              <div className="flex items-center gap-2">
                <Label htmlFor={fieldId} className="sr-only">
                  Category {index + 1}
                </Label>
                <Input
                  id={fieldId}
                  value={item.name}
                  readOnly={Boolean(used)}
                  disabled={admin.archived}
                  aria-describedby={used ? `${fieldId}-used` : undefined}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((entry) =>
                        entry.key === item.key
                          ? { ...entry, name: event.target.value }
                          : entry,
                      ),
                    )
                  }
                  className={`${fieldClass} min-w-0 flex-1`}
                />
                <Button
                  id={`${fieldId}-up`}
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11"
                  disabled={locked || index === 0}
                  aria-label={`Move ${item.name || "category"} up`}
                  onClick={() => move(index, index - 1)}
                >
                  <ChevronUp aria-hidden="true" />
                </Button>
                <Button
                  id={`${fieldId}-down`}
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11"
                  disabled={locked || index === items.length - 1}
                  aria-label={`Move ${item.name || "category"} down`}
                  onClick={() => move(index, index + 1)}
                >
                  <ChevronDown aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11"
                  disabled={locked || Boolean(used)}
                  aria-label={`Remove ${item.name || "category"}`}
                  aria-describedby={used ? `${fieldId}-used` : undefined}
                  onClick={() => {
                    setItems((current) =>
                      current.filter((entry) => entry.key !== item.key),
                    );
                    focusLater(`${id}-new`);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              {used ? (
                <p id={`${fieldId}-used`} className="text-xs text-muted-foreground">
                  In use: {used} {used === 1 ? "issue" : "issues"}. This
                  category stays and keeps its name.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Label htmlFor={`${id}-new`} className="sr-only">
          New category
        </Label>
        <Input
          id={`${id}-new`}
          value={fresh}
          disabled={admin.archived}
          placeholder="New category"
          autoComplete="off"
          onChange={(event) => setFresh(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          className={`${fieldClass} min-w-0 flex-1`}
        />
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={locked || !fresh.trim()}
          onClick={add}
        >
          <Plus aria-hidden="true" />
          Add
        </Button>
      </div>
      {error && changed && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        variant="secondary"
        className="h-11 w-full sm:w-auto"
        disabled={locked || Boolean(error) || !changed}
      >
        Save categories
      </Button>
    </form>
  );
}
