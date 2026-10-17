import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

// This runner always uses an empty, temporary local D1 database. It has no
// account ID, hosted binding, credential file, or remote command option.
const persistence = await mkdtemp(join(tmpdir(), 'minsky-auth-browser-'));
const config = 'tests/auth/wrangler.jsonc';
const wrangler = 'node_modules/wrangler/bin/wrangler.js';
let child;
let stopping = false;

function command(args) {
  return spawn(process.execPath, [wrangler, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: join(persistence, 'wrangler.log'),
    },
  });
}

function completion(process) {
  return new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT' || (stopping && (code === 143 || code === 130))) resolve();
      else reject(new Error(`Local authentication fixture process failed (${code ?? signal}).`));
    });
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}

try {
  child = command([
    'd1', 'migrations', 'apply', 'minsky-auth-browser-local-only', '--local',
    '--config', config, '--persist-to', persistence,
  ]);
  await completion(child);
  if (!stopping) {
    child = command([
      'dev', '--local', '--ip', '127.0.0.1', '--port', '8788',
      '--local-protocol', 'https', '--config', config,
      '--persist-to', persistence, '--log-level', 'error',
    ]);
    await completion(child);
  }
} finally {
  await rm(persistence, { recursive: true, force: true });
}
