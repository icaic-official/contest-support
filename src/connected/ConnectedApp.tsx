import { type ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { BrandMark } from "@/components/brand";
import { BuildId } from "@/components/build-id";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { documentationUrl } from "@/lib/links";
import { Landing } from "@/screens/Landing";
import { PasswordForm } from "@/screens/PasswordForm";
import { SignIn } from "@/screens/SignIn";
import { useAccountStatus } from "./hooks/useAccountStatus";
import { useAuthSession } from "./hooks/useAuthSession";
import { keepContest, skipToFragment } from "./navigation";
import { Workspace } from "./Workspace";
import { WorkflowRetryProvider } from "./WorkflowRetry";
import { preloadRememberedScreen } from "./lazyScreens";
import { Meta } from "@/components/meta";

/** The page chrome around the main landmark. */
type Layout = "dashboard" | "centered" | "landing";

const mainClasses: Record<Layout, string> = {
  dashboard: "flex-1 outline-none",
  landing: "flex-1 outline-none",
  centered:
    "flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 outline-none",
};

/**
 * The application root. It restores the sign-in, enforces the password
 * change, and then hands over to Workspace, which selects the UI.
 */
export function ConnectedApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname, search } = location;
  const auth = useAuthSession();
  const { user } = auth;
  const [live, setLive] = useState(false);
  const account = useAccountStatus(user?.id, live);
  const [passwordSetup, setPasswordSetup] = useState(false);
  // A voluntary password change ends when the person signs out.
  if (!user && passwordSetup) setPasswordSetup(false);
  const userId = user?.id;
  // The session check names the person. Only then does the device's record tell which screens to download early.
  useEffect(() => {
    if (userId) preloadRememberedScreen(userId);
  }, [userId]);
  const status = account.account;
  const dashboardReady =
    !!user &&
    !!status?.session_valid &&
    !status.must_change &&
    !passwordSetup &&
    !account.error;
  // Every other signed-out path is a deep link and goes through sign-in. So
  // is `/?event=`, the link on a credential sheet.
  const showLanding =
    !auth.loading && !user && pathname === "/" && !new URLSearchParams(search).has("event");
  const layout: Layout = dashboardReady
    ? "dashboard"
    : showLanding
      ? "landing"
      : "centered";
  let content: ReactNode;
  if (auth.loading) {
    content = <StatusMessage>Restoring your session…</StatusMessage>;
  } else if (showLanding) {
    content = <Landing />;
  } else if (!user) {
    content = <SignIn />;
  } else if (account.error) {
    content = (
      <Card className="w-full max-w-md">
        <CardContent className="grid gap-4">
          <Alert variant="destructive">
            <AlertDescription>{account.error}</AlertDescription>
          </Alert>
          <Button className="h-11" onClick={account.recheck}>
            Retry account check
          </Button>
        </CardContent>
      </Card>
    );
  } else if (!status) {
    content = <StatusMessage>Checking account access…</StatusMessage>;
  } else if (!status.session_valid) {
    content = (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl font-semibold tracking-tight">
              Sign in again
            </h1>
          </CardTitle>
          <CardDescription>
            Your password was reset. Sign out and use the new credentials from
            your organizer.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  } else if (passwordSetup || status.must_change) {
    content = (
      <PasswordForm
        required={status.must_change}
        done={() => {
          setPasswordSetup(false);
          account.recheck();
        }}
      />
    );
  } else {
    content = (
      <Workspace
        key={user.id}
        user={user}
        username={status.handle}
        canChangeUsername={status.can_change_handle}
        refreshAccount={account.refresh}
        changePassword={() => {
          // This unmounts the workspace. Its hook reads the contest from the address when it mounts again.
          const entry = keepContest(location, "/account");
          navigate(entry.to, { state: entry.state });
          setPasswordSetup(true);
        }}
        signOut={auth.signOut}
        onLiveChange={setLive}
      />
    );
  }
  return (
    <TooltipProvider>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-background text-sm font-medium shadow-md focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:px-4 focus:py-3"
          onClick={skipToFragment}
        >
          Skip to main content
        </a>
        {user && !dashboardReady && (
          <header className="flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-6">
            <BrandMark />
            <Button variant="ghost" onClick={auth.signOut}>
              Sign out
            </Button>
          </header>
        )}
        {layout === "centered" && !user && !auth.loading && (
          <div className="absolute top-3 right-3">
            <ThemeToggle />
          </div>
        )}
        <main
          id="main"
          tabIndex={-1}
          className={mainClasses[layout]}
        >
          {auth.error && (
            <Alert variant="destructive" className="mx-auto max-w-md">
              <AlertDescription>{auth.error}</AlertDescription>
            </Alert>
          )}
          <WorkflowRetryProvider key={user?.id ?? ""} actorId={user?.id ?? ""}>
            {content}
          </WorkflowRetryProvider>
        </main>
        {layout !== "dashboard" && (
          <footer className="px-6 py-4 text-center text-xs text-muted-foreground">
            <Meta>
              <span className="font-medium text-foreground/80">Minsky</span>
              <span>Development deployment</span>
              <a
              href={documentationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center underline-offset-4 hover:underline max-lg:min-h-11"
            >
              Documentation{" "}
              <span className="sr-only">(opens in a new tab)</span>↗
              </a>
              <BuildId />
            </Meta>
          </footer>
        )}
      </div>
      <Toaster />
    </TooltipProvider>
  );
}

function StatusMessage({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-muted-foreground">
      <Spinner className="size-4" />
      {children}
    </p>
  );
}
