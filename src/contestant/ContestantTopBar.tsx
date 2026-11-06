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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContestPicker } from "@/connected/ContestPicker";
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
  // Set when a menu item leaves for the account page. The menu returns focus
  // to its button when it closes, so the page waits for that. Radix also
  // keeps focus inside an open menu, so the page cannot take it earlier.
  const afterClose = useRef<(() => void) | undefined>(undefined);
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b px-2 lg:gap-4 lg:px-5">
      <Link
        to="/issues"
        aria-label="Minsky, your reports"
        className="flex shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-lg:size-11 lg:-m-1 lg:w-fit lg:p-1"
      >
        <BrandMark wordClassName="max-lg:sr-only" />
      </Link>
      <div className="min-w-0 leading-tight">
        <p
          className={cn(
            "truncate text-sm font-medium",
            sessions.length > 1 && "max-lg:hidden",
          )}
        >
          {eventName ?? "Your contest"}
        </p>
        {sessions.length > 1 ? (
          <ContestPicker
            variant="menu"
            contests={sessions}
            value={sessionId}
            disabled={locked}
            onSelect={onSelectSession}
            trigger={
              <button
                type="button"
                className="flex max-w-full items-center gap-1 rounded-sm text-xs text-muted-foreground max-lg:min-h-11 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
                aria-label={`Contest session: ${sessionName}. Change session`}
              >
                <span className="min-w-0 text-left">
                  {/* A phone has no room for a second row, so the picker holds both names. */}
                  <span className="block truncate text-sm font-medium text-foreground lg:hidden">
                    {eventName ?? "Your contest"}
                  </span>
                  <span className="block truncate">{sessionName}</span>
                </span>
                <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
              </button>
            }
          />
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
        className={cn("gap-1.5", !connected && "text-status-escalated")}
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
      <div
        className="h-6 w-px bg-border max-lg:hidden"
        aria-hidden="true"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto gap-2.5 px-2 py-1 text-left max-lg:size-11 max-lg:justify-center max-lg:p-0"
            aria-label={`Account menu for ${teamName}`}
          >
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold"
            >
              {initials(teamName)}
            </span>
            <span className="leading-tight max-lg:hidden">
              <span className="block text-sm font-medium">{teamName}</span>
              {location && (
                <span className="block text-xs font-normal text-muted-foreground">
                  {location}
                </span>
              )}
            </span>
            <ChevronDown
              className="text-muted-foreground max-lg:hidden"
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-60"
          onCloseAutoFocus={(event) => {
            const next = afterClose.current;
            if (!next) return;
            afterClose.current = undefined;
            event.preventDefault();
            next();
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
                afterClose.current = () => undefined;
              }}
            >
              <Link to="/account">My account</Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                afterClose.current = changePassword;
              }}
            >
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
