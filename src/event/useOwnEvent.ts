import { useEffect, useState } from "react";
import { backend } from "@/backend";

/**
 * Whether the caller has an event console of their own. It asks only while
 * `enabled`, which a caller with no contest sets. The console read answers
 * for an event admin, and refuses everyone else.
 */
export function useOwnEvent(enabled: boolean): "unknown" | "yes" | "no" {
  const [answer, setAnswer] = useState<"unknown" | "yes" | "no">("unknown");
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    backend.manage.event().then(
      () => current && setAnswer("yes"),
      () => current && setAnswer("no"),
    );
    return () => {
      current = false;
    };
  }, [enabled]);
  return enabled ? answer : "unknown";
}
