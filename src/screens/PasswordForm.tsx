import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { backend } from "@/backend";
import { errorMessage } from "@/backend/errors";

/** The ID of the Current password field. The account page links to it. */
export const currentPasswordFieldId = "password-current";

// The server rejects other lengths. Keep these in step with `passwordSchema`
// in src/server/adapters/cloudflare/authentication.ts.
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const newPasswordHintId = "password-password-hint";

const fields = [
  {
    name: "current",
    id: currentPasswordFieldId,
    label: "Current password",
    autoComplete: "current-password",
  },
  {
    name: "password",
    id: "password-password",
    label: "New password",
    autoComplete: "new-password",
  },
  {
    name: "confirm",
    id: "password-confirm",
    label: "Confirm password",
    autoComplete: "new-password",
  },
] as const;

/**
 * The password change fields and their checks, shared by the full-screen
 * form and the account page. After a change it empties the fields. It shows
 * `successMessage`, when given, until the person edits a field again.
 */
export function PasswordChangeForm({
  onChanged,
  successMessage,
}: {
  onChanged?: () => void;
  successMessage?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  return (
    <>
      <form
        onChange={() => setChanged(false)}
        onSubmit={(event) => {
          event.preventDefault();
          // The event target is gone after the first await.
          const form = event.currentTarget;
          const data = new FormData(form);
          const value = (name: string) => String(data.get(name) ?? "");
          if (value("password") !== value("confirm")) {
            setError("Passwords must match.");
            return;
          }
          if (value("current") === value("password")) {
            setError("Choose a different password.");
            return;
          }
          setBusy(true);
          setError("");
          setChanged(false);
          void (async () => {
            try {
              await backend.auth.changePassword(
                value("current"),
                value("password"),
              );
              form.reset();
              setChanged(true);
              onChanged?.();
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <fieldset disabled={busy} className="grid gap-5">
          <legend className="sr-only">New password</legend>
          {fields.map((field) => {
            const isNew = field.name !== "current";
            const hinted = field.name === "password";
            return (
              <div key={field.name} className="grid gap-2">
                <Label htmlFor={field.id}>{field.label}</Label>
                <Input
                  id={field.id}
                  name={field.name}
                  type="password"
                  required
                  minLength={isNew ? MIN_PASSWORD_LENGTH : undefined}
                  maxLength={isNew ? MAX_PASSWORD_LENGTH : undefined}
                  aria-describedby={hinted ? newPasswordHintId : undefined}
                  autoComplete={field.autoComplete}
                  className="h-11"
                />
                {hinted && (
                  <p
                    id={newPasswordHintId}
                    className="text-sm text-muted-foreground"
                  >
                    {`Use ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`}
                  </p>
                )}
              </div>
            );
          })}
          <Button type="submit" className="h-11" loading={busy}>
            Save password
          </Button>
        </fieldset>
      </form>
      {error && (
        <Alert variant="destructive" className="mt-5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {changed && successMessage && (
        <p role="status" className="mt-5 text-sm text-status-resolved">
          {successMessage}
        </p>
      )}
    </>
  );
}

/**
 * Changes the password on its own screen. When `required` is true the
 * database blocks contest data until the person replaces the temporary
 * password.
 */
export function PasswordForm({
  done,
  required,
}: {
  done: () => void;
  required: boolean;
}) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl font-semibold tracking-tight">
            {required
              ? "Change your temporary password"
              : "Change your password"}
          </h1>
        </CardTitle>
        <CardDescription>
          {required
            ? "Choose your own password before accessing the contest."
            : "Enter your current password and choose a new one."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PasswordChangeForm onChanged={done} />
      </CardContent>
      {!required && (
        <CardFooter>
          <Button variant="outline" className="h-11 w-full" onClick={done}>
            Return to dashboard
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
