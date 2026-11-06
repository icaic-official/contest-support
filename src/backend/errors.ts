/** A definitive rejection. An unknown write outcome must use a different error. */
export class WorkflowRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowRejectedError';
  }
}

/** The server answered a request with a 4xx status. It refused the request and changed nothing. */
export class RequestRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestRefusedError';
  }
}

/** `conflict` means the announcement changed after the caller read it. */
export class AnnouncementRejectedError extends WorkflowRejectedError {
  readonly conflict: boolean;

  constructor(message: string, conflict = false) {
    super(message);
    this.name = 'AnnouncementRejectedError';
    this.conflict = conflict;
  }
}

export class ImageRequestError extends Error {
  readonly validation: boolean;
  readonly restart: boolean;
  readonly incomplete: boolean;

  constructor(
    message: string,
    options?: { validation?: boolean; restart?: boolean; incomplete?: boolean },
  ) {
    super(message);
    this.name = 'ImageRequestError';
    this.validation = options?.validation ?? false;
    this.restart = options?.restart ?? false;
    this.incomplete = options?.incomplete ?? false;
  }
}

const rejectionMessages = {
  state: 'This issue changed while you were working. Refresh and try again.',
  access: 'You no longer have access to do this.',
  input: 'Check what you entered and try again.',
  request_id: 'This request was already used. Refresh and try again.',
} as const;

/** Why the server rejected a workflow command. */
export type WorkflowRejectionReason = keyof typeof rejectionMessages;

/**
 * What a person reads after a rejection. `state` covers an issue that
 * changed since the person loaded it, such as a stale revision or an issue
 * that another person already claimed. `access` covers a closed intake, an
 * archived event and a changed role.
 */
export function workflowRejectionMessage(reason: WorkflowRejectionReason): string {
  return rejectionMessages[reason];
}

export function errorMessage(error: unknown): string {
  // fetch rejects with a TypeError when the request does not reach the server.
  // Its text differs by browser, for example "Failed to fetch" or "Load failed".
  if (error instanceof TypeError) {
    return 'Minsky could not reach the server. Check your connection and try again.';
  }
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return 'The request could not be completed.';
}
