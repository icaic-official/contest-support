import { z } from "zod";

export const personas = {
  contestant: { name: "Team Aurora", role: "Team contestant" },
  volunteer: { name: "Sam Chen", role: "Volunteer" },
  specialist: { name: "Dr. Maya Rao", role: "Technical specialist" },
  jury: { name: "Alex Morgan", role: "Jury" },
} as const;
export type Persona = keyof typeof personas;
export const teams = [
  { id: "aurora", name: "Team Aurora", location: "Hall A · Desk 12" },
  { id: "cedar", name: "Team Cedar", location: "Hall A · Desk 18" },
  { id: "orbit", name: "Team Orbit", location: "Hall B · Desk 04" },
];
// Seed configuration: edit here and reset the demo to try different categories.
export const categories = ["Problem statement", "Devices", "Backend", "Other"];
const timestamp = z.number().finite().nonnegative();
const actor = z.enum(["contestant", "volunteer", "specialist", "jury"]);
const entrySchema = z.object({
  id: z.string(),
  at: timestamp,
  actor,
  text: z.string(),
  visibility: z.enum(["public", "internal"]),
});
const issueSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  category: z.string(),
  description: z.string(),
  status: z.enum(["open", "claimed", "escalated", "resolved"]),
  createdAt: timestamp,
  firstAssignedAt: timestamp.optional(),
  resolvedAt: timestamp.optional(),
  owner: z.enum(["volunteer", "specialist"]).optional(),
  escalation: z.literal("specialist").optional(),
  summary: z.string().optional(),
  history: z.array(entrySchema),
});
const awardSchema = z.object({
  id: z.string(),
  issueId: z.string(),
  minutes: z.number().int().positive(),
  explanation: z.string(),
  at: timestamp,
  actor: z.literal("jury"),
  appliedAt: timestamp.optional(),
  appliedBy: actor.optional(),
});
export const stateSchema = z
  .object({
    version: z.literal(1),
    issues: z.array(issueSchema),
    awards: z.array(awardSchema),
  })
  .superRefine((state, context) => {
    const invalid = () =>
      context.addIssue({
        code: "custom",
        message: "Inconsistent saved workflow data.",
      });
    if (
      new Set(state.issues.map((issue) => issue.id)).size !==
      state.issues.length
    )
      invalid();
    if (
      new Set(state.awards.map((award) => award.issueId)).size !==
      state.awards.length
    )
      invalid();
    for (const issue of state.issues) {
      if (
        !/^ISS-\d+$/.test(issue.id) ||
        !teams.some((team) => team.id === issue.teamId)
      )
        invalid();
      if (
        issue.status === "open"
          ? issue.owner !== undefined || issue.firstAssignedAt !== undefined
          : !issue.owner || issue.firstAssignedAt === undefined
      )
        invalid();
      if (
        issue.status === "escalated"
          ? issue.owner !== "volunteer" || issue.escalation !== "specialist"
          : issue.escalation !== undefined
      )
        invalid();
      if (
        issue.status === "resolved"
          ? issue.resolvedAt === undefined || !issue.summary?.trim()
          : issue.resolvedAt !== undefined || issue.summary !== undefined
      )
        invalid();
      if (
        issue.firstAssignedAt !== undefined &&
        issue.firstAssignedAt < issue.createdAt
      )
        invalid();
      if (
        issue.resolvedAt !== undefined &&
        issue.resolvedAt < (issue.firstAssignedAt ?? issue.createdAt)
      )
        invalid();
      if (
        !issue.history.length ||
        new Set(issue.history.map((entry) => entry.id)).size !==
          issue.history.length
      )
        invalid();
      issue.history.forEach((entry, index) => {
        if (entry.at < (issue.history[index - 1]?.at ?? issue.createdAt))
          invalid();
      });
    }
    for (const award of state.awards) {
      const issue = state.issues.find((item) => item.id === award.issueId);
      if (
        !issue ||
        issue.status !== "resolved" ||
        award.at < issue.resolvedAt! ||
        !award.explanation.trim()
      )
        invalid();
      if (
        award.appliedAt === undefined
          ? award.appliedBy !== undefined
          : !award.appliedBy ||
            award.appliedBy === "contestant" ||
            award.appliedAt < award.at
      )
        invalid();
    }
  });
export type State = z.infer<typeof stateSchema>;
export type Issue = State["issues"][number];
export type Action =
  | { type: "submit"; category: string; description: string }
  | { type: "claim" | "escalate" | "accept" | "apply"; issueId: string }
  | {
      type: "message";
      issueId: string;
      text: string;
      visibility: "public" | "internal";
    }
  | { type: "resolve"; issueId: string; summary: string }
  | { type: "award"; issueId: string; minutes: number; explanation: string };

function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function content(value: string) {
  const text = value.trim();
  requireThat(
    text.length > 0 && text.length <= 2000,
    "Enter between 1 and 2,000 characters.",
  );
  return text;
}
export const elapsed = (issue: Issue, now: number) =>
  Math.max(0, (issue.resolvedAt ?? now) - issue.createdAt);
export const assignmentDelay = (issue: Issue) =>
  issue.firstAssignedAt === undefined
    ? undefined
    : issue.firstAssignedAt - issue.createdAt;
export function duration(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
export const visibleHistory = (issue: Issue, persona: Persona) =>
  issue.history.filter(
    (entry) => persona !== "contestant" || entry.visibility === "public",
  );

export function transition(
  state: State,
  action: Action,
  persona: Persona,
  now = Date.now(),
): State {
  requireThat(Number.isFinite(now) && now >= 0, "Invalid action timestamp.");
  const next = structuredClone(state);
  if (action.type === "submit") {
    requireThat(
      persona === "contestant",
      "Switch to the contestant to submit an issue.",
    );
    requireThat(
      categories.includes(action.category),
      "Choose a configured category.",
    );
    const id = `ISS-${String(Math.max(0, ...state.issues.map((i) => Number(i.id.slice(4)))) + 1).padStart(3, "0")}`;
    next.issues.unshift({
      id,
      teamId: "aurora",
      category: action.category,
      description: content(action.description),
      status: "open",
      createdAt: now,
      history: [
        {
          id: `${id}-1`,
          at: now,
          actor: persona,
          text: "Issue submitted. Timer started.",
          visibility: "public",
        },
      ],
    });
    return next;
  }
  const issue = next.issues.find((i) => i.id === action.issueId);
  requireThat(issue, "Issue not found.");
  requireThat(
    persona !== "contestant" || issue.teamId === "aurora",
    "This issue belongs to another team.",
  );
  requireThat(
    now >= (issue.history.at(-1)?.at ?? issue.createdAt),
    "The device clock moved backwards. Try again when the clock catches up.",
  );
  const log = (text: string, visibility: "public" | "internal" = "public") =>
    issue.history.push({
      id: `${issue.id}-${issue.history.length + 1}`,
      at: now,
      actor: persona,
      text,
      visibility,
    });
  switch (action.type) {
    case "claim":
      requireThat(
        persona === "volunteer" && issue.status === "open",
        "Only a volunteer can claim an open issue.",
      );
      issue.owner = persona;
      issue.status = "claimed";
      issue.firstAssignedAt = now;
      log("Volunteer claimed the issue.");
      break;
    case "escalate":
      requireThat(
        persona === issue.owner &&
          persona === "volunteer" &&
          issue.status === "claimed",
        "Only the assigned volunteer can escalate this issue.",
      );
      issue.status = "escalated";
      issue.escalation = "specialist";
      log(
        "Escalated to Technical specialist. Volunteer remains responsible until acceptance.",
      );
      break;
    case "accept":
      requireThat(
        persona === "specialist" && issue.status === "escalated",
        "Only a specialist can accept a pending handoff.",
      );
      issue.owner = "specialist";
      issue.status = "claimed";
      delete issue.escalation;
      log("Specialist accepted the handoff and ownership.");
      break;
    case "message":
      requireThat(issue.status !== "resolved", "This issue is resolved.");
      requireThat(
        action.visibility === "public" || persona !== "contestant",
        "Contestants cannot add internal notes.",
      );
      log(
        `${action.visibility === "internal" ? "Internal note" : "Public reply"}: ${content(action.text)}`,
        action.visibility,
      );
      break;
    case "resolve":
      requireThat(
        persona === issue.owner &&
          (issue.status === "claimed" || issue.status === "escalated"),
        "Only the current owner can resolve an active issue.",
      );
      issue.summary = content(action.summary);
      issue.status = "resolved";
      issue.resolvedAt = now;
      delete issue.escalation;
      log(`Resolved: ${issue.summary}`);
      break;
    case "award":
      requireThat(
        persona === "jury" && issue.status === "resolved",
        "Only the jury can award time on a resolved issue.",
      );
      requireThat(
        !next.awards.some((a) => a.issueId === issue.id),
        "An award is already recorded for this issue.",
      );
      requireThat(
        Number.isSafeInteger(action.minutes) && action.minutes > 0,
        "Award a positive whole number of minutes.",
      );
      next.awards.push({
        id: `AWD-${issue.id}`,
        issueId: issue.id,
        minutes: action.minutes,
        explanation: content(action.explanation),
        at: now,
        actor: "jury",
      });
      log(
        `Jury awarded ${action.minutes} minutes: ${content(action.explanation)}. Pending external application.`,
      );
      break;
    case "apply": {
      const award = next.awards.find((a) => a.issueId === issue.id);
      requireThat(
        persona !== "contestant" && award && award.appliedAt === undefined,
        "A pending award is required; only staff can confirm application.",
      );
      award.appliedAt = now;
      award.appliedBy = persona;
      log("Staff confirmed the award was applied externally (simulated).");
      break;
    }
  }
  return next;
}

export function seed(now = Date.now()): State {
  const draft = (
    id: string,
    teamId: string,
    category: string,
    description: string,
    age: number,
  ): Issue => ({
    id,
    teamId,
    category,
    description,
    status: "open",
    createdAt: now - age,
    history: [
      {
        id: `${id}-1`,
        at: now - age,
        actor: "contestant",
        text: "Issue submitted. Timer started.",
        visibility: "public",
      },
    ],
  });
  let state: State = {
    version: 1,
    awards: [],
    issues: [
      draft(
        "ISS-001",
        "aurora",
        "Devices",
        "Our display flickers when we connect the external monitor.",
        360000,
      ),
      draft(
        "ISS-002",
        "cedar",
        "Backend",
        "The practice environment is not responding.",
        240000,
      ),
      draft(
        "ISS-003",
        "orbit",
        "Problem statement",
        "Please clarify the units used in question 2.",
        900000,
      ),
    ],
  };
  state = transition(
    state,
    { type: "claim", issueId: "ISS-002" },
    "volunteer",
    now - 180000,
  );
  state = transition(
    state,
    { type: "escalate", issueId: "ISS-002" },
    "volunteer",
    now - 120000,
  );
  state = transition(
    state,
    { type: "claim", issueId: "ISS-003" },
    "volunteer",
    now - 840000,
  );
  state = transition(
    state,
    {
      type: "resolve",
      issueId: "ISS-003",
      summary: "Confirmed that all distances are measured in metres.",
    },
    "volunteer",
    now - 600000,
  );
  return state;
}
