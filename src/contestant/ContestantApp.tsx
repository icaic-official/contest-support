import { ChevronLeft, CircleAlert, Plus, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { AccountPage, useOpenPasswordChange } from "@/connected/AccountPage";
import { useRouteFocus } from "@/connected/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ContestClock } from "@/connected/ContestClock";
import { desktopQuery, useMediaQuery } from "@/connected/hooks/useMediaQuery";
import { useNow } from "@/connected/hooks/useNow";
import { useWorkflowState } from "@/connected/hooks/useWorkflowState";
import {
  type ContestClock as ClockData,
  isRunning,
  type Issue,
  type Resolution,
} from "@/connected/model";
import type { ShellProps } from "@/connected/shell";
import { NoSessionAccess } from "@/screens/NoSessionAccess";
import { ContestantTopBar } from "./ContestantTopBar";
import {
  contestantHeadingId,
  reportBlocker,
  teamIssues,
} from "./contestantView";
import { IssuePage } from "./IssuePage";
import { ReportForm, type ReportDraft } from "./ReportForm";
import { ReportList } from "./ReportList";

/**
 * The contestant UI for team accounts. One app serves laptops and phones.
 * At 1024 px and wider it shows the report list beside the report. Below
 * that width it shows one screen at a time: the home (clock, report button
 * and report list), one report, or the report form. Both layouts share the
 * same components and state (mockup for the laptop layout:
 * design/redesign/f-contestant-desktop.html).
 *
 * Contestant views must never contain internal notes or staff-only images.
 * The server omits them for team accounts, and contestantView.ts filters
 * them again.
 */
export function ContestantApp(props: ShellProps) {
  const { user, username, data, signOut } = props;
  const openPasswordChange = useOpenPasswordChange();
  const workflow = useWorkflowState(data);
  const { command, selectedIssueId, selectIssue } = workflow;
  const now = useNow(data.clockOffset);
  const { pathname } = useLocation();
  const accountPage = pathname.replace(/\/+$/u, "") === "/account";
  const desktop = useMediaQuery(desktopQuery);
  const [reporting, setReporting] = useState(false);
  // Phone only: whether the selected report fills the screen. The first
  // report is always selected, so the home needs its own flag.
  const [issueOpen, setIssueOpen] = useState(false);
  const [reportDraft, setReportDraft] = useState<ReportDraft>({
    category: "",
    description: "",
  });
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [reopenDrafts, setReopenDrafts] = useState<Record<string, string>>({});
  // Counts focus requests. State, not a ref: the effect then runs after the
  // commit that shows the new heading. With a ref, pending effects of an
  // earlier refresh could focus the old heading, which has the same ID.
  const [focusRequests, setFocusRequests] = useState(0);
  const reportButton = useRef<HTMLButtonElement>(null);

  /** Moves focus to the main heading after the next render. */
  const requestFocus = useCallback(() => {
    setFocusRequests((count) => count + 1);
  }, []);
  useEffect(() => {
    if (focusRequests === 0) return;
    document.getElementById(contestantHeadingId)?.focus();
  }, [focusRequests]);

  const state = data.snapshot;
  const membership = state?.membership;
  const headingId = accountPage
    ? "contestant-account-heading"
    : contestantHeadingId;
  useRouteFocus(headingId, Boolean(membership));
  if (!state || !membership || !state.session || !membership.team_id) {
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
  const teamId = membership.team_id;
  const team = state.teams.find((item) => item.id === teamId);
  const issues = teamIssues(state.issues, teamId);
  const issue = issues.find((item) => item.id === selectedIssueId) ?? issues[0];
  const blocker = reportBlocker(state, now);
  const view = reporting ? "report" : issueOpen && issue ? "issue" : "home";

  /** Clears the open report and the report form after the session changes. */
  function resetForSession() {
    selectIssue("");
    setReporting(false);
    setIssueOpen(false);
  }

  function openIssue(issueId: string) {
    setReporting(false);
    setIssueOpen(true);
    selectIssue(issueId);
    requestFocus();
  }
  function openReport() {
    setReporting(true);
    requestFocus();
  }
  function closeReport() {
    setReporting(false);
    if (issue && (desktop || issueOpen)) {
      requestFocus();
    } else if (desktop) {
      window.requestAnimationFrame(() => reportButton.current?.focus());
    } else {
      requestFocus();
    }
  }
  function closeIssue() {
    setIssueOpen(false);
    requestFocus();
  }

  const alerts = (
    // Sticky, so an error and its retry stay in view while scrolled.
    <div className="sticky top-0 z-10 mx-auto w-full max-w-4xl shrink-0 space-y-2 px-4 pt-2 empty:hidden lg:px-8 lg:pt-4">
      {data.refreshError && (
        <Alert variant="destructive" className="shadow-md">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{data.refreshError}</AlertDescription>
        </Alert>
      )}
      {command.error && (
        <Alert variant="destructive" className="shadow-md">
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1">{command.error}</span>
            {command.pending && !command.busy && (
              <Button
                size="sm"
                variant="outline"
                className="max-lg:h-11"
                onClick={command.retry}
              >
                <RotateCw aria-hidden="true" />
                Retry last request
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
  const status = (
    <p role="status" className="sr-only">
      {command.notice}
    </p>
  );
  const reportsPane = (
    <ReportsPane
      clock={state.clock}
      now={now}
      reportButton={reportButton}
      reportDisabled={Boolean(blocker) || command.locked}
      availability={blocker ?? "A helper comes to your table."}
      onReport={openReport}
      issues={issues}
      resolutions={state.resolutions}
      selectedId={reporting || !desktop ? undefined : issue?.id}
      onSelect={openIssue}
      headingId={desktop ? undefined : contestantHeadingId}
    />
  );
  const detail = reporting ? (
    <ReportForm
      categories={state.session.categories}
      teamName={team?.name}
      location={team?.location}
      blocker={blocker}
      locked={command.locked}
      sending={isRunning(command.running, "submit")}
      draft={reportDraft}
      onDraft={setReportDraft}
      onCancel={closeReport}
      onSubmit={(draft) => {
        void command.act(
          {
            type: "submit",
            category: draft.category,
            description: draft.description,
          },
          {
            // Runs once the server records the report, also after a
            // retry. useWorkflowState then selects the new issue.
            onSuccess: () => {
              setReportDraft({ category: "", description: "" });
              setReporting(false);
              setIssueOpen(true);
              requestFocus();
            },
          },
        );
      }}
    />
  ) : issue ? (
    <IssuePage
      key={issue.id}
      issue={issue}
      snapshot={state}
      userId={user.id}
      location={team?.location}
      now={now}
      command={command}
      replyDraft={replyDrafts[issue.id] ?? ""}
      onReplyDraft={(value) =>
        setReplyDrafts((drafts) => ({ ...drafts, [issue.id]: value }))
      }
      reopenDraft={reopenDrafts[issue.id] ?? ""}
      onReopenDraft={(value) =>
        setReopenDrafts((drafts) => ({ ...drafts, [issue.id]: value }))
      }
      refresh={data.refresh}
    />
  ) : (
    <div className="mx-auto max-w-xl p-8 pt-24 text-center">
      <h1
        id={contestantHeadingId}
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight outline-none"
      >
        No reports yet
      </h1>
      <p className="mt-2 text-muted-foreground">
        {blocker ??
          "When something goes wrong at your table, use Report an issue. A helper will come to you."}
      </p>
      {!blocker && (
        <Button
          className="mt-6"
          disabled={command.locked}
          onClick={openReport}
        >
          <Plus aria-hidden="true" />
          Report an issue
        </Button>
      )}
    </div>
  );

  return (
    <div
      data-ui="contestant"
      className="flex h-full flex-col bg-background text-foreground"
    >
      {!accountPage && (desktop || view !== "home") && (
        <a
          href="#contestant-main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
        >
          Skip to report details
        </a>
      )}
      <ContestantTopBar
        eventName={state.event?.name}
        sessionName={state.session.name}
        sessions={data.sessions}
        sessionId={data.sessionId}
        connected={data.connected}
        locked={command.locked}
        teamName={team?.name ?? "Your team"}
        location={team?.location}
        account={username ?? user.email ?? undefined}
        onSelectSession={(sessionId) => {
          data.selectSession(sessionId);
          resetForSession();
        }}
        changePassword={openPasswordChange}
        signOut={signOut}
      />
      {accountPage && (
        <div className="relative min-h-0 flex-1 overflow-y-auto p-4 lg:p-8">
          <AccountPage
            shell={props}
            state={state}
            member={membership}
            headingId={headingId}
            now={now}
            locked={command.locked}
            onSessionChange={resetForSession}
          />
        </div>
      )}
      <div
        hidden={accountPage}
        className={
          accountPage
            ? "hidden"
            : desktop
              ? "grid min-h-0 flex-1 grid-cols-[320px_1fr] grid-rows-[minmax(0,1fr)]"
              : "flex min-h-0 flex-1 flex-col"
        }
      >
        {desktop ? (
          <>
            {reportsPane}
            {/* ConnectedApp already renders the page's <main> landmark. */}
            <div
              id="contestant-main"
              role="region"
              aria-label="Report details"
              tabIndex={-1}
              className="relative min-h-0 overflow-y-auto outline-none"
              aria-busy={command.busy}
            >
              {alerts}
              {status}
              {detail}
            </div>
          </>
        ) : view === "home" ? (
          <div className="flex min-h-0 flex-1 flex-col" aria-busy={command.busy}>
            {alerts}
            {status}
            {reportsPane}
          </div>
        ) : (
          <div
            id="contestant-main"
            role="region"
            aria-label="Report details"
            tabIndex={-1}
            className="relative flex min-h-0 flex-1 flex-col outline-none"
            aria-busy={command.busy}
          >
            {view === "issue" && (
              <div className="shrink-0 border-b px-2">
                <Button
                  variant="ghost"
                  className="-ml-1 h-11"
                  onClick={closeIssue}
                >
                  <ChevronLeft aria-hidden="true" />
                  Your reports
                </Button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {alerts}
              {status}
              {detail}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The clock, the report button and the team's reports. It is the left column
 * on a laptop and the home screen on a phone.
 */
function ReportsPane({
  clock,
  now,
  reportButton,
  reportDisabled,
  availability,
  onReport,
  issues,
  resolutions,
  selectedId,
  onSelect,
  headingId,
}: {
  clock: ClockData | null | undefined;
  now: number;
  reportButton: React.RefObject<HTMLButtonElement | null>;
  reportDisabled: boolean;
  availability: string;
  onReport: () => void;
  issues: readonly Issue[];
  resolutions: readonly Resolution[];
  selectedId: string | undefined;
  onSelect: (issueId: string) => void;
  /** Set on a phone, where this pane holds the page heading. */
  headingId: string | undefined;
}) {
  return (
    <aside
      aria-label="Your reports"
      className="flex min-h-0 flex-1 flex-col bg-sidebar lg:flex-none lg:border-r"
    >
      <div className="p-4">
        <ContestClock clock={clock} now={now} />
        <Button
          ref={reportButton}
          className="h-11 w-full lg:h-10"
          disabled={reportDisabled}
          aria-describedby="report-availability"
          onClick={onReport}
        >
          <Plus aria-hidden="true" />
          Report an issue
        </Button>
        <p
          id="report-availability"
          className="mt-2 text-center text-xs text-muted-foreground"
        >
          {availability}
        </p>
      </div>
      <h2
        id={headingId}
        tabIndex={headingId ? -1 : undefined}
        className="px-4 pb-2 text-xs font-medium text-muted-foreground outline-none"
      >
        Your reports
      </h2>
      <ReportList
        issues={issues}
        resolutions={resolutions}
        selectedId={selectedId}
        now={now}
        onSelect={onSelect}
      />
    </aside>
  );
}
