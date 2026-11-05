import { CirclePause, Send, Tag } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { contestantHeadingId } from "./contestantView";

/** The report form fields. The shell keeps them while the person navigates. */
export interface ReportDraft {
  /** The chosen category, or "" for the first category. */
  category: string;
  description: string;
}

const maxDescription = 2000;

/** The "Report an issue" page with category tiles and a description. */
export function ReportForm({
  categories,
  teamName,
  location,
  blocker,
  locked,
  sending,
  draft,
  onDraft,
  onCancel,
  onSubmit,
}: {
  categories: readonly string[];
  teamName: string | undefined;
  location: string | undefined;
  /** Why the team cannot report now, or undefined when it can. */
  blocker: string | undefined;
  locked: boolean;
  /** True while this form's report is on its way to the server. */
  sending: boolean;
  draft: ReportDraft;
  onDraft: (draft: ReportDraft) => void;
  onCancel: () => void;
  onSubmit: (draft: ReportDraft) => void;
}) {
  const id = useId();
  const category = categories.includes(draft.category)
    ? draft.category
    : (categories[0] ?? "");
  const place = [teamName, location].filter(Boolean).join(" · ");
  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-8">
      <h1
        id={contestantHeadingId}
        tabIndex={-1}
        className="text-xl font-semibold tracking-tight outline-none lg:text-2xl"
      >
        Report an issue
      </h1>
      <p className="mt-1 text-muted-foreground">
        {place ? (
          <>
            A helper will come to{" "}
            <strong className="font-semibold text-foreground">{place}</strong>.
          </>
        ) : (
          "A helper will come to your table."
        )}{" "}
        Your unresolved time starts when you send this report.
      </p>
      {blocker && (
        <div
          role="alert"
          className="mt-4 flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
        >
          <CirclePause
            className="size-5 shrink-0 text-status-escalated"
            aria-hidden="true"
          />
          <p>
            <strong>{blocker}</strong> Raise your hand if you need help now.
          </p>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (blocker || locked || !draft.description.trim()) return;
          onSubmit({ category, description: draft.description });
        }}
      >
        <fieldset
          disabled={Boolean(blocker) || locked}
          className="mt-6 disabled:opacity-60"
        >
          <legend className="text-sm font-medium">
            What kind of problem?
          </legend>
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-3">
            {categories.map((name) => (
              <label
                key={name}
                className={cn(
                  "min-h-11 min-w-0 cursor-pointer rounded-xl border p-3 transition-colors hover:bg-accent/50 lg:p-4",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  "has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary",
                  "has-[:disabled]:cursor-not-allowed",
                )}
              >
                <input
                  type="radio"
                  name="category"
                  value={name}
                  className="sr-only"
                  checked={name === category}
                  onChange={() => onDraft({ ...draft, category: name })}
                />
                <Tag className="size-5 text-muted-foreground" aria-hidden="true" />
                <span className="mt-2 block font-medium break-words">{name}</span>
              </label>
            ))}
          </div>
          <div className="mt-6 grid gap-2">
            <Label htmlFor={`${id}-description`}>What is happening?</Label>
            <Textarea
              id={`${id}-description`}
              name="description"
              required
              maxLength={maxDescription}
              className="min-h-32"
              aria-describedby={`${id}-description-help`}
              placeholder="For example: the keyboard stopped working after the IDE froze. The mouse still works."
              value={draft.description}
              onChange={(event) =>
                onDraft({ ...draft, description: event.target.value })
              }
            />
            <p
              id={`${id}-description-help`}
              className="flex flex-wrap justify-between gap-x-4 text-xs text-muted-foreground"
            >
              <span>
                Staff can see your report and reply here. Do not include
                solution code.
              </span>
              <span className="tabular-nums">
                {draft.description.length} / {maxDescription}
              </span>
            </p>
          </div>
        </fieldset>
        <div className="sticky bottom-0 -mx-4 mt-4 grid grid-cols-2 gap-2 border-t bg-background px-4 py-3 lg:static lg:mx-0 lg:flex lg:justify-end lg:border-0 lg:px-0 lg:py-0">
          <Button
            type="button"
            variant="outline"
            className="h-11 lg:h-9"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="h-11 lg:h-9"
            disabled={Boolean(blocker) || locked || !draft.description.trim()}
            loading={sending}
          >
            <Send aria-hidden="true" />
            Send report
          </Button>
        </div>
      </form>
    </div>
  );
}
