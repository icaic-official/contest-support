import type { IntakeReason } from "@/backend/contracts";

/** A short state for a badge, for example "Intake open (grace period)". */
export function intakeHeadline(reason: IntakeReason): string {
  switch (reason) {
    case "before_start":
      return "Intake opens later";
    case "running":
      return "Intake open";
    case "grace":
      return "Intake open (grace period)";
    case "ended":
      return "Intake closed";
    case "override_open":
      return "Intake open (set by staff)";
    case "override_closed":
      return "Intake closed (set by staff)";
  }
}
