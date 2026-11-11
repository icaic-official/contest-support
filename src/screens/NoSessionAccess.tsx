import { LogOut, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ContestPicker } from "@/connected/ContestPicker";
import { BrandMark } from "@/components/brand";
import { BuildId } from "@/components/build-id";
import { ThemeToggle } from "@/components/theme-toggle";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { SessionData } from "@/connected/hooks/useSessionSnapshot";
import { WebmasterAccess } from "@/site/WebmasterAccess";

/**
 * Shows while no session snapshot is available: during the first load, after
 * a refresh error, or when the account has no membership yet. A webmaster
 * who must join a contest first sees the contests to join.
 */
export function NoSessionAccess({
  data,
  account,
  signOut,
  error,
  onRetry,
}: {
  data: SessionData;
  /** The username or email address of the signed-in account. */
  account?: string | undefined;
  signOut: () => void;
  /** The error of the last workflow command, if any. */
  error?: string;
  /** Sends the pending workflow command again. Set it only while one waits. */
  onRetry?: (() => void) | undefined;
}) {
  const { sessions, sessionId, loaded, refreshError } = data;
  // A read that has chosen no contest can already hold the list. A select with
  // no matching row shows its first row, which the person did not choose.
  const canChoose = sessions.length > 1 && sessionId !== "";
  const [refreshing, setRefreshing] = useState(false);
  const access = (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl font-semibold tracking-tight">
            Session access
          </h1>
        </CardTitle>
        <CardDescription>
          {refreshError
            ? "Minsky could not load your session."
            : "No session data is available. If your account was just created, ask an organizer to assign your membership."}
        </CardDescription>
      </CardHeader>
      {(refreshError || error || canChoose) && (
        <CardContent className="grid gap-4">
          {refreshError && (
            <Alert variant="destructive">
              <AlertDescription>{refreshError}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {canChoose && (
            <ContestPicker
              variant="select"
              label="Contest session"
              contests={sessions}
              value={sessionId}
              disabled={!!onRetry}
              onSelect={data.selectSession}
            />
          )}
        </CardContent>
      )}
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          className="h-11"
          disabled={refreshing}
          loading={refreshing}
          onClick={() => {
            setRefreshing(true);
            void data.refresh().finally(() => setRefreshing(false));
          }}
        >
          <RefreshCw />
          Refresh access
        </Button>
        {onRetry && (
          <Button variant="outline" className="h-11" onClick={onRetry}>
            Retry last request
          </Button>
        )}
      </CardFooter>
    </Card>
  );
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-6">
        <BrandMark />
        <div className="flex items-center gap-1">
          {account && (
            <span className="mr-2 hidden text-sm text-muted-foreground sm:inline">
              {account}
            </span>
          )}
          <ThemeToggle />
          <Button variant="ghost" onClick={signOut}>
            <LogOut />
            Sign out
          </Button>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
        {!loaded ? (
          <Card className="w-full max-w-md" aria-busy="true">
            <CardHeader>
              <p role="status" className="flex items-center gap-2 font-medium">
                <Spinner className="size-4" />
                Loading your contest session…
              </p>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        ) : (
          // Mounted only once a read finished, so the ordinary first load of
          // every account makes no site read. A failed read mounts it too, so
          // a webmaster keeps the way to the site page.
          <WebmasterAccess
            data={data}
            fallback={access}
            failed={Boolean(refreshError || error)}
          />
        )}
      </div>
      <p className="px-4 py-2 text-center text-xs text-muted-foreground">
        <BuildId />
      </p>
    </div>
  );
}
