import { describe, expect, it } from "vitest";
import { historyText, workflowEvent } from "./historyEvents";
import type { Issue, Resolution, Snapshot } from "./model";

const SESSION = "00000000-0000-4000-8000-000000000100";
const ISSUE = "00000000-0000-4000-8000-000000000300";
const HELPER = "00000000-0000-4000-8000-000000000002";

const issue: Issue = {
  id: ISSUE,
  number: 1,
  session_id: SESSION,
  team_id: "00000000-0000-4000-8000-000000000200",
  reporter: HELPER,
  reporter_name: "Fictional Reporter",
  category: "Devices",
  description: "Fictional report",
  status: "open",
  created_at: "2026-10-17T10:00:00Z",
  first_assigned_at: null,
  owner: null,
  owner_name: null,
  resolved_at: null,
  revision: 0,
};
const resolution: Resolution = {
  id: "00000000-0000-4000-8000-000000000400",
  session_id: SESSION,
  issue_id: ISSUE,
  actor: HELPER,
  actor_name: "Priya Raman",
  at: "2026-10-17T10:20:00Z",
  summary: "Fictional fix.",
  reopened_at: "2026-10-17T10:25:00Z",
  reopened_by: HELPER,
  reopened_name: "Priya Raman",
  reason: "Fictional reopen reason.",
};
const award: Snapshot["awards"][number] = {
  id: "00000000-0000-4000-8000-000000000600",
  issue_id: ISSUE,
  resolution_id: resolution.id,
  minutes: 5,
  explanation: "Fictional award.",
  actor_name: "Priya Raman",
  at: "2026-10-17T10:30:00Z",
  applied_at: null,
  applied_name: null,
  withdrawn_at: null,
  withdrawn_name: null,
};

function entry(text: string, at = "2026-10-17T10:05:00Z") {
  return {
    id: "00000000-0000-4000-8000-000000000500",
    issue_id: ISSUE,
    at,
    actor: HELPER,
    actor_name: "Priya Raman",
    text,
    visibility: "public" as const,
  };
}

const context = { issue, resolutions: [resolution], award };

describe("workflowEvent", () => {
  it("finds the steps with fixed text", () => {
    expect(workflowEvent(entry("Issue claimed."), context)).toEqual({
      kind: "claimed",
    });
    expect(
      workflowEvent(
        entry("Specialist handoff requested. Current owner retained."),
        context,
      ),
    ).toEqual({ kind: "handoff" });
    expect(workflowEvent(entry("Image added."), context)).toEqual({
      kind: "image-added",
    });
  });

  it("finds steps with free input only at the time of their record", () => {
    expect(
      workflowEvent(entry("Issue submitted: No link", issue.created_at), context),
    ).toEqual({ kind: "submitted" });
    expect(
      workflowEvent(entry("Resolved: Service restored", resolution.at), context),
    ).toEqual({ kind: "resolved" });
    expect(
      workflowEvent(entry("Reopened: Back again", resolution.reopened_at ?? ""), context),
    ).toEqual({ kind: "reopened", reason: "Back again" });
    expect(
      workflowEvent(entry("10 minutes awarded: Outage", award.at), context),
    ).toEqual({ kind: "awarded" });
  });

  it("treats typed text that imitates a step as a message", () => {
    expect(workflowEvent(entry("Resolved: typed by hand"), context)).toBeUndefined();
    expect(workflowEvent(entry("Thanks, it works."), context)).toBeUndefined();
  });
});

describe("historyText", () => {
  it.each([
    ["0 minutes awarded: Fine", "No time added: Fine"],
    ["1 minutes awarded: Fine", "1 minute awarded: Fine"],
    ["10 minutes awarded: Fine", "10 minutes awarded: Fine"],
  ])("shows the award entry %j as %j", (stored, shown) => {
    expect(historyText(entry(stored, award.at), context)).toBe(shown);
  });

  it("keeps the stored text of other entries and of typed text that imitates an award", () => {
    expect(historyText(entry("Issue claimed."), context)).toBe("Issue claimed.");
    expect(historyText(entry("1 minutes awarded: typed"), context)).toBe(
      "1 minutes awarded: typed",
    );
  });
});
