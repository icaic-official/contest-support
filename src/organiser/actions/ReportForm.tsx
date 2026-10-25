import { useId, useState } from "react";
import { Plus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TeamSearch } from "@/connected/TeamSearch";
import type { CommandRunner } from "@/connected/hooks/useCommand";
import { isRunning, type Snapshot } from "@/connected/model";
import {
  initialTeamSelection,
  submitTeamId,
  type TeamSelection,
} from "@/connected/teamSearch";
import { cn } from "@/lib/utils";

/**
 * Reports an issue for one or more teams. Staff find each team with the T0008
 * fuzzy team search. Staff can report while contestant intake is closed.
 * Each team gets its own issue, with its own timer, owner and award. The form
 * sends one command per team, so a failure leaves only the unsent teams.
 */
export function ReportForm({
  state,
  command,
  selection,
  onSelection,
  onDone,
}: {
  state: Snapshot;
  command: CommandRunner;
  selection: TeamSelection;
  onSelection: (selection: TeamSelection) => void;
  onDone: () => void;
}) {
  const id = useId();
  const categories = state.session?.categories ?? [];
  const [category, setCategory] = useState(categories[0] ?? "");
  const [description, setDescription] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const teamId = submitTeamId(selection);
  const targets =
    teamId && !added.includes(teamId) ? [...added, teamId] : added;
  const teamName = (id: string) =>
    state.teams.find((team) => team.id === id)?.name ?? id;

  async function submit() {
    for (const [index, target] of targets.entries()) {
      const last = index === targets.length - 1;
      const recorded = await command.act(
        { type: "submit", category, description, team_id: target },
        {
          stayOnPage: !last,
          onSuccess: () => {
            if (target === teamId) onSelection(initialTeamSelection());
            setAdded((current) => current.filter((id) => id !== target));
          },
        },
      );
      if (!recorded) return;
    }
    setDescription("");
    onDone();
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (targets.length > 0) void submit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        {state.session?.intake_open
          ? "Contestant intake is open."
          : "Contestant intake is closed. Staff can still submit for a team."}
      </p>
      <TeamSearch
        id="report-team-search"
        label="Affected team"
        teams={state.teams}
        issues={state.issues}
        selection={selection}
        onSelection={onSelection}
        variant="field"
      />
      {targets.length > 0 && (
        <ul aria-label="Teams to report" className="flex flex-wrap gap-2">
          {targets.map((target) => (
            <li
              key={target}
              className="flex h-9 items-center gap-1 rounded-full border pl-3 text-sm"
            >
              {teamName(target)}
              <button
                type="button"
                aria-label={`Remove ${teamName(target)}`}
                disabled={command.locked}
                className="flex size-9 items-center justify-center rounded-full"
                onClick={() => {
                  if (target === teamId) onSelection(initialTeamSelection());
                  setAdded((current) => current.filter((id) => id !== target));
                }}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full"
        disabled={command.locked || !teamId || added.includes(teamId)}
        onClick={() => {
          if (!teamId) return;
          setAdded((current) => [...current, teamId]);
          onSelection(initialTeamSelection());
        }}
      >
        <Plus aria-hidden="true" />
        Add another team
      </Button>
      <fieldset disabled={command.locked}>
        <legend className="pb-2 text-sm font-medium">Category</legend>
        <div className="flex flex-wrap gap-2">
          {categories.map((item) => (
            <label
              key={item}
              className={cn(
                "flex h-11 cursor-pointer items-center rounded-full border px-4 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                category === item &&
                  "border-primary bg-primary text-primary-foreground",
              )}
            >
              <input
                type="radio"
                name={`${id}-category`}
                value={item}
                checked={category === item}
                onChange={() => setCategory(item)}
                className="sr-only"
              />
              {item}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-description`}>What’s happening?</Label>
        <Textarea
          id={`${id}-description`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
          maxLength={2000}
          readOnly={command.locked}
          className="min-h-24 text-base md:text-sm"
        />
      </div>
      <Button
        type="submit"
        className="h-11 w-full"
        disabled={
          command.locked ||
          targets.length === 0 ||
          !category ||
          !description.trim()
        }
        loading={isRunning(command.running, "submit")}
      >
        <Send aria-hidden="true" />
        {targets.length > 1
          ? `Submit ${targets.length} issues`
          : "Submit issue"}
      </Button>
    </form>
  );
}
