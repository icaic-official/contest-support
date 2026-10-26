import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Camera,
  Check,
  CheckCheck,
  ChevronLeft,
  Ellipsis,
  Hand,
  Handshake,
  MessageSquarePlus,
  RotateCcw,
  Scale,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isRunning, type Issue } from "@/connected/model";
import { ActionSheet, CommandFeedback } from "../actions/ActionSheet";
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
  OwnerCard,
  ResolutionHistory,
} from "../components/IssueDetails";
import { PlaceTile, StatusBadge } from "../components/issueDisplay";
import {
  issueAbilities,
  missingActionHint,
  primaryAction,
  sheetAllowed,
} from "../organiserModel";
import { PhoneStatus } from "./PhoneParts";
import type { IssueSheet, PhoneTabProps } from "./PhoneTabs";

const sheetTitles: Record<
  Exclude<IssueSheet, "image">,
  { title: string; description?: string }
> = {
  reply: { title: "Reply" },
  resolve: { title: "Resolve issue" },
  escalate: { title: "Escalate to a specialist?" },
  reopen: { title: "Reopen issue" },
  award: {
    title: "Decide award",
    description:
      "Staff confirm separately when it is applied in the contest system.",
  },
  apply: { title: "Confirm external application" },
  more: { title: "More actions" },
};

function MoreItem({
  icon,
  label,
  help,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  help?: string;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-h-14 w-full items-center gap-3 p-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {icon}
        <span className="flex-1">
          <span className="block font-medium">{label}</span>
          {help && (
            <span className="block text-xs text-muted-foreground">{help}</span>
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * The full-screen issue view on a phone. A fixed bottom bar holds Reply and
 * one primary action. Other actions are in the More sheet. Every sheet has a
 * Cancel button, so no action needs a swipe.
 */
export function PhoneIssueView({
  issue,
  props,
  initialSheet,
  onBack,
  replyDraft,
  onReplyDraft,
}: {
  issue: Issue;
  props: PhoneTabProps;
  initialSheet?: IssueSheet;
  onBack: () => void;
  replyDraft: ReplyDraft;
  onReplyDraft: (draft: ReplyDraft) => void;
}) {
  const { state, member, workflow, now, shell } = props;
  const { command } = workflow;
  // The sheet keeps its content while its close animation runs.
  const [sheet, setSheetContent] = useState<IssueSheet | undefined>(
    initialSheet,
  );
  const [sheetOpen, setSheetOpen] = useState(Boolean(initialSheet));
  const setSheet = (next: IssueSheet | undefined) => {
    if (next) setSheetContent(next);
    setSheetOpen(Boolean(next));
  };
  const headingRef = useRef<HTMLHeadingElement>(null);
  const team = state.teams.find((item) => item.id === issue.team_id);
  const teamName = team?.name ?? "the team";
  const can = issueAbilities(issue, state, member);
  const primary = primaryAction(can);
  const hint = missingActionHint(issue, member, Boolean(state.event?.archived));
  const award = state.awards.find((item) => item.issue_id === issue.id);
  const close = () => setSheet(undefined);
  useEffect(() => {
    if (!initialSheet) headingRef.current?.focus();
  }, [initialSheet]);
  // A live change, such as a lost jury role or an archived event, can remove
  // the action of the open sheet. The server would reject it, so close it.
  const allowed = !sheet || sheetAllowed(sheet, can);
  useEffect(() => {
    if (!allowed) setSheetOpen(false);
  }, [allowed]);

  const moreItems: ReactNode[] = [];
  if (can.escalate) {
    moreItems.push(
      <MoreItem
        key="escalate"
        icon={<ArrowUpRight aria-hidden="true" className="size-5 text-status-escalated" />}
        label="Escalate to a specialist"
        help="You stay the owner until someone accepts."
        onSelect={() => setSheet("escalate")}
      />,
    );
  }
  if (can.upload) {
    moreItems.push(
      <MoreItem
        key="image"
        icon={<Camera aria-hidden="true" className="size-5" />}
        label="Add an image"
        onSelect={() => setSheet("image")}
      />,
    );
  }
  if (can.award && primary !== "award") {
    moreItems.push(
      <MoreItem
        key="award"
        icon={<Scale aria-hidden="true" className="size-5" />}
        label="Decide award"
        onSelect={() => setSheet("award")}
      />,
    );
  }
  if (can.apply && primary !== "apply") {
    moreItems.push(
      <MoreItem
        key="apply"
        icon={<CheckCheck aria-hidden="true" className="size-5" />}
        label="Confirm applied externally"
        onSelect={() => setSheet("apply")}
      />,
    );
  }
  if (can.reopen && primary !== "reopen") {
    moreItems.push(
      <MoreItem
        key="reopen"
        icon={<RotateCcw aria-hidden="true" className="size-5" />}
        label="Reopen issue"
        onSelect={() => setSheet("reopen")}
      />,
    );
  }

  const base = { issue_id: issue.id, revision: issue.revision };
  const primaryButton = (() => {
    const disabled = command.locked;
    switch (primary) {
      case "claim":
        return (
          <Button
            className="h-12 flex-1 text-base"
            disabled={disabled}
            loading={isRunning(command.running, "claim", issue.id)}
            onClick={() => void command.act({ type: "claim", ...base })}
          >
            <Hand aria-hidden="true" />
            Claim
          </Button>
        );
      case "accept":
        return (
          <Button
            className="h-12 flex-1 text-base"
            disabled={disabled}
            loading={isRunning(command.running, "accept", issue.id)}
            onClick={() => void command.act({ type: "accept", ...base })}
          >
            <Handshake aria-hidden="true" />
            Accept handoff
          </Button>
        );
      case "resolve":
        return (
          <Button
            className="h-12 flex-1 text-base"
            disabled={disabled}
            onClick={() => setSheet("resolve")}
          >
            <Check aria-hidden="true" />
            Resolve
          </Button>
        );
      case "award":
        return (
          <Button
            className="h-12 flex-1 text-base"
            disabled={disabled}
            onClick={() => setSheet("award")}
          >
            <Scale aria-hidden="true" />
            Decide award
          </Button>
        );
      case "apply":
        return (
          <Button
            className="h-12 flex-1 text-base"
            disabled={disabled}
            onClick={() => setSheet("apply")}
          >
            <CheckCheck aria-hidden="true" />
            Confirm applied
          </Button>
        );
      case "reopen":
        return (
          <Button
            variant="outline"
            className="h-12 flex-1 text-base"
            disabled={disabled}
            onClick={() => setSheet("reopen")}
          >
            <RotateCcw aria-hidden="true" />
            Reopen
          </Button>
        );
      default:
        return (
          <p className="flex-1 self-center text-center text-sm text-muted-foreground">
            {state.event?.archived
              ? "This event is archived."
              : issue.owner_name
                ? `${issue.owner_name} owns this issue.`
                : "No action available."}
          </p>
        );
    }
  })();

  const formProps = { issue, command, onDone: close };
  const sheetBody = (() => {
    switch (sheet) {
      case "reply":
        return (
          <ReplyForm
            {...formProps}
            teamName={teamName}
            internalAllowed={can.internalNotes}
            draft={replyDraft}
            onDraft={onReplyDraft}
          />
        );
      case "resolve":
        return <ResolveForm {...formProps} />;
      case "escalate":
        return <EscalateForm {...formProps} />;
      case "reopen":
        return <ReopenForm {...formProps} />;
      case "award":
        return <AwardForm {...formProps} />;
      case "apply":
        return <ApplyForm {...formProps} />;
      case "more":
        return (
          <ul className="divide-y rounded-xl border">{moreItems}</ul>
        );
      default:
        return null;
    }
  })();

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <Button variant="ghost" className="h-11" onClick={onBack}>
          <ChevronLeft aria-hidden="true" className="size-5" />
          Back
        </Button>
        <span className="mr-2 ml-auto font-mono text-sm text-muted-foreground">
          ISS-{issue.number}
        </span>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6">
        <PhoneStatus state={state} data={shell.data} command={command} />
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={issue.status} />
          <Badge variant="outline" className="text-muted-foreground">
            {issue.category}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <PlaceTile location={team?.location ?? ""} size="lg" inverted />
          <div className="min-w-0">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="truncate text-lg leading-tight font-semibold outline-none"
            >
              <span className="sr-only">ISS-{issue.number}, </span>
              {team?.name}
            </h1>
            <p className="text-sm text-muted-foreground">{team?.location}</p>
          </div>
        </div>
        <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">
          {issue.description}
        </p>
        <IssueTimers issue={issue} state={state} now={now} />
        <LifecycleBar status={issue.status} />
        <OwnerCard issue={issue} userId={member.user_id} />
        <HandoffBanner issue={issue} />
        <AwardReceipt award={award} state={state} />
        <ResolutionHistory issue={issue} state={state} />
        <OrganiserImages
          key={issue.id}
          state={state}
          issueId={issue.id}
          userId={member.user_id}
          canUpload={can.upload}
          uploadOpen={sheetOpen && sheet === "image"}
          onUploadOpenChange={(open) => setSheet(open ? "image" : undefined)}
          onChanged={shell.data.refresh}
        />
        <ActivityList issue={issue} state={state} />
      </div>
      <div className="shrink-0 space-y-2 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="flex gap-2">
          {can.reply && (
            <Button
              variant="outline"
              className="size-12"
              aria-label="Reply"
              disabled={command.locked && !command.pending}
              onClick={() => setSheet("reply")}
            >
              <MessageSquarePlus aria-hidden="true" className="size-5" />
            </Button>
          )}
          {primaryButton}
          {moreItems.length > 0 && (
            <Button
              variant="outline"
              className="size-12"
              aria-label="More actions"
              onClick={() => setSheet("more")}
            >
              <Ellipsis aria-hidden="true" className="size-5" />
            </Button>
          )}
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {sheet && sheet !== "image" && (
        <ActionSheet
          open={sheetOpen}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          title={sheetTitles[sheet].title}
          description={sheetTitles[sheet].description}
        >
          <CommandFeedback command={command} className="mb-3" />
          {sheetBody}
        </ActionSheet>
      )}
    </div>
  );
}
