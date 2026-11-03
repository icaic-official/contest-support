import { useRef, useState } from "react";
import { backend } from "@/backend";
import { type Handle, type ManageCommand, type SignInTarget } from "@/backend/contracts";
import { errorMessage } from "@/backend/errors";
import type { Snapshot } from "@/connected/model";
import { type ImageLimits, imageLimitsInput, setHandleCommand } from "./adminModel";

/** A temporary password that the admin shares once with the account owner. */
export interface Credentials {
  username: string;
  password: string;
  /** The event code that the account names to sign in. Unknown inside a contest, so the link is left out. */
  signIn?: SignInTarget | undefined;
}

/** Session administration requests and their shared feedback. */
export interface SessionAdmin {
  /** True while one request runs. Every control waits for it. */
  busy: boolean;
  /** True when the event is archived. Every change is disabled. */
  archived: boolean;
  error: string;
  notice: string;
  /** The credentials of the last account request, shown once. */
  credentials: Credentials | undefined;
  dismissCredentials: () => void;
  /** Each request resolves to true when the server records it. */
  setIntake: (open: boolean) => Promise<boolean>;
  saveImageLimits: (limits: ImageLimits) => Promise<boolean>;
  /** Changes a username. The password and open sessions stay. */
  setUsername: (userId: string, username: Handle) => Promise<boolean>;
  resetPassword: (userId: string) => Promise<boolean>;
  /** Replaces the whole ordered category list. */
  setCategories: (categories: readonly string[]) => Promise<boolean>;
  /** Changes the location of a team that sits in this contest. */
  setLocation: (entrantId: string, location: string) => Promise<boolean>;
}

/**
 * Runs the session administration requests of the admin pages: intake, image
 * limits, categories, team locations, username changes and password reissue.
 * Accounts and assignments belong to the event console. Only one request runs at a time. A
 * recorded request refreshes the snapshot. The phone Session tab and the
 * desktop console share it.
 */
export function useSessionAdmin(
  state: Snapshot,
  refresh: () => Promise<void>,
): SessionAdmin {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<Credentials>();
  // A ref, not state: a second tap in the same render must not start a
  // second request.
  const guard = useRef(false);
  const sessionId = state.session?.id ?? "";

  async function run(
    work: () => Promise<Credentials | void>,
    done = "Administration action completed.",
  ): Promise<boolean> {
    if (guard.current) return false;
    guard.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setCredentials(undefined);
    let revealed: Credentials | undefined;
    try {
      revealed = (await work()) ?? undefined;
      await refresh();
      setNotice(done);
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      // The credentials appear only when the request ends. Otherwise the
      // pages reopen the dialog after the admin has already closed it.
      // A failed refresh still shows them, because they are shown only once.
      setCredentials(revealed);
      setBusy(false);
      guard.current = false;
    }
  }

  /** Runs a contest command. */
  async function contest(command: ManageCommand): Promise<void> {
    await backend.manage.execute(crypto.randomUUID(), command);
  }

  /** Issues a new temporary password. It becomes the one-time credentials. */
  async function reissue(userId: string): Promise<Credentials> {
    const [issued] = await backend.manage.issueCredentials(crypto.randomUUID(), {
      eventId: state.event?.id ?? null,
      accountIds: [userId],
    });
    if (!issued?.temporaryPassword) throw new Error("The password was not issued. Try again.");
    return { username: issued.handle, password: issued.temporaryPassword };
  }

  return {
    busy,
    archived: Boolean(state.event?.archived),
    error,
    notice,
    credentials,
    dismissCredentials: () => setCredentials(undefined),
    setIntake: (open) =>
      run(() => contest({ type: "set_intake", contestId: sessionId, open })),
    saveImageLimits: (limits) =>
      run(() => contest({ type: "set_image_limits", contestId: sessionId, ...imageLimitsInput(limits) })),
    setUsername: (userId, username) =>
      run(async () => {
        if (!state.event) throw new Error("Refresh the page, then change the username again.");
        await contest(setHandleCommand(state.event.id, userId, username));
      }, "Username changed."),
    resetPassword: (userId) => run(() => reissue(userId)),
    setCategories: (categories) =>
      run(
        () => contest({ type: "set_categories", contestId: sessionId, categories }),
        "Categories saved.",
      ),
    setLocation: (entrantId, location) =>
      run(
        () => contest({ type: "set_location", contestId: sessionId, entrantId, location }),
        "Location saved.",
      ),
  };
}
