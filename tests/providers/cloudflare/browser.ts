import { z } from 'zod';
import { createCloudflareBackend } from '../../../src/backend/cloudflare/backend';
import type { BrowserProvider } from '../browser-protocol';
import { createResponseFaults } from '../support/response-fault';

const configurationSchema = z.strictObject({ origin: z.url() });

/** Exercise the actual browser connector with same-origin hosted cookies. */
export function createBrowserProvider(configuration: unknown): BrowserProvider {
  const { origin } = configurationSchema.parse(configuration);
  const faults = createResponseFaults({ workflow: '/api/workflow', account: '/api/credentials' });
  const backend = createCloudflareBackend({
    origin,
    fetch: faults.fetch,
  });
  return {
    backend,
    discardNextWorkflowResponse() { faults.discard('workflow'); },
    discardNextAccountResponse() { faults.discard('account'); },
    async close() {
      // Shared reset scenarios can revoke an earlier client. No server sign-out
      // remains possible for that cookie; closing its browser removes it.
      if (await backend.auth.currentUser()) await backend.auth.signOut();
    },
  };
}
