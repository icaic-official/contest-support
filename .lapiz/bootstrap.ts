// Lapiz preview only. Initializes the local D1 state with the installation
// tool's trusted bootstrap, then exits. Never runs against hosted resources.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { bootstrapSite } from '../src/server/adapters/cloudflare/installation';
import type { D1Connection } from '../src/server/adapters/d1/connection';

const [configPath, persistPath] = process.argv.slice(2);
const proxy = await getPlatformProxy<{ DB: D1Connection }>({ configPath, persist: { path: join(persistPath, 'v3') } });
try {
  const initialized = await proxy.env.DB.prepare("SELECT 1 FROM grants WHERE scope = 'site' LIMIT 1").first();
  const credentialFile = join(persistPath, 'admin.txt');
  if (initialized) {
    process.stdout.write(`Preview already initialized. First webmaster credentials: ${await readFile(credentialFile, 'utf8').catch(() => 'unknown\n')}`);
  } else {
    const config = JSON.parse(await readFile('src/server/adapters/cloudflare/tooling/site.example.json', 'utf8'));
    const result = await bootstrapSite(proxy.env.DB, config);
    const line = `username=${result.handle} temporary password=${result.temporaryPassword}\n`;
    await mkdir(persistPath, { recursive: true });
    await writeFile(credentialFile, line, { mode: 0o600 });
    process.stdout.write(`Preview bootstrapped. First webmaster credentials: ${line}`);
  }
} finally {
  await proxy.dispose();
}
