import { desktopQuery } from "@/connected/hooks/useMediaQuery";

/** Viewports at least this wide get the desktop console. */
export const organiserDesktopQuery = desktopQuery;

export const loadDesktopConsole = () => import("./desktop/OrganiserDesktopConsole");
export const loadPhoneApp = () => import("./phone/OrganiserPhoneApp");

/** Starts the download of the layout that this viewport will show. */
export function preloadOrganiserLayout(): void {
  void (window.matchMedia(organiserDesktopQuery).matches
    ? loadDesktopConsole()
    : loadPhoneApp());
}
