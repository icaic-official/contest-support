import { z } from 'zod';
import { ImageRequestError } from '../../../backend/errors';
import { AVATAR_MAX_BYTES } from '../../../connected/imageFile';
import { hasJsonBody, readBody, readJsonBody } from '../../http';
import { AuthenticationError, type AuthenticationService, type Caller } from '../../authentication';
import type { WorkflowService } from '../../workflow';
import type { D1ApplicationService } from './application';
import type { R2ImageService } from './images';
import { AnnouncementCommandError, type D1AnnouncementService } from './announcements';
import type { R2AnnouncementImageService } from './announcementImages';
import type { R2AvatarService } from './avatars';
import type { D1ContestAwardService } from './contestAwards';
import type { D1ManageService } from './manage';
import { logEvent, requestFields } from './log';
import { baseSecurityHeaders } from './securityHeaders';

const uuid = z.uuid();
const workflowSchema = z.strictObject({ sessionId: uuid, requestId: uuid, command: z.unknown() });
const contestAwardSchema = z.strictObject({ sessionId: uuid, requestId: uuid, command: z.unknown() });
const manageSchema = z.strictObject({ requestId: uuid, command: z.unknown() });
// A calendar window is at most 92 days, which bounds one read.
const instant = z.iso.datetime({ offset: true }).transform((text) => new Date(text).toISOString());
const windowSchema = z.strictObject({ from: instant, to: instant })
  .refine(({ from, to }) => from < to && Date.parse(to) - Date.parse(from) <= 92 * 86_400_000);
const credentialsSchema = z.strictObject({ requestId: uuid, eventId: uuid.nullable(), accountIds: z.unknown(), contestId: uuid.nullable().default(null), voidLivePasswords: z.boolean().default(false) });
const imageSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('begin'), sessionId: uuid, requestId: uuid, issueId: uuid,
    visibility: z.enum(['public', 'internal']), name: z.string(), bytes: z.number() }),
  z.strictObject({ action: z.enum(['finish', 'remove', 'abandon']), sessionId: uuid, attachmentId: uuid }),
]);

const announcementSchema = z.strictObject({ sessionId: uuid, requestId: uuid, command: z.unknown() });
const announcementImageSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('begin'), sessionId: uuid, requestId: uuid, announcementId: uuid,
    name: z.string(), bytes: z.number() }),
  z.strictObject({ action: z.enum(['finish', 'remove', 'abandon']), sessionId: uuid, imageId: uuid }),
]);
const avatarCommandSchema = z.strictObject({ action: z.literal('remove') });
const avatarPathSchema = z.tuple([uuid, uuid]);
// Announcement text can use 10,000 characters of up to four bytes each.
const announcementBodyLimit = 65_536;
// A management command can add 300 entrants with their usernames in one request.
const manageBodyLimit = 131_072;

export const privateHeaders = {
  ...baseSecurityHeaders,
  'Cache-Control': 'private, no-store', 'Vary': 'Origin, Cookie',
  // API bodies are JSON or downloaded images. None may run script or load a resource.
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

export function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateHeaders });
}

export interface ApplicationHttpServices {
  auth: Pick<AuthenticationService, 'current'>;
  application: Pick<D1ApplicationService, 'contests' | 'snapshot'>;
  workflow: Pick<WorkflowService, 'execute'>;
  manage: Pick<D1ManageService, 'site' | 'event' | 'execute' | 'issueCredentials'>;
  contestAwards: Pick<D1ContestAwardService, 'execute'>;
  images: Pick<R2ImageService, 'begin' | 'upload' | 'finish' | 'remove' | 'download'>;
  announcements: Pick<D1AnnouncementService, 'snapshot' | 'execute'>;
  announcementImages: Pick<R2AnnouncementImageService, 'begin' | 'upload' | 'finish' | 'remove' | 'download'>;
  avatars: Pick<R2AvatarService, 'list' | 'upload' | 'remove' | 'download'>;
  connect(request: Request, caller: Caller, sessionId: string): Promise<Response>;
}

/** Same-origin routes derive Caller only from the maintained identity service. */
export function createApplicationHandler(services: ApplicationHttpServices, origin: string) {
  if (new URL(origin).origin !== origin) throw new Error('Configure an exact application origin.');
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const suppliedOrigin = request.headers.get('Origin');
      if (url.origin !== origin || suppliedOrigin !== null && suppliedOrigin !== origin ||
          request.headers.get('Sec-Fetch-Site') === 'cross-site') {
        throw new AuthenticationError(403, 'This request origin is not permitted.');
      }
      if (!['GET', 'POST', 'PUT'].includes(request.method)) return privateJson({ error: 'The request method is not permitted.' }, 405);
      const current = await services.auth.current(request.headers);
      if (!current) throw new AuthenticationError(401, 'Sign in to continue.');
      if (current.status.must_change || !current.status.session_valid) throw new AuthenticationError(403, 'Change your temporary password first.');
      const caller = current.caller;
      if (request.method === 'GET') {
        if (url.pathname === '/api/contests') {
          const eventId = url.searchParams.get('eventId');
          if (url.searchParams.has('from') || url.searchParams.has('to')) {
            return privateJson(await services.application.contests(caller, { window: windowSchema.parse({
              from: url.searchParams.get('from'), to: url.searchParams.get('to') }) }));
          }
          return privateJson(await services.application.contests(caller, eventId === null ? {} : { eventId: uuid.parse(eventId) }));
        }
        if (url.pathname === '/api/site') return privateJson(await services.manage.site(caller));
        if (url.pathname === '/api/event') return privateJson(await services.manage.event(caller, url.searchParams.has('eventId') ? uuid.parse(url.searchParams.get('eventId')) : undefined));
        if (url.pathname === '/api/snapshot' || url.pathname === '/api/updates') {
          const sessionId = uuid.parse(url.searchParams.get('sessionId'));
          if (url.pathname === '/api/snapshot') return privateJson(await services.application.snapshot(caller, sessionId));
          if (suppliedOrigin !== origin || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
            throw new AuthenticationError(403, 'A same-origin WebSocket request is required.');
          }
          return services.connect(request, caller, sessionId);
        }
        if (url.pathname === '/api/announcements') {
          return privateJson(await services.announcements.snapshot(caller, uuid.parse(url.searchParams.get('sessionId'))));
        }
        if (url.pathname === '/api/avatars') {
          return privateJson(await services.avatars.list(caller, uuid.parse(url.searchParams.get('sessionId'))));
        }
        if (url.pathname.startsWith('/api/avatar/')) {
          const [sessionId, avatarId] = avatarPathSchema.parse(url.pathname.slice('/api/avatar/'.length).split('/'));
          const image = await services.avatars.download(caller, sessionId, avatarId);
          return new Response(image.body, { headers: { ...privateHeaders, 'Content-Type': image.contentType } });
        }
        if (url.pathname.startsWith('/api/announcement-image/')) {
          const image = await services.announcementImages.download(caller, decodeURIComponent(url.pathname.slice('/api/announcement-image/'.length)));
          return new Response(image.body, { headers: { ...privateHeaders, 'Content-Type': image.contentType } });
        }
        if (url.pathname.startsWith('/api/image/')) {
          const image = await services.images.download(caller, decodeURIComponent(url.pathname.slice('/api/image/'.length)));
          return new Response(image.body, { headers: { ...privateHeaders, 'Content-Type': image.contentType } });
        }
        return privateJson({ error: 'The endpoint does not exist.' }, 404);
      }
      if (suppliedOrigin !== origin || request.headers.get('X-Minsky-Request') !== '1' ||
          request.headers.get('X-CSRF-Token') !== current.csrf) {
        throw new AuthenticationError(403, 'The request protection checks failed.');
      }
      if (request.method === 'PUT') {
        const avatar = url.pathname.startsWith('/api/avatar/');
        const announcement = url.pathname.startsWith('/api/announcement-image/');
        if (!avatar && !announcement && !url.pathname.startsWith('/api/image/')) return privateJson({ error: 'The endpoint does not exist.' }, 404);
        const lengthHeader = request.headers.get('Content-Length');
        if (lengthHeader === null || !/^[1-9][0-9]*$/.test(lengthHeader)) return privateJson({ error: 'An image transfer requires its exact length.' }, 411);
        if (avatar) {
          if (Number(lengthHeader) > AVATAR_MAX_BYTES) {
            throw new ImageRequestError(`Choose a picture of up to ${AVATAR_MAX_BYTES / 1024} KB.`, { validation: true });
          }
          return privateJson(await services.avatars.upload(caller, {
            requestId: uuid.parse(url.pathname.slice('/api/avatar/'.length)),
            bytes: await readBody(request, AVATAR_MAX_BYTES), digest: request.headers.get('X-Minsky-Digest') ?? '',
          }));
        }
        const prefix = announcement ? '/api/announcement-image/' : '/api/image/';
        await (announcement ? services.announcementImages : services.images).upload(caller,
          decodeURIComponent(url.pathname.slice(prefix.length)), request.body,
          request.headers.get('Content-Type') ?? '', request.headers.get('X-Minsky-Digest') ?? '', Number(lengthHeader));
        return privateJson({});
      }
      if (!hasJsonBody(request)) {
        throw new AuthenticationError(400, 'A JSON request body is required.');
      }
      const body = await readJsonBody(request, url.pathname === '/api/announcements' ? announcementBodyLimit
        : url.pathname === '/api/manage' ? manageBodyLimit : undefined);
      if (url.pathname === '/api/workflow') {
        const parsed = workflowSchema.safeParse(body);
        if (!parsed.success) return privateJson({ outcome: 'rejected', reason: 'input' }, 400);
        const result = await services.workflow.execute(caller, parsed.data.sessionId, parsed.data.requestId, parsed.data.command);
        if (result.outcome !== 'committed') return privateJson(result, result.outcome === 'rejected' ? 409 : 503);
        // The commit is final. A failed read must not turn it into an error, so the client reads again.
        let snapshot: Awaited<ReturnType<ApplicationHttpServices['application']['snapshot']>> | undefined;
        try { snapshot = await services.application.snapshot(caller, parsed.data.sessionId); } catch { /* The client reads again. */ }
        return privateJson(snapshot ? { ...result, snapshot } : result, 200);
      }
      if (url.pathname === '/api/manage') {
        const parsed = manageSchema.parse(body);
        return privateJson(await services.manage.execute(caller, parsed.requestId, parsed.command));
      }
      if (url.pathname === '/api/contest-awards') {
        const parsed = contestAwardSchema.parse(body);
        return privateJson({ id: await services.contestAwards.execute(caller, parsed.sessionId, parsed.requestId, parsed.command) });
      }
      if (url.pathname === '/api/credentials') {
        const parsed = credentialsSchema.parse(body);
        return privateJson(await services.manage.issueCredentials(caller, parsed.requestId, { eventId: parsed.eventId, accountIds: parsed.accountIds, contestId: parsed.contestId, voidLivePasswords: parsed.voidLivePasswords }));
      }
      if (url.pathname === '/api/announcements') {
        const parsed = announcementSchema.safeParse(body);
        if (!parsed.success) return privateJson({ outcome: 'rejected', reason: 'input' }, 400);
        try {
          return privateJson({ outcome: 'committed', id: await services.announcements.execute(
            caller, parsed.data.sessionId, parsed.data.requestId, parsed.data.command) });
        } catch (error) {
          if (!(error instanceof AnnouncementCommandError)) throw error;
          return privateJson({ outcome: 'rejected', reason: error.reason, error: error.message }, error.reason === 'input' ? 400 : 409);
        }
      }
      if (url.pathname === '/api/announcement-images') {
        const command = announcementImageSchema.parse(body);
        if (command.action === 'begin') {
          return privateJson(await services.announcementImages.begin(caller, {
            sessionId: command.sessionId, requestId: command.requestId, announcementId: command.announcementId,
            name: command.name, bytes: command.bytes,
          }));
        }
        if (command.action === 'finish') await services.announcementImages.finish(caller, command.sessionId, command.imageId);
        else await services.announcementImages.remove(caller, command.sessionId, command.imageId, command.action === 'abandon');
        return privateJson({});
      }
      if (url.pathname === '/api/avatars') {
        avatarCommandSchema.parse(body);
        await services.avatars.remove(caller);
        return privateJson({});
      }
      if (url.pathname === '/api/images') {
        const command = imageSchema.parse(body);
        if (command.action === 'begin') {
          return privateJson(await services.images.begin(caller, {
            sessionId: command.sessionId, requestId: command.requestId, issueId: command.issueId,
            visibility: command.visibility, name: command.name, bytes: command.bytes,
          }));
        }
        if (command.action === 'finish') await services.images.finish(caller, command.sessionId, command.attachmentId);
        else await services.images.remove(caller, command.sessionId, command.attachmentId, command.action === 'abandon');
        return privateJson({});
      }
      return privateJson({ error: 'The endpoint does not exist.' }, 404);
    } catch (error) {
      if (error instanceof AuthenticationError) return privateJson({ error: error.message }, error.status);
      if (error instanceof ImageRequestError) return privateJson({ error: error.message,
        validation: error.validation, restart: error.restart, incomplete: error.incomplete }, 409);
      if (error instanceof z.ZodError || error instanceof URIError) return privateJson({ error: 'The request is invalid.' }, 400);
      logEvent('error', 'http.unhandled_error', { ...requestFields(request), status: 503, error });
      return privateJson({ error: 'The request could not be completed. Its write outcome may be unknown.' }, 503);
    }
  };
}
