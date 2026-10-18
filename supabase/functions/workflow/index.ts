import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { WorkflowService } from '../../../src/server/workflow.ts';
import { createSupabaseWorkflowPersistence } from '../../../src/server/adapters/supabase/store.ts';
import { workflowHandler } from '../../../src/server/adapters/supabase/http.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const publicClient = createClient(url, publicKey, options);
const privileged = createClient(url, serviceKey, options);
const service = new WorkflowService(createSupabaseWorkflowPersistence(async (name, parameters) => {
  const { data, error } = await privileged.rpc(name, parameters);
  return { data, error };
}));

Deno.serve(workflowHandler({
  origins: (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  async authenticate(token) {
    // getUser verifies this exact bearer token with Auth before its claims are read.
    const { data, error } = await publicClient.auth.getUser(token);
    if (error || !data.user) return undefined;
    try {
      const segment = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(segment));
      if (claims.sub !== data.user.id || typeof claims.session_id !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(claims.session_id)) return undefined;
      return { accountId: data.user.id, loginId: claims.session_id };
    } catch { return undefined; }
  },
  execute: (caller, sessionId, requestId, command) => service.execute(caller, sessionId, requestId, command),
}));
