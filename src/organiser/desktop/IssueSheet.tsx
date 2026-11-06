import { type ReactNode, useState } from "react";
import {
  ArrowUpRight,
  Camera,
  Check,
  CheckCheck,
  Hand,
  Handshake,
  MapPin,
  RotateCcw,
  Scale,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isRunning, type Issue } from "@/connected/model";
import { ActionDialog } from "../actions/ActionDialog";
import { CommandFeedback } from "../actions/ActionSheet";
import {
  ApplyForm,
  AwardForm,
  EscalateForm,
  ReopenForm,
  type ReplyDraft,
  ReplyForm,
  ResolveForm,
} from "../actions/IssueForms";
import { OrganiserImages } from "../actions/OrganiserImages";
import {
  ActivityList,
  AwardReceipt,
  HandoffBanner,
  IssueTimers,
  LifecycleBar,
  lifecycleDetails,
  OwnerCard,
  ResolutionHistory,
} from "../components/IssueDetails";
import { StatusBadge } from "../components/issueDisplay";
import {
  issueAbilities,
  missingActionHint,
  primaryAction,
} from "../organiserModel";
import { type ConsolePageProps, type SheetTab, sheetTabs } from "./consoleProps";

/** A task of the sheet that opens in a dialog. */
type SheetDialog = "resolve" | "escalate" | "reopen";

const dialogText: Record<SheetDialog, { title: string; description?: string }> =
  {
    resolve: { title: "Resolve issue" },
    escalate: { title: "Escalate to a specialist?" },
    reopen: { title: "Reopen issue" },
  };

/**
 * The issue side sheet of the desktop console: the report, timer cards, the
 * lifecycle stepper, the handoff banner and the actions, then the Activity,
 * Images and Outcome & award tabs and a composer for public replies and
 * internal notes. Resolve, escalate and reopen open a dialog. Award decisions
 * and external application are on the Outcome & award tab.
 */
export function IssueSheet({
  issue,
  props,
  tab,
  onTab,
  onClose,
  onClosed,
  replyDraft,
  onReplyDraft,
}: {
  /** The open issue, or undefined when the sheet is closed. */
  issue: Issue | undefined;
  props: ConsolePageProps;
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  onClose: () => void;
  /** Moves focus after the sheet closes. */
  onClosed: () => void;
  replyDraft: ReplyDraft;
  onReplyDraft: (draft: ReplyDraft) => void;
}) {
  // Keep the last issue on screen while the sheet slides out, so the panel
  // does not go blank during the close animation.
  const [lastIssue, setLastIssue] = useState(issue);
  if (issue && issue !== lastIssue) setLastIssue(issue);
  const shown = issue ?? lastIssue;
  return (
    <Sheet
      open={Boolean(issue)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        // Radix returns focus only to a Dialog.Trigger. The sheet opens from
        // many controls, so the console moves focus itself.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
        className="w-[min(680px,100vw)] gap-0 p-0 sm:max-w-[680px]"
      >
        {shown && (
          <IssueSheetBody
            key={shown.id}
            issue={shown}
            props={props}
            tab={tab}
            onTab={onTab}
            onClose={onClose}
            replyDraft={replyDraft}
            onReplyDraft={onReplyDraft}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function IssueSheetBody({
  issue,
  props,
  tab,
  onTab,
  onClose,
  replyDraft,
  onReplyDraft,
}: {
  issue: Issue;
  props: ConsolePageProps;
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  onClose: () => void;
  replyDraft: ReplyDraft;
  onReplyDraft: (draft: ReplyDraft) => void;
}) {
  const { state, member, workflow, now, shell } = props;
  const { command } = workflow;
  // The dialog keeps its content while its close animation runs.
  const [dialog, setDialogContent] = useState<SheetDialog>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const openDialog = (next: SheetDialog) => {
    setDialogContent(next);
    setDialogOpen(true);
  };
  const openUpload = () => {
    onTab("images");
    setUploadOpen(true);
  };
  const team = state.teams.find((item) => item.id === issue.team_id);
  const teamName = team?.name ?? "the team";
  const can = issueAbilities(issue, state, member);
  const primary = primaryAction(can);
  const hint = missingActionHint(issue, member, Boolean(state.event?.archived));
  const award = state.awards.find((item) => item.issue_id === issue.id);
  const historyCount = state.history.filter(
    (item) => item.issue_id === issue.id,
  ).length;
  const imageCount = state.attachments.filter(
    (item) => item.issue_id === issue.id,
  ).length;
  const base = { issue_id: issue.id, revision: issue.revision };
  const disabled = command.locked;
  const decideId = `decide-${issue.id}`;
  const applyId = `apply-${issue.id}`;
  // The tab can already be open, so focus moves either way. The panel is
  // still hidden until React renders, so focus waits one frame.
  const showOutcome = (headingId: string) => {
    onTab("outcome");
    window.requestAnimationFrame(() =>
      document.getElementById(headingId)?.focus(),
    );
  };

  const actions: ReactNode[] = [];
  // The primary action is a filled button. Other actions are outlined.
  const add = (
    key: string,
    isPrimary: boolean,
    node: (variant: "default" | "outline") => ReactNode,
  ) =>
    actions.push(
      <span key={key}>{node(isPrimary ? "default" : "outline")}</span>,
    );
  if (can.accept) {
    add("accept", primary === "accept", (variant) => (
      <Button
        variant={variant}
        disabled={disabled}
        loading={isRunning(command.running, "accept", issue.id)}
        onClick={() => void command.act({ type: "accept", ...base })}
      >
        <Handshake aria-hidden="true" />
        Accept handoff
      </Button>
    ));
  }
  if (can.claim) {
    add("claim", primary === "claim", (variant) => (
      <Button
        variant={variant}
        disabled={disabled}
        loading={isRunning(command.running, "claim", issue.id)}
        onClick={() => void command.act({ type: "claim", ...base })}
      >
        <Hand aria-hidden="true" />
        Claim
      </Button>
    ));
  }
  if (can.resolve) {
    add("resolve", primary === "resolve", (variant) => (
      <Button
        variant={variant}
        disabled={disabled}
        onClick={() => openDialog("resolve")}
      >
        <Check aria-hidden="true" />
        Resolve
      </Button>
    ));
  }
  if (can.escalate) {
    add("escalate", false, (variant) => (
      <Button
        variant={variant}
        disabled={disabled}
        onClick={() => openDialog("escalate")}
      >
        <ArrowUpRight aria-hidden="true" />
        Escalate to specialist
      </Button>
    ));
  }
  if (can.award) {
    add("award", primary === "award", (variant) => (
      <Button variant={variant} onClick={() => showOutcome(decideId)}>
        <Scale aria-hidden="true" />
        Decide award
      </Button>
    ));
  }
  if (can.apply) {
    add("apply", primary === "apply", (variant) => (
      <Button variant={variant} onClick={() => showOutcome(applyId)}>
        <CheckCheck aria-hidden="true" />
        Confirm applied
      </Button>
    ));
  }
  if (can.reopen) {
    add("reopen", false, (variant) => (
      <Button
        variant={variant}
        disabled={disabled}
        onClick={() => openDialog("reopen")}
      >
        <RotateCcw aria-hidden="true" />
        Reopen
      </Button>
    ));
  }
  if (can.upload) {
    add("image", false, (variant) => (
      <Button variant={variant} onClick={openUpload}>
        <Camera aria-hidden="true" />
        Add image
      </Button>
    ));
  }

  const formProps = {
    issue,
    command,
    onDone: () => setDialogOpen(false),
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        <div className="space-y-3 px-6 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              ISS-{issue.number}
            </span>
            <StatusBadge status={issue.status} />
            <Badge variant="outline" className="text-muted-foreground">
              {issue.category}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto"
              aria-label="Close issue"
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <SheetTitle className="text-lg leading-snug break-words whitespace-pre-wrap">
            <span className="sr-only">ISS-{issue.number}: </span>
            {issue.description}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5">
              <Users aria-hidden="true" className="size-4" />
              {teamName}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin aria-hidden="true" className="size-4" />
              {team?.location ?? "Location unknown"}
            </span>
            <span>Reported by {issue.reporter_name}</span>
          </SheetDescription>
          <CommandFeedback command={command} />
          <div className="grid grid-cols-[2fr_1fr] gap-2">
            <IssueTimers issue={issue} state={state} now={now} />
            <OwnerCard issue={issue} userId={member.user_id} />
          </div>
          <LifecycleBar status={issue.status} details={lifecycleDetails(issue)} />
          <HandoffBanner issue={issue} />
          {actions.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2">{actions}</div>
              {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {state.event?.archived
                ? "This event is archived. Records are read only."
                : issue.owner_name
                  ? `${issue.owner_name} owns this issue.`
                  : "No action available."}
            </p>
          )}
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            const next = sheetTabs.find((item) => item === value);
            if (next) onTab(next);
          }}
          className="gap-0"
        >
          <TabsList
            variant="line"
            className="sticky top-0 z-10 h-11 w-full justify-start rounded-none border-b bg-background px-6"
          >
            <TabsTrigger value="activity" className="flex-none">
              Activity <span className="text-xs opacity-60">{historyCount}</span>
            </TabsTrigger>
            <TabsTrigger value="images" className="flex-none">
              Images <span className="text-xs opacity-60">{imageCount}</span>
            </TabsTrigger>
            <TabsTrigger value="outcome" className="flex-none">
              Outcome & award
            </TabsTrigger>
          </TabsList>
          <TabsContent value="activity" className="px-6 py-4">
            <ActivityList issue={issue} state={state} />
          </TabsContent>
          {/* The images stay mounted so an upload continues on another tab. */}
          <TabsContent value="images" forceMount hidden={tab !== "images"} className="px-6 py-4">
            <OrganiserImages
              state={state}
              issueId={issue.id}
              userId={member.user_id}
              canUpload={can.upload}
              uploadOpen={uploadOpen}
              onUploadOpenChange={setUploadOpen}
              onChanged={shell.data.refresh}
              surface="dialog"
            />
          </TabsContent>
          {/* The forms stay mounted so a typed award draft survives another tab. */}
          <TabsContent
            value="outcome"
            forceMount
            hidden={tab !== "outcome"}
            className="space-y-4 px-6 py-4"
          >
            <ResolutionHistory issue={issue} state={state} />
            <AwardReceipt award={award} state={state} />
            {can.award && (
              <section
                aria-labelledby={decideId}
                className="rounded-xl border p-4"
              >
                <h2
                  id={decideId}
                  tabIndex={-1}
                  className="text-sm font-semibold outline-none"
                >
                  Decide award
                </h2>
                <p className="text-xs text-muted-foreground">
                  Staff confirm separately when it is applied in the contest
                  system.
                </p>
                <AwardForm issue={issue} command={command} onDone={() => {}} />
              </section>
            )}
            {can.apply && (
              <section
                aria-labelledby={applyId}
                className="rounded-xl border p-4"
              >
                <h2
                  id={applyId}
                  tabIndex={-1}
                  className="mb-3 text-sm font-semibold outline-none"
                >
                  Confirm external application
                </h2>
                <ApplyForm issue={issue} command={command} onDone={() => {}} />
              </section>
            )}
            {!award &&
              !can.award &&
              !state.resolutions.some((r) => r.issue_id === issue.id) && (
                <p className="text-sm text-muted-foreground">
                  No resolution or award yet.
                </p>
              )}
          </TabsContent>
        </Tabs>
      </div>
      {can.reply && (
        <div className="shrink-0 border-t bg-background p-4">
          <ReplyForm
            issue={issue}
            command={command}
            onDone={() => {}}
            teamName={teamName}
            internalAllowed={can.internalNotes}
            draft={replyDraft}
            onDraft={onReplyDraft}
            onAttachImage={can.upload ? openUpload : undefined}
            layout="composer"
          />
        </div>
      )}
      {dialog && (
        <ActionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title={dialogText[dialog].title}
          description={dialogText[dialog].description}
        >
          <CommandFeedback command={command} className="mb-3" />
          {dialog === "resolve" && <ResolveForm {...formProps} />}
          {dialog === "escalate" && <EscalateForm {...formProps} noSpecialist={shell.data.snapshot?.has_specialist === false} />}
          {dialog === "reopen" && <ReopenForm {...formProps} />}
        </ActionDialog>
      )}
    </div>
  );
}
