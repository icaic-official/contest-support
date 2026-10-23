import { useMediaQuery } from "@/connected/hooks/useMediaQuery";
import { useWorkflowState } from "@/connected/hooks/useWorkflowState";
import type { ShellProps } from "@/connected/shell";
import { OrganiserDesktopConsole } from "./desktop/OrganiserDesktopConsole";
import { OrganiserPhoneApp } from "./phone/OrganiserPhoneApp";

/** Viewports at least this wide get the desktop console. */
export const organiserDesktopQuery = "(min-width: 1024px)";

/**
 * The organiser UI for volunteers, specialists, jury members and session
 * admins. Phones get the phone-first app. Laptops and tablets get the desktop
 * console. Both layouts share one workflow state, so a pending request and the
 * selected issue survive a change of viewport.
 */
export function OrganiserApp(props: ShellProps) {
  const workflow = useWorkflowState(props.data);
  const desktop = useMediaQuery(organiserDesktopQuery);
  return desktop ? (
    <OrganiserDesktopConsole shell={props} workflow={workflow} />
  ) : (
    <OrganiserPhoneApp shell={props} workflow={workflow} />
  );
}
