const key = "minsky-tab-signed-out";

/** The state for this page. It stands in for storage that the browser denies. */
let remembered = false;

/**
 * True when a person signed out in this tab and nobody has signed in since.
 * The browser keeps it for the tab, so a reload does not end it.
 */
export function tabSignedOut(): boolean {
  try {
    return remembered || window.sessionStorage.getItem(key) === "1";
  } catch {
    return remembered;
  }
}

export function setTabSignedOut(signedOut: boolean): void {
  remembered = signedOut;
  try {
    if (signedOut) window.sessionStorage.setItem(key, "1");
    else window.sessionStorage.removeItem(key);
  } catch {
    // Without storage, the page keeps the state, and a reload forgets it. Back can then show an older address that names a contest.
  }
}
