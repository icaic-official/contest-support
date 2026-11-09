import { type FormEvent, useId, useState } from "react";
import { Link } from "react-router";
import { deletionConfirmation, type SiteOverview } from "@/backend/contracts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ReturningDialogContent as DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { eventPath } from "@/connected/navigation";

type SiteEvent = SiteOverview["events"][number];

function count(amount: number, one: string, many: string): string {
  return `${amount} ${amount === 1 ? one : many}`;
}

/**
 * Names what a deletion takes, and asks for the event's exact name, or for its
 * code when it has no name. Only that text enables the action, and the server
 * checks it again. The dialog stays open while its request runs.
 */
export function DeleteEventDialog({
  event,
  busy,
  error,
  onOpenChange,
  onCloseAutoFocus,
  onDelete,
}: {
  /** The event to delete. Undefined keeps the dialog closed. */
  event: SiteEvent | undefined;
  busy: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
  onDelete: (confirmName: string) => void;
}) {
  return (
    <Dialog open={!!event} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        {event && (
          <DeleteEventForm
            key={event.id}
            event={event}
            busy={busy}
            error={error}
            onCancel={() => onOpenChange(false)}
            onDelete={onDelete}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteEventForm({
  event,
  busy,
  error,
  onCancel,
  onDelete,
}: {
  event: SiteEvent;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onDelete: (confirmName: string) => void;
}) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const { label, text } = deletionConfirmation(event);
  const matches = typed === text;
  function submit(form: FormEvent<HTMLFormElement>) {
    form.preventDefault();
    if (matches && !busy) onDelete(typed);
  }
  return (
    <form onSubmit={submit} className="min-w-0 space-y-4">
      <DialogHeader className="text-left">
        <DialogTitle className="pr-6 leading-snug break-words whitespace-pre-wrap">
          Delete {label === "name" ? text : `the unnamed event ${text}`}?
        </DialogTitle>
        <DialogDescription>
          This deletes {count(event.contests, "contest", "contests")} and {count(event.accounts, "account", "accounts")}{" "}
          for good. Every issue, reply, note, award, image, and announcement of this event goes with them. Everyone in this
          event is signed out at once, and a running contest stops. The event&apos;s name and code stay in the site record.
          You cannot undo this.
        </DialogDescription>
      </DialogHeader>
      <p className="text-sm">
        Download the archive of each contest from{" "}
        <Link to={eventPath(event.id)} className="font-medium underline underline-offset-4">
          the event console
        </Link>{" "}
        first.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor={inputId}>Type the event {label} to confirm</Label>
        <Input
          id={inputId}
          value={typed}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(input) => setTyped(input.target.value)}
          className="h-11"
        />
        <p className="text-xs break-words whitespace-pre-wrap text-muted-foreground">The {label} is: {text}</p>
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" className="h-11" disabled={!matches || busy}>
          Delete event
        </Button>
      </DialogFooter>
    </form>
  );
}
