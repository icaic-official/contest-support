import type { Issue, Resolution, Snapshot } from "./model";

export type JurySection = "decision" | "application";

export interface JuryRow {
  issue: Issue;
  team: Snapshot["teams"][number] | undefined;
  resolution: Resolution | undefined;
  resolutions: Resolution[];
  award: Snapshot["awards"][number] | undefined;
}

/** Groups authorized session data without applying the ordinary queue filters. */
export function juryWorklists(state: Snapshot): Record<JurySection, JuryRow[]> {
  const lists: Record<JurySection, JuryRow[]> = {
    decision: [],
    application: [],
  };
  const session = state.session?.id;
  if (
    !session ||
    state.membership?.session_id !== session ||
    !state.membership.roles.includes("jury")
  )
    return lists;
  const teams = new Map(state.teams.map((team) => [team.id, team]));
  const awards = new Map(state.awards.map((award) => [award.issue_id, award]));
  const resolutions = new Map<string, Resolution[]>();
  const byId = new Map<string, Resolution>();
  for (const resolution of state.resolutions) {
    if (resolution.session_id !== session) continue;
    const records = resolutions.get(resolution.issue_id) ?? [];
    records.push(resolution);
    resolutions.set(resolution.issue_id, records);
    byId.set(resolution.id, resolution);
  }
  for (const issue of state.issues) {
    if (issue.session_id !== session) continue;
    const award = awards.get(issue.id);
    const records = resolutions.get(issue.id) ?? [];
    const row: JuryRow = {
      issue,
      team: teams.get(issue.team_id),
      resolution: award
        ? byId.get(award.resolution_id)
        : records.find((resolution) => !resolution.reopened_at),
      resolutions: records,
      award,
    };
    if (award) {
      if (award.applied_at === null && award.withdrawn_at === null) lists.application.push(row);
    } else if (issue.status === "resolved") {
      lists.decision.push(row);
    }
  }
  const compare = (a: JuryRow, b: JuryRow) => {
    const timestamp = (row: JuryRow) =>
      Date.parse(
        row.award?.at ??
          row.resolution?.at ??
          row.issue.resolved_at ??
          row.issue.created_at,
      );
    return (
      timestamp(a) - timestamp(b) ||
      a.issue.number - b.issue.number ||
      a.issue.id.localeCompare(b.issue.id)
    );
  };
  lists.decision.sort(compare);
  lists.application.sort(compare);
  return lists;
}
