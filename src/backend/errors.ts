/** A definitive rejection. An unknown write outcome must use a different error. */
export class WorkflowRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowRejectedError';
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
