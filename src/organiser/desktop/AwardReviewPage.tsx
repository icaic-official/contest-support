import { useState } from "react";
import {
  pillIndicator,
  SlidingIndicator,
} from "@/components/ui/sliding-indicator";
import { cn } from "@/lib/utils";
import { ContestAwardsPanel } from "@/connected/ContestAwards";
import { clockDuration } from "@/connected/ui";
import { ApplyForm, AwardForm } from "../actions/IssueForms";
import { AwardReceipt } from "../components/IssueDetails";
import { AwardEvidence, UnresolvedTimer } from "../components/issueDisplay";
import {
  type AwardList,
  awardListLabels,
  awardListOrder,
  awardLists,
  issueAbilities,
} from "../organiserModel";
import type { ConsolePageProps } from "./consoleProps";
import { PageHeader } from "./QueuePages";

/**
 * The jury award lists: resolved issues without an award, awards that wait
 * for confirmation in the external contest system (also on reopened issues)
 * and applied awards. The award form and the confirmation form are on each
 * card. A decision does not change the contest clock.
 */
export function AwardReviewPage({ props }: { props: ConsolePageProps }) {
  const { state, member, workflow, now } = props;
  const [list, setList] = useState<AwardList>("decide");
  const issuesOf = awardLists(state);
  const shown = issuesOf[list];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Award review"
        description="Decide on resolved issues. Recording an award does not change the contest clock. Staff confirm external application separately."
      />
      <ContestAwardsPanel state={state} member={member} refresh={props.shell.data.refresh} />
      <div
        role="group"
        aria-label="Award lists"
        className="relative isolate inline-flex gap-1 rounded-lg bg-muted p-1"
      >
        <SlidingIndicator className={pillIndicator} />
        {awardListOrder.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={list === value}
            onClick={() => setList(value)}
            className={cn(
              "h-8 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors duration-(--motion-base) ease-out focus-visible:ring-[3px] focus-visible:ring-ring/50",
              list === value && "text-foreground",
            )}
          >
            {awardListLabels[value]}{" "}
            <span className="text-xs tabular-nums opacity-70">
              {issuesOf[value].length}
            </span>
          </button>
        ))}
      </div>
      {shown.length ? (
        <ul aria-label={awardListLabels[list]} className="grid gap-4">
          {shown.map((row) => {
            const { issue, team, award } = row;
            const can = issueAbilities(issue, state, member);
            return (
              <li
                key={issue.id}
                className="grid gap-6 rounded-xl border bg-card p-5 lg:grid-cols-[1fr_320px]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground/80">ISS-{issue.number}</span>
                    <span className="font-medium text-foreground/80">{team?.name ?? "Team unavailable"}</span>
                    {team?.location && <span>{team.location}</span>}
                    <span>{issue.category}</span>
                  </div>
                  <h2 className="mt-1.5 font-medium break-words">
                    <button
                      id={`award-issue-${issue.id}`}
                      type="button"
                      onClick={() => props.openIssue(issue.id, "outcome")}
                      className="rounded-sm text-left outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {issue.description}
                    </button>
                  </h2>
                  <AwardEvidence row={row} />
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Unresolved
                      </dt>
                      <dd>
                        <UnresolvedTimer
                          issue={issue}
                          resolutions={state.resolutions}
                          now={now}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        First assignment
                      </dt>
                      <dd className="font-mono tabular-nums">
                        {issue.first_assigned_at
                          ? clockDuration(
                              Date.parse(issue.first_assigned_at) -
                                Date.parse(issue.created_at),
                            )
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="space-y-3">
                  {award ? (
                    <AwardReceipt award={award} state={state} />
                  ) : can.award ? (
                    <div className="rounded-lg border p-4">
                      <h3 className="text-sm font-medium">Record a decision</h3>
                      <AwardForm
                        issue={issue}
                        command={workflow.command}
                        onDone={() => {}}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {state.event?.archived
                        ? "This event is archived. Records are read only."
                        : "No award decision yet."}
                    </p>
                  )}
                  {can.apply && (
                    <div className="rounded-lg border p-4">
                      <ApplyForm
                        issue={issue}
                        command={workflow.command}
                        onDone={() => {}}
                      />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nothing in this list.
        </p>
      )}
    </div>
  );
}
