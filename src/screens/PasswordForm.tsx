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
import { requireBackend } from "@/backend";
import { errorMessage } from "@/backend/errors";

const fields = [
  {
    name: "current",
    label: "Current password",
    autoComplete: "current-password",
  },
  { name: "password", label: "New password", autoComplete: "new-password" },
  { name: "confirm", label: "Confirm password", autoComplete: "new-password" },
] as const;

/**
 * Changes the password. When `required` is true the database blocks contest
 * data until the person replaces the temporary password.
 */
export function PasswordForm({
  done,
  required,
}: {
  done: () => void;
  required: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
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
            void (async () => {
              try {
                await requireBackend().auth.changePassword(
                  value("current"),
                  value("password"),
                );
                done();
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
            {fields.map((field) => (
              <div key={field.name} className="grid gap-2">
                <Label htmlFor={`password-${field.name}`}>{field.label}</Label>
                <Input
                  id={`password-${field.name}`}
                  name={field.name}
                  type="password"
                  required
                  minLength={field.name === "current" ? undefined : 8}
                  autoComplete={field.autoComplete}
                  className="h-11"
                />
              </div>
            ))}
            <Button type="submit" className="h-11">
              Save password
            </Button>
          </fieldset>
        </form>
        {error && (
          <Alert variant="destructive" className="mt-5">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
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
