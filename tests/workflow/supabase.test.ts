import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createSupabaseBackend } from '../../src/backend/supabase/backend';
import { createServerWorkflowExecutor } from '../../src/backend/supabase/workflow';
import { createSupabaseWorkflowPersistence } from '../../src/server/adapters/supabase/store';
import { WorkflowService, type WorkflowPersistence } from '../../src/server/workflow';
import type { Backend } from '../../src/backend/contracts';
import type { Actor } from '../providers/contracts';
import type { WorkflowScenarioContext } from '../providers/scenarios/workflows';
import { createFixture, cleanupFixture, type SupabaseFixture } from '../providers/supabase/fixture';
import { lifecycle, accessSeparation, idempotency } from '../providers/scenarios/workflows';

const project = process.env.MINSKY_TEST_PROJECT_REF;
if (project !== 'ghtztmovdkhuketcbjmq') throw new Error('Shared workflow verification requires the approved Minsky CI project.');
const path = process.env.MINSKY_WORKFLOW_FIXTURE;
if (!path) throw new Error('Run this suite through scripts/workflow-proof.mjs.');
const journalPath = path;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) throw new Error('Missing isolated fixture credentials.');
const url = `https://${project}.supabase.co`;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function checked(error: unknown): void {
  if (error) throw new Error('Isolated workflow fixture operation failed.');
}

/** A real Supabase login and a real deployed workflow function per connection. */
function context(fixture: SupabaseFixture): WorkflowScenarioContext {
  const clients: SupabaseClient[] = [];
  const discard = new WeakMap<Backend, () => void>();
  return {
    ...fixture,
    async connect(actor?: Actor) {
      let drop = false;
      const client = createClient(fixture.url, fixture.publicKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: async (input, init) => {
          const response = await fetch(input, init);
          if (drop && response.ok && String(input).endsWith('/functions/v1/workflow')) {
            const result: unknown = await response.clone().json();
            if (result !== null && typeof result === 'object' && 'outcome' in result && result.outcome === 'committed') {
              drop = false;
              throw new Error('Fixture discarded the committed response.');
            }
          }
          return response;
        } },
      });
      clients.push(client);
      const backend = createSupabaseBackend(fixture.url, fixture.publicKey, client);
      backend.workflows.execute = createServerWorkflowExecutor(client);
      if (actor) {
        const account = fixture.accounts[actor];
        await backend.auth.signIn(account.username, account.password);
      }
      discard.set(backend, () => { drop = true; });
      return backend;
    },
    discardNextWorkflowResponse(backend) {
      const enable = discard.get(backend);
      if (!enable) throw new Error('Unknown workflow fixture connection.');
      enable();
    },
    async close() {
      for (const client of clients) checked((await client.auth.signOut({ scope: 'local' })).error);
    },
  };
}

// Each case uses new request/issue IDs within one UUID-owned run. Reuse the
// accounts to avoid repeated mandatory-password changes hitting Auth rate limits.
describe('shared workflow on hosted Supabase', () => {
  let fixture: SupabaseFixture;
  let run: WorkflowScenarioContext;
  beforeAll(async () => { fixture = await createFixture(journalPath, { organizerPasswordSetup: true }); run = context(fixture); });
  afterAll(async () => {
    try { if (run) await run.close(); } finally {
      // createFixture also cleans up a partial setup. Retain a journal if cleanup
      // fails; never replace it before a later run.
      const exists = await readFile(journalPath, 'utf8').then(() => true, () => false);
      if (exists) await cleanupFixture(journalPath);
    }
  });

  it('passes the shared lifecycle and persisted history assertions through the deployed function', async () => lifecycle(run));
  it('passes the shared team, session, and private activity assertions through the deployed function', async () => accessSeparation(run));
  it('passes the shared lost-response, retry, and concurrent-claim assertions through the deployed function', async () => idempotency(run));

  it('checks the trusted boundary and refuses direct mutation plans from a browser', async () => {
    const account = fixture.accounts.contestant;
    const client = createClient(fixture.url, fixture.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
    try {
      checked((await client.auth.signInWithPassword({ email: `${account.username}@accounts.minsky.invalid`, password: account.password })).error);
      const token = (await client.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Fixture login did not return a token.');
      const direct = await client.rpc('shared_workflow_commit', {
        p_actor: fixture.accounts.volunteer.id, p_login: crypto.randomUUID(), p_session: fixture.sessionId,
        p_request: crypto.randomUUID(), p_action: { type: 'submit', category: 'Backend', description: 'Unchecked direct plan' },
        p_dependency: {}, p_decision: {},
      });
      expect(direct.error?.code).toBe('42501');
      const body = { sessionId: fixture.sessionId, requestId: crypto.randomUUID(), command: {
        type: 'submit', category: 'Backend', description: 'Authenticated identity wins', team_id: 'ignored-non-uuid-override',
      }, accountId: fixture.accounts.volunteer.id, roles: ['volunteer', 'specialist', 'jury'] };
      const response = await fetch(`${url}/functions/v1/workflow`, { method: 'POST', headers: {
        apikey: fixture.publicKey, authorization: `Bearer ${token}`, 'content-type': 'application/json',
      }, body: JSON.stringify(body) });
      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.outcome).toBe('committed');
      const issue = await admin.from('issues').select('reporter,team_id').eq('id', result.issueId).single();
      checked(issue.error);
      expect(issue.data).toEqual({ reporter: account.id, team_id: fixture.teamId });
      for (const authorization of ['', 'Bearer unverified-token']) {
        const rejected = await fetch(`${url}/functions/v1/workflow`, { method: 'POST', headers: {
          apikey: fixture.publicKey, authorization, 'content-type': 'application/json',
        }, body: JSON.stringify(body) });
        expect(rejected.status).toBe(401);
      }
    } finally { await client.auth.signOut({ scope: 'local' }); }
  });

  it('rejects a permission change made after a real hosted decision read', async () => {
    const contestant = await run.connect('contestant');
    const issueId = await contestant.workflows.execute(fixture.sessionId, crypto.randomUUID(), { type: 'submit', category: 'Backend', description: 'Hosted permission race' });
    const account = fixture.accounts.volunteer;
    const client = createClient(fixture.url, fixture.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
    try {
      checked((await client.auth.signInWithPassword({ email: `${account.username}@accounts.minsky.invalid`, password: account.password })).error);
      const login = (await client.auth.getSession()).data.session;
      if (!login) throw new Error('Fixture login did not return a session.');
      const claims: unknown = JSON.parse(Buffer.from(login.access_token.split('.')[1], 'base64url').toString('utf8'));
      if (!claims || typeof claims !== 'object' || !('session_id' in claims) || typeof claims.session_id !== 'string') throw new Error('Verified fixture login has no session identifier.');
      const base = createSupabaseWorkflowPersistence(async (name, parameters) => {
        const { data, error } = await admin.rpc(name, parameters);
        return { data, error };
      });
      let changed = false;
      const raced: WorkflowPersistence = { read: (...args) => base.read(...args), commit: async (...args) => {
        if (!changed) {
          changed = true;
          checked((await admin.from('memberships').update({ roles: ['jury'] }).eq('session_id', fixture.sessionId).eq('user_id', account.id)).error);
        }
        return base.commit(...args);
      } };
      const revision = (await contestant.workflows.snapshot(fixture.sessionId)).issues.find((item) => item.id === issueId)!.revision;
      const result = await new WorkflowService(raced).execute({ accountId: account.id, loginId: claims.session_id }, fixture.sessionId, crypto.randomUUID(), { type: 'claim', issue_id: issueId, revision });
      expect(result.outcome).toBe('rejected');
      const persisted = await admin.from('issues').select('status,owner').eq('id', issueId).single();
      checked(persisted.error);
      expect(persisted.data).toEqual({ status: 'open', owner: null });
      const history = await admin.from('history').select('id').eq('issue_id', issueId);
      checked(history.error);
      expect(history.data).toHaveLength(1);
    } finally { await client.auth.signOut({ scope: 'local' }); }
  });
});
