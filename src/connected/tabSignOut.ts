const key = "minsky-tab-signed-out";

/**
 * True when a person signed out in this tab and nobody has signed in since.
 * The browser keeps it for the tab, so a reload does not end it.
 */
export function tabSignedOut(): boolean {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function setTabSignedOut(signedOut: boolean): void {
  try {
    if (signedOut) window.sessionStorage.setItem(key, "1");
    else window.sessionStorage.removeItem(key);
  } catch {
    // Without storage, a reload forgets the sign-out. Back can then show an older address that names a contest.
  }
}

/**
 * Ends the sign-out of the tab when the person started this page load, by a
 * link, the address bar or a bookmark. That is a new visit, so the contest in
 * its address is the person's own. A reload and a step through history also
 * load the page, but they return to an address that an earlier visit made.
 */
export function startVisit(): void {
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  if (entry?.type === "navigate") setTabSignedOut(false);
}
