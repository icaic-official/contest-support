import { useEffect, useId, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { backend } from "@/backend";
import type { ContestSummary } from "@/backend/contracts";
import { errorMessage } from "@/backend/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeSchedule } from "@/event/scheduleForm";
import { calendarWindow, groupCalendar } from "./calendarModel";
import { intakeHeadline } from "./intakeText";
import { formatInZone, viewerNote } from "./zonedTime";

/** The contests of the person's own events for seven days, grouped by event and day in the event's zone. */
export function Calendar({
  onOpen,
  currentId,
  refreshKey = 0,
}: {
  /** The contest that is open now. It shows "Current" in place of its button. */
  currentId?: string | undefined;
  /** Opens a contest that the person holds a seat in. Omit it to list without links. */
  onOpen?: ((contest: ContestSummary) => void) | undefined;
  /** Reads the calendar again when it changes. */
  refreshKey?: number;
}) {
  const id = useId();
  const [page, setPage] = useState(0);
  const [contests, setContests] = useState<ContestSummary[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    backend.workflows
      .contests({ window: calendarWindow(page, Date.now()) })
      .then((list) => {
        if (!current) return;
        setContests(list);
        setError("");
      })
      .catch((cause: unknown) => {
        if (current) setError(errorMessage(cause));
      });
    return () => {
      current = false;
    };
  }, [page, refreshKey]);
  const events = contests ? groupCalendar(contests) : [];
  const range = calendarWindow(page, Date.now());
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="text-sm font-medium">
          Calendar
          <span className="ml-2 font-normal text-muted-foreground">
            {new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(Date.parse(range.from))} to{" "}
            {new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(Date.parse(range.to) - 1)}
          </span>
        </h3>
        <div className="flex gap-1" role="group" aria-label="Calendar weeks">
          <Button type="button" variant="outline" size="icon" className="size-11" aria-label="Previous week"
            disabled={page <= -4} onClick={() => setPage(page - 1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" className="h-11" disabled={page === 0} onClick={() => setPage(0)}>
            Today
          </Button>
          <Button type="button" variant="outline" size="icon" className="size-11" aria-label="Next week"
            disabled={page >= 8} onClick={() => setPage(page + 1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : !contests ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scheduled contests in these seven days.</p>
      ) : (
        events.map((event) => (
          <div key={event.eventId} className="space-y-2">
            <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {event.eventName} · {event.timeZone}
            </h4>
            {event.days.map((day) => (
              <div key={day.date} className="rounded-lg border">
                <h5 className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">
                  {formatInZone(day.instant, event.timeZone, "date")}
                </h5>
                <ul className="divide-y">
                  {day.contests.map((contest) => (
                    <li key={contest.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                      <div className="min-w-0 flex-1 basis-44">
                        <p className="truncate text-sm font-medium">{contest.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {describeSchedule(contest.schedule, contest.timeZone)}
                        </p>
                        {viewerNote(contest.schedule.startsAt, contest.timeZone, "datetime") && (
                          <p className="text-xs text-muted-foreground">
                            {viewerNote(contest.schedule.startsAt, contest.timeZone, "datetime")}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline">{intakeHeadline(contest.intake.reason)}</Badge>
                      {contest.id === currentId ? (
                        <Badge variant="secondary">Current</Badge>
                      ) : contest.canOpen ? (
                        onOpen && (
                          <Button type="button" variant="outline" className="h-11"
                            aria-label={`Open ${contest.name}`} onClick={() => onOpen(contest)}>
                            Open
                          </Button>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">You have no seat here</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  );
}
