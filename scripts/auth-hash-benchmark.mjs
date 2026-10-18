import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { setTimeout } from 'node:timers';
/* global fetch, URL, console */

const expectedAccount = '458ad6a930b0fb717796dfa19ca6a2b1';
const args = process.argv.slice(2);
const hosted = args.includes('--hosted');
const selectedOperation = args.find((arg) => arg.startsWith('--operation='))?.slice('--operation='.length);
if (selectedOperation && !['hash', 'verify'].includes(selectedOperation)) throw new Error('Select hash or verify.');
if (args.some((arg) => arg !== '--hosted' && arg !== `--account=${expectedAccount}` && !['--operation=hash', '--operation=verify'].includes(arg))) {
  throw new Error('Unexpected benchmark argument.');
}
if (hosted && !args.includes(`--account=${expectedAccount}`)) {
  throw new Error('Hosted benchmarking requires the explicit authorized account.');
}

const directory = await mkdtemp(join(tmpdir(), 'minsky-auth-hash-'));
process.env.WRANGLER_LOG_PATH = join(directory, 'wrangler.log');
process.env.WRANGLER_SEND_METRICS = 'false';
const name = `minsky-auth-${selectedOperation ?? 'hash'}-${randomUUID().slice(0, 8)}`;
const token = randomBytes(32).toString('hex');
const digest = createHash('sha256').update(token).digest('hex');
const configPath = join(directory, 'wrangler.json');
const wranglerPath = resolve('node_modules/wrangler/bin/wrangler.js');
const since = new Date().toISOString();
let deployed = false;
let local;

function wrangler(command) {
  try {
    return execFileSync(process.execPath, [wranglerPath, ...command, '--config', configPath], {
      encoding: 'utf8', maxBuffer: 5_000_000, timeout: 120_000,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(directory, 'wrangler.log') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`The benchmark Worker command failed (${command[0]}). Provider output was withheld.`);
  }
}

async function analytics(expectedRequests) {
  let apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) {
    const oauthPath = join(homedir(), '.config', '.wrangler', 'config', 'default.toml');
    try {
      const oauth = await readFile(oauthPath, 'utf8');
      apiToken = /^oauth_token\s*=\s*"([^"]+)"/m.exec(oauth)?.[1];
    } catch { /* Analytics is optional when the existing login lacks this scope. */ }
  }
  if (!apiToken) return { verified: false, reason: 'No existing analytics credential.' };
  const query = `query($account: string, $since: string, $until: string, $script: string) {
    viewer { accounts(filter: {accountTag: $account}) {
      workersInvocationsAdaptive(limit: 100, filter: {scriptName: $script, datetime_geq: $since, datetime_leq: $until}) {
        dimensions {status} sum {requests errors} quantiles {cpuTimeP50 cpuTimeP99}
      }
    } }
  }`;
  let latestRows;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { account: expectedAccount, since, until: new Date().toISOString(), script: name } }),
    });
    const result = await response.json();
    if (!response.ok || result.errors?.length) return { verified: false, reason: 'The existing credential cannot read Worker analytics.' };
    const rows = result.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
    if (rows?.length) {
      latestRows = rows;
      if (rows.reduce((sum, row) => sum + row.sum.requests, 0) >= expectedRequests) {
        return { verified: true, cpuUnit: 'microseconds', samples: rows };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return {
    verified: Boolean(latestRows),
    complete: false,
    reason: 'The adaptive analytics dataset did not include every request within 30 seconds.',
    cpuUnit: 'microseconds', samples: latestRows, script: name, since,
  };
}

try {
  await writeFile(join(directory, 'worker.ts'), `
import { passwordHasher, randomSecret } from ${JSON.stringify(resolve('src/server/adapters/cloudflare/password.ts'))};
export default {
  async fetch(request: Request, env: { TOKEN_DIGEST: string }) {
    const supplied = request.headers.get('x-benchmark-token') ?? '';
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(supplied));
    const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== env.TOKEN_DIGEST) return new Response('Not found', {status:404});
    const path = new URL(request.url).pathname;
    if (path === '/ready') return new Response('Ready');
    if (path === '/hash') {
      const password = randomSecret();
      const started = performance.now();
      await passwordHasher.hash(password);
      return Response.json({ok:true, elapsedMs:performance.now()-started});
    }
    if (path === '/verify') {
      const fixture = await request.json() as {password:string;hash:string};
      const started = performance.now();
      const ok = await passwordHasher.verify(fixture.password, fixture.hash);
      return Response.json({ok, elapsedMs:performance.now()-started});
    }
    return new Response('Not found', {status:404});
  }
};
`, { mode: 0o600 });
  await writeFile(configPath, JSON.stringify({
    name, account_id: expectedAccount, main: './worker.ts', compatibility_date: '2026-10-13',
    compatibility_flags: ['nodejs_compat'], workers_dev: true, preview_urls: false,
    observability: { enabled: false }, vars: { TOKEN_DIGEST: digest },
  }), { mode: 0o600 });

  let url;
  if (hosted) {
    const identity = wrangler(['whoami']);
    if (!identity.includes(expectedAccount)) throw new Error('Wrangler is not authorized for the expected account.');
    const deployment = wrangler(['deploy']);
    deployed = true;
    url = deployment.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/)?.[0];
    if (!url) throw new Error('The benchmark deployment returned no workers.dev URL.');
  } else {
    const { unstable_startWorker: startWorker } = await import('wrangler');
    local = await startWorker({ config: configPath, dev: { remote: false, persist: false, logLevel: 'error', server: { port: 0 } } });
    url = String(await local.url);
  }

  // Wait for workers.dev propagation without including a hash or password.
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await fetch(new URL('/ready', url), { headers: { 'x-benchmark-token': token } });
    if (response.ok) break;
    if (attempt === 19) throw new Error('The benchmark Worker did not become ready.');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const { hashPassword } = await import('better-auth/crypto');
  const fixturePassword = randomBytes(32).toString('hex');
  const fixtureHash = await hashPassword(fixturePassword);
  const measurements = [];
  for (let sample = 0; sample < 5; sample++) {
    for (const operation of selectedOperation ? [selectedOperation] : ['hash', 'verify']) {
      let response;
      const started = performance.now();
      for (let attempt = 0; attempt < 20; attempt++) {
        response = await fetch(new URL(`/${operation}`, url), {
          method: 'POST',
          headers: { 'x-benchmark-token': token, 'content-type': 'application/json' },
          body: operation === 'verify' ? JSON.stringify({ password: fixturePassword, hash: fixtureHash }) : undefined,
        });
        if (!hosted || response.status !== 404) break;
        // A new workers.dev route can reach different edges during propagation.
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      const clientElapsedMs = performance.now() - started;
      if (!response.ok) {
        measurements.push({ operation, httpStatus: response.status, clientElapsedMs });
        process.exitCode = 1;
        continue;
      }
      const result = await response.json();
      measurements.push({ operation, httpStatus: response.status, ok: result.ok, localRuntimeElapsedMs: hosted ? undefined : result.elapsedMs, clientElapsedMs });
    }
  }
  // Hosted timers are frozen during CPU work. Only analytics measures CPU time.
  console.log(JSON.stringify({ target: hosted ? 'hosted' : 'local-workerd', name, measurements, analytics: hosted ? await analytics(measurements.length + 1) : undefined }, null, 2));
} finally {
  if (local) await local.dispose();
  if (deployed) {
    wrangler(['delete', '--force']);
    console.log('The isolated benchmark Worker was deleted.');
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
