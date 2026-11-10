import { Children, Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Small facts on one line, such as who did something and when. Spacing separates the facts, not a punctuation mark, so
 * a line that wraps never starts or ends with a stray separator. A hidden comma keeps the pause for screen readers.
 */
export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children);
  return (
    <span className={className}>
      {items.map((item, index) => (
        <Fragment key={index}>
          <span className={cn(index < items.length - 1 && "mr-3")}>{item}</span>
          {index < items.length - 1 && <span className="sr-only">, </span>}
        </Fragment>
      ))}
    </span>
  );
}

/** A figure in a heading, as a quiet pill. `unit` is the word that a screen reader adds, such as "entries". */
export function Count({ children, unit, className }: { children: ReactNode; unit?: string; className?: string }) {
  return (
    <span
      className={cn(
        "ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] leading-5 font-medium text-muted-foreground tabular-nums",
        className,
      )}
    >
      {children}
      {unit && <span className="sr-only"> {unit}</span>}
    </span>
  );
}

/** A figure with its label, such as "3 active". The figure stands out, and the label stays quiet. */
export function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span>
      <span className="font-semibold text-foreground tabular-nums">{value}</span> {label}
    </span>
  );
}
