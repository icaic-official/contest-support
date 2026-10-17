import type { WorkflowState } from "@/connected/hooks/useWorkflowState";
import { LegacyWorkspace } from "@/connected/legacy/LegacyWorkspace";
import type { ShellProps } from "@/connected/shell";

/**
 * The phone-first organiser app (mockup: design/redesign/e-organiser-phone.html).
 *
 * Placeholder: it renders the pre-redesign workspace until the organiser
 * phone step of T0015 replaces LegacyWorkspace.
 */
export function OrganiserPhoneApp({
  shell,
  workflow,
}: {
  shell: ShellProps;
  workflow: WorkflowState;
}) {
  return (
    <LegacyWorkspace
      shell={shell}
      workflow={workflow}
      layout="organiser-phone"
    />
  );
}
