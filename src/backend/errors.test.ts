import { describe, expect, it } from 'vitest';
import { errorMessage, workflowRejectionMessage } from './errors';

const unreachable = 'Minsky could not reach the server. Check your connection and try again.';

describe('errorMessage', () => {
  it('replaces the browser text of a failed fetch', () => {
    for (const browserText of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) {
      expect(errorMessage(new TypeError(browserText))).toBe(unreachable);
    }
  });

  it('keeps the message of any other error', () => {
    expect(errorMessage(new Error('Workflow outcome is unknown. Retry the same request.')))
      .toBe('Workflow outcome is unknown. Retry the same request.');
  });

  it('uses a general message when the failure has no text', () => {
    expect(errorMessage(undefined)).toBe('The request could not be completed.');
  });
});

describe('workflowRejectionMessage', () => {
  it.each([
    ['state', 'This issue changed while you were working. Refresh and try again.'],
    ['access', 'You no longer have access to do this.'],
    ['input', 'Check what you entered and try again.'],
    ['request_id', 'This request was already used. Refresh and try again.'],
  ] as const)('explains the %s rejection in plain words', (reason, message) => {
    expect(workflowRejectionMessage(reason)).toBe(message);
  });
});
