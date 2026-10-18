import { WorkerEntrypoint } from 'cloudflare:workers';
import { WorkflowService } from '../../workflow';
import { D1ApplicationStore } from '../d1/store';
import authenticationWorker from './worker';
import { D1AuthenticationService } from './authentication';
import { createBetterAuthIdentity } from './identity';
import { passwordHasher } from './password';
import { D1ApplicationService } from './application';
import { R2ImageService, type PrivateBucket } from './images';
import { createApplicationHandler, privateJson } from './http';
import { connectLive, dispatchNotifications, maintainFixtureSessions, type LiveEnvironment } from './live';

export { SessionLiveCoordinator } from './live';

/** Reachable only through an account-authorized Cloudflare service binding. */
export class SessionMaintenance extends WorkerEntrypoint<LiveEnvironment> {
  fetch(request: Request): Promise<Response> { return maintainFixtureSessions(request, this.env); }
}

export interface ApplicationEnvironment extends LiveEnvironment {
  AUTH_ORIGIN: string;
  AUTH_SECRET: string;
  IMAGES: PrivateBucket;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface ExecutionContext { waitUntil(operation: Promise<unknown>): void }

function authentication(env: ApplicationEnvironment) {
  const identity = createBetterAuthIdentity(env.DB as Parameters<typeof createBetterAuthIdentity>[0], {
    origin: env.AUTH_ORIGIN, secret: env.AUTH_SECRET, secureCookies: true,
  });
  return new D1AuthenticationService(env.DB, identity, passwordHasher);
}

async function deliver(env: ApplicationEnvironment): Promise<void> {
  const result = await dispatchNotifications(env);
  if (result.failed) throw new Error('Live notification delivery requires another attempt.');
}

/** Installed application entry. Existing static development hosting stays separate. */
export default {
  async fetch(request: Request, env: ApplicationEnvironment, context: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== '/api' && !path.startsWith('/api/')) {
      if (/^\/(?:\.|src(?:\/|$)|supabase(?:\/|$)|scripts(?:\/|$)|node_modules(?:\/|$))/.test(path)) {
        return new Response(null, { status: 404 });
      }
      return env.ASSETS.fetch(request);
    }
    try {
      let response: Response;
      if (path === '/api/accounts' || path.startsWith('/api/auth/') && path !== '/api/auth/sessions') {
        if (path === '/api/auth/sign-in' && request.method === 'POST' &&
            !(await env.DB.prepare('SELECT 1 FROM accounts LIMIT 1').first())) {
          // Public traffic must not create rate-limit rows that make an empty
          // installation fail its trusted bootstrap check. Bootstrap creates
          // its first account atomically; this route never grants setup authority.
          return privateJson({ error: 'The application is not initialized.' }, 503);
        }
        response = await authenticationWorker.fetch(request, env);
      } else {
        const application = new D1ApplicationService(env.DB);
        const images = new R2ImageService(env.DB, env.IMAGES);
        response = await createApplicationHandler({
          auth: authentication(env), application, images,
          workflow: new WorkflowService(new D1ApplicationStore(env.DB)),
          connect: (input, caller, sessionId) => connectLive(input, env, caller, sessionId),
        }, env.AUTH_ORIGIN)(request);
      }
      // A credential operation can commit its restriction before returning an
      // error. Dispatch after every mutation. Cron retries after process loss.
      if (request.method === 'POST' || request.method === 'PUT') context.waitUntil(deliver(env));
      return response;
    } catch {
      return privateJson({ error: 'The application is unavailable. The write outcome may be unknown.' }, 503);
    }
  },
  async scheduled(event: unknown, env: ApplicationEnvironment): Promise<void> {
    const results = await Promise.allSettled([
      new R2ImageService(env.DB, env.IMAGES).recover(),
      deliver(env),
      authenticationWorker.scheduled(event, env),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('Application maintenance requires another attempt.');
    }
  },
};
