import { useState } from "react";
import { isStaff, type Snapshot } from "../model";
import {
  initialTeamSelection,
  keepTeamSelection,
  type TeamSelection,
} from "../teamSearch";

/**
 * Holds the team chosen with team search. A session change clears it. A new
 * snapshot keeps it only while the person is staff and the team still exists.
 */
export function useTeamSelection(
  sessionId: string,
  snapshot: Snapshot | undefined,
): [TeamSelection, (selection: TeamSelection) => void] {
  const [selection, setSelection] = useState(initialTeamSelection);
  const [checked, setChecked] = useState({ sessionId, snapshot });
  // Adjust state during render when the data changes, as React recommends,
  // so a stale team never reaches a submitted command.
  if (
    checked.sessionId !== sessionId ||
    (snapshot && checked.snapshot !== snapshot)
  ) {
    setChecked({ sessionId, snapshot });
    const member = snapshot?.membership;
    const next =
      checked.sessionId !== sessionId
        ? initialTeamSelection()
        : keepTeamSelection(
            selection,
            Boolean(member && !member.team_id && isStaff(member)),
            snapshot?.teams ?? [],
          );
    if (next !== selection) setSelection(next);
  }
  return [selection, setSelection];
}
