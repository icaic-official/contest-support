import { useRef, useState } from "react";
import { backend } from "@/backend";
import type { AccountCommand } from "@/backend/contracts";
import { errorMessage } from "@/backend/errors";
import type { Snapshot } from "@/connected/model";
import {
  type ImageLimits,
  type MembershipDraft,
  type NewAccount,
  createAccountCommand,
  imageLimitsInput,
  membershipInput,
  resetPasswordCommand,
  setUsernameCommand,
} from "./adminModel";

/** A temporary password that the admin shares once with the account owner. */
export interface Credentials {
  username: string;
  password: string;
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
  credentials?: Credentials;
  dismissCredentials: () => void;
  /** Each request resolves to true when the server records it. */
  setIntake: (open: boolean) => Promise<boolean>;
  saveImageLimits: (limits: ImageLimits) => Promise<boolean>;
  createAccount: (account: NewAccount) => Promise<boolean>;
  setUsername: (userId: string, username: string) => Promise<boolean>;
  saveMembership: (userId: string, draft: MembershipDraft) => Promise<boolean>;
  resetPassword: (userId: string) => Promise<boolean>;
  revokeAccess: (userId: string) => Promise<boolean>;
}

/**
 * Runs the session administration requests of the admin pages: intake, image
 * limits, accounts and memberships. Only one request runs at a time. A
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
      setNotice("Administration action completed.");
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

  /**
   * Sends an account command. A new temporary password becomes the one-time
   * credentials, with the username of the account.
   */
  async function account(
    command: AccountCommand,
    username: string,
  ): Promise<Credentials | undefined> {
    const result = await backend.admin.account(sessionId, command);
    return result.temporaryPassword
      ? { username, password: result.temporaryPassword }
      : undefined;
  }

  function usernameOf(userId: string): string {
    return (
      state.members.find((item) => item.person.id === userId)?.person
        .username ?? "Existing email login"
    );
  }

  return {
    busy,
    archived: Boolean(state.event?.archived),
    error,
    notice,
    credentials,
    dismissCredentials: () => setCredentials(undefined),
    setIntake: (open) =>
      run(() => backend.admin.setIntake(sessionId, open)),
    saveImageLimits: (limits) =>
      run(() =>
        backend.admin.setImageLimits(
          sessionId,
          imageLimitsInput(limits),
        ),
      ),
    createAccount: (input) =>
      run(() =>
        account(
          createAccountCommand(input),
          input.username.trim().toLowerCase(),
        ),
      ),
    setUsername: (userId, username) =>
      run(() =>
        account(
          setUsernameCommand(userId, username),
          username.trim().toLowerCase(),
        ),
      ),
    saveMembership: (userId, draft) =>
      run(() =>
        backend.admin.saveMember(
          sessionId,
          userId.trim(),
          membershipInput(draft),
        ),
      ),
    resetPassword: (userId) =>
      run(() => account(resetPasswordCommand(userId), usernameOf(userId))),
    revokeAccess: (userId) =>
      run(() => backend.admin.removeMember(sessionId, userId)),
  };
}
