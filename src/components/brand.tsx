import { cn } from "@/lib/utils";

/** The Minsky mark and name. */
export function BrandMark({
  className,
  wordClassName,
}: {
  className?: string;
  wordClassName?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 font-semibold",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"
      >
        M
      </span>
      <span className={wordClassName}>Minsky</span>
    </span>
  );
}
