import { CircleAlert, Plus, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { AccountPage, useOpenPasswordChange } from "@/connected/AccountPage";
import { useRouteFocus } from "@/connected/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useNow } from "@/connected/hooks/useNow";
import { useWorkflowState } from "@/connected/hooks/useWorkflowState";
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
 * The contestant UI for team accounts. It is a desktop app with no phone
 * layout (mockup: design/redesign/f-contestant-desktop.html).
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
  const [reporting, setReporting] = useState(false);
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
  const blocker = reportBlocker(state);

  /** Clears the open report and the report form after the session changes. */
  function resetForSession() {
    selectIssue("");
    setReporting(false);
  }

  function openIssue(issueId: string) {
    setReporting(false);
    selectIssue(issueId);
    requestFocus();
  }
  function openReport() {
    setReporting(true);
    requestFocus();
  }
  function closeReport() {
    setReporting(false);
    if (issue) {
      requestFocus();
    } else {
      window.requestAnimationFrame(() => reportButton.current?.focus());
    }
  }

  return (
    <div
      data-ui="contestant"
      className="flex h-full min-w-[1024px] flex-col bg-background text-foreground"
    >
      <a
        href="#contestant-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        Skip to report details
      </a>
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
        <div className="relative min-h-0 flex-1 overflow-y-auto p-8">
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
            : "grid min-h-0 flex-1 grid-cols-[320px_1fr] grid-rows-[minmax(0,1fr)]"
        }
      >
        <aside
          aria-label="Your reports"
          className="flex min-h-0 flex-col border-r bg-sidebar"
        >
          <div className="p-4">
            <Button
              ref={reportButton}
              className="h-10 w-full"
              disabled={Boolean(blocker) || command.locked}
              aria-describedby="report-availability"
              onClick={openReport}
            >
              <Plus aria-hidden="true" />
              Report an issue
            </Button>
            <p
              id="report-availability"
              className="mt-2 text-center text-xs text-muted-foreground"
            >
              {blocker ?? "A helper comes to your table."}
            </p>
          </div>
          <h2 className="px-4 pb-2 text-xs font-medium text-muted-foreground">
            Your reports
          </h2>
          <ReportList
            issues={issues}
            resolutions={state.resolutions}
            selectedId={reporting ? undefined : issue?.id}
            now={now}
            onSelect={openIssue}
          />
        </aside>
        {/* ConnectedApp already renders the page's <main> landmark. */}
        <div
          id="contestant-main"
          role="region"
          aria-label="Report details"
          tabIndex={-1}
          className="relative min-h-0 overflow-y-auto outline-none"
          aria-busy={command.busy}
        >
          {/* Sticky, so an error and its retry stay in view while scrolled. */}
          <div className="sticky top-0 z-10 mx-auto max-w-4xl space-y-2 px-8 pt-4 empty:hidden">
            {data.refreshError && (
              <Alert variant="destructive" className="shadow-md">
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{data.refreshError}</AlertDescription>
              </Alert>
            )}
            {command.error && (
              <Alert variant="destructive" className="shadow-md">
                <CircleAlert aria-hidden="true" />
                <AlertDescription className="flex items-center gap-3">
                  <span className="flex-1">{command.error}</span>
                  {command.pending && !command.busy && (
                    <Button size="sm" variant="outline" onClick={command.retry}>
                      <RotateCw aria-hidden="true" />
                      Retry last request
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
          <p role="status" className="sr-only">
            {command.notice}
          </p>
          {reporting ? (
            <ReportForm
              categories={state.session.categories}
              teamName={team?.name}
              location={team?.location}
              blocker={blocker}
              locked={command.locked}
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
          )}
        </div>
      </div>
    </div>
  );
}
