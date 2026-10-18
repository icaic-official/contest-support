import process from 'node:process';
import console from 'node:console';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';

const project = process.env.MINSKY_TEST_PROJECT_REF;
if (project !== 'ghtztmovdkhuketcbjmq') {
  throw new Error('Set MINSKY_TEST_PROJECT_REF=ghtztmovdkhuketcbjmq. Only the approved Minsky CI target is permitted.');
}
const options = process.argv.slice(2);
if (options.length > 1 || options.some((argument) => !argument.startsWith('--recover='))) {
  throw new Error('Only --recover=/absolute/path/fixture.json is accepted. Test configuration overrides are forbidden.');
}
let service = process.env.SUPABASE_SERVICE_ROLE_KEY;
let publicKey = process.env.SUPABASE_ANON_KEY;
if (!service || !publicKey) {
  let output;
  try {
    output = execFileSync('node_modules/.bin/supabase', ['projects', 'api-keys', '--project-ref', project, '--reveal', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { throw new Error('Cannot retrieve isolated test credentials. Use the existing Supabase login or supply CI secrets.'); }
  const parsed = JSON.parse(output);
  const keys = Array.isArray(parsed) ? parsed : (parsed.api_keys ?? parsed.keys ?? []);
  service ??= keys.find((key) => key.name === 'service_role' || key.type === 'secret')?.api_key;
  publicKey ??= keys.find((key) => key.name === 'anon' || key.type === 'publishable')?.api_key;
}
if (!service || !publicKey) throw new Error('Isolated test credentials are unavailable.');
const recoveries = process.argv.slice(2).filter((argument) => argument.startsWith('--recover='));
if (recoveries.length > 1) throw new Error('Supply one recovery journal.');
if (recoveries.length) {
  const recovery = recoveries[0].slice('--recover='.length);
  if (!isAbsolute(recovery) || !existsSync(recovery)) throw new Error('Supply the absolute path to an existing recovery journal.');
  if (process.argv.length !== 3) throw new Error('Recovery does not accept test options.');
  const result = spawnSync(process.execPath, ['scripts/provider-test.mjs', '--provider=supabase', recoveries[0]], {
    stdio: 'inherit', env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: service, SUPABASE_ANON_KEY: publicKey },
  });
  process.exit(result.status ?? 1);
}
// Check the server path before creating any fixture. Never log provider bodies.
const endpoint = `https://${project}.supabase.co`;
const probeId = '00000000-0000-4000-8000-000000000000';
const probe = await globalThis.fetch(`${endpoint}/rest/v1/rpc/shared_workflow_read`, {
  method: 'POST', headers: { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' },
  body: JSON.stringify({ p_actor: probeId, p_login: probeId, p_session: probeId, p_request: probeId,
    p_action: { type: 'submit', category: 'Backend', description: 'Read-only prerequisite check' } }),
  signal: globalThis.AbortSignal.timeout(30_000),
});
if (!probe.ok || await probe.text() !== 'null') throw new Error('Shared workflow database prerequisites are missing. No fixtures were created.');
const functionProbe = await globalThis.fetch(`${endpoint}/functions/v1/workflow`, {
  method: 'OPTIONS', headers: { apikey: publicKey }, signal: globalThis.AbortSignal.timeout(30_000),
});
if (functionProbe.status !== 204) throw new Error('Shared workflow function is unavailable. No fixtures were created.');
const directory = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'minsky-workflow-proof-'));
const journal = join(directory, 'fixture.json');
try {
  const result = spawnSync('node_modules/.bin/vitest', ['run', '--config', 'vitest.workflow.config.ts'], {
    stdio: 'inherit', env: { ...process.env, MINSKY_TEST_PROJECT_REF: project, SUPABASE_SERVICE_ROLE_KEY: service,
      SUPABASE_ANON_KEY: publicKey, MINSKY_WORKFLOW_FIXTURE: journal },
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (existsSync(journal)) {
    process.exitCode = 1;
    console.error(`Fixture cleanup failed. Recovery journal retained at ${journal}`);
  }
  else await rm(directory, { recursive: true, force: true });
}
