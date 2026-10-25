import { useState } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { backend } from "@/backend";
import { errorMessage } from "@/backend/errors";

/** The public sign-in page. Organizers create every account. */
export function SignIn() {
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  return (
    <section
      id="sign-in"
      aria-labelledby="sign-in-heading"
      className="w-full max-w-sm"
    >
      <BrandMark className="mb-10 text-lg" />
      <h1
        id="sign-in-heading"
        className="text-3xl font-semibold tracking-tight"
      >
        Sign in
      </h1>
      <p className="mt-2 text-muted-foreground">
        Access your contest workspace.
      </p>
      <form
        className="mt-8"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setBusy(true);
          setError("");
          void (async () => {
            try {
              await backend.auth.signIn(
                String(data.get("username") ?? ""),
                String(data.get("password") ?? ""),
              );
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <fieldset disabled={busy} className="grid gap-5">
          <legend className="sr-only">Account credentials</legend>
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
            <div className="relative">
              <Input
                id="sign-in-password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                className="h-11 pr-12"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                aria-controls="sign-in-password"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </div>
          <Button type="submit" size="lg" className="h-11 w-full">
            {busy && <LoaderCircle className="animate-spin" aria-hidden />}
            {busy ? "Signing in…" : "Sign in"}
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
