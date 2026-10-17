import { describe, expect, it } from 'vitest';
import { loginIdentifier } from './backend';

describe('username login identifiers', () => {
  it('normalizes usernames and retains existing email accounts during migration', () => {
    expect(loginIdentifier(' Team-Aurora ')).toBe(
      'team-aurora@accounts.minsky.invalid',
    );
    expect(loginIdentifier(' Organizer@Example.org ')).toBe(
      'organizer@example.org',
    );
  });
  it('rejects malformed usernames before sending a sign-in request', () => {
    for (
      const username of ['', 'ab', 'user name', 'user/name', 'x'.repeat(33)]
    ) {
      expect(() => loginIdentifier(username)).toThrow(
        'organizer-provided username',
      );
    }
  });
});
