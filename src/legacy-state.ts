import { z } from "zod";
import { teams } from "./domain";

// Frozen v1 validation: validate the source before mapping historical identities.
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
export const legacyStateSchema = z
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
