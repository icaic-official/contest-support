import { describe, expect, it } from "vitest";
import type { Attachment, Issue, Resolution, Snapshot } from "@/connected/model";
import {
  conversation,
  issueHeadline,
  publicHistory,
  reportBlocker,
  teamImages,
  teamIssues,
  trackerSteps,
} from "./contestantView";

const TEAM = "00000000-0000-4000-8000-000000000200";
const OTHER_TEAM = "00000000-0000-4000-8000-000000000201";
const TEAM_USER = "00000000-0000-4000-8000-000000000001";
const HELPER = "00000000-0000-4000-8000-000000000002";
const SESSION = "00000000-0000-4000-8000-000000000100";

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "00000000-0000-4000-8000-000000000300",
    number: 7,
    session_id: SESSION,
    team_id: TEAM,
    reporter: TEAM_USER,
    reporter_name: "Aurora",
    category: "Network",
    description: "No connection",
    status: "open",
    created_at: "2026-10-17T10:00:00Z",
    first_assigned_at: null,
    owner: null,
    owner_name: null,
    resolved_at: null,
    revision: 1,
    ...overrides,
  };
}

function resolution(overrides: Partial<Resolution> = {}): Resolution {
  return {
    id: "00000000-0000-4000-8000-000000000400",
    session_id: SESSION,
    issue_id: issue().id,
    actor: HELPER,
    actor_name: "Priya Raman",
    at: "2026-10-17T10:20:00Z",
    summary: "Service restored",
    reopened_at: null,
    reopened_by: null,
    reopened_name: null,
    reason: null,
    ...overrides,
  };
}

type HistoryEntry = Snapshot["history"][number];
let historyCount = 0;
function entry(overrides: Partial<HistoryEntry>): HistoryEntry {
  historyCount++;
  return {
    id: `00000000-0000-4000-8000-${String(500 + historyCount).padStart(12, "0")}`,
    issue_id: issue().id,
    at: "2026-10-17T10:05:00Z",
    actor: HELPER,
    actor_name: "Priya Raman",
    text: "On my way.",
    visibility: "public",
    ...overrides,
  };
}

function attachment(visibility: Attachment["visibility"]): Attachment {
  return {
    id: `00000000-0000-4000-8000-00000000060${visibility === "public" ? 1 : 2}`,
    issue_id: issue().id,
    uploader: HELPER,
    uploader_name: "Priya Raman",
    uploaded_at: "2026-10-17T10:06:00Z",
    visibility,
    byte_size: 1000,
    content_type: "image/png",
    original_name: "screen.png",
  };
}

const award = {
  id: "00000000-0000-4000-8000-000000000700",
  issue_id: issue().id,
  resolution_id: resolution().id,
  minutes: 10,
  explanation: "Network outage",
  actor_name: "Jury",
  at: "2026-10-17T10:30:00Z",
  applied_at: null,
  applied_name: null,
};

const time = (value: string) => value.slice(11, 16);

describe("contestant content filters", () => {
  it("never returns internal notes", () => {
    const history = [
      entry({ text: "Public reply" }),
      entry({ text: "Staff note", visibility: "internal" }),
      entry({ text: "Other issue", issue_id: "00000000-0000-4000-8000-000000000999" }),
    ];
    expect(publicHistory(history, issue().id).map((h) => h.text)).toEqual([
      "Public reply",
    ]);
  });

  it("never returns staff-only images", () => {
    const images = teamImages(
      [attachment("public"), attachment("internal")],
      issue().id,
    );
    expect(images.map((image) => image.visibility)).toEqual(["public"]);
  });

  it("returns only the team's issues, newest first", () => {
    const older = issue({ id: "00000000-0000-4000-8000-000000000301" });
    const newer = issue({
      id: "00000000-0000-4000-8000-000000000302",
      created_at: "2026-10-17T11:00:00Z",
    });
    const foreign = issue({
      id: "00000000-0000-4000-8000-000000000303",
      team_id: OTHER_TEAM,
    });
    expect(teamIssues([older, foreign, newer], TEAM).map((i) => i.id)).toEqual([
      newer.id,
      older.id,
    ]);
  });
});

describe("issueHeadline", () => {
  it("describes each status in plain language", () => {
    const owned = { owner: HELPER, owner_name: "Priya Raman" };
    const options = { location: "Hall A · Table 4", reopened: false };
    expect(issueHeadline(issue(), options)).toBe(
      "Your report is in the queue. A helper will come to Hall A · Table 4.",
    );
    expect(issueHeadline(issue({ ...owned, status: "claimed" }), options)).toBe(
      "Priya is handling your report.",
    );
    expect(
      issueHeadline(issue({ ...owned, status: "escalated" }), options),
    ).toBe("A specialist will look at your report.");
    expect(issueHeadline(issue({ ...owned, status: "resolved" }), options)).toBe(
      "This issue is resolved.",
    );
    expect(
      issueHeadline(issue({ ...owned, status: "claimed" }), {
        ...options,
        reopened: true,
      }),
    ).toBe("Your issue is open again. Priya is handling it.");
  });
});

describe("trackerSteps", () => {
  const states = (steps: ReturnType<typeof trackerSteps>) =>
    steps.map((step) => (step.done ? "done" : step.current ? "current" : "todo"));

  it("marks the helper step as current for a new report", () => {
    const steps = trackerSteps(issue(), undefined, time);
    expect(states(steps)).toEqual(["done", "current", "todo", "todo"]);
    expect(steps[0].detail).toBe("10:00");
    expect(steps[1].detail).toBe("Waiting for a helper");
  });

  it("names the owner and the first assignment time", () => {
    const steps = trackerSteps(
      issue({
        status: "escalated",
        owner_name: "Priya Raman",
        first_assigned_at: "2026-10-17T10:02:00Z",
      }),
      undefined,
      time,
    );
    expect(states(steps)).toEqual(["done", "done", "current", "todo"]);
    expect(steps[1].detail).toBe("Priya Raman · 10:02");
    expect(steps[2].detail).toBe("Waiting for a specialist");
  });

  it("waits for a jury decision after resolution", () => {
    const resolved = issue({
      status: "resolved",
      owner_name: "Priya Raman",
      first_assigned_at: "2026-10-17T10:02:00Z",
      resolved_at: "2026-10-17T10:20:00Z",
    });
    expect(states(trackerSteps(resolved, undefined, time))).toEqual([
      "done",
      "done",
      "done",
      "current",
    ]);
    const steps = trackerSteps(resolved, award, time);
    expect(states(steps)).toEqual(["done", "done", "done", "done"]);
    expect(steps[3].detail).toBe("Decided · 10 minutes");
  });

  it("words a zero-minute and a one-minute award without a plus sign or a wrong plural", () => {
    const resolved = issue({
      status: "resolved",
      owner_name: "Priya Raman",
      first_assigned_at: "2026-10-17T10:02:00Z",
      resolved_at: "2026-10-17T10:20:00Z",
    });
    const detail = (minutes: number) =>
      trackerSteps(resolved, { ...award, minutes }, time)[3].detail;
    expect(detail(0)).toBe("Decided · No time added");
    expect(detail(1)).toBe("Decided · 1 minute");
  });

  it("keeps an award after reopening while resolution is pending", () => {
    const reopened = issue({
      status: "claimed",
      owner_name: "Priya Raman",
      first_assigned_at: "2026-10-17T10:02:00Z",
    });
    expect(states(trackerSteps(reopened, award, time))).toEqual([
      "done",
      "done",
      "current",
      "done",
    ]);
  });
});

describe("conversation", () => {
  it("separates workflow events from messages", () => {
    const reopenedAt = "2026-10-17T10:25:00Z";
    const resolutions = [resolution({ reopened_at: reopenedAt, reason: "Back" })];
    const items = conversation(
      [
        entry({
          at: issue().created_at,
          actor: TEAM_USER,
          actor_name: "Aurora",
          text: "Issue submitted: No connection",
        }),
        entry({ text: "Issue claimed." }),
        entry({ text: "On my way." }),
        entry({ actor: TEAM_USER, actor_name: "Aurora", text: "Thanks" }),
        entry({ at: "2026-10-17T10:20:00Z", text: "Resolved: Service restored" }),
        entry({
          at: reopenedAt,
          actor: TEAM_USER,
          actor_name: "Aurora",
          text: "Reopened: Back",
        }),
        entry({ text: "Resolved: typed by hand" }),
      ],
      { issue: issue(), resolutions, award: undefined, userId: TEAM_USER },
    );
    expect(
      items.map((item) =>
        item.kind === "event" ? `event:${item.text}` : `${item.mine ? "mine" : "staff"}:${item.entry.text}`,
      ),
    ).toEqual([
      "event:You sent the report",
      "event:Priya Raman took the report",
      "staff:On my way.",
      "mine:Thanks",
      "event:Priya Raman resolved the issue",
      "event:You reopened the issue: Back",
      "staff:Resolved: typed by hand",
    ]);
  });
});

describe("reportBlocker", () => {
  const session = {
    id: SESSION,
    event_id: SESSION,
    name: "Finals",
    intake_open: true,
    categories: ["Network"],
    revision: 1,
    max_image_bytes: 1,
    max_images_per_issue: 1,
    max_image_bytes_per_issue: 1,
  };
  const event = { id: SESSION, name: "Open", archived: false };

  it("explains why reporting is unavailable", () => {
    expect(reportBlocker({ session, event })).toBeUndefined();
    expect(
      reportBlocker({ session: { ...session, intake_open: false }, event }),
    ).toBe("Reporting is closed by the organizers.");
    expect(
      reportBlocker({ session, event: { ...event, archived: true } }),
    ).toBe("This event is archived. Records are read only.");
  });
});
