import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createSupabaseBackend } from '../../../src/backend/supabase/backend';
import type { BrowserProvider } from '../browser-protocol';
import { createResponseFaults } from '../support/response-fault';

const configSchema = z.object({ url: z.url(), publicKey: z.string().min(1) })
  .strict();

export function createBrowserProvider(configuration: unknown): BrowserProvider {
  const config = configSchema.parse(configuration);
  const faults = createResponseFaults({ workflow: '/rest/v1/rpc/workflow', account: '/functions/v1/admin' });
  const client = createClient(config.url, config.publicKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: faults.fetch },
  });
  return {
    backend: createSupabaseBackend(config.url, config.publicKey, client),
    discardNextWorkflowResponse() {
      faults.discard('workflow');
    },
    discardNextAccountResponse() { faults.discard('account'); },
    async close() {
      await client.removeAllChannels();
      const result = await client.auth.signOut({ scope: 'local' });
      if (result.error) throw new Error('A fixture login could not be closed.');
    },
  };
}
