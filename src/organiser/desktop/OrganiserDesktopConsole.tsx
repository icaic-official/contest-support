import type { WorkflowState } from "@/connected/hooks/useWorkflowState";
import { LegacyWorkspace } from "@/connected/legacy/LegacyWorkspace";
import type { ShellProps } from "@/connected/shell";

/**
 * The organiser desktop console for laptops and tablets
 * (mockup: design/redesign/a-console.html).
 *
 * Placeholder: it renders the pre-redesign workspace until the organiser
 * desktop step of T0015 replaces LegacyWorkspace.
 */
export function OrganiserDesktopConsole({
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
      layout="organiser-desktop"
    />
  );
}
