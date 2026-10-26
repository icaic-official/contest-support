import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useMemo,
  useRef,
} from "react";
import type { Command } from "./model";

interface PendingWorkflowRequest {
  actorId: string;
  sessionId: string;
  request: string;
  command: Command;
  onSuccess: (() => void) | undefined;
  /** A queue action stays on the list instead of selecting its issue. */
  stayOnPage: boolean;
}

interface WorkflowRetryState {
  actorId: string;
  pending: RefObject<PendingWorkflowRequest | undefined>;
}

const WorkflowRetryContext = createContext<WorkflowRetryState | undefined>(
  undefined,
);

/** Keeps an uncertain request while account checks hide the workspace. */
export function WorkflowRetryProvider({
  actorId,
  children,
}: {
  actorId: string;
  children: ReactNode;
}) {
  const pending = useRef<PendingWorkflowRequest | undefined>(undefined);
  const value = useMemo(() => ({ actorId, pending }), [actorId]);
  return (
    <WorkflowRetryContext.Provider value={value}>
      {children}
    </WorkflowRetryContext.Provider>
  );
}

export function useWorkflowRetry(): WorkflowRetryState {
  const state = useContext(WorkflowRetryContext);
  if (!state) throw new Error("WorkflowRetryProvider is missing.");
  return state;
}
