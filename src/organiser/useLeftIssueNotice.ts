import { useEffect, useRef, useState } from "react";
import type { Issue } from "@/connected/model";
import { issueThatLeft } from "./organiserModel";

/**
 * Closes the open issue when it leaves the issues that the person can open,
 * and returns a status message about it. `onLeft` runs once for that issue,
 * for example to move focus to the page heading. Opening another issue
 * clears the message.
 */
export function useLeftIssueNotice(
  selectedIssueId: string,
  selectIssue: (issueId: string) => void,
  opened: Issue | undefined,
  onLeft: () => void,
): string {
  const last = useRef<Issue | undefined>(undefined);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const left = issueThatLeft(selectedIssueId, last.current, opened);
    last.current = opened;
    if (opened) {
      setNotice("");
      return;
    }
    if (!left) return;
    selectIssue("");
    setNotice(`ISS-${left.number} is no longer in your lists.`);
    onLeft();
  }, [selectedIssueId, selectIssue, opened, onLeft]);
  return notice;
}
