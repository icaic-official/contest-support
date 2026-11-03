import { type ReactNode, useState } from "react";
import { ChevronDown, ChevronRight, KeyRound, UserMinus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/connected/labels";
import type { Snapshot } from "@/connected/model";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "../components/issueDisplay";
import { MembershipForm, UsernameForm } from "./AccountForms";
import {
  type SessionMember,
  accountKind,
  actorName,
  auditEntryText,
} from "./adminModel";
import type { SessionAdmin } from "./useSessionAdmin";

/** The error (role=alert) and the notice (role=status) of admin requests. */
export function AdminFeedback({
  error,
  notice,
  className,
}: {
  error: string;
  notice: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            <p role="alert">{error}</p>
          </AlertDescription>
        </Alert>
      )}
      <p role="status" className="text-xs text-muted-foreground empty:hidden">
        {notice}
      </p>
    </div>
  );
}

/** A confirmation step before a change that the admin cannot undo. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The accounts of the session. Each row opens the actions of the account. */
export function AccountList({
  members,
  teams,
  onOpen,
}: {
  members: readonly SessionMember[];
  teams: Snapshot["teams"];
  onOpen: (userId: string) => void;
}) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {members.map(({ membership, person }) => {
        const kind = accountKind(membership, teams);
        return (
          <li key={person.id}>
            <button
              id={`account-${person.id}`}
              type="button"
              onClick={() => onOpen(person.id)}
              className="flex min-h-14 w-full items-center gap-3 p-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <PersonAvatar
                name={person.name}
                personId={person.id}
                className="size-9"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{person.name}</span>
                <span
                  className={cn(
                    "block truncate text-xs text-muted-foreground",
                    person.username && "font-mono",
                  )}
                >
                  {person.username ?? "Username not assigned"}
                </span>
              </span>
              <span className="flex max-w-[45%] flex-wrap justify-end gap-1">
                {kind.team ? (
                  <Badge variant="outline" className="max-w-full truncate">
                    {kind.team}
                  </Badge>
                ) : kind.labels.length ? (
                  kind.labels.map((label) => (
                    <Badge
                      key={label}
                      variant={label === "Admin" ? "default" : "outline"}
                    >
                      {label}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">No roles</span>
                )}
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The actions for one account: the username, the membership, a
 * password reset and the removal of session access. A reset and a removal
 * need confirmation. An admin cannot reset their own password here.
 */
export function MemberActions({
  member,
  teams,
  selfId,
  admin,
  onDone,
}: {
  member: SessionMember;
  teams: Snapshot["teams"];
  selfId: string | undefined;
  admin: SessionAdmin;
  /** Runs after a recorded change that has no credentials to show. */
  onDone: () => void;
}) {
  const [confirm, setConfirm] = useState<"reset" | "revoke">();
  const { person, membership } = member;
  const disabled = admin.busy || admin.archived;
  return (
    <div className="space-y-5">
      <UsernameForm
        key={person.username}
        current={person.username}
        disabled={disabled}
        onSubmit={(username) => {
          void admin.setUsername(person.id, username).then((done) => {
            if (done) onDone();
          });
        }}
      />
      <MembershipForm
        key={JSON.stringify(membership)}
        member={membership}
        teams={teams}
        disabled={disabled}
        onSave={(draft) =>
          admin.saveMembership(person.id, draft).then((done) => {
            if (done) onDone();
          })
        }
      />
      <div className="space-y-2 border-t pt-4">
        {person.id !== selfId && (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            disabled={disabled}
            onClick={() => setConfirm("reset")}
          >
            <KeyRound aria-hidden="true" />
            Reset password
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full text-destructive"
          disabled={disabled}
          onClick={() => setConfirm("revoke")}
        >
          <UserMinus aria-hidden="true" />
          Revoke session access
        </Button>
      </div>
      <ConfirmDialog
        open={confirm === "reset"}
        onOpenChange={(open) => !open && setConfirm(undefined)}
        title={`Reset ${person.name}'s password?`}
        description="Verify their identity first. Existing sessions will lose access. You receive a new temporary password to share."
        confirmLabel="Reset password"
        onConfirm={() => {
          void admin.resetPassword(person.id);
        }}
      />
      <ConfirmDialog
        open={confirm === "revoke"}
        onOpenChange={(open) => !open && setConfirm(undefined)}
        title={`Revoke ${person.name}'s access to this session?`}
        description="The account can no longer open this session."
        confirmLabel="Revoke access"
        onConfirm={() => {
          void admin.revokeAccess(person.id).then((done) => {
            if (done) onDone();
          });
        }}
      />
    </div>
  );
}

/** A section that opens and closes, with a 44 px heading button. */
export function Collapsible({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-xl border bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-[15px] font-medium focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span className="flex-1">{title}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t p-4">{children}</div>
    </details>
  );
}

/** The latest administration actions with the person they changed, the actor and the time. */
export function AdminActivity({ state }: { state: Snapshot }) {
  if (!state.audit.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No administration activity yet.
      </p>
    );
  }
  return (
    <ul className="space-y-2 text-sm">
      {state.audit.map((entry) => (
        <li key={entry.id}>
          <span className="block font-medium first-letter:uppercase">
            {auditEntryText(state.members, entry)}
          </span>
          <span className="block text-xs text-muted-foreground">
            {actorName(state.members, entry)} · {formatDate(entry.at)}
          </span>
        </li>
      ))}
    </ul>
  );
}
