import { useId } from "react";
import type { SiteOverview } from "@/backend/contracts";
import { Button } from "@/components/ui/button";

/**
 * The contests that a webmaster must join before reading their issues and
 * notes, while the site restricts webmaster reads. Each row has Join.
 */
export function JoinContests({
  contests,
  busy,
  onJoin,
}: {
  contests: SiteOverview["contestsToJoin"];
  busy: boolean;
  onJoin: (contestId: string) => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-xl border bg-card">
      <h2 id={id} className="border-b px-4 py-3 text-sm font-semibold">
        Contests to join
      </h2>
      <div className="space-y-3 p-4">
        <p className="text-sm text-muted-foreground">
          Join this contest to read its issues and notes. The contest's admins
          see your join in their audit.
        </p>
        {contests.length === 0 ? (
          <p className="text-sm">You joined every contest.</p>
        ) : (
          <ul className="divide-y">
            {contests.map((contest) => (
              <li key={contest.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-sm font-medium">{contest.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {contest.eventName}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  aria-label={`Join ${contest.name}`}
                  onClick={() => onJoin(contest.id)}
                >
                  Join
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
