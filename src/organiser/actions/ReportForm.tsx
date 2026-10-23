import { useId, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TeamSearch } from "@/connected/TeamSearch";
import type { CommandRunner } from "@/connected/hooks/useCommand";
import type { Snapshot } from "@/connected/model";
import {
  initialTeamSelection,
  submitTeamId,
  type TeamSelection,
} from "@/connected/teamSearch";
import { cn } from "@/lib/utils";

/**
 * Reports an issue for a team. Staff find the team with the T0008 fuzzy team
 * search. Staff can report while contestant intake is closed.
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
  const teamId = submitTeamId(selection);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!teamId) return;
        void command.act(
          { type: "submit", category, description, team_id: teamId },
          {
            onSuccess: () => {
              setDescription("");
              onSelection(initialTeamSelection());
              onDone();
            },
          },
        );
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
          command.locked || !teamId || !category || !description.trim()
        }
      >
        <Send aria-hidden="true" />
        Submit issue
      </Button>
    </form>
  );
}
