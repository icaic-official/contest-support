import type { Command } from "../connected/model";

export interface PendingWorkflowRequest {
  actorId: string;
  sessionId: string;
  request: string;
  command: Command;
  onSuccess?: () => void;
}
