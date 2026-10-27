import { WorkerEntrypoint } from 'cloudflare:workers';
import { WorkflowService } from '../../workflow';
import type { D1Binding } from '../d1/connection';
import { D1ApplicationStore } from '../d1/store';
import authenticationWorker from './worker';
import { D1AuthenticationService } from './authentication';
import { sharedBetterAuthIdentity } from './identity';
import { passwordHasher } from './password';
import { D1ApplicationService } from './application';
import { R2ImageService, type PrivateBucket } from './images';
import { D1AnnouncementService } from './announcements';
import { R2AnnouncementImageService } from './announcementImages';
import { R2AvatarService } from './avatars';
import { createApplicationHandler, privateJson } from './http';
import { logEvent, requestFields } from './log';
import { withSecurityHeaders } from './securityHeaders';
import { connectLive, dispatchNotifications, maintainFixtureSessions, type LiveEnvironment } from './live';

export { SessionLiveCoordinator } from './live';

/** Reachable only through an account-authorized Cloudflare service binding. */
export class SessionMaintenance extends WorkerEntrypoint<LiveEnvironment> {
  fetch(request: Request): Promise<Response> { return maintainFixtureSessions(request, this.env); }
}

export interface ApplicationEnvironment extends LiveEnvironment {
  DB: D1Binding;
  AUTH_ORIGIN: string;
  AUTH_SECRET: string;
  IMAGES: PrivateBucket;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface ExecutionContext { waitUntil(operation: Promise<unknown>): void }

function authentication(env: ApplicationEnvironment) {
  const identity = sharedBetterAuthIdentity(env.DB, {
    origin: env.AUTH_ORIGIN, secret: env.AUTH_SECRET, secureCookies: true,
  });
  return new D1AuthenticationService(env.DB, identity, passwordHasher);
}

async function deliver(env: ApplicationEnvironment): Promise<void> {
  const result = await dispatchNotifications(env);
  if (result.failed) {
    logEvent('error', 'notifications.delivery_failed', { task: 'deliver', delivered: result.delivered, failed: result.failed });
    throw new Error('Live notification delivery requires another attempt.');
  }
}

/** Installed application entry. Existing static development hosting stays separate. */
export default {
  async fetch(request: Request, env: ApplicationEnvironment, context: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== '/api' && !path.startsWith('/api/')) {
      if (/^\/(?:\.|src(?:\/|$)|scripts(?:\/|$)|node_modules(?:\/|$))/.test(path)) {
        return withSecurityHeaders(new Response(null, { status: 404 }), request.url);
      }
      return withSecurityHeaders(await env.ASSETS.fetch(request), request.url);
    }
    try {
      let response: Response;
      if (path === '/api/accounts' || path.startsWith('/api/auth/')) {
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
          announcements: new D1AnnouncementService(env.DB),
          announcementImages: new R2AnnouncementImageService(env.DB, env.IMAGES),
          avatars: new R2AvatarService(env.DB, env.IMAGES),
          workflow: new WorkflowService(new D1ApplicationStore(env.DB)),
          connect: (input, caller, sessionId) => connectLive(input, env, caller, sessionId),
        }, env.AUTH_ORIGIN)(request);
      }
      // A credential operation can commit its restriction before returning an
      // error. Dispatch after every mutation. Cron retries after process loss.
      if (request.method === 'POST' || request.method === 'PUT') context.waitUntil(deliver(env).catch(() => { /* Already logged. Cron retries. */ }));
      return response;
    } catch (error) {
      logEvent('error', 'worker.unhandled_error', { ...requestFields(request), status: 503, error });
      return privateJson({ error: 'The application is unavailable. The write outcome may be unknown.' }, 503);
    }
  },
  async scheduled(event: unknown, env: ApplicationEnvironment): Promise<void> {
    const tasks = {
      'recover-images': new R2ImageService(env.DB, env.IMAGES).recover(),
      'recover-announcement-images': new R2AnnouncementImageService(env.DB, env.IMAGES).recover(),
      'recover-avatars': new R2AvatarService(env.DB, env.IMAGES).recover(),
      'deliver-notifications': deliver(env),
      'expire-sessions': authenticationWorker.scheduled(event, env),
    };
    // Every task settles before any failure is logged, in task order.
    const outcomes = await Promise.all(Object.entries(tasks).map(([task, run]) =>
      run.then(() => undefined, (error: unknown) => ({ task, error }))));
    const failures = outcomes.filter((outcome) => outcome !== undefined);
    for (const { task, error } of failures) logEvent('error', 'scheduled.task_failed', { task, error });
    if (failures.length) {
      logEvent('error', 'scheduled.failed', { failed: failures.length });
      throw new Error('Application maintenance requires another attempt.');
    }
  },
};
