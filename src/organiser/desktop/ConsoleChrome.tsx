import { useId } from "react";
import {
  ChartNoAxesColumn,
  ChevronRight,
  ChevronsUpDown,
  Inbox,
  KeyRound,
  LogOut,
  type LucideIcon,
  ListPlus,
  MapPin,
  Monitor,
  Moon,
  PanelLeft,
  Plus,
  Scale,
  Search,
  Settings2,
  Sun,
  UserRoundCheck,
  ArrowUpRight,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ContestPicker } from "@/connected/ContestPicker";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import type { SessionData } from "@/connected/hooks/useSessionSnapshot";
import type { Issue, Membership, Snapshot } from "@/connected/model";
import { searchTeams, unresolvedLabel } from "@/connected/teamSearch";
import { type ThemePreference, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { EventLink } from "@/event/EventLink";
import { SiteLink } from "@/site/SiteLink";
import {
  ConnectionBadge,
  PersonAvatar,
  StatusIcon,
} from "../components/issueDisplay";
import { roleNames } from "../organiserModel";
import {
  type ConsoleNavGroup,
  type ConsolePage,
  consolePageLabels,
  labelMatches,
  paletteIssues,
} from "./consoleModel";

const pageIcons: Record<ConsolePage, LucideIcon> = {
  queue: Inbox,
  mine: UserRoundCheck,
  handoffs: ArrowUpRight,
  teams: MapPin,
  awards: Scale,
  overview: ChartNoAxesColumn,
  accounts: Users,
  roster: ListPlus,
  settings: Settings2,
};

/**
 * The event and session at the top of the sidebar. With several sessions it
 * is a menu that changes the session. It waits while a command runs.
 */
function SessionSwitcher({
  state,
  data,
  collapsed,
  locked,
  onSessionChange,
}: {
  state: Snapshot;
  data: SessionData;
  collapsed: boolean;
  locked: boolean;
  onSessionChange: () => void;
}) {
  const eventName = state.event?.name ?? "Your contest";
  const sessionName = state.session?.name ?? "";
  const mark = (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground"
    >
      M
    </span>
  );
  const label = (
    <span className={cn("min-w-0 flex-1 text-left", collapsed && "sr-only")}>
      <span className="block truncate text-sm font-semibold">{eventName}</span>
      <span className="block truncate text-xs text-muted-foreground">
        {sessionName}
      </span>
    </span>
  );
  const rowClass =
    "flex h-12 w-full items-center gap-2 rounded-md px-2 outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50";
  if (data.sessions.length < 2) {
    return (
      <div className={rowClass}>
        {mark}
        {label}
      </div>
    );
  }
  return (
    <ContestPicker
      variant="menu"
      contests={data.sessions}
      value={data.sessionId}
      disabled={locked}
      className="w-64"
      onSelect={(sessionId) => {
        data.selectSession(sessionId);
        onSessionChange();
      }}
      trigger={
        <button
          type="button"
          className={cn(rowClass, "hover:bg-sidebar-accent disabled:opacity-50")}
          aria-label={`Contest session: ${sessionName}. Change session`}
        >
          {mark}
          {label}
          {!collapsed && (
            <ChevronsUpDown
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
          )}
        </button>
      }
    />
  );
}

/**
 * The collapsible sidebar: the session switcher, navigation by combined
 * roles, the intake switch for admins and the person card, which opens the
 * account page. When collapsed, the links show icons with tooltips and keep
 * their names for screen readers.
 */
export function ConsoleSidebar({
  state,
  data,
  member,
  personName,
  groups,
  counts,
  page,
  onPage,
  collapsed,
  locked,
  onSessionChange,
  intake,
  accountPage,
  onAccount,
}: {
  state: Snapshot;
  data: SessionData;
  member: Membership;
  personName: string;
  groups: readonly ConsoleNavGroup[];
  counts: Partial<Record<ConsolePage, number>>;
  page: ConsolePage | undefined;
  onPage: (page: ConsolePage) => void;
  collapsed: boolean;
  locked: boolean;
  onSessionChange: () => void;
  /** The intake switch for admins. Omit it for other people. */
  intake?:
    | {
        open: boolean;
        /** Whether a schedule drives intake, or staff set it by hand over the schedule. */
        schedule: "none" | "follows" | "overridden";
        disabled: boolean;
        onChange: (open: boolean) => void;
        /** Opens the panel where staff return intake to the schedule. */
        onReturn: () => void;
      }
    | undefined;
  /** True while the account page is open. */
  accountPage: boolean;
  onAccount: () => void;
}) {
  const id = useId();
  const accountButton = (
    <button
      type="button"
      aria-label={`Account settings for ${personName}`}
      aria-current={accountPage ? "page" : undefined}
      onClick={onAccount}
      className={cn(
        "flex h-12 w-full items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50",
        accountPage
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent",
        collapsed && "justify-center",
      )}
    >
      <PersonAvatar name={personName} personId={member.user_id} />
      <span className={cn("min-w-0 flex-1", collapsed && "sr-only")}>
        <span className="block truncate text-sm font-medium">{personName}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {roleNames(member)}
        </span>
      </span>
      {!collapsed && (
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
      )}
    </button>
  );
  return (
    <aside
      aria-label="Console"
      className={cn(
        "flex h-full shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width]",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="p-2">
        <SessionSwitcher
          state={state}
          data={data}
          collapsed={collapsed}
          locked={locked}
          onSessionChange={onSessionChange}
        />
      </div>
      <nav aria-label="Console pages" className="flex-1 overflow-y-auto px-2">
        {groups.map((group) => (
          <div key={group.label} className="pb-2">
            <h2
              className={cn(
                "px-2 py-2 text-xs font-medium text-muted-foreground",
                collapsed && "sr-only",
              )}
            >
              {group.label}
            </h2>
            <ul className="space-y-0.5">
              {group.pages.map((item) => {
                const Icon = pageIcons[item];
                const label = consolePageLabels[item];
                const count = counts[item];
                const link = (
                  <button
                    type="button"
                    aria-current={page === item ? "page" : undefined}
                    onClick={() => onPage(item)}
                    className={cn(
                      "flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50",
                      page === item
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      collapsed && "justify-center",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span
                      className={cn("flex-1 text-left", collapsed && "sr-only")}
                    >
                      {label}
                    </span>
                    {count !== undefined && count > 0 && (
                      <span
                        className={cn(
                          "text-xs text-muted-foreground tabular-nums",
                          collapsed && "sr-only",
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
                return (
                  <li key={item}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right">
                          {label}
                          {count ? ` · ${count}` : ""}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      {member.is_admin && (
        <div className="px-2 pb-2">
          <EventLink
            data={data}
            collapsed={collapsed}
            className={cn(
              "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed && "justify-center",
            )}
          />
          <SiteLink
            collapsed={collapsed}
            className={cn(
              "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed && "justify-center",
            )}
          />
        </div>
      )}
      {intake && !collapsed && (
        <div className="mx-2 mb-2 rounded-lg border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`${id}-intake`} className="text-sm font-medium">
              Contestant intake
            </label>
            <Switch
              id={`${id}-intake`}
              checked={intake.open}
              disabled={intake.disabled}
              onCheckedChange={intake.onChange}
              aria-describedby={`${id}-intake-state`}
            />
          </div>
          <p
            id={`${id}-intake-state`}
            className="mt-1 text-xs text-muted-foreground"
          >
            {intake.open
              ? "Teams can submit new reports."
              : "Teams cannot submit new reports."}
            {intake.schedule === "follows" && " Switching this overrides the schedule."}
            {intake.schedule === "overridden" && " Set by hand. This overrides the schedule."}
          </p>
          {intake.schedule === "overridden" && (
            <Button
              type="button"
              variant="link"
              className="mt-1 h-auto p-0 text-xs"
              onClick={intake.onReturn}
            >
              Return to schedule in settings
            </Button>
          )}
        </div>
      )}
      <div className="border-t p-2">
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{accountButton}</TooltipTrigger>
            <TooltipContent side="right">
              {personName} · Account settings
            </TooltipContent>
          </Tooltip>
        ) : (
          accountButton
        )}
      </div>
    </aside>
  );
}

/**
 * The top bar: the sidebar toggle, the breadcrumb, the command palette
 * button, Live or Reconnecting and the theme menu.
 */
export function ConsoleTopBar({
  sessionName,
  pageLabel,
  connected,
  collapsed,
  onToggleSidebar,
  onOpenPalette,
}: {
  sessionName: string;
  pageLabel: string;
  connected: boolean;
  collapsed: boolean;
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
}) {
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iP(?:hone|ad)/u.test(navigator.platform);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        onClick={onToggleSidebar}
      >
        <PanelLeft aria-hidden="true" />
      </Button>
      <span aria-hidden="true" className="h-5 w-px bg-border" />
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <li className="truncate">{sessionName}</li>
          <li aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </li>
          <li
            aria-current="page"
            className="truncate font-medium text-foreground"
          >
            {pageLabel}
          </li>
        </ol>
      </nav>
      <button
        type="button"
        onClick={onOpenPalette}
        aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
        className="ml-auto flex h-9 w-72 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground shadow-xs outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Search aria-hidden="true" className="size-4" />
        <span className="flex-1 text-left">Search teams, issues…</span>
        <kbd className="rounded border bg-muted px-1.5 font-mono text-[11px]">
          {mac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
      <span className="rounded-full border px-2.5 py-1">
        <ConnectionBadge connected={connected} />
      </span>
      <ThemeToggle />
    </header>
  );
}

const themeChoices: readonly {
  value: ThemePreference;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: "light", label: "Use light theme", icon: Sun },
  { value: "dark", label: "Use dark theme", icon: Moon },
  { value: "system", label: "Use the device theme", icon: Monitor },
];

/**
 * The ⌘K command palette. It finds issues by number or report text, teams by
 * the T0008 fuzzy search, pages and common actions. It does its own
 * filtering, so the cmdk filter is off.
 */
export function CommandPalette({
  open,
  onOpenChange,
  query,
  onQuery,
  state,
  issues,
  pages,
  canReport,
  onIssue,
  onTeam,
  onPage,
  onReport,
  onChangePassword,
  onSignOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQuery: (query: string) => void;
  state: Snapshot;
  /** The issues that this person can see. */
  issues: readonly Issue[];
  pages: readonly ConsolePage[];
  canReport: boolean;
  onIssue: (issueId: string) => void;
  onTeam: (teamId: string) => void;
  onPage: (page: ConsolePage) => void;
  onReport: () => void;
  onChangePassword: () => void;
  onSignOut: () => void;
}) {
  const theme = useTheme();
  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  const foundIssues = paletteIssues(issues, query);
  const foundTeams = query.trim()
    ? searchTeams(state.teams, state.issues, query).suggestions
    : [];
  const foundPages = pages.filter((page) =>
    labelMatches(consolePageLabels[page], query),
  );
  const actions = [
    ...(canReport
      ? [
          {
            key: "report",
            label: "Report for a team",
            icon: Plus,
            onSelect: onReport,
          },
        ]
      : []),
    ...themeChoices
      .filter((choice) => choice.value !== theme.preference)
      .map((choice) => ({
        key: choice.value,
        label: choice.label,
        icon: choice.icon,
        onSelect: () => theme.setPreference(choice.value),
      })),
    {
      key: "password",
      label: "Change password",
      icon: KeyRound,
      onSelect: onChangePassword,
    },
    { key: "sign-out", label: "Sign out", icon: LogOut, onSelect: onSignOut },
  ].filter((action) => labelMatches(action.label, query));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[15%] translate-y-0 overflow-hidden p-0 sm:max-w-xl"
        // Clear the query after the closing animation, so the list does not
        // change while the dialog fades out.
        onCloseAutoFocus={() => onQuery("")}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Find an issue, a team or a page, or run an action.
        </DialogDescription>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5"
        >
          <CommandInput
            value={query}
            onValueChange={onQuery}
            placeholder="Issue number, team, table or page…"
          />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            {foundIssues.length > 0 && (
              <CommandGroup heading="Issues">
                {foundIssues.map((issue) => {
                  const team = state.teams.find(
                    (item) => item.id === issue.team_id,
                  );
                  return (
                    <CommandItem
                      key={issue.id}
                      value={`issue-${issue.id}`}
                      onSelect={() => run(() => onIssue(issue.id))}
                    >
                      <StatusIcon status={issue.status} />
                      <span className="font-mono text-xs text-muted-foreground">
                        ISS-{issue.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {issue.description}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {team?.name}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {foundTeams.length > 0 && (
              <CommandGroup heading="Teams and tables">
                {foundTeams.map((team) => (
                  <CommandItem
                    key={team.id}
                    value={`team-${team.id}`}
                    onSelect={() => run(() => onTeam(team.id))}
                  >
                    <MapPin aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      {team.name}
                      <span className="text-muted-foreground">
                        {" "}
                        · {team.location}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {team.unresolved
                        ? unresolvedLabel(team.unresolved)
                        : "Clear"}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {foundPages.length > 0 && (
              <CommandGroup heading="Go to">
                {foundPages.map((page) => {
                  const Icon = pageIcons[page];
                  return (
                    <CommandItem
                      key={page}
                      value={`page-${page}`}
                      onSelect={() => run(() => onPage(page))}
                    >
                      <Icon aria-hidden="true" />
                      {consolePageLabels[page]}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {actions.length > 0 && (
              <CommandGroup heading="Actions">
                {actions.map(({ key, label, icon: Icon, onSelect }) => (
                  <CommandItem
                    key={key}
                    value={`action-${key}`}
                    onSelect={() => run(onSelect)}
                  >
                    <Icon aria-hidden="true" />
                    {label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
