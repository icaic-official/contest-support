import { z } from 'zod';
import { roleSchema } from '../connected/model';
import { AuthenticationError, type AuthenticationService } from './authentication';

const passwordSchema = z.string().min(1).max(1024);
const usernameSchema = z.string().min(1).max(128);
const signInSchema = z.strictObject({ username: usernameSchema, password: passwordSchema });
const passwordChangeSchema = z.strictObject({ currentPassword: passwordSchema, newPassword: passwordSchema });
const accountSchema = z.strictObject({
  sessionId: z.uuid(),
  command: z.discriminatedUnion('action', [
    z.strictObject({
      action: z.literal('create_account'), username: usernameSchema,
      name: z.string().min(1).max(256), teamId: z.uuid().nullable(),
      roles: z.array(roleSchema).max(3), isAdmin: z.boolean(),
    }),
    z.strictObject({ action: z.literal('set_username'), userId: z.uuid(), username: usernameSchema }),
    z.strictObject({ action: z.literal('reset_password'), userId: z.uuid() }),
  ]),
});

function json(body: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Vary': 'Origin',
  });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

/** Read a bounded body before JSON parsing. Do not retain request credentials. */
async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new AuthenticationError(400, 'A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        throw new AuthenticationError(400, 'The request body is too large.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    throw new AuthenticationError(400, 'The JSON request body is invalid.');
  } finally {
    reader.releaseLock();
  }
}

function permittedOrigin(value: string): string {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.origin !== value || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error('Configure an exact HTTPS origin or a local loopback HTTP origin.');
  }
  return value;
}

/** No CORS routes are exposed. Each deployment serves its browser on the same origin. */
export function createAuthenticationHandler(
  service: AuthenticationService,
  options: { origins: string[] },
): (request: Request) => Promise<Response> {
  if (options.origins.length === 0) throw new Error('At least one permitted origin is required.');
  const origins = new Set(options.origins.map(permittedOrigin));
  return async (request) => {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get('Origin');
      if (!origins.has(url.origin) || (origin !== null && (origin !== url.origin || !origins.has(origin)))) {
        throw new AuthenticationError(403, 'This request origin is not permitted.');
      }
      if (request.method === 'GET') {
        if (url.pathname === '/api/auth/session') {
          const session = await service.current(request.headers);
          if (!session) throw new AuthenticationError(401, 'Sign in to continue.');
          return json({ user: session.user, status: session.status, csrf: session.csrf });
        }
        if (url.pathname === '/api/auth/sessions') return json(await service.sessions(request.headers));
        return json({ error: 'The endpoint does not exist.' }, 404);
      }
      if (request.method !== 'POST') return json({ error: 'The request method is not permitted.' }, 405);
      if (origin === null || request.headers.get('X-Minsky-Request') !== '1' ||
          request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
          request.headers.get('Sec-Fetch-Site') === 'cross-site') {
        throw new AuthenticationError(403, 'The request protection checks failed.');
      }
      const body = await readBody(request);
      if (url.pathname === '/api/auth/sign-in') {
        const parsed = signInSchema.safeParse(body);
        if (!parsed.success) throw new AuthenticationError(400, 'Enter a username and password.');
        const result = await service.signIn(parsed.data.username, parsed.data.password);
        return json({}, 200, result.cookie);
      }
      if (!['/api/auth/sign-out', '/api/auth/change-password', '/api/accounts'].includes(url.pathname)) {
        return json({ error: 'The endpoint does not exist.' }, 404);
      }
      const session = await service.current(request.headers);
      if (!session) throw new AuthenticationError(401, 'Sign in to continue.');
      if (request.headers.get('X-CSRF-Token') !== session.csrf) {
        throw new AuthenticationError(403, 'The request protection checks failed.');
      }
      if (url.pathname === '/api/auth/sign-out') {
        if (!z.strictObject({}).safeParse(body).success) throw new AuthenticationError(400, 'The request body is invalid.');
        const result = await service.signOut(request.headers);
        return json({}, 200, result.cookie);
      }
      if (url.pathname === '/api/auth/change-password') {
        const parsed = passwordChangeSchema.safeParse(body);
        if (!parsed.success) throw new AuthenticationError(400, 'Enter the current and new passwords.');
        const result = await service.changePassword(request.headers, parsed.data.currentPassword, parsed.data.newPassword);
        return json({}, 200, result.cookie);
      }
      const parsed = accountSchema.safeParse(body);
      if (!parsed.success) throw new AuthenticationError(400, 'The account command is invalid.');
      return json(await service.account(request.headers, parsed.data.sessionId, parsed.data.command));
    } catch (error) {
      if (error instanceof AuthenticationError) return json({ error: error.message }, error.status);
      return json({ error: 'The authentication request could not be completed.' }, 503);
    }
  };
}
