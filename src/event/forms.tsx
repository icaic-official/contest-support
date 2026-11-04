import { type ReactNode, useId, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type LineRules, type PersonLine, linesError, parsePersonLines } from "./eventModel";

export const fieldClass = "h-11 text-base md:text-sm";

/** A card with a heading for one task of a tab. */
export function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("rounded-xl border bg-card p-4 sm:p-5", className)}>
      <h2 id={id} className="text-sm font-semibold">
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** After a removal, moves focus to the same place in the list, or to the page heading when the list is empty. */
export function focusAfterRemoval(button: HTMLElement) {
  const list = button.closest("ul");
  const buttons = list ? Array.from(list.querySelectorAll<HTMLElement>("button[data-removes]")) : [];
  const index = buttons.indexOf(button);
  requestAnimationFrame(() => {
    const left = list?.isConnected ? Array.from(list.querySelectorAll<HTMLElement>("button[data-removes]")) : [];
    (left[index] ?? left.at(-1) ?? document.querySelector<HTMLElement>("h1[tabindex]"))?.focus();
  });
}

/** The error of the last command. `Alert` already announces it. */
export function CommandError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>
        <p>{message}</p>
      </AlertDescription>
    </Alert>
  );
}

/**
 * A box of pasted "name, username" lines with a live check of every line. The
 * box keeps its text until the command succeeds, so a failed request loses
 * nothing. `onSubmit` resolves to "done" when the server recorded the lines, "refused" when it answered with a refusal, and "unknown" when no answer came.
 */
export function LinesForm({
  label,
  help,
  submitLabel,
  rules,
  disabled,
  onSubmit,
  children,
}: {
  label: string;
  help: string;
  submitLabel: string;
  rules: LineRules;
  disabled: boolean;
  onSubmit: (lines: PersonLine[]) => Promise<"done" | "refused" | "unknown">;
  children?: ReactNode;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [lost, setLost] = useState("");
  const lines = parsePersonLines(text, rules);
  // The answer to these lines was lost, and the next read shows that the server recorded them.
  if (lost && lost === text && lines.length > 0 && lines.every((line) => rules.takenHandles.includes(line.handle))) {
    setText("");
    setLost("");
  }
  const problem = linesError(lines);
  const flagged = lines.filter((line) => line.problem);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || problem) return;
        // The submit button goes disabled when the box empties, so focus waits in the box for the next lines.
        document.getElementById(id)?.focus();
        const sent = text;
        void onSubmit(lines).then((outcome) => {
          if (outcome === "done") setText("");
          // A refusal changed nothing, so the typed lines stay and nothing is waiting for a later read.
          setLost(outcome === "unknown" ? sent : "");
        });
      }}
    >
      {children}
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Textarea
          id={id}
          value={text}
          rows={5}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          aria-describedby={`${id}-help`}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          className="font-mono text-base md:text-sm"
        />
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      </div>
      {flagged.length > 0 && (
        <ul aria-label="Lines with a problem" className="space-y-1 text-xs text-destructive">
          {flagged.slice(0, 5).map((line) => (
            <li key={line.line}>
              Line {line.line}: {line.problem}
            </li>
          ))}
          {flagged.length > 5 && <li>{flagged.length - 5} more lines have a problem.</li>}
        </ul>
      )}
      <Button
        type="submit"
        variant="secondary"
        className="h-11 w-full sm:w-auto"
        disabled={disabled || Boolean(problem)}
      >
        {submitLabel}
        {lines.length > 0 && !problem ? ` (${lines.length})` : ""}
      </Button>
    </form>
  );
}
