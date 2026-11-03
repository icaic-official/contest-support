import { type ReactNode, useId, useState } from "react";
import { UserRound, Users } from "lucide-react";
import { type Handle, parseHandle } from "@/backend/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Membership, Role, Snapshot } from "@/connected/model";
import { cn } from "@/lib/utils";
import {
  type MembershipDraft,
  type NewAccount,
  draftOfMembership,
  isCompleteMembership,
  staffRoles,
  toggleRole,
  usernamePattern,
} from "./adminModel";

const fieldClass = "h-11 text-base md:text-sm";

const roleLabels: Record<Role, string> = {
  volunteer: "Volunteer",
  specialist: "Specialist",
  jury: "Jury",
};

/** A labelled field with optional help text below it. */
function Field({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  );
}

/** A username field with the rule of the admin function. */
function UsernameInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Input
      id={id}
      required
      minLength={3}
      maxLength={32}
      pattern={usernamePattern}
      autoCapitalize="none"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-describedby={`${id}-help`}
      className={cn(fieldClass, "font-mono")}
    />
  );
}

const usernameHelp =
  "3–32 letters, digits, underscores or hyphens. Usernames are stored in lowercase.";

/**
 * Staff or team account, then the team or the staff roles and Admin. A team
 * account has no staff roles. Native radios and checkboxes keep keyboard use.
 */
export function MembershipFields({
  draft,
  onChange,
  teams,
}: {
  draft: MembershipDraft;
  onChange: (draft: MembershipDraft) => void;
  teams: Snapshot["teams"];
}) {
  const id = useId();
  const cardClass =
    "flex min-h-11 cursor-pointer flex-col gap-1 rounded-xl border p-3 has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50";
  const pillClass =
    "flex h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50";
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Account type</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["staff", "Staff", "One person", UserRound],
              [
                "team",
                "Team",
                teams.length === 0 ? "Add a team first." : "Shared team login",
                Users,
              ],
            ] as const
          ).map(([kind, label, help, Icon]) => (
            <label key={kind} className={cardClass}>
              <input
                type="radio"
                name={`${id}-kind`}
                value={kind}
                checked={draft.kind === kind}
                disabled={kind === "team" && teams.length === 0}
                onChange={() => onChange({ ...draft, kind })}
                className="sr-only"
              />
              <Icon aria-hidden="true" className="size-5" />
              <span className="font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">{help}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {draft.kind === "team" ? (
        <Field
          id={`${id}-team`}
          label="Contestant team"
          help="This account can submit and view issues for the selected team."
        >
          <select
            id={`${id}-team`}
            required
            value={draft.teamId}
            onChange={(event) =>
              onChange({ ...draft, teamId: event.target.value })
            }
            aria-describedby={`${id}-team-help`}
            className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
          >
            <option value="" disabled>
              Choose a team
            </option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} · {team.location}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <fieldset aria-describedby={`${id}-staff-help`}>
          <legend className="mb-1.5 text-sm font-medium">
            Staff permissions
          </legend>
          <div className="flex flex-wrap gap-2">
            {staffRoles.map((role) => (
              <label key={role} className={pillClass}>
                <input
                  type="checkbox"
                  checked={draft.roles.includes(role)}
                  onChange={(event) =>
                    onChange(toggleRole(draft, role, event.target.checked))
                  }
                  className="sr-only"
                />
                {roleLabels[role]}
              </label>
            ))}
            <label className={pillClass}>
              <input
                type="checkbox"
                checked={draft.isAdmin}
                onChange={(event) =>
                  onChange({ ...draft, isAdmin: event.target.checked })
                }
                className="sr-only"
              />
              Admin
            </label>
          </div>
          <p
            id={`${id}-staff-help`}
            className="mt-1.5 text-xs text-muted-foreground"
          >
            Choose the permissions this staff member needs.
          </p>
        </fieldset>
      )}
    </div>
  );
}

/**
 * Creates a staff or team account. The form clears after the server
 * records the account, so the desktop console can keep it on the page.
 */
export function CreateAccountForm({
  teams,
  disabled,
  busy,
  onCreate,
}: {
  teams: Snapshot["teams"];
  disabled: boolean;
  busy: boolean;
  onCreate: (account: NewAccount) => Promise<boolean>;
}) {
  const id = useId();
  const empty = (): NewAccount => ({
    name: "",
    username: "",
    membership: draftOfMembership(undefined, ["volunteer"]),
  });
  const [account, setAccount] = useState<NewAccount>(empty);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isCompleteMembership(account.membership)) return;
        void onCreate(account).then((created) => {
          if (created) setAccount(empty());
        });
      }}
    >
      <fieldset disabled={disabled} className="space-y-4">
        <legend className="sr-only">New account</legend>
        <MembershipFields
          draft={account.membership}
          teams={teams}
          onChange={(membership) => setAccount({ ...account, membership })}
        />
        <Field id={`${id}-name`} label="Display name">
          <Input
            id={`${id}-name`}
            required
            maxLength={200}
            value={account.name}
            onChange={(event) =>
              setAccount({ ...account, name: event.target.value })
            }
            placeholder="Team Aurora or Alex Morgan"
            className={fieldClass}
          />
        </Field>
        <Field id={`${id}-username`} label="Username" help={usernameHelp}>
          <UsernameInput
            id={`${id}-username`}
            value={account.username}
            onChange={(username) => setAccount({ ...account, username })}
            placeholder="team-aurora"
          />
        </Field>
        <Button
          type="submit"
          className="h-12 w-full text-base"
          loading={busy}
        >
          {busy ? "Working…" : "Create account"}
        </Button>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        You receive a temporary password to share securely. The user must
        change it before they can use the contest.
      </p>
    </form>
  );
}

/**
 * Changes the username of an account, or gives an account without one its
 * first username. The parent sets a `key` from `current`, so the form
 * restarts after a change.
 */
export function UsernameForm({
  current,
  disabled,
  onSubmit,
}: {
  /** The account's username. Null when the account has none. */
  current: string | null;
  disabled: boolean;
  onSubmit: (username: Handle) => void;
}) {
  const id = useId();
  const [username, setUsername] = useState(current ?? "");
  const handle = parseHandle(username);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        // The input's pattern stops a submit of text that is not a handle.
        if (handle) onSubmit(handle);
      }}
    >
      <fieldset disabled={disabled} className="space-y-3">
        <Field
          id={`${id}-username`}
          label={current ? "Change username" : "Assign username"}
          help={current
            ? "The password stays the same, and open sessions stay signed in. Use the new username at the next sign-in."
            : "Then reset the password, so that the account can sign in."}
        >
          <UsernameInput
            id={`${id}-username`}
            value={username}
            onChange={setUsername}
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          className="h-11 w-full"
          disabled={handle === current}
        >
          {current ? "Change username" : "Set username"}
        </Button>
      </fieldset>
    </form>
  );
}

/**
 * Updates the team, staff roles and Admin of a membership. The parent sets
 * a `key` from the membership so the form restarts when it changes.
 */
export function MembershipForm({
  member,
  teams,
  disabled,
  onSave,
}: {
  member: Membership;
  teams: Snapshot["teams"];
  disabled: boolean;
  /** Resolves when the request ends. The button spins until then. */
  onSave: (draft: MembershipDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => draftOfMembership(member));
  const [saving, setSaving] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!isCompleteMembership(draft)) return;
        setSaving(true);
        void onSave(draft).finally(() => setSaving(false));
      }}
    >
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="sr-only">Membership</legend>
        <MembershipFields draft={draft} teams={teams} onChange={setDraft} />
        <Button
          type="submit"
          variant="secondary"
          className="h-11 w-full"
          loading={saving}
        >
          {saving ? "Saving…" : "Save membership"}
        </Button>
      </fieldset>
    </form>
  );
}

/** Adds an account that already exists to the session by its user ID. */
export function AssignByIdForm({
  teams,
  disabled,
  onAssign,
}: {
  teams: Snapshot["teams"];
  disabled: boolean;
  onAssign: (userId: string, draft: MembershipDraft) => Promise<boolean>;
}) {
  const id = useId();
  const [userId, setUserId] = useState("");
  const [draft, setDraft] = useState(() => draftOfMembership());
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!isCompleteMembership(draft)) return;
        void onAssign(userId, draft).then((assigned) => {
          if (assigned) {
            setUserId("");
            setDraft(draftOfMembership());
          }
        });
      }}
    >
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="sr-only">Assign an existing account</legend>
        <Field id={`${id}-user`} label="Account ID">
          <Input
            id={`${id}-user`}
            required
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            className={cn(fieldClass, "font-mono")}
          />
        </Field>
        <MembershipFields draft={draft} teams={teams} onChange={setDraft} />
        <Button type="submit" variant="secondary" className="h-11 w-full">
          Assign membership
        </Button>
      </fieldset>
    </form>
  );
}
