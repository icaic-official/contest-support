import { z } from "zod";

export type Role = "volunteer" | "specialist" | "jury";
export interface Person {
  name: string;
  roles: readonly Role[];
  teamId?: string;
}
export type Persona = "aurora" | "sam" | "maya" | "alex" | "robin";
export const personas: Record<Persona, Person> = {
  aurora: { name: "Team Aurora", roles: [], teamId: "aurora" },
  sam: { name: "Sam Chen", roles: ["volunteer"] },
  maya: { name: "Dr. Maya Rao", roles: ["specialist"] },
  alex: { name: "Alex Morgan", roles: ["jury"] },
  robin: { name: "Robin Ellis", roles: ["volunteer", "specialist"] },
};
const roleNames: Record<Role, string> = {
  volunteer: "Volunteer",
  specialist: "Technical specialist",
  jury: "Jury",
};
export function roleLabel(person: Person): string {
  return person.teamId
    ? "Team contestant"
    : person.roles.map((role) => roleNames[role]).join(" + ");
}
export function isSupport(person: Person): boolean {
  return (
    person.roles.includes("volunteer") || person.roles.includes("specialist")
  );
}
export function isJuryOnly(person: Person): boolean {
  return person.roles.includes("jury") && !isSupport(person);
}
export function canView(issue: Issue, person: Person): boolean {
  return person.teamId
    ? issue.teamId === person.teamId
    : !isJuryOnly(person) || issue.status === "resolved";
}
export function canClaim(issue: Issue, person: Person): boolean {
  return isSupport(person) && issue.status === "open";
}
export function canResolve(issue: Issue, id: Persona): boolean {
  return (
    isSupport(personas[id]) &&
    issue.owner === id &&
    (issue.status === "claimed" || issue.status === "escalated")
  );
}
export function canEscalate(issue: Issue, id: Persona): boolean {
  return canResolve(issue, id) && issue.status === "claimed";
}
export function canAccept(issue: Issue, id: Persona): boolean {
  const person: Person = personas[id];
  return (
    person.roles.includes("specialist") &&
    issue.status === "escalated" &&
    issue.owner !== id
  );
}
export function canReopen(issue: Issue, person: Person): boolean {
  return (
    issue.status === "resolved" &&
    (isSupport(person) || person.teamId === issue.teamId)
  );
}
export function canAward(issue: Issue, person: Person): boolean {
  return person.roles.includes("jury") && issue.status === "resolved";
}
export const teams = [
  { id: "aurora", name: "Team Aurora", location: "Hall A · Desk 12" },
  { id: "cedar", name: "Team Cedar", location: "Hall A · Desk 18" },
  { id: "orbit", name: "Team Orbit", location: "Hall B · Desk 04" },
];
// Seed configuration: edit here and reset the demo to try different categories.
export const categories = ["Problem statement", "Devices", "Backend", "Other"];
const timestamp = z.number().finite().nonnegative();
const actor = z.enum(["aurora", "sam", "maya", "alex", "robin"]);
const publicContent = z
  .string()
  .refine((value) => value.trim().length > 0 && value.trim().length <= 2000);
const resolutionSchema = z.object({
  id: z.string(),
  at: timestamp,
  actor,
  summary: publicContent,
  reopened: z
    .object({ at: timestamp, actor, reason: publicContent })
    .optional(),
});
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
  owner: actor.optional(),
  resolutions: z.array(resolutionSchema),
  escalation: z.literal("specialist").optional(),
  summary: z.string().optional(),
  history: z.array(entrySchema),
});
const awardSchema = z.object({
  id: z.string(),
  issueId: z.string(),
  minutes: z.number().int().nonnegative(),
  explanation: z.string(),
  at: timestamp,
  actor,
  resolutionId: z.string(),
  appliedAt: timestamp.optional(),
  appliedBy: actor.optional(),
});
export const stateSchema = z
  .object({
    version: z.literal(2),
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
          ? issue.escalation !== "specialist"
          : issue.escalation !== undefined
      )
        invalid();
      if (
        issue.status === "resolved"
          ? issue.resolvedAt === undefined || !issue.summary?.trim()
          : issue.resolvedAt !== undefined || issue.summary !== undefined
      )
        invalid();
      if (issue.owner && !isSupport(personas[issue.owner])) invalid();
      if (issue.status === "open" && issue.resolutions.length) invalid();
      if (
        new Set(issue.resolutions.map((record) => record.id)).size !==
        issue.resolutions.length
      )
        invalid();
      let previous = issue.firstAssignedAt ?? issue.createdAt;
      for (const resolution of issue.resolutions) {
        if (!isSupport(personas[resolution.actor]) || resolution.at < previous)
          invalid();
        const reopened = resolution.reopened;
        if (reopened) {
          const person: Person = personas[reopened.actor];
          if (
            reopened.at < resolution.at ||
            (!isSupport(person) && person.teamId !== issue.teamId)
          )
            invalid();
        } else if (
          resolution !== issue.resolutions.at(-1) ||
          issue.status !== "resolved"
        ) {
          invalid();
        }
        previous = reopened?.at ?? resolution.at;
      }
      const latest = issue.resolutions.at(-1);
      if (
        issue.status === "resolved" &&
        (!latest ||
          latest.reopened ||
          latest.at !== issue.resolvedAt ||
          latest.summary !== issue.summary ||
          latest.actor !== issue.owner)
      )
        invalid();
      if ((issue.history.at(-1)?.at ?? -1) < previous) invalid();
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
        !issue.resolutions.some(
          (resolution) =>
            resolution.id === award.resolutionId &&
            award.at >= resolution.at &&
            (!resolution.reopened || award.at <= resolution.reopened.at),
        ) ||
        !personas[award.actor].roles.some((role) => role === "jury") ||
        !award.explanation.trim()
      )
        invalid();
      if (
        award.appliedAt === undefined
          ? award.appliedBy !== undefined
          : !award.appliedBy ||
            award.appliedBy === "aurora" ||
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
  | { type: "reopen"; issueId: string; reason: string }
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
export function elapsed(issue: Issue, now: number): number {
  let total = 0;
  let activeFrom = issue.createdAt;
  for (const resolution of issue.resolutions) {
    total += resolution.at - activeFrom;
    if (!resolution.reopened) return total;
    activeFrom = resolution.reopened.at;
  }
  return total + Math.max(0, now - activeFrom);
}
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
    (entry) => persona !== "aurora" || entry.visibility === "public",
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
      persona === "aurora",
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
      resolutions: [],
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
    persona !== "aurora" || issue.teamId === "aurora",
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
        canClaim(issue, personas[persona]),
        "Only support staff can claim an open issue.",
      );
      issue.owner = persona;
      issue.status = "claimed";
      issue.firstAssignedAt = now;
      log("Support staff claimed the issue.");
      break;
    case "escalate":
      requireThat(
        canEscalate(issue, persona),
        "Only the current support owner can escalate this issue.",
      );
      issue.status = "escalated";
      issue.escalation = "specialist";
      log(
        "Escalated to Technical specialist. Current owner remains responsible until acceptance.",
      );
      break;
    case "accept":
      requireThat(
        canAccept(issue, persona),
        "Only a different specialist can accept a pending handoff.",
      );
      issue.owner = persona;
      issue.status = "claimed";
      delete issue.escalation;
      log("Specialist accepted the handoff and ownership.");
      break;
    case "message":
      requireThat(issue.status !== "resolved", "This issue is resolved.");
      requireThat(
        action.visibility === "public" || persona !== "aurora",
        "Contestants cannot add internal notes.",
      );
      log(
        `${action.visibility === "internal" ? "Internal note" : "Public reply"}: ${content(action.text)}`,
        action.visibility,
      );
      break;
    case "resolve":
      requireThat(
        canResolve(issue, persona),
        "Only the current owner can resolve an active issue.",
      );
      issue.summary = content(action.summary);
      issue.status = "resolved";
      issue.resolvedAt = now;
      issue.resolutions.push({
        id: `${issue.id}-resolution-${issue.resolutions.length + 1}`,
        at: now,
        actor: persona,
        summary: issue.summary,
      });
      delete issue.escalation;
      log(`Resolved: ${issue.summary}`);
      break;
    case "reopen": {
      requireThat(
        canReopen(issue, personas[persona]),
        "Only the team or support staff can reopen a resolved issue.",
      );
      const reason = content(action.reason);
      const resolution = issue.resolutions.at(-1);
      requireThat(
        resolution && !resolution.reopened,
        "A current resolution is required.",
      );
      resolution.reopened = { at: now, actor: persona, reason };
      issue.status = "claimed";
      delete issue.resolvedAt;
      delete issue.summary;
      delete issue.escalation;
      log(`Reopened: ${reason}`);
      break;
    }
    case "award":
      requireThat(
        canAward(issue, personas[persona]),
        "Only the jury can award time on a resolved issue.",
      );
      requireThat(
        !next.awards.some((a) => a.issueId === issue.id),
        "An award is already recorded for this issue.",
      );
      requireThat(
        Number.isSafeInteger(action.minutes) && action.minutes >= 0,
        "Award zero or a positive whole number of minutes.",
      );
      next.awards.push({
        id: `AWD-${issue.id}`,
        issueId: issue.id,
        minutes: action.minutes,
        explanation: content(action.explanation),
        at: now,
        actor: persona,
        resolutionId: issue.resolutions.at(-1)!.id,
      });
      log(
        `Jury awarded ${action.minutes} minutes: ${content(action.explanation)}. Pending external application.`,
      );
      break;
    case "apply": {
      const award = next.awards.find((a) => a.issueId === issue.id);
      requireThat(
        persona !== "aurora" && award && award.appliedAt === undefined,
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
    resolutions: [],
    history: [
      {
        id: `${id}-1`,
        at: now - age,
        actor: "aurora",
        text: "Issue submitted. Timer started.",
        visibility: "public",
      },
    ],
  });
  let state: State = {
    version: 2,
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
    "sam",
    now - 180000,
  );
  state = transition(
    state,
    { type: "escalate", issueId: "ISS-002" },
    "sam",
    now - 120000,
  );
  state = transition(
    state,
    { type: "claim", issueId: "ISS-003" },
    "sam",
    now - 840000,
  );
  state = transition(
    state,
    {
      type: "resolve",
      issueId: "ISS-003",
      summary: "Confirmed that all distances are measured in metres.",
    },
    "sam",
    now - 600000,
  );
  return state;
}
