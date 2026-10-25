import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Archive } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { RenderErrorBoundary } from "@/components/render-error-boundary";
import { AccountPage, useOpenPasswordChange } from "@/connected/AccountPage";
import { accountName } from "@/connected/accountModel";
import {
  pageForPath,
  useRouteFocus,
  workspacePaths,
} from "@/connected/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TooltipProvider } from "@/components/ui/tooltip";
import { inlineActionReturnsToList } from "@/connected/hooks/inlineAction";
import { useNow } from "@/connected/hooks/useNow";
import { useTeamSelection } from "@/connected/hooks/useTeamSelection";
import type { WorkflowState } from "@/connected/hooks/useWorkflowState";
import { type Issue, isStaff, type Snapshot } from "@/connected/model";
import type { ShellProps } from "@/connected/shell";
import { chooseTeam, initialTeamSelection } from "@/connected/teamSearch";
import { cn } from "@/lib/utils";
import { NoSessionAccess } from "@/screens/NoSessionAccess";
import { ActionDialog } from "../actions/ActionDialog";
import { CommandFeedback } from "../actions/ActionSheet";
import { emptyReply, type ReplyDraft } from "../actions/IssueForms";
import { emptyReport, ReportForm } from "../actions/ReportForm";
import { AdminFeedback } from "../admin/AccountAccess";
import { type SessionAdmin, useSessionAdmin } from "../admin/useSessionAdmin";
import {
  issueAbilities,
  openableIssues,
  visibleIssues,
} from "../organiserModel";
import { useLeftIssueNotice } from "../useLeftIssueNotice";
import {
  AccountsPage,
  OverviewPage,
  RosterPage,
  SettingsPage,
} from "./AdminPages";
import { AwardReviewPage } from "./AwardReviewPage";
import { CommandPalette, ConsoleSidebar, ConsoleTopBar } from "./ConsoleChrome";
import {
  type ConsolePageProps,
  consoleHeadingId,
  type RowAction,
  type SheetTab,
} from "./consoleProps";
import {
  type ConsolePage,
  consoleNavGroups,
  consolePageLabels,
  navCount,
} from "./consoleModel";
import { IssueSheet } from "./IssueSheet";
import { issueRowId } from "./IssueTable";
import { HandoffsPage, MinePage, QueuePage, TeamsPage } from "./QueuePages";

const sidebarKey = "minsky:console-sidebar";

function focusLater(id: string, fallback?: string) {
  window.requestAnimationFrame(() => {
    const target =
      document.getElementById(id) ??
      (fallback ? document.getElementById(fallback) : null);
    target?.focus();
  });
}

function storedCollapsed(): boolean {
  try {
    return window.localStorage.getItem(sidebarKey) === "collapsed";
  } catch {
    return false;
  }
}

/** Whether a key press comes from a field or an open dialog. */
function typingOrDialog(event: KeyboardEvent): boolean {
  const target = event.target instanceof Element ? event.target : null;
  return Boolean(
    target?.closest("input, textarea, select, [contenteditable='true']") ||
    document.querySelector("[role='dialog']"),
  );
}

/**
 * Runs the session admin requests while a snapshot exists. The sidebar
 * intake switch and the admin pages share one instance, so one request runs
 * at a time.
 */
function SessionAdminScope({
  state,
  refresh,
  children,
}: {
  state: Snapshot;
  refresh: () => Promise<void>;
  children: (admin: SessionAdmin) => ReactNode;
}) {
  return children(useSessionAdmin(state, refresh));
}

/**
 * The organiser desktop console for laptops and tablets
 * (mockup: design/redesign/a-console.html). A collapsible sidebar holds the
 * session switcher, the pages for the person's combined roles, the intake
 * switch for admins and the person card, which opens the account page. The
 * top bar has the breadcrumb, the ⌘K command palette, Live or Reconnecting
 * and the theme menu. An issue opens in a side sheet over the page.
 *
 * The console keeps the page, the reply drafts and the team filters while
 * the snapshot is missing, so they survive a refresh error.
 */
export function OrganiserDesktopConsole({
  shell,
  workflow,
}: {
  shell: ShellProps;
  workflow: WorkflowState;
}) {
  const { data, user, username, signOut } = shell;
  const state = data.snapshot;
  const member = state?.membership;
  const { command } = workflow;
  const now = useNow(data.clockOffset);
  const { pathname } = useLocation();
  const navigateTo = useNavigate();
  const openPasswordChange = useOpenPasswordChange();
  const page = pageForPath(pathname);
  const accountPage = page === "account";
  useRouteFocus(consoleHeadingId, Boolean(member));
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const [sheetTab, setSheetTab] = useState<SheetTab>("activity");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTeam, setReportTeam] = useTeamSelection(data.sessionId, state);
  const [reportDraft, setReportDraft] = useState(emptyReport);
  const [queueTeam, setQueueTeam] = useTeamSelection(data.sessionId, state);
  const [teamPageTeam, setTeamPageTeam] = useState<string>();
  const [replyDrafts, setReplyDrafts] = useState<Record<string, ReplyDraft>>(
    {},
  );
  // The control that opened the issue sheet gets focus when it closes.
  const sheetOpener = useRef<{ element: Element | null; issueId: string }>(
    undefined,
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      // J and K move between the issue rows of the current page.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "j" && event.key !== "k") return;
      if (typingOrDialog(event)) return;
      const rows = [
        ...document.querySelectorAll<HTMLElement>("[data-issue-row]"),
      ];
      if (!rows.length) return;
      const index = rows.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "j" ? 1 : -1;
      const next =
        index < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, index + step));
      event.preventDefault();
      rows[next].focus();
      rows[next].scrollIntoView({ block: "nearest" });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const openedIssue =
    state && member
      ? openableIssues(state, member).find(
          (issue) => issue.id === workflow.selectedIssueId,
        )
      : undefined;
  const leftNotice = useLeftIssueNotice(
    workflow.selectedIssueId,
    workflow.selectIssue,
    openedIssue,
    useCallback(() => {
      sheetOpener.current = undefined;
      focusLater(consoleHeadingId);
    }, []),
  );

  if (!state || !member || !state.session) {
    return (
      <NoSessionAccess
        data={data}
        account={username ?? user.email ?? undefined}
        signOut={signOut}
        error={command.error}
        onRetry={command.pending && !command.busy ? command.retry : undefined}
      />
    );
  }

  const groups = consoleNavGroups(member);
  const pages = groups.flatMap((group) => group.pages);
  const currentPage =
    page && page !== "account" && pages.includes(page) ? page : pages[0];
  const issues = visibleIssues(state.issues, member);
  const archived = Boolean(state.event?.archived);
  const canReport = isStaff(member);
  const personName = accountName(state, user, username);
  const counts = Object.fromEntries(
    pages.map((item) => [item, navCount(item, issues, state, member)]),
  );

  function navigate(next: ConsolePage) {
    void navigateTo(workspacePaths[next]);
    if (next === "teams") setTeamPageTeam(undefined);
    focusLater(consoleHeadingId);
  }

  function toggleSidebar() {
    setCollapsed((current) => {
      try {
        window.localStorage.setItem(
          sidebarKey,
          current ? "expanded" : "collapsed",
        );
      } catch {
        // The choice still applies until the page reloads.
      }
      return !current;
    });
  }

  function openIssue(issueId: string, tab: SheetTab = "activity") {
    if (!openedIssue) {
      sheetOpener.current = { element: document.activeElement, issueId };
    }
    setSheetTab(tab);
    workflow.selectIssue(issueId);
  }

  /**
   * Returns focus to the control that opened the sheet. A control that is
   * gone, such as a card that moved to another award list, gives focus to
   * the issue row or the page heading.
   */
  function returnSheetFocus() {
    const opener = sheetOpener.current;
    sheetOpener.current = undefined;
    const element = opener?.element;
    const target =
      (element instanceof HTMLElement &&
      element.isConnected &&
      element !== document.body
        ? element
        : null) ??
      (opener ? document.getElementById(issueRowId(opener.issueId)) : null) ??
      document.getElementById(consoleHeadingId);
    target?.focus();
  }

  function openReport(teamId?: string) {
    if (teamId) setReportTeam(chooseTeam(teamId));
    setReportOpen(true);
  }

  function rowAction(issue: Issue): RowAction | undefined {
    const can = issueAbilities(issue, state!, member!);
    if (can.accept) return "accept";
    if (can.claim) return "claim";
    return undefined;
  }

  function runRowAction(issue: Issue, action: RowAction) {
    const mark = workflow.selectionMark();
    void command
      .act(
        { type: action, issue_id: issue.id, revision: issue.revision },
        { stayOnPage: true },
      )
      .then((recorded) => {
        // The command does not open the issue. An issue the person opened
        // while it ran stays open. Otherwise focus returns to the row.
        if (
          !inlineActionReturnsToList(recorded, mark, workflow.selectionMark())
        ) {
          return;
        }
        workflow.selectIssue("");
        focusLater(issueRowId(issue.id), consoleHeadingId);
      });
  }

  function changeSession() {
    workflow.selectIssue("");
    workflow.setStatusFilter("all");
    setQueueTeam(initialTeamSelection());
    setReportTeam(initialTeamSelection());
    setReportDraft(emptyReport);
    setTeamPageTeam(undefined);
    setReportOpen(false);
    setReplyDrafts({});
  }

  const pageProps: ConsolePageProps = {
    shell,
    state,
    member,
    workflow,
    now,
    openIssue,
    rowAction,
    runRowAction,
  };

  return (
    <TooltipProvider>
      <SessionAdminScope state={state} refresh={data.refresh}>
        {(admin) => (
          <div
            data-ui="organiser-desktop"
            className="flex h-full overflow-hidden bg-background text-foreground"
          >
            <ConsoleSidebar
              state={state}
              data={data}
              member={member}
              personName={personName}
              groups={groups}
              counts={counts}
              page={accountPage ? undefined : currentPage}
              onPage={navigate}
              collapsed={collapsed}
              locked={command.locked}
              onSessionChange={changeSession}
              intake={
                member.is_admin
                  ? {
                      open: state.session!.intake_open,
                      disabled: admin.busy || admin.archived,
                      onChange: (open) => {
                        void admin.setIntake(open);
                      },
                    }
                  : undefined
              }
              accountPage={accountPage}
              onAccount={() => void navigateTo(workspacePaths.account)}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <ConsoleTopBar
                sessionName={state.session!.name}
                pageLabel={
                  accountPage ? "My account" : consolePageLabels[currentPage]
                }
                connected={data.connected}
                collapsed={collapsed}
                onToggleSidebar={toggleSidebar}
                onOpenPalette={() => setPaletteOpen(true)}
              />
              {/* ConnectedApp already renders the page's <main> landmark. */}
              <div className="relative flex-1 overflow-y-auto">
                <div className="mx-auto max-w-[1400px] space-y-4 p-6">
                  <div
                    className={cn(
                      "space-y-2 empty:hidden",
                      // An error stays in view, because the row that failed can be far down the page.
                      (data.refreshError || command.error) &&
                        "sticky top-0 z-10 bg-background pb-2",
                    )}
                  >
                    {archived && (
                      <Alert>
                        <Archive aria-hidden="true" />
                        <AlertDescription>
                          This event is archived. Records are read only.
                        </AlertDescription>
                      </Alert>
                    )}
                    {data.refreshError && (
                      <Alert variant="destructive">
                        <AlertDescription>
                          <p role="alert">{data.refreshError}</p>
                        </AlertDescription>
                      </Alert>
                    )}
                    <CommandFeedback command={command} />
                    {leftNotice && (
                      <p
                        role="status"
                        className="text-sm text-muted-foreground"
                      >
                        {leftNotice}
                      </p>
                    )}
                    {command.notice && (
                      <p
                        role="status"
                        className="text-xs text-muted-foreground"
                      >
                        {command.notice}
                      </p>
                    )}
                    {member.is_admin && (admin.error || admin.notice) && (
                      <AdminFeedback
                        error={admin.error}
                        notice={admin.notice}
                      />
                    )}
                  </div>
                  {/* A failed page keeps the sidebar and top bar usable. */}
                  <RenderErrorBoundary
                    scope="region"
                    resetKey={accountPage ? "account" : currentPage}
                  >
                    {accountPage ? (
                      <AccountPage
                        shell={shell}
                        state={state}
                        member={member}
                        headingId={consoleHeadingId}
                        now={now}
                        locked={command.locked}
                        onSessionChange={changeSession}
                      />
                    ) : (
                      <>
                        {currentPage === "queue" && (
                          <QueuePage
                            props={pageProps}
                            teamSelection={queueTeam}
                            onTeamSelection={setQueueTeam}
                            onReport={
                              canReport ? () => openReport() : undefined
                            }
                          />
                        )}
                        {currentPage === "mine" && (
                          <MinePage props={pageProps} />
                        )}
                        {currentPage === "handoffs" && (
                          <HandoffsPage props={pageProps} />
                        )}
                        {currentPage === "teams" && (
                          <TeamsPage
                            props={pageProps}
                            teamId={teamPageTeam}
                            onTeam={(teamId) => {
                              setTeamPageTeam(teamId);
                              focusLater(consoleHeadingId);
                            }}
                            onReport={canReport ? openReport : undefined}
                          />
                        )}
                        {currentPage === "awards" && (
                          <AwardReviewPage props={pageProps} />
                        )}
                        {currentPage === "overview" && (
                          <OverviewPage props={pageProps} />
                        )}
                        {currentPage === "accounts" && (
                          <AccountsPage props={pageProps} admin={admin} />
                        )}
                        {currentPage === "roster" && (
                          <RosterPage props={pageProps} admin={admin} />
                        )}
                        {currentPage === "settings" && (
                          <SettingsPage props={pageProps} admin={admin} />
                        )}
                      </>
                    )}
                  </RenderErrorBoundary>
                </div>
              </div>
            </div>
            <IssueSheet
              issue={openedIssue}
              props={pageProps}
              tab={sheetTab}
              onTab={setSheetTab}
              onClose={() => workflow.selectIssue("")}
              onClosed={returnSheetFocus}
              replyDraft={
                (openedIssue && replyDrafts[openedIssue.id]) || emptyReply
              }
              onReplyDraft={(draft) => {
                if (!openedIssue) return;
                setReplyDrafts((drafts) => ({
                  ...drafts,
                  [openedIssue.id]: draft,
                }));
              }}
            />
            {canReport && (
              <ActionDialog
                open={reportOpen}
                onOpenChange={setReportOpen}
                title="Report for a team"
                description="Find the team by name, location or table."
                className="sm:max-w-lg"
              >
                <CommandFeedback command={command} className="mb-3" />
                <ReportForm
                  state={state}
                  command={command}
                  selection={reportTeam}
                  onSelection={setReportTeam}
                  draft={reportDraft}
                  onDraft={setReportDraft}
                  onDone={() => setReportOpen(false)}
                />
              </ActionDialog>
            )}
            <CommandPalette
              open={paletteOpen}
              onOpenChange={setPaletteOpen}
              query={paletteQuery}
              onQuery={setPaletteQuery}
              state={state}
              issues={issues}
              pages={pages}
              canReport={canReport && !archived}
              onIssue={(issueId) => openIssue(issueId)}
              onTeam={(teamId) => {
                if (pages.includes("queue")) {
                  setQueueTeam(chooseTeam(teamId));
                  navigate("queue");
                } else {
                  navigate("teams");
                  setTeamPageTeam(teamId);
                }
              }}
              onPage={navigate}
              onReport={() => openReport()}
              onChangePassword={openPasswordChange}
              onSignOut={signOut}
            />
          </div>
        )}
      </SessionAdminScope>
    </TooltipProvider>
  );
}
