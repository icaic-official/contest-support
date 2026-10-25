import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import {
  pageForPath,
  useRouteFocus,
  workspacePaths,
  type WorkspacePage,
} from "@/connected/navigation";
import { Button } from "@/components/ui/button";
import { inlineActionReturnsToList } from "@/connected/hooks/inlineAction";
import { useNow } from "@/connected/hooks/useNow";
import { useTeamSelection } from "@/connected/hooks/useTeamSelection";
import type { WorkflowState } from "@/connected/hooks/useWorkflowState";
import { type Issue, isStaff } from "@/connected/model";
import type { ShellProps } from "@/connected/shell";
import { initialTeamSelection } from "@/connected/teamSearch";
import { NoSessionAccess } from "@/screens/NoSessionAccess";
import { ActionSheet, CommandFeedback } from "../actions/ActionSheet";
import { emptyReply, type ReplyDraft } from "../actions/IssueForms";
import { emptyReport, ReportForm } from "../actions/ReportForm";
import {
  issueAbilities,
  openableIssues,
  type OrganiserTab,
  organiserTabs,
} from "../organiserModel";
import { useLeftIssueNotice } from "../useLeftIssueNotice";
import { PhoneIssueView } from "./PhoneIssueView";
import {
  type CardAction,
  PhoneHeader,
  PhoneStatus,
  TabBar,
  tabLabel,
} from "./PhoneParts";
import {
  AwardsTab,
  FindTab,
  type IssueSheet,
  MeTab,
  MineTab,
  type PhoneTabProps,
  QueueTab,
} from "./PhoneTabs";
import { SessionTab } from "./PhoneSessionTab";

const headingId = "organiser-tab-heading";

const tabPaths = {
  queue: workspacePaths.queue,
  mine: workspacePaths.mine,
  awards: workspacePaths.awards,
  find: workspacePaths.teams,
  session: workspacePaths.overview,
  me: workspacePaths.account,
} as const;

const pageTabs: Record<WorkspacePage, OrganiserTab> = {
  queue: "queue",
  mine: "mine",
  handoffs: "queue",
  teams: "find",
  awards: "awards",
  overview: "session",
  accounts: "session",
  roster: "session",
  settings: "session",
  account: "me",
};

function focusLater(id: string, fallback?: string) {
  window.requestAnimationFrame(() => {
    const target =
      document.getElementById(id) ??
      (fallback ? document.getElementById(fallback) : null);
    target?.focus();
  });
}

/**
 * The phone-first organiser app (mockup: design/redesign/e-organiser-phone.html).
 * Bottom tabs follow the person's combined roles. An issue opens as a
 * full-screen view over the tabs. The app stays mounted while the snapshot
 * is missing, so reply drafts and the chosen tab survive a refresh error.
 */
export function OrganiserPhoneApp({
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
  const navigate = useNavigate();
  const page = pageForPath(pathname);
  const tab = page ? pageTabs[page] : "queue";
  useRouteFocus(headingId, Boolean(member));
  const [pushSheet, setPushSheet] = useState<IssueSheet>();
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTeam, setReportTeam] = useTeamSelection(data.sessionId, state);
  const [reportDraft, setReportDraft] = useState(emptyReport);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, ReplyDraft>>(
    {},
  );

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
      setPushSheet(undefined);
      focusLater(headingId);
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

  const tabs = organiserTabs(member);
  const currentTab = tabs.includes(tab) ? tab : tabs[0];
  const archived = Boolean(state.event?.archived);
  const canReport = isStaff(member);

  function openIssue(issueId: string, sheet?: IssueSheet) {
    setPushSheet(sheet);
    workflow.selectIssue(issueId);
  }

  function closeIssue() {
    const issueId = workflow.selectedIssueId;
    setPushSheet(undefined);
    workflow.selectIssue("");
    focusLater(`issue-card-${issueId}`, headingId);
  }

  function cardAction(issue: Issue): CardAction | undefined {
    const can = issueAbilities(issue, state!, member!);
    if (can.accept) return "accept";
    if (can.claim) return "claim";
    return undefined;
  }

  function runCardAction(issue: Issue, action: CardAction) {
    const mark = workflow.selectionMark();
    void command
      .act(
        { type: action, issue_id: issue.id, revision: issue.revision },
        { stayOnPage: true },
      )
      .then((recorded) => {
        // The command does not open the issue. An issue the person opened
        // while it ran stays open. Otherwise focus returns to the card.
        if (!inlineActionReturnsToList(recorded, mark, workflow.selectionMark())) {
          return;
        }
        workflow.selectIssue("");
        focusLater(`issue-card-${issue.id}`, headingId);
      });
  }

  const tabProps: PhoneTabProps = {
    shell,
    state,
    member,
    workflow,
    now,
    openIssue,
    cardAction,
    runCardAction,
  };

  // The report sheet stays mounted when a recorded report opens its issue.
  return (
    <div data-ui="organiser-phone" className="h-full bg-background">
      {openedIssue ? (
        <PhoneIssueView
          key={openedIssue.id}
          issue={openedIssue}
          props={tabProps}
          initialSheet={pushSheet}
          onBack={closeIssue}
          replyDraft={replyDrafts[openedIssue.id] ?? emptyReply}
          onReplyDraft={(draft) =>
            setReplyDrafts((drafts) => ({ ...drafts, [openedIssue.id]: draft }))
          }
        />
      ) : (
        <div className="flex h-full flex-col">
          <PhoneHeader
            title={tabLabel(currentTab)}
            headingId={headingId}
            state={state}
            connected={data.connected}
            action={
              canReport &&
              currentTab !== "me" &&
              currentTab !== "session" && (
                <Button
                  className="h-11 rounded-full"
                  disabled={archived || command.locked}
                  onClick={() => setReportOpen(true)}
                >
                  <Plus aria-hidden="true" />
                  Report
                </Button>
              )
            }
          />
          <div className="relative flex-1 space-y-4 overflow-y-auto px-4 pb-6">
            <PhoneStatus state={state} data={data} command={command} />
            {leftNotice && (
              <p role="status" className="text-sm text-muted-foreground">
                {leftNotice}
              </p>
            )}
            {currentTab === "queue" && <QueueTab {...tabProps} />}
            {currentTab === "mine" && <MineTab {...tabProps} />}
            {currentTab === "awards" && <AwardsTab {...tabProps} />}
            {currentTab === "find" && <FindTab {...tabProps} />}
            {currentTab === "session" && <SessionTab {...tabProps} />}
            {currentTab === "me" && (
              <MeTab
                {...tabProps}
                onSessionChange={() => {
                  workflow.selectIssue("");
                  workflow.setStatusFilter("all");
                  setReportTeam(initialTeamSelection());
                  setReportDraft(emptyReport);
                  setReportOpen(false);
                  setReplyDrafts({});
                }}
              />
            )}
          </div>
          <TabBar
            tabs={tabs}
            current={currentTab}
            onSelect={(next) => {
              void navigate(tabPaths[next]);
              focusLater(headingId);
            }}
          />
        </div>
      )}
      {canReport && (
        <ActionSheet
          open={reportOpen}
          onOpenChange={setReportOpen}
          title="Report for a team"
          description="Find the team by name, location or table."
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
        </ActionSheet>
      )}
    </div>
  );
}
