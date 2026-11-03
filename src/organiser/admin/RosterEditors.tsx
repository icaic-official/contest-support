import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Snapshot, Team } from "@/connected/model";
import { rosterTextMax } from "@/connected/roster";
import type { SessionAdmin } from "./useSessionAdmin";
import { categoriesError, categoryUsage, compareNames, moveItem } from "./rosterModel";

const fieldClass = "h-11 text-base md:text-sm";

/** Moves focus after React has drawn the next screen. */
function focusLater(id: string) {
  window.requestAnimationFrame(() => document.getElementById(id)?.focus());
}

/**
 * The teams of a contest with their locations. A contest admin changes a
 * location. The event admin adds, renames, and assigns teams in the event
 * console, so this list has no add, rename, or delete control.
 */
export function TeamLocationEditor({
  state,
  admin,
}: {
  state: Snapshot;
  admin: SessionAdmin;
}) {
  const teams = useMemo(
    () => [...state.teams].sort((a, b) => compareNames(a.name, b.name)),
    [state.teams],
  );
  if (!teams.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No teams are assigned to this contest. An event admin assigns them in the event console.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {teams.map((team) => (
        <LocationRow key={`${team.id}:${team.location}`} team={team} admin={admin} />
      ))}
    </ul>
  );
}

function LocationRow({ team, admin }: { team: Team; admin: SessionAdmin }) {
  const id = useId();
  const [location, setLocation] = useState(team.location);
  const locked = admin.busy || admin.archived;
  const changed = location.trim() !== team.location;
  return (
    <li className="p-3">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!locked && changed) void admin.setLocation(team.id, location.trim());
        }}
      >
        <Label htmlFor={id} className="block truncate font-medium">
          {team.name}
        </Label>
        <div className="flex gap-2">
          <Input
            id={id}
            value={location}
            maxLength={rosterTextMax}
            placeholder="Location"
            disabled={admin.archived}
            autoComplete="off"
            onChange={(event) => setLocation(event.target.value)}
            className={`${fieldClass} min-w-0 flex-1`}
          />
          <Button type="submit" variant="secondary" className="h-11" disabled={locked || !changed}>
            Save
          </Button>
        </div>
      </form>
    </li>
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
    const item = items[index];
    if (!item) return;
    const { key } = item;
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
          void admin.setCategories(names.map((name) => name.trim()));
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
