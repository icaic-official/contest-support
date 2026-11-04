import { useState } from "react";
import { Link, useLocation } from "react-router";
import { BrandMark } from "@/components/brand";
import { PasswordInput } from "@/components/PasswordInput";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { backend } from "@/backend";
import { parseEventCode, type SignInTarget } from "@/backend/contracts";
import { errorMessage } from "@/backend/errors";
import { rememberEventCode, rememberedEventCode } from "./eventCodeMemory";

/**
 * The public sign-in page. Organizers create every account. A person names
 * the event code, which the `?event=` link on their sheet or the last sign-in
 * on this device fills in. A webmaster chooses Site sign-in instead.
 */
export function SignIn() {
  const { search } = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [site, setSite] = useState(false);
  const [code, setCode] = useState(
    () => new URLSearchParams(search).get("event") ?? rememberedEventCode() ?? "",
  );
  return (
    <section
      id="sign-in"
      aria-labelledby="sign-in-heading"
      className="w-full max-w-sm"
    >
      <Link
        to="/"
        className="mb-10 flex w-fit rounded-md text-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <BrandMark />
      </Link>
      <h1
        id="sign-in-heading"
        className="text-3xl font-semibold tracking-tight"
      >
        {site ? "Site sign-in" : "Sign in"}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {site
          ? "For webmasters, who run the whole site."
          : "Access your contest workspace."}
      </p>
      <form
        className="mt-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const data = new FormData(event.currentTarget);
          const eventCode = parseEventCode(code);
          if (!site && !eventCode) {
            setError("Enter the event code from your sign-in details.");
            return;
          }
          const target: SignInTarget = eventCode && !site
            ? { kind: "event", code: eventCode }
            : { kind: "site" };
          setBusy(true);
          setError("");
          void (async () => {
            try {
              await backend.auth.signIn(
                target,
                String(data.get("username") ?? ""),
                String(data.get("password") ?? ""),
              );
              if (target.kind === "event") rememberEventCode(target.code);
            } catch (cause) {
              setError(errorMessage(cause));
              document.getElementById("sign-in-password")?.focus();
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        {/* Not disabled while busy: disabling the focused field drops focus to
            the page body. The busy guard in onSubmit stops a double submit. */}
        <fieldset className="grid gap-5">
          <legend className="sr-only">Account credentials</legend>
          {!site && (
            <div className="grid gap-2">
              <Label htmlFor="sign-in-event">Event code</Label>
              <Input
                id="sign-in-event"
                name="event"
                required
                value={code}
                onChange={(change) => setCode(change.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Enter your event code"
                className="h-11"
              />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="sign-in-username">Username</Label>
            <Input
              id="sign-in-username"
              name="username"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Enter your username"
              className="h-11"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sign-in-password">Password</Label>
            <PasswordInput
              id="sign-in-password"
              name="password"
              required
              autoComplete="current-password"
              placeholder="Enter your password"
              className="h-11"
            />
          </div>
          <Button type="submit" size="lg" className="h-11 w-full" loading={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <Button
            type="button"
            variant="link"
            className="h-11 w-full"
            onClick={() => {
              setSite(!site);
              setError("");
            }}
          >
            {site ? "Sign in to an event" : "Site sign-in"}
          </Button>
        </fieldset>
      </form>
      {error && (
        <Alert variant="destructive" className="mt-5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p className="mt-8 text-sm leading-relaxed text-muted-foreground">
        Accounts are created by contest organizers.
        <br />
        Need access or a password reset?
        <br />
        <span className="text-foreground">
          Contact your contest organizers.
        </span>
      </p>
    </section>
  );
}
