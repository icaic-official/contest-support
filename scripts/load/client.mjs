import { performance } from 'node:perf_hooks';

const { AbortSignal, URL, WebSocket, fetch } = globalThis;

/** Milliseconds since the Unix epoch. Comparable across worker threads of one process. */
export const now = () => performance.timeOrigin + performance.now();

/**
 * Each failure class answers a different question: `edge` responses come from
 * Cloudflare in front of the Worker, `server` responses from the Worker itself.
 * A workflow `conflict` is an expected race between people, not a failure.
 */
export const failureClasses = ['client', 'limited', 'server', 'edge', 'network', 'timeout', 'socket'];

export class RequestFailure extends Error {
  constructor(outcome, status, body) {
    super(`The request failed: ${outcome}${status ? ` (HTTP ${status})` : ''}.`);
    this.outcome = outcome;
    this.status = status;
    this.body = body;
  }
}

function classify(status, json, expected) {
  if ((status >= 200 && status < 300) || status === expected) return 'ok';
  if (json === undefined) return 'edge';
  if (status === 409) return 'conflict';
  if (status === 429) return 'limited';
  if (status >= 500) return 'server';
  return 'client';
}

/**
 * One browser profile: its own cookies and the headers the Minsky frontend
 * sends. `record(name, ms, outcome, bytes)` receives every request, so the
 * caller decides how to aggregate.
 */
export function createClient(origin, { record, timeoutMs = 30_000 }) {
  const cookies = new Map();

  function cookieHeader() {
    return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  function storeCookies(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute)) || value === '';
      if (expired) cookies.delete(name);
      else cookies.set(name, value);
    }
  }

  /** Resolves with the parsed body for 2xx and 409. Rejects with RequestFailure otherwise. */
  async function request(name, path, { method = 'GET', body, csrf, signal, expected } = {}) {
    const headers = { Accept: 'application/json', 'Sec-Fetch-Site': 'same-origin' };
    if (cookies.size) headers.Cookie = cookieHeader();
    if (method !== 'GET') {
      Object.assign(headers, { Origin: origin, 'X-Minsky-Request': '1', 'Content-Type': 'application/json' });
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    const started = now();
    const timeout = AbortSignal.timeout(timeoutMs);
    let response;
    let text;
    try {
      response = await fetch(new URL(path, origin), {
        method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      storeCookies(response);
      text = await response.text();
    } catch (error) {
      if (signal?.aborted) throw error;
      const outcome = timeout.aborted ? 'timeout' : 'network';
      record(name, now() - started, outcome, 0);
      throw new RequestFailure(outcome);
    }
    const ms = now() - started;
    let json;
    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      try { json = JSON.parse(text); } catch { json = undefined; }
    }
    const outcome = classify(response.status, json, expected);
    record(name, ms, outcome, text.length);
    if (outcome !== 'ok' && outcome !== 'conflict') throw new RequestFailure(outcome, response.status, json);
    return { status: response.status, body: json, ms };
  }

  function webSocket(path) {
    const url = new URL(path, origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WebSocket(url, { headers: { Origin: origin, Cookie: cookieHeader() } });
  }

  return { request, webSocket, signedIn: () => cookies.size > 0 };
}

/** The frontend reads a fresh CSRF token before every write. */
export async function csrfToken(client) {
  return (await client.request('auth-session', '/api/auth/session')).body.csrf;
}
