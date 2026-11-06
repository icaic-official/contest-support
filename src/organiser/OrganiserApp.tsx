import { lazy } from "react";
import { useMediaQuery } from "@/connected/hooks/useMediaQuery";
import { useWorkflowState } from "@/connected/hooks/useWorkflowState";
import type { ShellProps } from "@/connected/shell";
import { loadDesktopConsole, loadPhoneApp, organiserDesktopQuery } from "./layouts";

// A phone never downloads the desktop console, and a laptop never downloads the phone app.
const OrganiserDesktopConsole = lazy(() =>
  loadDesktopConsole().then((m) => ({ default: m.OrganiserDesktopConsole })),
);
const OrganiserPhoneApp = lazy(() =>
  loadPhoneApp().then((m) => ({ default: m.OrganiserPhoneApp })),
);

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
