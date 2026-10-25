import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';

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
