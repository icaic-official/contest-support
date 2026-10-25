import { createAuthenticationHandler } from '../../authenticationHttp';
import { AuthenticationError } from '../../authentication';
import type { D1Connection } from '../d1/connection';
import { D1AuthenticationService } from './authentication';
import { createBetterAuthIdentity } from './identity';
import { passwordHasher } from './password';
import { logEvent, requestFields } from './log';

interface Environment {
  DB: D1Connection;
  AUTH_ORIGIN: string;
  AUTH_SECRET: string;
}

/** Separate experimental CI Worker. Static app previews never import this entry. */
export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    try {
      // The application port narrows D1's surface. The runtime binding also has
      // exec(), which Better Auth uses to recognize its native D1 adapter.
      const identity = createBetterAuthIdentity(env.DB as Parameters<typeof createBetterAuthIdentity>[0], {
        origin: env.AUTH_ORIGIN, secret: env.AUTH_SECRET, secureCookies: true,
      });
      const service = new D1AuthenticationService(env.DB, identity, passwordHasher);
      if (new URL(request.url).pathname === '/api/auth/sign-in' && request.method === 'POST') {
        if (new URL(request.url).origin !== env.AUTH_ORIGIN || request.headers.get('Origin') !== env.AUTH_ORIGIN ||
            request.headers.get('X-Minsky-Request') !== '1' || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
          return new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } });
        }
        const ip = request.headers.get('CF-Connecting-IP');
        if (!ip) return new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } });
        // Store a digest rather than a raw IP address. The limit applies across
        // Worker isolates. The username limit also runs inside the service.
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.AUTH_SECRET}:${ip}`));
        const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
        await service.limit(`ip:${key}`, 50);
      }
      return createAuthenticationHandler(service, { origins: [env.AUTH_ORIGIN] })(request);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
      }
      logEvent('error', 'authentication.unhandled_error', { ...requestFields(request), status: 503, error });
      return Response.json({ error: 'Authentication is unavailable. Try again later.' }, {
        status: 503, headers: { 'Cache-Control': 'no-store' },
      });
    }
  },
  async scheduled(_event: unknown, env: Environment): Promise<void> {
    // Expired sessions cannot authorize access before this maintenance runs.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM authentication_limits WHERE window_start < unixepoch() - 86400'),
      env.DB.prepare('DELETE FROM logins WHERE expires_at < unixepoch() - 86400'),
      env.DB.prepare("DELETE FROM ba_session WHERE expiresAt < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')"),
    ]);
  },
};
