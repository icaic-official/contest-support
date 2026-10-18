import { z } from 'zod';
import { ImageRequestError } from '../../../backend/errors';
import { roleSchema } from '../../../connected/model';
import type { Caller } from '../../applicationStore';
import { AuthenticationError, type AuthenticationService } from '../../authentication';
import type { WorkflowService } from '../../workflow';
import type { D1ApplicationService } from './application';
import type { R2ImageService } from './images';

const uuid = z.uuid();
const member = z.strictObject({ teamId: uuid.nullable(), roles: z.array(roleSchema).max(3), isAdmin: z.boolean() });
const adminSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('set_intake'), sessionId: uuid, open: z.boolean() }),
  z.strictObject({ action: z.literal('set_image_limits'), sessionId: uuid, limits: z.strictObject({ fileMegabytes: z.number(), count: z.number(), totalMegabytes: z.number() }) }),
  z.strictObject({ action: z.literal('save_member'), sessionId: uuid, userId: uuid, member }),
  z.strictObject({ action: z.literal('remove_member'), sessionId: uuid, userId: uuid }),
]);
const workflowSchema = z.strictObject({ sessionId: uuid, requestId: uuid, command: z.unknown() });
const imageSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('begin'), sessionId: uuid, requestId: uuid, issueId: uuid,
    visibility: z.enum(['public', 'internal']), name: z.string(), bytes: z.number() }),
  z.strictObject({ action: z.enum(['finish', 'remove', 'abandon']), sessionId: uuid, attachmentId: uuid }),
]);

export const privateHeaders = {
  'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Vary': 'Origin, Cookie',
};

export function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateHeaders });
}

async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new AuthenticationError(400, 'A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        throw new AuthenticationError(400, 'The request body is too large.');
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    throw new AuthenticationError(400, 'The JSON request body is invalid.');
  } finally {
    reader.releaseLock();
  }
}

export interface ApplicationHttpServices {
  auth: Pick<AuthenticationService, 'current'>;
  application: Pick<D1ApplicationService, 'sessions' | 'snapshot' | 'setIntake' | 'setImageLimits' | 'saveMember' | 'removeMember'>;
  workflow: Pick<WorkflowService, 'execute'>;
  images: Pick<R2ImageService, 'begin' | 'upload' | 'finish' | 'remove' | 'download'>;
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
        if (url.pathname === '/api/sessions' || url.pathname === '/api/auth/sessions') return privateJson(await services.application.sessions(caller));
        if (url.pathname === '/api/snapshot' || url.pathname === '/api/updates') {
          const sessionId = uuid.parse(url.searchParams.get('sessionId'));
          if (url.pathname === '/api/snapshot') return privateJson(await services.application.snapshot(caller, sessionId));
          if (suppliedOrigin !== origin || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
            throw new AuthenticationError(403, 'A same-origin WebSocket request is required.');
          }
          return services.connect(request, caller, sessionId);
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
        if (!url.pathname.startsWith('/api/image/')) return privateJson({ error: 'The endpoint does not exist.' }, 404);
        const lengthHeader = request.headers.get('Content-Length');
        if (lengthHeader === null || !/^[1-9][0-9]*$/.test(lengthHeader)) return privateJson({ error: 'An image transfer requires its exact length.' }, 411);
        await services.images.upload(caller, decodeURIComponent(url.pathname.slice('/api/image/'.length)), request.body,
          request.headers.get('Content-Type') ?? '', request.headers.get('X-Minsky-Digest') ?? '', Number(lengthHeader));
        return privateJson({});
      }
      if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new AuthenticationError(400, 'A JSON request body is required.');
      }
      const body = await boundedJson(request);
      if (url.pathname === '/api/workflow') {
        const parsed = workflowSchema.safeParse(body);
        if (!parsed.success) return privateJson({ outcome: 'rejected', reason: 'input' }, 400);
        const result = await services.workflow.execute(caller, parsed.data.sessionId, parsed.data.requestId, parsed.data.command);
        return privateJson(result, result.outcome === 'committed' ? 200 : result.outcome === 'rejected' ? 409 : 503);
      }
      if (url.pathname === '/api/admin') {
        const command = adminSchema.parse(body);
        switch (command.action) {
          case 'set_intake': await services.application.setIntake(caller, command.sessionId, command.open); break;
          case 'set_image_limits': await services.application.setImageLimits(caller, command.sessionId, command.limits); break;
          case 'save_member': await services.application.saveMember(caller, command.sessionId, command.userId, command.member); break;
          case 'remove_member': await services.application.removeMember(caller, command.sessionId, command.userId); break;
        }
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
      return privateJson({ error: 'The request could not be completed. Its write outcome may be unknown.' }, 503);
    }
  };
}
