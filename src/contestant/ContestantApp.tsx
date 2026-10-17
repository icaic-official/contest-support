import { useWorkflowState } from "@/connected/hooks/useWorkflowState";
import { LegacyWorkspace } from "@/connected/legacy/LegacyWorkspace";
import type { ShellProps } from "@/connected/shell";

/**
 * The contestant UI for team accounts. It is a desktop app with no phone
 * layout (mockup: design/redesign/f-contestant-desktop.html).
 *
 * Placeholder: it renders the pre-redesign workspace until the contestant
 * step of T0015 replaces LegacyWorkspace. Contestant views must never contain
 * internal notes or staff-only images.
 */
export function ContestantApp(props: ShellProps) {
  const workflow = useWorkflowState(props.data);
  return (
    <LegacyWorkspace shell={props} workflow={workflow} layout="contestant" />
  );
}
