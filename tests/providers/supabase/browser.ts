import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createSupabaseBackend } from '../../../src/backend/supabase/backend';
import type { BrowserProvider } from '../browser-protocol';

const configSchema = z.object({ url: z.url(), publicKey: z.string().min(1) })
  .strict();

export function createBrowserProvider(configuration: unknown): BrowserProvider {
  const config = configSchema.parse(configuration);
  let discardNext = false;
  const client = createClient(config.url, config.publicKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        const target = typeof input === 'string'
          ? input
          : input instanceof URL
          ? input.href
          : input.url;
        if (
          discardNext && new URL(target).pathname === '/rest/v1/rpc/workflow' &&
          response.ok
        ) {
          discardNext = false;
          await response.arrayBuffer();
          throw new TypeError(
            'The fixture discarded the committed workflow response.',
          );
        }
        return response;
      },
    },
  });
  return {
    backend: createSupabaseBackend(config.url, config.publicKey, client),
    discardNextWorkflowResponse() {
      discardNext = true;
    },
    async close() {
      await client.removeAllChannels();
      const result = await client.auth.signOut({ scope: 'local' });
      if (result.error) throw new Error('A fixture login could not be closed.');
    },
  };
}
