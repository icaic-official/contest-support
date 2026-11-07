import type { EventDeletion } from "@/backend/contracts";
import { Badge } from "@/components/ui/badge";
import { useNow } from "@/connected/hooks/useNow";
import { formatInZone, viewerZone } from "@/connected/zonedTime";

function when(instant: string): string {
  return formatInZone(instant, viewerZone(), "datetime");
}

/** One deletion's progress, in plain words. */
export function deletionProgress(deletion: EventDeletion, now: number): { label: string; detail: string } {
  if (deletion.finishedAt) {
    return { label: "Deleted", detail: `Finished ${when(deletion.finishedAt)}.` };
  }
  if (deletion.blockedBy) {
    const { name, handle } = deletion.blockedBy;
    return {
      label: "Stopped",
      detail: `The account ${name}${handle ? ` (${handle})` : ""} also has activity in another event. Deleting it would change that event, so Minsky keeps it. Minsky tries again every hour and continues when the other event no longer names this account.`,
    };
  }
  switch (deletion.step) {
    case "rows":
      return { label: "Deleting contests and accounts", detail: `Contests and accounts left: ${deletion.remaining}.` };
    case "live":
      return { label: "Closing live updates", detail: `Contests left: ${deletion.remaining}.` };
    case "files":
      if (deletion.filesDueAt && Date.parse(deletion.filesDueAt) > now) {
        return {
          label: "Waiting for the final file check",
          detail: `The contests and accounts are gone. An upload in progress can still finish, so the final file check runs after ${when(deletion.filesDueAt)}.`,
        };
      }
      return { label: "Removing files", detail: `File folders left: ${deletion.remaining}.` };
    case "done":
      return { label: "Deleted", detail: "" };
  }
}

/** The open deletions and the latest finished ones. */
export function Deletions({ deletions }: { deletions: readonly EventDeletion[] }) {
  const now = useNow();
  return (
    <ul className="divide-y">
      {deletions.map((deletion) => {
        const { label, detail } = deletionProgress(deletion, now);
        return (
          <li key={deletion.eventId} className="space-y-1 py-2.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="min-w-0 text-sm font-medium break-words">{deletion.eventName || "Unnamed event"}</p>
              <Badge variant={deletion.blockedBy ? "destructive" : "secondary"}>{label}</Badge>
            </div>
            <p className="text-xs break-words text-muted-foreground">
              <span className="font-mono">{deletion.eventCode}</span> · Requested by {deletion.requestedByName}, {when(deletion.requestedAt)}.
            </p>
            {detail && <p className="text-sm break-words text-muted-foreground">{detail}</p>}
          </li>
        );
      })}
    </ul>
  );
}
