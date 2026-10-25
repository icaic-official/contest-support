import { useState } from "react";
import type { Issue } from "@/connected/model";
import {
  changedIssueIds,
  liveChangeIds,
  recentChanges,
} from "./organiserModel";

const noChanges: ReadonlyMap<string, number> = new Map();

/** The length of the highlight, from the `--motion-highlight` token. */
function highlightMs(): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    "--motion-highlight",
  );
  return Number.parseFloat(value) || 0;
}

/**
 * The ids of issues that a live update added or changed, while their
 * highlight runs. `issues` is the whole session list, not a filtered view, so
 * a change of filter or page never counts as an update. `scope` is the
 * session id. A new scope starts again from the current list. The first list
 * that a scope shows highlights nothing. `now` is the clock of the page, and
 * the set shrinks as it advances. A row that changes again during its
 * highlight does not start the highlight again.
 */
export function useChangedIssues(
  issues: readonly Issue[],
  scope: string | undefined,
  now: number,
): ReadonlySet<string> {
  const [windowMs] = useState(highlightMs);
  const [seen, setSeen] = useState({ scope, issues, changes: noChanges });
  if (seen.scope !== scope) {
    setSeen({ scope, issues, changes: noChanges });
  } else if (seen.issues !== issues) {
    setSeen({
      scope,
      issues,
      changes: recentChanges(
        seen.changes,
        changedIssueIds(seen.issues, issues),
        now,
        windowMs,
      ),
    });
  }
  return liveChangeIds(seen.changes, now, windowMs);
}
