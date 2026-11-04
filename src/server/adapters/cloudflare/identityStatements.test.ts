import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { D1Binding, D1Connection, D1Statement } from '../d1/connection';
import type { LoginKey } from '../../../backend/contracts';
import { applyMigrations } from '../d1/testFixture';
import applicationWorker, { type ApplicationEnvironment } from './applicationWorker';
import { createBetterAuthIdentity, sharedBetterAuthIdentity } from './identity';

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }));
// The maintained scrypt hasher takes about 100 ms per password. A fast
// stand-in keeps these tests about D1 statements, not hashing cost.
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

/** Records the SQL of every statement the code under test sends to D1. */
function recordSql<Connection extends D1Connection>(db: Connection, sql: string[]): Connection {
  const wrap = (statement: D1Statement, text: string): D1Statement => new Proxy(statement, {
    get(target, key) {
      if (key === 'bind') return (...values: Array<string | number | null>) => wrap(target.bind(...values), text);
      if (key === 'first' || key === 'all' || key === 'run') {
        return (...args: unknown[]) => { sql.push(text); return (Reflect.get(target, key) as (...a: unknown[]) => unknown).apply(target, args); };
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  const texts = new WeakMap<D1Statement, string>();
  return new Proxy(db, {
    get(target, key) {
      if (key === 'prepare') {
        return (text: string) => {
          const statement = wrap(target.prepare(text), text);
          texts.set(statement, text);
          return statement;
        };
      }
      if (key === 'batch') {
        return (statements: D1Statement[]) => {
          for (const statement of statements) sql.push(texts.get(statement) ?? 'batch statement');
          return target.batch(statements);
        };
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

describe('Better Auth work per request with real local D1', () => {
  let db: D1Binding;
  let dispose: () => Promise<void>;
  let env: ApplicationEnvironment;
  const sql: string[] = [];
  const run = randomUUID().replaceAll('-', '').slice(0, 8);
  const username = `statements_${run}`;
  let eventCode = '';

  beforeAll(async () => {
    const platform = await getPlatformProxy<{ DB: D1Binding }>({
      configPath: 'wrangler.auth-ci.jsonc', persist: false, remoteBindings: false, envFiles: [],
    });
    db = platform.env.DB;
    dispose = platform.dispose;
    await applyMigrations(db);
    const id = randomUUID();
    const event = randomUUID();
    await db.batch([
      db.prepare('INSERT INTO events (id) VALUES (?)').bind(event),
      db.prepare('INSERT INTO accounts (id, name, username, handle, event_id, must_change) VALUES (?, ?, ?, ?, ?, 0)')
        .bind(id, 'Fictional account', username, username, event),
      db.prepare(`INSERT INTO ba_user (id, name, username, email, emailVerified, createdAt, updatedAt)
        VALUES (?, 'Fictional account', ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
        .bind(id, username, `${username}@accounts.minsky.invalid`),
      db.prepare(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
        VALUES (?, ?, 'credential', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
        .bind(randomUUID(), id, id, createHash('sha256').update(`fixture:${password}`).digest('hex')),
    ]);
    eventCode = (await db.prepare('SELECT code FROM events WHERE id = ?').bind(event).first<{ code: string }>())!.code;
    env = {
      DB: recordSql(db, sql), AUTH_ORIGIN: origin, AUTH_SECRET: randomUUID() + randomUUID(),
      ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
      IMAGES: { get: async () => null, put: async () => null, delete: async () => {} },
      LIVE_UPDATES: { idFromName: (name) => name, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) },
    };
  }, timeout);
  afterAll(async () => { if (dispose) await dispose(); }, timeout);

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const pending: Promise<unknown>[] = [];
    const response = await applicationWorker.fetch(new Request(`${origin}${path}`, {
      ...init, headers: { Origin: origin, 'X-Minsky-Request': '1', 'Sec-Fetch-Site': 'same-origin', ...init.headers },
    }), env, { waitUntil: (operation) => { pending.push(operation); } });
    await Promise.all(pending);
    return response;
  }

  // The Worker builds a new Better Auth instance for each request, so its
  // runtime schema check ran again every time. It read sqlite_master and then
  // table_info for each Better Auth table. That was about 36 of 40 statements.
  it('sends about four D1 statements for an authenticated API request and never reads the schema', async () => {
    const signed = await request('/api/auth/sign-in', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.9' },
      body: JSON.stringify({ event: eventCode, handle: username, password }),
    });
    expect(signed.status).toBe(200);
    const cookie = signed.headers.getSetCookie().find((value) => value.startsWith('__Host-minsky-session='))!.split(';')[0]!;

    sql.length = 0;
    const response = await request('/api/contests', { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    const statements = [...sql];
    expect(statements.filter((text) => /sqlite_master|table_info|pragma/i.test(text))).toEqual([]);
    expect(statements.length).toBeLessThanOrEqual(6);
  }, timeout);

  it('reuses one identity per D1 binding and rebuilds it when the secret changes', async () => {
    const options = { origin, secret: randomUUID() + randomUUID(), secureCookies: true };
    const binding = db;
    const first = sharedBetterAuthIdentity(binding, options);
    expect(sharedBetterAuthIdentity(binding, { ...options })).toBe(first);
    const signed = await first.signIn(username as LoginKey, password);
    const cookie = signed.cookie.split(';')[0]!;
    expect((await first.session(new Headers({ cookie })))?.accountId).toBe(signed.accountId);
    const rotated = sharedBetterAuthIdentity(binding, { ...options, secret: randomUUID() + randomUUID() });
    expect(rotated).not.toBe(first);
    await expect(rotated.session(new Headers({ cookie }))).resolves.toBeUndefined();
  }, timeout);

  // With the runtime check off, nothing else notices when a Better Auth
  // upgrade expects a table or column that the migrations lack.
  it('keeps the D1 migrations in step with the tables Better Auth expects', async () => {
    const checked = createBetterAuthIdentity(db, {
      origin, secret: randomUUID() + randomUUID(), secureCookies: true, validateSchema: true,
    });
    await expect(checked.session(new Headers())).resolves.toBeUndefined();

    await db.prepare('ALTER TABLE ba_session RENAME COLUMN token TO token_renamed').run();
    try {
      const drifted = createBetterAuthIdentity(db, {
        origin, secret: randomUUID() + randomUUID(), secureCookies: true, validateSchema: true,
      });
      await expect(drifted.session(new Headers())).rejects.toThrow();
    } finally {
      await db.prepare('ALTER TABLE ba_session RENAME COLUMN token_renamed TO token').run();
    }
  }, timeout);
});
