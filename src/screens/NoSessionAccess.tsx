import { LogOut, RefreshCw } from "lucide-react";
import { BrandMark } from "@/components/brand";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { SessionData } from "@/connected/hooks/useSessionSnapshot";

/**
 * Shows while no session snapshot is available: during the first load, after
 * a refresh error, or when the account has no membership yet.
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
  account?: string;
  signOut: () => void;
  /** The error of the last workflow command, if any. */
  error?: string;
  /** Sends the pending workflow command again. Set it only while one waits. */
  onRetry?: () => void;
}) {
  const { sessions, sessionId, loaded, refreshError } = data;
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
              <p role="status" className="font-medium">
                Loading your contest session…
              </p>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        ) : (
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Session access
                </h1>
              </CardTitle>
              <CardDescription>
                No session data is available. If your account was just created,
                ask an organizer to assign your membership.
              </CardDescription>
            </CardHeader>
            {(refreshError || error || sessions.length > 1) && (
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
                {sessions.length > 1 && (
                  <div className="grid gap-2">
                    <Label htmlFor="access-session">Contest session</Label>
                    <select
                      id="access-session"
                      value={sessionId}
                      disabled={!!onRetry}
                      onChange={(event) =>
                        data.selectSession(event.target.value)
                      }
                      className="h-11 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                    >
                      {sessions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </CardContent>
            )}
            <CardFooter className="flex flex-wrap gap-2">
              <Button
                className="h-11"
                onClick={() => {
                  void data.refresh();
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
        )}
      </div>
    </div>
  );
}
