import { useEffect, useState } from "react";
import { backend } from "@/backend";

type Landing = "unknown" | "site" | "event" | "none";

/**
 * Where a caller with no contest belongs. A webmaster has no event, so the
 * site read comes first and the event read is never sent for one. Otherwise
 * the console read answers for an event admin and refuses everyone else.
 */
export function useNoContestLanding(enabled: boolean): Landing {
  const [answer, setAnswer] = useState<Landing>("unknown");
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const settle = (next: Landing) => {
      if (current) setAnswer(next);
    };
    backend.manage
      .site()
      .catch(() => null)
      .then((site) => {
        if (site) return settle("site");
        return backend.manage.event().then(
          () => settle("event"),
          () => settle("none"),
        );
      });
    return () => {
      current = false;
    };
  }, [enabled]);
  return enabled ? answer : "unknown";
}
