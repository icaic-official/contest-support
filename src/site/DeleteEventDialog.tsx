import { type FormEvent, useId, useState } from "react";
import type { SiteOverview } from "@/backend/contracts";
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

type SiteEvent = SiteOverview["events"][number];

function count(amount: number, one: string, many: string): string {
  return `${amount} ${amount === 1 ? one : many}`;
}

/**
 * Names what a deletion takes, and asks for the event's exact name. Only the
 * typed name enables the action, and the server checks that name again.
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
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto" onCloseAutoFocus={onCloseAutoFocus}>
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
  const matches = typed === event.name;
  function submit(form: FormEvent<HTMLFormElement>) {
    form.preventDefault();
    if (matches && !busy) onDelete(typed);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader className="text-left">
        <DialogTitle>Delete {event.name}?</DialogTitle>
        <DialogDescription>
          This deletes {count(event.contests, "contest", "contests")} and {count(event.accounts, "account", "accounts")}{" "}
          for good. Every issue, reply, note, award, image, and announcement of this event goes with them. You cannot undo this.
        </DialogDescription>
      </DialogHeader>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor={inputId}>Type the event name to confirm</Label>
        <Input id={inputId} value={typed} autoComplete="off" onChange={(input) => setTyped(input.target.value)} className="h-11" />
        <p className="text-xs break-words text-muted-foreground">The name is: {event.name}</p>
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="h-11" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" className="h-11" disabled={!matches || busy}>
          Delete event
        </Button>
      </DialogFooter>
    </form>
  );
}
