import { useId, useState } from "react";
import { KeyRound, Pencil } from "lucide-react";
import type { EntrantKind, EventConsole } from "@/backend/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { rosterTextMax } from "@/connected/roster";
import { UsernameForm } from "@/organiser/admin/AccountForms";
import { PersonAvatar } from "@/organiser/components/issueDisplay";
import { ConfirmDialog } from "@/organiser/admin/AccountAccess";
import { entrantInputs, personInputs } from "./eventModel";
import { CommandError, LinesForm, Panel, fieldClass } from "./forms";
import type { EventConsoleState } from "./useEventConsole";

interface TabProps {
  data: EventConsole;
  state: EventConsoleState;
}

/**
 * The staff accounts of the event. Event admins and webmasters create people
 * from pasted lines, make event admins, change usernames, and issue passwords.
 * A new account has no password until the credential sheet issues one.
 */
export function PeopleTab({ data, state }: TabProps) {
  const locked = data.event.archived;
  const [renaming, setRenaming] = useState<EventConsole["people"][number]>();
  const [resetting, setResetting] = useState<EventConsole["people"][number]>();
  const admins = new Set(data.admins);
  return (
    <div className="space-y-5">
      {!renaming && <CommandError message={state.error} />}
      <Panel
        title="Add people"
        description="Staff and volunteers sign in with a username. Minsky shows each first password once."
      >
        <LinesForm
          label="People, one per line: name, username"
          help="Example: Sam Lee, sam-lee"
          submitLabel="Create people"
          disabled={locked}
          rules={{
            uniqueNames: false,
            takenNames: [],
            takenHandles: [
              ...data.people.map((person) => person.handle ?? ""),
              ...data.entrants.map((entrant) => entrant.handle ?? ""),
            ],
          }}
          onSubmit={async (lines) => {
            const receipt = await state.execute({
              type: "create_people",
              eventId: data.event.id,
              people: personInputs(lines),
            });
            if (!receipt) return false;
            void state.issue(receipt.accountIds ?? []);
            return true;
          }}
        />
      </Panel>
      <Panel title={`People · ${data.people.length}`}>
        {data.people.length === 0 ? (
          <p className="text-sm text-muted-foreground">No staff accounts yet.</p>
        ) : (
          <ul className="divide-y">
            {data.people.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <PersonAvatar name={person.name} personId={person.id} />
                <div className="min-w-0 flex-1 basis-36 leading-tight">
                  <p className="truncate text-sm font-medium">{person.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{person.handle ?? "No username"}</p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {!person.ready && <Badge variant="secondary">Needs a password</Badge>}
                  <AdminSwitch
                    name={person.name}
                    checked={admins.has(person.id)}
                    disabled={locked}
                    onChange={(admin) =>
                      void state.execute({
                        type: "set_event_admin",
                        eventId: data.event.id,
                        accountId: person.id,
                        admin,
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11"
                    disabled={locked}
                    aria-label={`Change username of ${person.name}`}
                    onClick={() => {
                      state.clearError();
                      setRenaming(person);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={locked}
                    onClick={() => (person.ready ? setResetting(person) : void state.issue([person.id]))}
                  >
                    <KeyRound aria-hidden="true" />
                    {person.ready ? "Reset password" : "Issue password"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(undefined)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="text-left">
            <DialogTitle>{renaming?.name}</DialogTitle>
            <DialogDescription>The password and open sessions stay.</DialogDescription>
          </DialogHeader>
          {renaming && (
            <UsernameForm
              key={renaming.handle}
              current={renaming.handle}
              disabled={locked}
              onSubmit={(handle) => {
                void state
                  .execute({ type: "set_handle", eventId: data.event.id, accountId: renaming.id, handle })
                  .then((receipt) => receipt && setRenaming(undefined));
              }}
            />
          )}
          <CommandError message={state.error} />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!resetting}
        onOpenChange={(open) => !open && setResetting(undefined)}
        title={`Reset the password of ${resetting?.name ?? "this person"}?`}
        description="The current password stops working, and every open session ends. The new password is shown once."
        confirmLabel="Reset password"
        onConfirm={() => {
          if (resetting) void state.issue([resetting.id]);
        }}
      />
    </div>
  );
}

function AdminSwitch({
  name,
  checked,
  disabled,
  onChange,
}: {
  name: string;
  checked: boolean;
  disabled: boolean;
  onChange: (admin: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex h-11 items-center gap-2">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-xs">
        <span className="sr-only">{name}: </span>Event admin
      </Label>
    </div>
  );
}

/**
 * The teams and single contestants of the event. Each has one sign-in. Pasted
 * lines import many at once, and a rename changes the name in every contest.
 */
export function EntrantsTab({ data, state }: TabProps) {
  const locked = data.event.archived;
  const [kind, setKind] = useState<EntrantKind>("team");
  const [renaming, setRenaming] = useState<EventConsole["entrants"][number]>();
  const [resetting, setResetting] = useState<EventConsole["entrants"][number]>();
  const [adding, setAdding] = useState<EventConsole["entrants"][number]>();
  const id = useId();
  return (
    <div className="space-y-5">
      {!renaming && !adding && <CommandError message={state.error} />}
      <Panel
        title="Import entrants"
        description="A team shares one sign-in. A single contestant has their own."
      >
        <LinesForm
          label="Entrants, one per line: name, username"
          help="Example: Team Aurora, team-aurora"
          submitLabel="Import entrants"
          disabled={locked}
          rules={{
            uniqueNames: true,
            takenNames: data.entrants.map((entrant) => entrant.name),
            takenHandles: [
              ...data.people.map((person) => person.handle ?? ""),
              ...data.entrants.map((entrant) => entrant.handle ?? ""),
            ],
          }}
          onSubmit={async (lines) => {
            const receipt = await state.execute({
              type: "create_entrants",
              eventId: data.event.id,
              entrants: entrantInputs(lines, kind),
            });
            if (!receipt) return false;
            void state.issue(receipt.accountIds ?? []);
            return true;
          }}
        >
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Kind</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["team", "Team"],
                  ["single", "Single contestant"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="flex h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
                >
                  <input
                    type="radio"
                    name={`${id}-kind`}
                    value={value}
                    checked={kind === value}
                    onChange={() => setKind(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </LinesForm>
      </Panel>
      <Panel title={`Entrants · ${data.entrants.length}`}>
        {data.entrants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entrants yet.</p>
        ) : (
          <ul className="divide-y">
            {data.entrants.map((entrant) => (
              <li key={entrant.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-36 leading-tight">
                  <p className="truncate text-sm font-medium">{entrant.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {entrant.handle ?? "No sign-in"}
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{entrant.kind === "team" ? "Team" : "Single"}</Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11"
                    disabled={locked}
                    aria-label={`Rename ${entrant.name}`}
                    onClick={() => {
                      state.clearError();
                      setRenaming(entrant);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  {entrant.accountId ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      disabled={locked}
                      aria-label={`Reset password for ${entrant.name}`}
                      onClick={() => setResetting(entrant)}
                    >
                      <KeyRound aria-hidden="true" />
                      Password
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      disabled={locked}
                      aria-label={`Add a sign-in for ${entrant.name}`}
                      onClick={() => {
                        state.clearError();
                        setAdding(entrant);
                      }}
                    >
                      <KeyRound aria-hidden="true" />
                      Add sign-in
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(undefined)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="text-left">
            <DialogTitle>Rename entrant</DialogTitle>
            <DialogDescription>The new name shows in every contest that seats this entrant.</DialogDescription>
          </DialogHeader>
          {renaming && (
            <RenameForm
              key={renaming.id}
              current={renaming.name}
              taken={data.entrants.filter((entrant) => entrant.id !== renaming.id).map((entrant) => entrant.name.toLowerCase())}
              disabled={locked}
              onSubmit={(name) =>
                void state
                  .execute({ type: "rename_entrant", eventId: data.event.id, entrantId: renaming.id, name })
                  .then((receipt) => receipt && setRenaming(undefined))
              }
            />
          )}
          <CommandError message={state.error} />
        </DialogContent>
      </Dialog>
      <Dialog open={!!adding} onOpenChange={(open) => !open && setAdding(undefined)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="text-left">
            <DialogTitle>Add a sign-in for {adding?.name}</DialogTitle>
            <DialogDescription>This entrant has no sign-in. Minsky shows the first password once.</DialogDescription>
          </DialogHeader>
          {adding && (
            <UsernameForm
              key={adding.id}
              current={null}
              disabled={locked}
              onSubmit={(handle) => {
                void state
                  .execute({ type: "add_entrant_sign_in", eventId: data.event.id, entrantId: adding.id, handle })
                  .then((receipt) => {
                    if (!receipt) return;
                    setAdding(undefined);
                    void state.issue(receipt.accountIds ?? []);
                  });
              }}
            />
          )}
          <CommandError message={state.error} />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!resetting}
        onOpenChange={(open) => !open && setResetting(undefined)}
        title={`Reset the password of ${resetting?.name ?? "this entrant"}?`}
        description="The current password stops working for everyone who shares it, and every open session ends. The new password is shown once."
        confirmLabel="Reset password"
        onConfirm={() => {
          if (resetting?.accountId) void state.issue([resetting.accountId]);
        }}
      />
    </div>
  );
}

function RenameForm({
  current,
  taken,
  disabled,
  onSubmit,
}: {
  current: string;
  taken: readonly string[];
  disabled: boolean;
  onSubmit: (name: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState(current);
  const trimmed = name.trim();
  const clash = taken.includes(trimmed.toLowerCase());
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed && !clash && trimmed !== current) onSubmit(trimmed);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={id}>Name</Label>
        <Input
          id={id}
          value={name}
          maxLength={rosterTextMax}
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => setName(event.target.value)}
          className={fieldClass}
        />
        {clash && <p className="text-xs text-destructive">Another entrant has this name.</p>}
      </div>
      <Button type="submit" className="h-11 w-full" disabled={disabled || !trimmed || clash || trimmed === current}>
        Save name
      </Button>
    </form>
  );
}
