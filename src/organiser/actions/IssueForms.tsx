import { type ReactNode, useId, useState } from "react";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Eye,
  Lock,
  RotateCcw,
  Scale,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CommandRunner } from "@/connected/hooks/useCommand";
import { awardMinutePresets, resolutionPresets } from "@/connected/labels";
import type { Issue } from "@/connected/model";
import { cn } from "@/lib/utils";

/** Props that every issue form shares. */
interface IssueFormProps {
  issue: Issue;
  command: CommandRunner;
  /** Runs when the server records the command, for example to close a sheet. */
  onDone: () => void;
}

const fieldClass = "text-base md:text-sm";

/**
 * A radio input styled as a card. Native radios keep arrow-key movement
 * inside the group.
 */
export function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  disabled,
  children,
  className,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 text-[15px] has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="size-4 shrink-0 accent-current"
      />
      {children}
    </label>
  );
}

/** A reply draft. The shell keeps drafts so a closed sheet keeps its text. */
export interface ReplyDraft {
  text: string;
  visibility: "public" | "internal";
}

export const emptyReply: ReplyDraft = { text: "", visibility: "public" };

/**
 * Sends a reply to the team or an internal note for staff. Internal mode has
 * an amber striped surface. After a recorded reply the draft clears, also
 * after a retry of the same request (T0012).
 *
 * The phone sheets use the stacked layout. The desktop console uses the
 * composer layout: the message first, then the audience switch and Send in
 * one row. Ctrl+Enter or ⌘+Enter sends in both layouts.
 */
export function ReplyForm({
  issue,
  command,
  onDone,
  teamName,
  internalAllowed,
  draft,
  onDraft,
  layout = "stacked",
}: IssueFormProps & {
  teamName: string;
  internalAllowed: boolean;
  draft: ReplyDraft;
  onDraft: (draft: ReplyDraft) => void;
  layout?: "stacked" | "composer";
}) {
  const id = useId();
  const internal = internalAllowed && draft.visibility === "internal";
  const composer = layout === "composer";
  const audience = internalAllowed && (
    <fieldset className={cn(composer && "shrink-0")}>
      <legend className="sr-only">Audience</legend>
      <div
        className={cn(
          "grid grid-cols-2 gap-1 rounded-lg bg-muted p-1",
          composer && "gap-0.5",
        )}
      >
        {(
          [
            ["public", composer ? "Public reply" : "To the team", Eye],
            ["internal", composer ? "Internal note" : "Staff only", Lock],
          ] as const
        ).map(([value, label, Icon]) => (
          <label
            key={value}
            className={cn(
              "flex cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm font-medium has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
              composer ? "h-9 px-3" : "h-11",
              draft.visibility === value &&
                (value === "internal"
                  ? "bg-amber-500 text-white"
                  : "bg-background shadow-sm"),
            )}
          >
            <input
              type="radio"
              name={`${id}-audience`}
              value={value}
              checked={draft.visibility === value}
              disabled={command.locked}
              onChange={() => onDraft({ ...draft, visibility: value })}
              className="sr-only"
            />
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
  const hint = (
    <p
      id={`${id}-hint`}
      className={cn(
        "text-xs",
        internal ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
      )}
    >
      {internal
        ? "Internal note. The team never sees this."
        : `Public reply. ${teamName} sees this on their screen.`}
    </p>
  );
  const message = (
    <div className="space-y-1.5">
      <Label
        htmlFor={`${id}-message`}
        className={cn(composer && "sr-only")}
      >
        {internal ? "Internal note" : "Message"}
      </Label>
      <Textarea
        id={`${id}-message`}
        value={draft.text}
        onChange={(event) => onDraft({ ...draft, text: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        required
        maxLength={2000}
        readOnly={command.locked}
        aria-describedby={`${id}-hint`}
        placeholder={internal ? "Note for staff…" : `Message to ${teamName}…`}
        className={cn(
          composer ? "min-h-20 resize-none" : "min-h-28",
          fieldClass,
          internal && "internal-surface",
        )}
      />
    </div>
  );
  const send = (
    <Button
      type="submit"
      className={cn(composer ? "h-9" : "h-11 w-full")}
      disabled={command.locked || !draft.text.trim()}
    >
      {internal ? <Lock aria-hidden="true" /> : <Send aria-hidden="true" />}
      {internal
        ? composer
          ? "Add note"
          : "Add internal note"
        : composer
          ? "Send"
          : "Send to team"}
    </Button>
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (command.locked || !draft.text.trim()) return;
        void command.act(
          {
            type: "message",
            issue_id: issue.id,
            revision: issue.revision,
            text: draft.text,
            visibility: internal ? "internal" : "public",
          },
          {
            onSuccess: () => {
              onDraft(emptyReply);
              onDone();
            },
          },
        );
      }}
      className={cn(composer ? "space-y-2" : "space-y-3")}
    >
      {composer ? (
        <>
          {message}
          <div className="flex flex-wrap items-center gap-2">
            {audience}
            <div className="min-w-0 flex-1">{hint}</div>
            {send}
          </div>
        </>
      ) : (
        <>
          {audience}
          {hint}
          {message}
          {send}
        </>
      )}
    </form>
  );
}

/** Resolves an issue with a preset or a custom summary. The timer stops. */
export function ResolveForm({ issue, command, onDone }: IssueFormProps) {
  const id = useId();
  const [choice, setChoice] = useState("");
  const [custom, setCustom] = useState("");
  const summary = choice === "custom" ? custom.trim() : choice;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!summary) return;
        void command.act(
          {
            type: "resolve",
            issue_id: issue.id,
            revision: issue.revision,
            summary,
          },
          { onSuccess: onDone },
        );
      }}
    >
      <fieldset className="space-y-2" disabled={command.locked}>
        <legend className="pb-1 text-sm font-medium">
          Resolution summary · visible to the team
        </legend>
        {resolutionPresets.map((preset) => (
          <ChoiceCard
            key={preset}
            name={`${id}-summary`}
            value={preset}
            checked={choice === preset}
            onChange={setChoice}
          >
            {preset}
          </ChoiceCard>
        ))}
        <ChoiceCard
          name={`${id}-summary`}
          value="custom"
          checked={choice === "custom"}
          onChange={setChoice}
        >
          Write a custom summary
        </ChoiceCard>
      </fieldset>
      {choice === "custom" && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-custom`}>Custom resolution summary</Label>
          <Textarea
            id={`${id}-custom`}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            required
            maxLength={2000}
            autoFocus
            className={cn("min-h-20", fieldClass)}
          />
        </div>
      )}
      <Button
        type="submit"
        className="h-11 w-full"
        disabled={command.locked || !summary}
      >
        <Check aria-hidden="true" />
        Resolve issue
      </Button>
    </form>
  );
}

/**
 * Requests a specialist handoff. The owner stays responsible until a
 * specialist accepts.
 */
export function EscalateForm({ issue, command, onDone }: IssueFormProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Specialists get a handoff request. You stay the owner until one
        accepts. Add an internal note with Reply so they know what you tried.
      </p>
      <Button
        type="button"
        className="h-11 w-full"
        disabled={command.locked}
        onClick={() => {
          void command.act(
            { type: "escalate", issue_id: issue.id, revision: issue.revision },
            { onSuccess: onDone },
          );
        }}
      >
        <ArrowUpRight aria-hidden="true" />
        Escalate to specialist
      </Button>
    </div>
  );
}

/**
 * Reopens a resolved issue with a public reason. The previous owner stays
 * responsible, and the timer resumes without the resolved interval.
 */
export function ReopenForm({ issue, command, onDone }: IssueFormProps) {
  const id = useId();
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void command.act(
          {
            type: "reopen",
            issue_id: issue.id,
            revision: issue.revision,
            reason,
          },
          { onSuccess: onDone },
        );
      }}
    >
      <p className="text-sm text-muted-foreground">
        The previous owner stays responsible. Resolved intervals are excluded
        from unresolved time.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-reason`}>Public reopening reason</Label>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          maxLength={2000}
          readOnly={command.locked}
          className={cn("min-h-24", fieldClass)}
        />
      </div>
      <Button
        type="submit"
        className="h-11 w-full"
        disabled={command.locked || !reason.trim()}
      >
        <RotateCcw aria-hidden="true" />
        Reopen issue
      </Button>
    </form>
  );
}

/**
 * Records a time award in whole minutes with a public explanation. Staff
 * confirm separately when it is applied in the contest system.
 */
export function AwardForm({ issue, command, onDone }: IssueFormProps) {
  const id = useId();
  const [minutes, setMinutes] = useState<number | "custom">();
  const [custom, setCustom] = useState("");
  const [explanation, setExplanation] = useState("");
  const value =
    minutes === "custom"
      ? /^\d+$/u.test(custom)
        ? Number(custom)
        : undefined
      : minutes;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (value === undefined) return;
        void command.act(
          {
            type: "award",
            issue_id: issue.id,
            revision: issue.revision,
            minutes: value,
            explanation,
          },
          { onSuccess: onDone },
        );
      }}
    >
      <div className="py-2 text-center" aria-hidden="true">
        <span className="text-6xl font-bold tracking-tight tabular-nums">
          {value ?? "–"}
        </span>
        <span className="font-medium text-muted-foreground"> min</span>
      </div>
      <fieldset disabled={command.locked}>
        <legend className="pb-2 text-sm font-medium">Award minutes</legend>
        <div className="grid grid-cols-4 gap-1.5">
          {[...awardMinutePresets, "custom" as const].map((option) => (
            <label
              key={option}
              className={cn(
                "flex h-11 cursor-pointer items-center justify-center rounded-xl bg-muted text-sm font-semibold has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                minutes === option && "bg-primary text-primary-foreground",
                option === "custom" && "col-span-2",
              )}
            >
              <input
                type="radio"
                name={`${id}-minutes`}
                className="sr-only"
                checked={minutes === option}
                onChange={() => setMinutes(option)}
              />
              {option === "custom" ? "Other amount" : `${option} min`}
            </label>
          ))}
        </div>
      </fieldset>
      {minutes === "custom" && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-custom`}>Custom award minutes</Label>
          <Input
            id={`${id}-custom`}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            max={2147483647}
            required
            autoFocus
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            className={cn("h-11", fieldClass)}
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-explanation`}>Public award explanation</Label>
        <Textarea
          id={`${id}-explanation`}
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
          required
          maxLength={2000}
          readOnly={command.locked}
          className={cn("min-h-20", fieldClass)}
        />
      </div>
      <Button
        type="submit"
        className="h-11 w-full"
        disabled={command.locked || value === undefined || !explanation.trim()}
      >
        <Scale aria-hidden="true" />
        {value === undefined ? "Record award" : `Record ${value} minutes`}
      </Button>
    </form>
  );
}

/**
 * Confirms that staff applied an award in the external contest system. The
 * person must tick the confirmation first.
 */
export function ApplyForm({ issue, command, onDone }: IssueFormProps) {
  const id = useId();
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void command.act(
          { type: "apply", issue_id: issue.id, revision: issue.revision },
          { onSuccess: onDone },
        );
      }}
    >
      <label
        htmlFor={`${id}-confirm`}
        className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm"
      >
        <input
          id={`${id}-confirm`}
          type="checkbox"
          required
          checked={confirmed}
          disabled={command.locked}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-current"
        />
        I confirm this award was applied in the external contest system.
      </label>
      <p className="text-xs text-muted-foreground">
        Minsky records confirmation only. It does not change a contest clock.
      </p>
      <Button
        type="submit"
        className="h-11 w-full"
        disabled={command.locked || !confirmed}
      >
        <CheckCheck aria-hidden="true" />
        Confirm applied externally
      </Button>
    </form>
  );
}
