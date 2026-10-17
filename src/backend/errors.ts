/** A definitive rejection. An unknown write outcome must use a different error. */
export class WorkflowRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowRejectedError';
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
