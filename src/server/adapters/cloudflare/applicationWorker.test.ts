import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy, unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';
import type { D1Connection } from '../d1/connection';
import applicationWorker, { type ApplicationEnvironment } from './applicationWorker';
import { bootstrapInstallation } from './installation';

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }));

const origin = 'https://isolated-installation.example.invalid';
const timeout = 120_000;

describe('full Worker installation boundary with real local D1', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  let env: ApplicationEnvironment;

  beforeAll(async () => {
    const platform = await getPlatformProxy<{ DB: D1Connection }>({
      configPath: 'wrangler.auth-ci.jsonc', persist: false, remoteBindings: false, envFiles: [],
    });
    db = platform.env.DB;
    dispose = platform.dispose;
    const directory = 'src/server/adapters/d1/migrations';
    for (const file of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
      await db.batch(splitSqlQuery(readFileSync(`${directory}/${file}`, 'utf8')).map((sql) => db.prepare(sql)));
    }
    env = {
      DB: db, AUTH_ORIGIN: origin, AUTH_SECRET: randomUUID() + randomUUID(),
      ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
      IMAGES: { get: async () => null, put: async () => null, delete: async () => {} },
      LIVE_UPDATES: { idFromName: (name) => name, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) },
    };
  }, timeout);
  afterAll(async () => { if (dispose) await dispose(); }, timeout);

  async function signIn(username: string, password: string) {
    const pending: Promise<unknown>[] = [];
    const response = await applicationWorker.fetch(new Request(`${origin}/api/auth/sign-in`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
        'X-Minsky-Request': '1', 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '192.0.2.10' },
      body: JSON.stringify({ username, password }),
    }), env, { waitUntil: (operation) => { pending.push(operation); } });
    await Promise.all(pending);
    return response;
  }

  it('blocks empty login without poisoning bootstrap, then permits normal authentication', async () => {
    const response = await signIn('fictional-owner', 'Fictional unused password');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'The application is not initialized.' });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect((await db.prepare('SELECT count(*) AS count FROM authentication_limits').first<{ count: number }>())?.count).toBe(0);
    expect((await db.prepare('SELECT count(*) AS count FROM accounts').first<{ count: number }>())?.count).toBe(0);
    expect((await db.prepare('SELECT count(*) AS count FROM ba_session').first<{ count: number }>())?.count).toBe(0);
    const installed = await bootstrapInstallation(db, {
      adminUsername: 'fictional-owner', adminName: 'Fictional owner',
      eventName: `Installation boundary ${randomUUID()}`, sessionName: 'Fictional session',
      categories: ['Other'], teams: [{ name: 'Fictional team', location: 'Fixture desk' }],
    });
    expect(installed.accountId).toBeTruthy();
    const signed = await signIn(installed.adminUsername, installed.temporaryPassword);
    expect(signed.status).toBe(200);
    expect(signed.headers.get('Set-Cookie')).toContain('__Host-minsky-session=');
    expect((await db.prepare('SELECT count(*) AS count FROM authentication_limits').first<{ count: number }>())?.count).toBe(2);
    expect((await db.prepare('SELECT count(*) AS count FROM ba_session').first<{ count: number }>())?.count).toBe(1);
  }, timeout);
});
