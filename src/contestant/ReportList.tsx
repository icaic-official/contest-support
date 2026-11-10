import { relativeAge } from "@/connected/labels";
import { type Issue, type Resolution, unresolvedTime } from "@/connected/model";
import { clockDuration } from "@/connected/ui";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { Meta } from "@/components/meta";

/** The team's reports in the left column, newest first. */
export function ReportList({
  issues,
  resolutions,
  selectedId,
  now,
  onSelect,
}: {
  issues: readonly Issue[];
  resolutions: readonly Resolution[];
  selectedId: string | undefined;
  now: number;
  onSelect: (issueId: string) => void;
}) {
  if (!issues.length) {
    return (
      <p className="px-4 text-sm text-muted-foreground">
        Your team has not sent a report yet.
      </p>
    );
  }
  return (
    <nav aria-label="Reports" className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      <ul className="space-y-1">
        {issues.map((issue) => {
          const selected = issue.id === selectedId;
          return (
            <li key={issue.id}>
              <button
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() => onSelect(issue.id)}
                className={cn(
                  "w-full rounded-lg p-3 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected && "bg-accent",
                )}
              >
                <span className="flex items-center gap-2">
                  <StatusBadge status={issue.status} />
                  <span
                    className={cn(
                      "ml-auto font-mono text-xs tabular-nums",
                      issue.status === "resolved" && "text-muted-foreground",
                    )}
                  >
                    <span className="sr-only">Unresolved time </span>
                    {clockDuration(unresolvedTime(issue, resolutions, now))}
                  </span>
                </span>
                <span className="mt-2 line-clamp-2 block text-sm font-medium">
                  {issue.description}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  <Meta>
                    <span className="font-mono">ISS-{issue.number}</span>
                    <span>{issue.category}</span>
                    <span className="tabular-nums">{relativeAge(issue.created_at, now)}</span>
                  </Meta>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
