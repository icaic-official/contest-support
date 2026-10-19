import type { Snapshot } from "../../connected/model";
import { PageHeading } from "../../connected/ui";
import { IssueDetail } from "../issues/IssueDetail";
import type { IssueAction } from "../issues/actions";
import { JuryWorklist } from "./JuryWorklist";

export function JuryPage({
  state,
  now,
  act,
  refresh,
}: {
  state: Snapshot;
  now: number;
  act: IssueAction;
  refresh: () => Promise<void>;
}) {
  const member = state.membership;
  if (!member) return null;
  return (
    <>
      <PageHeading
        title="Jury worklist"
        description="Award decisions and outstanding external confirmations."
      />
      <JuryWorklist
        state={state}
        now={now}
        renderDetail={(issue, back) => (
          <IssueDetail
            key={issue.id}
            issue={issue}
            state={state}
            member={member}
            now={now}
            act={act}
            refresh={refresh}
            onBack={back}
          />
        )}
      />
    </>
  );
}
