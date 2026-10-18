import { useRef, useState } from "react";
import { z } from "zod";
import { errorMessage, requireClient } from "@/connected/client";
import type { Snapshot } from "@/connected/model";
import {
  type AdminRequest,
  type ImageLimits,
  type MembershipDraft,
  type NewAccount,
  createAccountRequest,
  imageLimitsParams,
  manageMemberParams,
  resetPasswordRequest,
  revokeMemberParams,
  setUsernameRequest,
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

const passwordSchema = z.object({ temporary_password: z.string() });

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
    work: () => Promise<{ error: unknown }>,
  ): Promise<boolean> {
    if (guard.current) return false;
    guard.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setCredentials(undefined);
    try {
      const result = await work();
      if (result.error) throw result.error;
      await refresh();
      setNotice("Administration action completed.");
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
      guard.current = false;
    }
  }

  /**
   * Calls the `admin` Edge Function. A new temporary password becomes the
   * one-time credentials, with the username of the account.
   */
  async function account(
    body: AdminRequest,
    username: string,
  ): Promise<{ error: unknown }> {
    const result = await requireClient().functions.invoke("admin", { body });
    if (
      result.error &&
      "context" in result.error &&
      result.error.context instanceof Response
    ) {
      const reply: unknown = await result.error.context.json();
      if (reply && typeof reply === "object" && "error" in reply) {
        return { error: { message: String(reply.error) } };
      }
    }
    if (!result.error && result.data?.temporary_password) {
      const parsed = passwordSchema.parse(result.data);
      setCredentials({ username, password: parsed.temporary_password });
    }
    return result;
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
      run(async () =>
        requireClient().rpc("set_intake", { p_session: sessionId, p_open: open }),
      ),
    saveImageLimits: (limits) =>
      run(async () =>
        requireClient().rpc(
          "set_image_limits",
          imageLimitsParams(sessionId, limits),
        ),
      ),
    createAccount: (input) =>
      run(() =>
        account(
          createAccountRequest(sessionId, input),
          input.username.trim().toLowerCase(),
        ),
      ),
    setUsername: (userId, username) =>
      run(() =>
        account(
          setUsernameRequest(sessionId, userId, username),
          username.trim().toLowerCase(),
        ),
      ),
    saveMembership: (userId, draft) =>
      run(async () =>
        requireClient().rpc(
          "manage_member",
          manageMemberParams(sessionId, userId, draft),
        ),
      ),
    resetPassword: (userId) =>
      run(() =>
        account(resetPasswordRequest(sessionId, userId), usernameOf(userId)),
      ),
    revokeAccess: (userId) =>
      run(async () =>
        requireClient().rpc(
          "manage_member",
          revokeMemberParams(sessionId, userId),
        ),
      ),
  };
}
