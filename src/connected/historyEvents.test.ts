import { describe, expect, it } from "vitest";
import { workflowEvent } from "./historyEvents";
import type { Issue, Resolution, Snapshot } from "./model";

const SESSION = "00000000-0000-4000-8000-000000000100";
const ISSUE = "00000000-0000-4000-8000-000000000300";
const HELPER = "00000000-0000-4000-8000-000000000002";

const issue = { id: ISSUE, created_at: "2026-10-17T10:00:00Z" } as Issue;
const resolution = {
  id: "00000000-0000-4000-8000-000000000400",
  session_id: SESSION,
  issue_id: ISSUE,
  at: "2026-10-17T10:20:00Z",
  reopened_at: "2026-10-17T10:25:00Z",
} as Resolution;
const award = { at: "2026-10-17T10:30:00Z" } as Snapshot["awards"][number];

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
