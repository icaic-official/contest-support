import type { Command } from "../../connected/model";

export interface ActionOptions {
  retry?: boolean;
  onSuccess?: () => void;
}

export type IssueAction = (
  command: Command,
  options?: ActionOptions,
) => Promise<boolean>;
