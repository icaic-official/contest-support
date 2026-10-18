import { z } from 'zod';
import { createCloudflareBackend } from '../../../src/backend/cloudflare/backend';
import type { BrowserProvider } from '../browser-protocol';

const configurationSchema = z.strictObject({ origin: z.url() });

/** Exercise the actual browser connector with same-origin hosted cookies. */
export function createBrowserProvider(configuration: unknown): BrowserProvider {
  const { origin } = configurationSchema.parse(configuration);
  let discardNext = false;
  const backend = createCloudflareBackend({
    origin,
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (discardNext && new URL(target).pathname === '/api/workflow' && response.ok) {
        discardNext = false;
        await response.arrayBuffer();
        throw new TypeError('The fixture discarded the committed workflow response.');
      }
      return response;
    },
  });
  return {
    backend,
    discardNextWorkflowResponse() { discardNext = true; },
    async close() {
      // Shared reset scenarios can revoke an earlier client. No server sign-out
      // remains possible for that cookie; closing its browser removes it.
      if (await backend.auth.currentUser()) await backend.auth.signOut();
    },
  };
}
