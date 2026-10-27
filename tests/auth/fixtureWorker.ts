import { createAuthenticationHandler } from '../../src/server/authenticationHttp';
import { D1AuthenticationService } from '../../src/server/adapters/cloudflare/authentication';
import { createBetterAuthIdentity } from '../../src/server/adapters/cloudflare/identity';
import { passwordHasher, randomSecret } from '../../src/server/adapters/cloudflare/password';
import type { D1Binding } from '../../src/server/adapters/d1/connection';

const origin = 'https://127.0.0.1:8788';
let secret: string | undefined;
const fixtureId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Local browser fixture only. The production Worker does not import this file. */
export default {
  async fetch(request: Request, env: { DB: D1Binding }): Promise<Response> {
    const url = new URL(request.url);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return new Response(null, { status: 403 });
    if (url.pathname === '/__fixture/health') return new Response('ready');
    if (url.pathname.startsWith('/__fixture/')) {
      if (url.origin !== origin || request.headers.has('Origin') || request.headers.get('X-Minsky-Fixture') !== '1') {
        return new Response(null, { status: 403 });
      }
      const id = url.pathname.slice('/__fixture/'.length);
      if (!fixtureId.test(id)) return new Response(null, { status: 400 });
      const username = `browser_${id.replaceAll('-', '').slice(0, 20)}`;
      if (request.method === 'POST') {
        const password = randomSecret() + 'Aa9!';
        const hash = await passwordHasher.hash(password);
        const now = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare('INSERT INTO accounts (id, name, username, must_change) VALUES (?, ?, ?, 1)').bind(id, 'Fictional browser fixture', username),
          env.DB.prepare('INSERT INTO events (id) VALUES (?)').bind(id),
          env.DB.prepare('INSERT INTO sessions (id, event_id) VALUES (?, ?)').bind(id, id),
          env.DB.prepare('INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, 1)').bind(id, id),
          env.DB.prepare(`INSERT INTO ba_user (id, name, email, emailVerified, createdAt, updatedAt, username)
            VALUES (?, ?, ?, 1, ?, ?, ?)`).bind(id, 'Fictional browser fixture', `${username}@accounts.minsky.invalid`, now, now, username),
          env.DB.prepare(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
            VALUES (?, ?, 'credential', ?, ?, ?, ?)`).bind(id, id, id, hash, now, now),
        ]);
        return json({ id, username, password }, 201);
      }
      if (request.method === 'DELETE') {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id),
          env.DB.prepare('DELETE FROM ba_user WHERE id = ?').bind(id),
          env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id),
          env.DB.prepare('DELETE FROM authentication_limits WHERE key IN (?, ?)').bind(`username:${username}`, `change:${id}`),
        ]);
        const remaining = await env.DB.prepare(`SELECT
          (SELECT count(*) FROM accounts WHERE id = ?) +
          (SELECT count(*) FROM ba_user WHERE id = ?) +
          (SELECT count(*) FROM ba_account WHERE userId = ?) +
          (SELECT count(*) FROM ba_session WHERE userId = ?) +
          (SELECT count(*) FROM logins WHERE account_id = ?) +
          (SELECT count(*) FROM memberships WHERE account_id = ?) +
          (SELECT count(*) FROM account_operations WHERE account_id = ?) +
          (SELECT count(*) FROM sessions WHERE id = ?) +
          (SELECT count(*) FROM events WHERE id = ?) AS remaining`).bind(id, id, id, id, id, id, id, id, id).first<{ remaining: number }>();
        return json(remaining);
      }
      return new Response(null, { status: 405 });
    }
    if (url.pathname === '/') {
      return new Response('<!doctype html><html lang="en"><title>Isolated authentication browser fixture</title><body>Fictional browser security fixture</body></html>', {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
      });
    }
    // Wrangler supplies a real local D1 binding. The application contract keeps
    // only the D1 methods it uses; Better Auth accepts the full runtime binding.
    secret ??= randomSecret();
    const identity = createBetterAuthIdentity(env.DB, {
      origin, secret, secureCookies: true,
    });
    const service = new D1AuthenticationService(env.DB, identity, passwordHasher);
    return createAuthenticationHandler(service, { origins: [origin] })(request);
  },
};
