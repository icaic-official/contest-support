import { useId, useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import type { ContestType, EventConsole } from "@/backend/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  ReturningDialogContent as DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rosterTextMax, teamsPerCommandMax } from "@/connected/roster";
import { staffRoles } from "@/organiser/admin/adminModel";
import { acceptsKind, contestTypeLabels, seatedEntrants } from "./eventModel";
import { CommandError, Panel, fieldClass, focusAfterRemoval } from "./forms";
import type { EventConsoleState } from "./useEventConsole";

interface TabProps {
  data: EventConsole;
  state: EventConsoleState;
}

const selectClass =
  "h-11 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm dark:bg-input/30";

const contestTypes: readonly ContestType[] = ["teams", "singles", "mixed"];

/** The default categories of a new contest. A contest admin changes them. */
const defaultCategories = ["General"];

function TypeSelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: ContestType;
  disabled: boolean;
  onChange: (type: ContestType) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as ContestType)}
      className={selectClass}
    >
      {contestTypes.map((type) => (
        <option key={type} value={type}>
          {contestTypeLabels[type]}
        </option>
      ))}
    </select>
  );
}

/** The contests of the event. A contest takes teams, single contestants, or both. */
export function ContestsTab({ data, state }: TabProps) {
  const locked = data.event.archived;
  const id = useId();
  const [name, setName] = useState("");
  const [type, setType] = useState<ContestType>("teams");
  const [editing, setEditing] = useState<EventConsole["contests"][number]>();
  const trimmed = name.trim();
  return (
    <div className="space-y-5">
      {!editing && <CommandError message={state.error} />}
      <Panel title="Create a contest" description="A contest admin sets its intake, limits, and categories afterwards.">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            if (locked || !trimmed) return;
            void state
              .execute({
                type: "create_contest",
                eventId: data.event.id,
                name: trimmed,
                contestType: type,
                categories: defaultCategories,
              })
              .then((receipt) => receipt && setName(""));
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-name`}>Contest name</Label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={rosterTextMax}
              autoComplete="off"
              disabled={locked}
              onChange={(event) => setName(event.target.value)}
              className={fieldClass}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-type`}>Contest type</Label>
            <TypeSelect id={`${id}-type`} value={type} disabled={locked} onChange={setType} />
          </div>
          <Button type="submit" variant="secondary" className="h-11" disabled={locked || !trimmed}>
            Create contest
          </Button>
        </form>
      </Panel>
      <Panel title={`Contests · ${data.contests.length}`}>
        {data.contests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contests yet.</p>
        ) : (
          <ul className="divide-y">
            {data.contests.map((contest) => (
              <li key={contest.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-36 leading-tight">
                  <p className="truncate text-sm font-medium">{contest.name}</p>
                  <p className="text-xs text-muted-foreground">{contestTypeLabels[contest.contestType]}</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Badge variant="outline">{contest.intakeOpen ? "Intake open" : "Intake closed"}</Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11"
                    disabled={locked}
                    aria-label={`Edit ${contest.name}`}
                    onClick={() => {
                      state.clearError();
                      setEditing(contest);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(undefined)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="text-left">
            <DialogTitle>Edit contest</DialogTitle>
            <DialogDescription>A contest keeps its entrants when its name changes.</DialogDescription>
          </DialogHeader>
          {editing && (
            <EditContest
              key={editing.id}
              contest={editing}
              disabled={locked}
              onSubmit={(next) =>
                void state
                  .execute({ type: "update_contest", contestId: editing.id, name: next.name, contestType: next.type })
                  .then((receipt) => receipt && setEditing(undefined))
              }
            />
          )}
          <CommandError message={state.error} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditContest({
  contest,
  disabled,
  onSubmit,
}: {
  contest: EventConsole["contests"][number];
  disabled: boolean;
  onSubmit: (next: { name: string; type: ContestType }) => void;
}) {
  const id = useId();
  const [name, setName] = useState(contest.name);
  const [type, setType] = useState(contest.contestType);
  const trimmed = name.trim();
  const changed = trimmed !== contest.name || type !== contest.contestType;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed && changed) onSubmit({ name: trimmed, type });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          value={name}
          maxLength={rosterTextMax}
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => setName(event.target.value)}
          className={fieldClass}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-type`}>Type</Label>
        <TypeSelect id={`${id}-type`} value={type} disabled={disabled} onChange={setType} />
      </div>
      <Button type="submit" className="h-11 w-full" disabled={disabled || !trimmed || !changed}>
        Save contest
      </Button>
    </form>
  );
}

/**
 * Who sits in one contest. Entrants of the contest's type are assigned in
 * bulk with a location, and unassigned one at a time. Staff are assigned with
 * roles and an admin flag. Only event admins and webmasters reach this tab.
 */
export function AssignmentsTab({ data, state }: TabProps) {
  const id = useId();
  const [chosen, setChosen] = useState(data.contests[0]?.id ?? "");
  const contest = data.contests.find((item) => item.id === chosen) ?? data.contests[0];
  if (!contest) {
    return (
      <div className="space-y-5">
        <Panel title="Assignments">
          <p className="text-sm text-muted-foreground">Create a contest first.</p>
        </Panel>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <CommandError message={state.error} />
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor={`${id}-contest`}>Contest</Label>
        <select
          id={`${id}-contest`}
          value={contest.id}
          onChange={(event) => setChosen(event.target.value)}
          className={selectClass}
        >
          {data.contests.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <EntrantAssignments key={`e:${contest.id}`} data={data} state={state} contest={contest} />
      <StaffAssignments key={`s:${contest.id}`} data={data} state={state} contest={contest} />
    </div>
  );
}

function EntrantAssignments({
  data,
  state,
  contest,
}: TabProps & { contest: EventConsole["contests"][number] }) {
  const id = useId();
  const locked = data.event.archived;
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [location, setLocation] = useState("");
  const seated = useMemo(() => seatedEntrants(data, contest.id), [data, contest.id]);
  const entries = new Map(data.entries.filter((entry) => entry.contestId === contest.id).map((entry) => [entry.entrantId, entry]));
  const eligible = data.entrants.filter((entrant) => acceptsKind(contest.contestType, entrant.kind));
  const open = eligible.filter((entrant) => !seated.has(entrant.id));
  const selected = open.filter((entrant) => picked.has(entrant.id));
  const chosen = selected.slice(0, teamsPerCommandMax);
  const toggle = (entrantId: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(entrantId);
    else next.delete(entrantId);
    setPicked(next);
  };
  return (
    <Panel
      title={`Entrants in ${contest.name} · ${seated.size}`}
      description={`This contest takes: ${contestTypeLabels[contest.contestType].toLowerCase()}. Assigning gives each entrant's sign-in a seat.`}
    >
      <div className="space-y-4">
        {open.length > 0 ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (locked || chosen.length === 0) return;
              void state
                .execute({
                  type: "assign_entrants",
                  contestId: contest.id,
                  entries: chosen.map((entrant) => ({ entrantId: entrant.id, location: location.trim() })),
                })
                .then((receipt) => receipt && setPicked(new Set()));
            }}
          >
            <fieldset className="min-w-0 space-y-1">
              <legend className="text-sm font-medium">Not yet in this contest</legend>
              <ul className="max-h-64 min-w-0 divide-y overflow-y-auto rounded-xl border">
                {open.map((entrant) => (
                  <li key={entrant.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm">
                      <input
                        type="checkbox"
                        checked={picked.has(entrant.id)}
                        disabled={locked}
                        onChange={(event) => toggle(entrant.id, event.target.checked)}
                        className="size-4"
                      />
                      <span className="min-w-0 flex-1 truncate">{entrant.name}</span>
                      <Badge variant="outline">{entrant.kind === "team" ? "Team" : "Single"}</Badge>
                    </label>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                disabled={locked}
                onClick={() => setPicked(new Set(open.slice(0, teamsPerCommandMax).map((entrant) => entrant.id)))}
              >
                Select all
              </Button>
              {open.length > teamsPerCommandMax && (
                <p className="text-xs text-muted-foreground">
                  One assignment takes up to {teamsPerCommandMax} entrants. Select all picks the first {teamsPerCommandMax}. Assign them, then select again.
                  {selected.length > teamsPerCommandMax && ` ${selected.length - teamsPerCommandMax} selected entrants wait for the next assignment.`}
                </p>
              )}
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-location`}>Location for the selected entrants</Label>
              <Input
                id={`${id}-location`}
                value={location}
                maxLength={rosterTextMax}
                autoComplete="off"
                disabled={locked}
                onChange={(event) => setLocation(event.target.value)}
                className={fieldClass}
              />
            </div>
            <Button type="submit" variant="secondary" className="h-11 w-full sm:w-auto" disabled={locked || chosen.length === 0}>
              Assign selected entrants{chosen.length > 0 ? ` (${chosen.length})` : ""}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            {eligible.length === 0
              ? "No entrant fits this contest's type. Import entrants on the Entrants tab."
              : "Every fitting entrant is in this contest."}
          </p>
        )}
        {seated.size > 0 && (
          <ul aria-label={`Entrants in ${contest.name}`} className="divide-y rounded-xl border">
            {data.entrants
              .filter((entrant) => seated.has(entrant.id))
              .map((entrant) => (
                <li key={entrant.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <div className="min-w-0 flex-1 basis-32 leading-tight">
                    <p className="truncate text-sm font-medium">{entrant.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{entries.get(entrant.id)?.location || "No location"}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={locked}
                    data-removes
                    aria-label={`Remove ${entrant.name} from ${contest.name}`}
                    onClick={(event) => {
                      const button = event.currentTarget;
                      void state
                        .execute({ type: "unassign_entrant", contestId: contest.id, entrantId: entrant.id })
                        .then((receipt) => receipt && focusAfterRemoval(button));
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function StaffAssignments({
  data,
  state,
  contest,
}: TabProps & { contest: EventConsole["contests"][number] }) {
  const locked = data.event.archived;
  const held = new Map(
    data.staffAssignments.filter((item) => item.contestId === contest.id).map((item) => [item.accountId, item]),
  );
  const admins = new Set(data.admins);
  return (
    <Panel
      title={`Staff in ${contest.name} · ${held.size}`}
      description="Pick roles, or make a person a contest admin. Event admins reach every contest without a seat."
    >
      {data.people.length === 0 ? (
        <p className="text-sm text-muted-foreground">Create people on the People tab first.</p>
      ) : (
        <ul className="divide-y">
          {data.people.map((person) => (
            <StaffRow
              key={person.id}
              name={person.name}
              handle={person.handle}
              eventAdmin={admins.has(person.id)}
              seat={held.get(person.id)}
              disabled={locked}
              onAssign={(roles, admin) =>
                void state.execute({
                  type: "assign_staff",
                  contestId: contest.id,
                  accountId: person.id,
                  roles,
                  admin,
                })
              }
              onRemove={() => void state.execute({ type: "unassign_staff", contestId: contest.id, accountId: person.id })}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function StaffRow({
  name,
  handle,
  eventAdmin,
  seat,
  disabled,
  onAssign,
  onRemove,
}: {
  name: string;
  handle: string | null;
  eventAdmin: boolean;
  seat: EventConsole["staffAssignments"][number] | undefined;
  disabled: boolean;
  onAssign: (roles: typeof staffRoles, admin: boolean) => void;
  onRemove: () => void;
}) {
  const [roles, setRoles] = useState<ReadonlySet<string>>(new Set(seat?.roles ?? ["volunteer"]));
  const [admin, setAdmin] = useState(seat?.admin ?? false);
  // A changed seat resets the draft in place. A new key would remount the row and drop focus.
  const seatKey = JSON.stringify(seat ?? null);
  const [seenSeat, setSeenSeat] = useState(seatKey);
  if (seenSeat !== seatKey) {
    setSeenSeat(seatKey);
    setRoles(new Set(seat?.roles ?? ["volunteer"]));
    setAdmin(seat?.admin ?? false);
  }
  const assignRef = useRef<HTMLButtonElement>(null);
  const chosen = staffRoles.filter((role) => roles.has(role));
  const changed =
    !seat || admin !== seat.admin || chosen.join() !== staffRoles.filter((role) => seat.roles.includes(role)).join();
  const pill =
    "flex h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 has-[:disabled]:opacity-50";
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-32 leading-tight">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{handle ?? "No username"}</p>
        </div>
        {eventAdmin && <Badge variant="outline">Event admin</Badge>}
        {seat && <Badge variant="secondary">Assigned</Badge>}
      </div>
      <fieldset className="flex flex-wrap gap-2" disabled={disabled}>
        <legend className="sr-only">Roles of {name}</legend>
        {staffRoles.map((role) => (
          <label key={role} className={pill}>
            <input
              type="checkbox"
              className="sr-only"
              checked={roles.has(role)}
              onChange={(event) => {
                const next = new Set(roles);
                if (event.target.checked) next.add(role);
                else next.delete(role);
                setRoles(next);
              }}
            />
            <span className="sr-only">{name}: </span>
            {role.charAt(0).toUpperCase() + role.slice(1)}
          </label>
        ))}
        <label className={pill}>
          <input type="checkbox" className="sr-only" checked={admin} onChange={(event) => setAdmin(event.target.checked)} />
          <span className="sr-only">{name}: </span>Contest admin
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          className="h-11"
          ref={assignRef}
          aria-disabled={!changed || (chosen.length === 0 && !admin) ? true : undefined}
          disabled={disabled}
          aria-label={`${seat ? "Update" : "Assign"} ${name}`}
          onClick={() => {
            if (changed && (chosen.length > 0 || admin)) onAssign(chosen, admin);
          }}
        >
          {seat ? "Update" : "Assign"}
        </Button>
        {seat && (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={disabled}
            aria-label={`Remove ${name} from this contest`}
            onClick={() => {
              assignRef.current?.focus();
              onRemove();
            }}
          >
            Remove
          </Button>
        )}
      </div>
    </li>
  );
}
