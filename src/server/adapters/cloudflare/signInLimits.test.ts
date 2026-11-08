import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { D1Binding } from '../d1/connection';
import { applyMigrations } from '../d1/testFixture';
import applicationWorker, { type ApplicationEnvironment } from './applicationWorker';
import { signInFailureLimits } from './authentication';
import { openLocalPlatform } from './tooling/store-database.mjs';

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }));
// The maintained scrypt hasher takes about 100 ms per password. A fast
// stand-in keeps these tests about limits, not hashing cost.
vi.mock('./password', async (importOriginal) => {
  const hash = (password: string) => createHash('sha256').update(`fixture:${password}`).digest('hex');
  return {
    ...(await importOriginal<typeof import('./password')>()),
    passwordHasher: { hash: async (password: string) => hash(password), verify: async (password: string, stored: string) => hash(password) === stored },
  };
});

const origin = 'https://isolated-installation.example.invalid';
const password = 'Fictional venue password 1';
const timeout = 300_000;

describe('sign-in failure limits at the Worker boundary with real local D1', () => {
  let db: D1Binding;
  let dispose: () => Promise<void>;
  let env: ApplicationEnvironment;
  const run = randomUUID().replaceAll('-', '').slice(0, 8);
  const event = randomUUID();
  let eventCode = '';

  async function createAccounts(prefix: string, count: number): Promise<string[]> {
    const names = Array.from({ length: count }, (_, index) => `${prefix}_${run}_${index}`);
    const stored = createHash('sha256').update(`fixture:${password}`).digest('hex');
    for (let start = 0; start < names.length; start += 10) {
      await db.batch(names.slice(start, start + 10).flatMap((name) => {
        const id = randomUUID();
        return [
          db.prepare('INSERT INTO accounts (id, name, username, handle, event_id, must_change) VALUES (?, ?, ?, ?, ?, 0)')
            .bind(id, 'Fictional account', name, name, event),
          db.prepare(`INSERT INTO ba_user (id, name, username, email, emailVerified, createdAt, updatedAt)
            VALUES (?, 'Fictional account', ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
            .bind(id, name, `${name}@accounts.minsky.invalid`),
          db.prepare(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
            VALUES (?, ?, 'credential', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
            .bind(randomUUID(), id, id, stored),
        ];
      }));
    }
    return names;
  }

  async function signIn(ip: string, username: string, attempt = password, code = eventCode): Promise<number> {
    const pending: Promise<unknown>[] = [];
    const response = await applicationWorker.fetch(new Request(`${origin}/api/auth/sign-in`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
        'X-Minsky-Request': '1', 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': ip },
      body: JSON.stringify({ event: code, handle: username, password: attempt }),
    }), env, { waitUntil: (operation) => { pending.push(operation); } });
    await Promise.all(pending);
    return response.status;
  }

  async function counters(): Promise<Array<{ key: string; attempts: number }>> {
    return (await db.prepare('SELECT key, attempts FROM authentication_limits ORDER BY key').all<{ key: string; attempts: number }>()).results;
  }

  const counter = async (key: string) => (await counters()).filter((row) => row.key === key);

  beforeAll(async () => {
    const platform = await openLocalPlatform<{ DB: D1Binding }>('wrangler.auth-ci.jsonc');
    db = platform.env.DB;
    dispose = platform.dispose;
    await applyMigrations(db);
    await db.prepare('INSERT INTO events (id) VALUES (?)').bind(event).run();
    eventCode = (await db.prepare('SELECT code FROM events WHERE id = ?').bind(event).first<{ code: string }>())!.code;
    env = {
      DB: db, AUTH_ORIGIN: origin, AUTH_SECRET: randomUUID() + randomUUID(),
      ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
      IMAGES: { get: async () => null, put: async () => null, delete: async () => {}, list: async () => ({ objects: [], truncated: false }) },
      LIVE_UPDATES: { idFromName: (name) => name, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) },
    };
  }, timeout);
  afterAll(async () => { if (dispose) await dispose(); }, timeout);

  async function ipKey(ip: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.AUTH_SECRET}:${ip}`));
    const key = `ip:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    return key;
  }

  // One local sign-in takes 1 to 5 seconds on a busy machine, so the suite cannot
  // make 800 of them. A success never writes a counter, so the test starts the IP
  // one failure below its ceiling. Any count leak would then block a later sign-in.
  it('admits successful sign-ins from an IP at its ceiling, then blocks it after one more failure', async () => {
    const names = await createAccounts('venue', 12);
    const ip = '198.51.100.1';
    const key = await ipKey(ip);
    await db.prepare('INSERT INTO authentication_limits (key, window_start, attempts) VALUES (?, unixepoch(), ?)')
      .bind(key, signInFailureLimits.perIp - 1).run();
    const statuses: number[] = [];
    for (const name of names) statuses.push(await signIn(ip, name));
    expect(statuses).toEqual(names.map(() => 200));
    expect(await counter(key)).toEqual([{ key, attempts: signInFailureLimits.perIp - 1 }]);

    // The 200th failure fills the ceiling. The next attempt, even with the correct password, is refused.
    expect(await signIn(ip, `ghost_${run}_0`, 'Fictional wrong password')).toBe(401);
    expect(await signIn(ip, names[0]!)).toBe(429);
    expect(await signIn(ip, `ghost_${run}_1`, 'Fictional wrong password')).toBe(429);
    // A refused attempt does not add to the count or extend the window.
    expect(await counter(key)).toEqual([{ key, attempts: signInFailureLimits.perIp }]);
    expect(await signIn('198.51.100.3', names[0]!)).toBe(200);
    await db.prepare('UPDATE authentication_limits SET window_start = unixepoch() - 901 WHERE key = ?').bind(key).run();
    expect(await signIn(ip, names[0]!)).toBe(200);
  }, timeout);

  it('locks only the handle in its event with 10 failures and leaves other users on the same IP alone', async () => {
    const [target, other] = await createAccounts('lock', 2);
    const ip = '198.51.100.4';
    for (let index = 0; index < signInFailureLimits.perUsername; index++) {
      expect(await signIn(ip, target!, 'Fictional wrong password')).toBe(401);
    }
    expect(await signIn(ip, target!)).toBe(429);
    expect(await signIn('198.51.100.5', target!)).toBe(429);
    expect(await signIn(ip, other!)).toBe(200);
    // The IP count is far below its ceiling, so only the username refuses.
    const key = await ipKey(ip);
    expect(await counter(key)).toEqual([{ key, attempts: signInFailureLimits.perUsername }]);
    await db.prepare('UPDATE authentication_limits SET window_start = unixepoch() - 901 WHERE key = ?').bind(`handle:${event}:${target}`).run();
    expect(await signIn(ip, target!)).toBe(200);
  }, timeout);

  it('counts a wrong event code against the IP and the typed code, and a malformed one against the IP only', async () => {
    const [name] = await createAccounts('code', 1);
    const ip = '198.51.100.6';
    expect(await signIn(ip, name!, password, `absent-${run}`)).toBe(401);
    expect(await signIn(ip, name!, password, 'no')).toBe(401);
    const key = await ipKey(ip);
    expect(await counter(key)).toEqual([{ key, attempts: 2 }]);
    expect((await counters()).filter((row) => row.key.endsWith(`:${name!}`)))
      .toEqual([{ key: `handle:code:absent-${run}:${name!}`, attempts: 1 }]);
    expect(await signIn(ip, name!)).toBe(200);
  }, timeout);
});
