import { useEffect, useRef, useState } from "react";
import { backend } from "@/backend";
import { errorMessage, WorkflowRejectedError } from "@/backend/errors";
import type { Command, Snapshot } from "../model";
import { useWorkflowRetry } from "../WorkflowRetry";

/** Options for one workflow command. */
export interface ActionOptions {
  /** Send the pending command again with its original request UUID. */
  retry?: boolean;
  /**
   * Runs once when the server records the command, before the refresh. Use it
   * to clear the form that sent the command. A retry runs the callback of the
   * original request.
   */
  onSuccess?: () => void;
  /**
   * When true, a recorded command does not select its issue. Use it for a
   * queue action that stays on the list.
   */
  stayOnPage?: boolean;
}

/** Resolves to true when the command is recorded in the current workspace. */
export type Act = (
  command: Command,
  options?: ActionOptions,
) => Promise<boolean>;

/** The workflow command runner and its status for one session. */
export interface CommandRunner {
  act: Act;
  /** True while a command request runs. */
  busy: boolean;
  /** A command whose result is unknown after a transport failure. */
  pending: Command | undefined;
  /** True while a command runs or waits for a retry. Disable workflow controls. */
  locked: boolean;
  /** Sends the pending command again with its original request UUID. */
  retry: () => void;
  /** Confirmation of the last recorded command. */
  notice: string;
  /** The error of the last command. */
  error: string;
}

/**
 * Runs workflow commands one at a time. A repeated click while a command runs
 * does nothing. After a transport failure the command keeps its request UUID
 * until the person retries it, so the server cannot record it twice.
 */
export function useCommand({
  sessionId,
  refresh,
  applySnapshot,
  onStart,
  onRecorded,
}: {
  sessionId: string;
  refresh: () => Promise<void>;
  /**
   * Shows the snapshot that a recorded command returns, so no read follows.
   * Resolves to false when the caller must read again.
   */
  applySnapshot?: (sessionId: string, snapshot: Snapshot) => Promise<boolean>;
  /** Runs when a command or a retry starts. */
  onStart?: () => void;
  /** Runs after the refresh that follows a recorded command. */
  onRecorded?: (
    issueId: string,
    command: Command,
    options: { stayOnPage: boolean },
  ) => void;
}): CommandRunner {
  const { actorId, pending: pendingRequest } = useWorkflowRetry();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(pendingRequest.current?.command);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(
    pendingRequest.current
      ? "The request result is unknown. Retry the last request."
      : "",
  );
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const currentSessionId = useRef(sessionId);
  // A late response must check the current session, not its starting closure.
  currentSessionId.current = sessionId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // A retry can survive the account gate. A callback into an old form cannot.
      if (pendingRequest.current?.actorId === actorId) {
        pendingRequest.current.onSuccess = undefined;
      }
    };
  }, [actorId, pendingRequest]);
  async function act(
    command: Command,
    { retry = false, onSuccess, stayOnPage = false }: ActionOptions = {},
  ): Promise<boolean> {
    if (
      !mounted.current ||
      inFlight.current ||
      (!retry && pendingRequest.current)
    ) {
      return false;
    }
    if (retry && pendingRequest.current?.actorId !== actorId) return false;
    inFlight.current = true;
    onStart?.();
    setBusy(true);
    setNotice("");
    setError("");
    const request =
      retry && pendingRequest.current
        ? pendingRequest.current
        : {
            actorId,
            sessionId,
            request: crypto.randomUUID(),
            command,
            onSuccess,
            stayOnPage,
          };
    pendingRequest.current = request;
    setPending(request.command);
    try {
      const { workflows } = backend;
      const { issueId: id, snapshot } = workflows.executeAndRead
        ? await workflows.executeAndRead(
            request.sessionId,
            request.request,
            request.command,
          )
        : {
            issueId: await workflows.execute(
              request.sessionId,
              request.request,
              request.command,
            ),
            snapshot: undefined,
          };
      if (pendingRequest.current !== request || !mounted.current) return false;
      pendingRequest.current = undefined;
      setPending(undefined);
      // A retry must complete the original form's cleanup before enabling edits.
      if (request.sessionId === currentSessionId.current) request.onSuccess?.();
      // The response already carries the changed snapshot, so one request is enough.
      if (!snapshot || !(await applySnapshot?.(request.sessionId, snapshot))) {
        await refresh();
      }
      if (!mounted.current || request.sessionId !== currentSessionId.current)
        return false;
      onRecorded?.(id, request.command, { stayOnPage: request.stayOnPage });
      setNotice("Action recorded in shared history.");
      return true;
    } catch (cause) {
      if (pendingRequest.current !== request || !mounted.current) return false;
      // Known server rejections are definitive. Transport failures retain the same
      // request UUID for an explicit retry, including submissions and messages.
      if (cause instanceof WorkflowRejectedError) {
        pendingRequest.current = undefined;
        setPending(undefined);
      }
      await refresh();
      if (!mounted.current) return false;
      setError(errorMessage(cause));
      return false;
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    act,
    busy,
    pending,
    locked: busy || !!pending,
    retry: () => {
      const command = pendingRequest.current?.command;
      if (command) void act(command, { retry: true });
    },
    notice,
    error,
  };
}
