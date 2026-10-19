import { useState } from "react";
import { requireBackend } from "../../backend";
import { errorMessage } from "../../backend/errors";
import { formData, text } from "../../connected/forms";

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
    <section className="panel auth-panel">
      <h1>
        {required ? "Change your temporary password" : "Change your password"}
      </h1>
      <p>
        {required
          ? "Choose your own password before accessing the contest."
          : "Enter your current password and choose a new one."}
      </p>
      <form
        onSubmit={(event) => {
          const data = formData(event);
          if (text(data, "password") !== text(data, "confirm")) {
            setError("Passwords must match.");
            return;
          }
          if (text(data, "current") === text(data, "password")) {
            setError("Choose a different password.");
            return;
          }
          setBusy(true);
          setError("");
          void (async () => {
            try {
              await requireBackend().auth.changePassword(
                text(data, "current"),
                text(data, "password"),
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
        <fieldset disabled={busy}>
          <legend className="sr-only">New password</legend>
          <label>
            Current password
            <input
              name="current"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm password
            <input
              name="confirm"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
            />
          </label>
          <button type="submit">Save password</button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {!required && (
        <button className="quiet" onClick={done}>
          Return to dashboard
        </button>
      )}
    </section>
  );
}
