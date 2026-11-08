import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { D1Binding } from '../d1/connection';
import { applyMigrations } from '../d1/testFixture';
import applicationWorker, { type ApplicationEnvironment } from './applicationWorker';
import { bootstrapSite } from './installation';
import { openLocalPlatform } from './tooling/store-database.mjs';

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }));

const origin = 'https://isolated-installation.example.invalid';
const timeout = 120_000;

describe('full Worker installation boundary with real local D1', () => {
  let db: D1Binding;
  let dispose: () => Promise<void>;
  let env: ApplicationEnvironment;

  beforeAll(async () => {
    const platform = await openLocalPlatform<{ DB: D1Binding }>('wrangler.auth-ci.jsonc');
    db = platform.env.DB;
    dispose = platform.dispose;
    await applyMigrations(db);
    env = {
      DB: db, AUTH_ORIGIN: origin, AUTH_SECRET: randomUUID() + randomUUID(),
      ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
      IMAGES: { get: async () => null, put: async () => null, delete: async () => {} },
      LIVE_UPDATES: { idFromName: (name) => name, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) },
    };
  }, timeout);
  afterAll(async () => { if (dispose) await dispose(); }, timeout);

  /** A site sign-in, as the bootstrap webmaster uses. */
  async function signIn(handle: string, password: string) {
    const pending: Promise<unknown>[] = [];
    const response = await applicationWorker.fetch(new Request(`${origin}/api/auth/sign-in`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
        'X-Minsky-Request': '1', 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '192.0.2.10' },
      body: JSON.stringify({ event: null, handle, password }),
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
    const installed = await bootstrapSite(db, { webmasterHandle: 'fictional-owner', webmasterName: 'Fictional owner' });
    expect(installed.accountId).toBeTruthy();
    const signed = await signIn(installed.handle, installed.temporaryPassword);
    expect(signed.status).toBe(200);
    expect(signed.headers.get('Set-Cookie')).toContain('__Host-minsky-session=');
    // A successful sign-in does not count toward the username or IP limit.
    expect((await db.prepare('SELECT count(*) AS count FROM authentication_limits').first<{ count: number }>())?.count).toBe(0);
    expect((await db.prepare('SELECT count(*) AS count FROM ba_session').first<{ count: number }>())?.count).toBe(1);
  }, timeout);
});
