import { type ReactNode, useId, useState } from "react";
import { type Handle, parseHandle } from "@/backend/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { usernamePattern } from "./adminModel";

const fieldClass = "h-11 text-base md:text-sm";

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
