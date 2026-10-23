import { ChevronDown, KeyRound, LogOut, MapPin } from "lucide-react";
import { Link } from "react-router";
import { useRef } from "react";
import { BrandMark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SessionSummary } from "@/connected/hooks/useSessionSnapshot";
import { cn } from "@/lib/utils";

/** Two initials for the team avatar. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

/**
 * The contestant top bar: event and session, connection state, team and
 * location, theme and account menu.
 */
export function ContestantTopBar({
  eventName,
  sessionName,
  sessions,
  sessionId,
  connected,
  locked,
  teamName,
  location,
  account,
  onSelectSession,
  changePassword,
  signOut,
}: {
  eventName: string | undefined;
  sessionName: string;
  sessions: readonly SessionSummary[];
  sessionId: string;
  connected: boolean;
  /** True while a workflow command runs or waits for a retry. */
  locked: boolean;
  teamName: string;
  location: string | undefined;
  account: string | undefined;
  onSelectSession: (sessionId: string) => void;
  changePassword: () => void;
  signOut: () => void;
}) {
  const openingAccount = useRef(false);
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b px-5">
      <BrandMark />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-medium">
          {eventName ?? "Your contest"}
        </p>
        {sessions.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={locked}
                className="flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
                aria-label={`Contest session: ${sessionName}. Change session`}
              >
                {sessionName}
                <ChevronDown className="size-3" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Contest session</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sessionId}
                onValueChange={onSelectSession}
              >
                {sessions.map((item) => (
                  <DropdownMenuRadioItem key={item.id} value={item.id}>
                    {item.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <p className="truncate text-xs text-muted-foreground">
            {sessionName}
          </p>
        )}
      </div>
      <div className="flex-1" />
      <Badge
        variant="outline"
        role="status"
        className={cn("gap-1.5", !connected && "text-age-warn")}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-2 rounded-full",
            connected ? "bg-emerald-500" : "animate-pulse bg-amber-500",
          )}
        />
        {connected ? "Live" : "Reconnecting"}
      </Badge>
      <ThemeToggle />
      <div className="h-6 w-px bg-border" aria-hidden="true" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto gap-2.5 px-2 py-1 text-left"
            aria-label={`Account menu for ${teamName}`}
          >
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold"
            >
              {initials(teamName)}
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-medium">{teamName}</span>
              {location && (
                <span className="block text-xs font-normal text-muted-foreground">
                  {location}
                </span>
              )}
            </span>
            <ChevronDown className="text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-60"
          onCloseAutoFocus={(event) => {
            if (!openingAccount.current) return;
            event.preventDefault();
            openingAccount.current = false;
          }}
        >
          <DropdownMenuLabel className="font-normal">
            <span className="block font-medium">{teamName}</span>
            {location && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3" aria-hidden="true" />
                {location}
              </span>
            )}
            {account && (
              <span className="block truncate text-xs text-muted-foreground">
                Signed in as {account}
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              asChild
              onSelect={() => {
                openingAccount.current = true;
              }}
            >
              <Link to="/account">My account</Link>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={locked} onSelect={changePassword}>
              <KeyRound aria-hidden="true" />
              Change password
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={signOut}>
              <LogOut aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
