import { Clock } from "lucide-react";
import { clockText } from "./contestClock";
import type { ContestClock as Clock_ } from "./model";

/**
 * The contest clock for a contestant: when reporting opens or closes, with a
 * countdown. D1 derives every time. This component only displays them.
 * `now` is server time in milliseconds.
 */
export function ContestClock({ clock, now }: { clock: Clock_ | null | undefined; now: number }) {
  if (!clock?.schedule) return null;
  const text = clockText(clock, now);
  return (
    <section
      aria-label="Contest clock"
      data-testid="contest-clock"
      className="mb-3 rounded-lg border bg-card p-3 text-sm"
    >
      <p className="flex items-start gap-2 font-medium tabular-nums">
        <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>{text.headline}</span>
      </p>
      {text.details.map((line) => (
        <p key={line} className="mt-1 text-xs text-muted-foreground">
          {line}
        </p>
      ))}
    </section>
  );
}
