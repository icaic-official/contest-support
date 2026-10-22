// Lapiz preview only. Serves the Cloudflare application Worker with local
// D1, R2, and Durable Object emulation behind the preview's HTTPS hostname.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const state = resolve(import.meta.dirname, 'state');
const port = process.env.PORT ?? '8787';
const hostname = process.env.LAPIZ_PREVIEW_HOSTNAME;
if (!hostname) throw new Error('LAPIZ_PREVIEW_HOSTNAME is required.');
mkdirSync(state, { recursive: true });

const secretFile = resolve(state, 'auth-secret');
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });

// Wrangler hides .dev.vars values in its binding table and logs.
writeFileSync(resolve(import.meta.dirname, '.dev.vars'), `AUTH_SECRET=${readFileSync(secretFile, 'utf8')}\n`, { mode: 0o600 });
const configPath = resolve(import.meta.dirname, 'wrangler.preview.json');
writeFileSync(configPath, JSON.stringify({
  name: 'minsky-lapiz-preview',
  main: resolve(root, 'src/server/adapters/cloudflare/applicationWorker.ts'),
  compatibility_date: '2026-10-13',
  compatibility_flags: ['nodejs_compat'],
  vars: { AUTH_ORIGIN: `https://${hostname}` },
  assets: { directory: resolve(import.meta.dirname, 'dist'), binding: 'ASSETS', run_worker_first: true },
  d1_databases: [{ binding: 'DB', database_name: 'minsky-lapiz-preview', database_id: '00000000-0000-4000-8000-000000000000',
    migrations_dir: resolve(root, 'src/server/adapters/d1/migrations') }],
  r2_buckets: [{ binding: 'IMAGES', bucket_name: 'minsky-lapiz-preview' }],
  durable_objects: { bindings: [{ name: 'LIVE_UPDATES', class_name: 'SessionLiveCoordinator' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['SessionLiveCoordinator'] }],
  // The Worker checks request URLs against AUTH_ORIGIN. Rewrite local
  // requests to the public HTTPS origin that the Lapiz proxy serves.
  dev: { ip: '0.0.0.0', port: Number(port), local_protocol: 'http', upstream_protocol: 'https', host: hostname },
}, null, 2));

const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const run = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, CI: '1' } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run([wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', state]);
run([resolve(import.meta.dirname, 'build/bootstrap.mjs'), configPath, state]);
