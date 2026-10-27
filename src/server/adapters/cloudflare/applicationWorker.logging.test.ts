import { afterEach, describe, expect, it, vi } from 'vitest';
import applicationWorker, { type ApplicationEnvironment } from './applicationWorker';

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }));

const origin = 'https://logging.example.invalid';
const secret = 'fictional-secret-value-7f3a9c';
const address = '192.0.2.77';
const context = { waitUntil: () => {} };

afterEach(() => vi.restoreAllMocks());

/** A database that fails every call with a message that carries the secret. */
function failingEnvironment(): ApplicationEnvironment {
  const fail = () => { throw new Error(`database unavailable ${secret}`); };
  return {
    DB: { prepare: fail, batch: fail, exec: fail },
    AUTH_ORIGIN: origin, AUTH_SECRET: secret,
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    IMAGES: { get: async () => null, put: async () => null, delete: async () => {} },
    LIVE_UPDATES: { idFromName: (name) => name, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) },
  };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`${origin}${path}?token=${secret}`, {
    ...init,
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Minsky-Request': '1',
      'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': address, 'cf-ray': 'ray-test-1',
      Cookie: `__Host-minsky-session=${secret}`, Authorization: `Bearer ${secret}` },
  });
}

describe('Worker failure logging', () => {
  it('logs one structured event for an unhandled failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await applicationWorker.fetch(
      request('/api/auth/sign-in', { method: 'POST', body: JSON.stringify({ username: 'a', password: secret }) }),
      failingEnvironment(), context);
    expect(response.status).toBe(503);
    expect(spy.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown)).toEqual([{
      level: 'error', event: 'worker.unhandled_error', route: '/api/auth/sign-in', method: 'POST',
      requestId: 'ray-test-1', status: 503, errorName: 'Error',
    }]);
  });

  it('never writes secrets, cookies, addresses, or error messages to any log', async () => {
    const output: string[] = [];
    for (const level of ['error', 'warn', 'log', 'info', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => { output.push(parts.map(String).join(' ')); });
    }
    const env = failingEnvironment();
    await applicationWorker.fetch(
      request('/api/auth/sign-in', { method: 'POST', body: JSON.stringify({ username: 'a', password: secret }) }), env, context);
    await applicationWorker.fetch(request('/api/images', { method: 'POST', body: JSON.stringify({ note: secret }) }), env, context);
    await expect(applicationWorker.scheduled({}, env)).rejects.toThrow();
    expect(output.length).toBeGreaterThan(2);
    for (const line of output) {
      expect(line).not.toContain(secret);
      expect(line).not.toContain(address);
      expect(line).not.toContain('database unavailable');
      expect(line).not.toContain('Bearer');
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }
  });
});
