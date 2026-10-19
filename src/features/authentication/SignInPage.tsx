import { useState } from "react";
import { requireBackend } from "../../backend";
import { errorMessage } from "../../backend/errors";
import { formData, text } from "../../connected/forms";
import { Brand, Icon } from "../../connected/ui";

export function SignInPage() {
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  return (
    <section
      id="sign-in"
      className="sign-in-panel"
      aria-labelledby="sign-in-heading"
    >
      <Brand />
      <h1 id="sign-in-heading">Sign in</h1>
      <p className="sign-in-subtitle">Access your contest workspace.</p>
      <form
        onSubmit={(event) => {
          const data = formData(event);
          setBusy(true);
          setError("");
          void (async () => {
            try {
              await requireBackend().auth.signIn(
                text(data, "username"),
                text(data, "password"),
              );
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <fieldset disabled={busy}>
          <legend className="sr-only">Account credentials</legend>
          <label>
            Username
            <input
              name="username"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Enter your username"
            />
          </label>
          <div className="password-field">
            <label htmlFor="sign-in-password">Password</label>
            <div className="password-input">
              <input
                id="sign-in-password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                aria-controls="sign-in-password"
                onClick={() => setShowPassword(!showPassword)}
              >
                <Icon name={showPassword ? "eye-off" : "eye"} />
              </button>
            </div>
          </div>
          <button className="sign-in-submit" type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <p className="sign-in-help">
        Accounts are created by contest organizers.
        <br />
        Need access or a password reset?
        <br />
        <span>Contact your contest organizers.</span>
      </p>
    </section>
  );
}
