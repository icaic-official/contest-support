import { z } from 'zod';
import type { Announcements, Avatars, Backend, LiveUpdates } from '../contracts';
import { AnnouncementRejectedError, ImageRequestError, RequestRefusedError, WorkflowRejectedError, workflowRejectionMessage } from '../errors';
import { announcementSnapshotSchema } from '../../connected/announcementModel';
import { AVATAR_MAX_BYTES, imageKind } from '../../connected/imageFile';
import { type Command, roleSchema, snapshotSchema, type Snapshot } from '../../connected/model';
import { createCloudflareAuthentication } from './authentication';

const contestsSchema = z.array(z.object({
  id: z.uuid(), name: z.string(), eventId: z.uuid(), eventName: z.string(), manage: z.enum(['none', 'contest', 'event', 'site']),
}));
const siteSchema = z.object({
  webmasters: z.array(z.object({ id: z.uuid(), name: z.string(), handle: z.string(), ready: z.boolean() })),
  restrictWebmasterReads: z.boolean(),
  events: z.array(z.object({
    id: z.uuid(), name: z.string(), code: z.string(), timeZone: z.string(), archived: z.boolean(),
    contests: z.number(), accounts: z.number(),
  })),
  contestsToJoin: z.array(z.object({ id: z.uuid(), name: z.string(), eventName: z.string() })),
});
const receiptSchema = z.object({
  eventId: z.uuid().exactOptional(), contestId: z.uuid().exactOptional(),
  accountIds: z.array(z.uuid()).exactOptional(), entrantIds: z.array(z.uuid()).exactOptional(),
});
const consoleSchema = z.object({
  event: z.object({ id: z.uuid(), name: z.string(), code: z.string(), timeZone: z.string(), archived: z.boolean() }),
  manage: z.enum(['none', 'contest', 'event', 'site']),
  admins: z.array(z.uuid()),
  people: z.array(z.object({ id: z.uuid(), name: z.string(), handle: z.string().nullable(), ready: z.boolean() })),
  entrants: z.array(z.object({
    id: z.uuid(), kind: z.enum(['team', 'single']), name: z.string(), accountId: z.uuid().nullable(), handle: z.string().nullable(),
  })),
  contests: z.array(z.object({
    id: z.uuid(), name: z.string(), contestType: z.enum(['singles', 'mixed', 'teams']), intakeOpen: z.boolean(),
  })),
  staffAssignments: z.array(z.object({
    contestId: z.uuid(), accountId: z.uuid(), admin: z.boolean(), roles: z.array(roleSchema),
  })),
  entries: z.array(z.object({ contestId: z.uuid(), entrantId: z.uuid(), location: z.string() })),
  audit: z.array(z.object({
    id: z.string(), actorName: z.string(), at: z.string(), action: z.string(), target: z.string().nullable(),
  })),
});
const issuedSchema = z.array(z.object({ accountId: z.uuid(), handle: z.string(), temporaryPassword: z.string().nullable() }));
const startedSchema = z.object({ id: z.uuid(), original_path: z.string(), thumbnail_path: z.string() });
const workflowSchema = z.discriminatedUnion('outcome', [
  // The snapshot is optional and checked apart, so a bad one never hides a committed command.
  z.object({ outcome: z.literal('committed'), issueId: z.uuid(), snapshot: z.unknown().optional() }),
  z.object({ outcome: z.literal('rejected'), reason: z.enum(['input', 'access', 'state', 'request_id']) }),
  z.object({ outcome: z.literal('unknown') }),
]);
const announcementResultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('committed'), id: z.uuid() }),
  z.object({
    outcome: z.literal('rejected'),
    reason: z.enum(['input', 'access', 'state', 'conflict', 'request_id']),
    error: z.string().optional(),
  }),
]);
const reservedSchema = z.object({ id: z.uuid(), path: z.string() });
const avatarSchema = z.object({ person_id: z.uuid(), avatar_id: z.uuid() });
const failureSchema = z.object({
  error: z.string(), validation: z.boolean().exactOptional(),
  restart: z.boolean().exactOptional(), incomplete: z.boolean().exactOptional(),
});

/** Each instance uses one same-origin deployment and independent subscriptions. */
export function createCloudflareBackend(options: {
  origin: string;
  fetch?: typeof fetch;
  webSocket?: (url: string) => WebSocket;
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}): Backend {
  const auth = createCloudflareAuthentication(options);
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const origin = new URL(options.origin);

  async function send(path: string, init?: RequestInit): Promise<Response> {
    return request(new URL(path, origin), {
      ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    });
  }

  function protectedHeaders(token: string, contentType: string): Headers {
    return new Headers({ 'Content-Type': contentType, 'X-Minsky-Request': '1', 'X-CSRF-Token': token });
  }

  async function post(path: string, body: unknown): Promise<Response> {
    return auth.withCsrf((token) => send(path, {
      method: 'POST', headers: protectedHeaders(token, 'application/json'), body: JSON.stringify(body),
    }));
  }

  async function readJson(response: Response): Promise<unknown> {
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = failureSchema.safeParse(body);
      const message = error.success ? error.data.error : 'The request could not be completed.';
      throw response.status < 500 ? new RequestRefusedError(message) : new Error(message);
    }
    return body;
  }

  async function imageResult(response: Response): Promise<unknown> {
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const failure = failureSchema.safeParse(body);
      throw new ImageRequestError(failure.success ? failure.data.error : 'The image request failed.',
        failure.success ? failure.data : undefined);
    }
    return body;
  }

  function announcementImagePath(path: string): string {
    return `/api/announcement-image/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  function imagePath(path: string): string {
    return `/api/image/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  /** The Worker requires the SHA-256 digest of the exact bytes, and R2 checks it again. */
  async function putImage(url: string, body: Blob, contentType: string, bytes: ArrayBuffer): Promise<unknown> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return imageResult(await auth.withCsrf((token) => {
      const headers = protectedHeaders(token, contentType);
      headers.set('X-Minsky-Digest', hex);
      return send(url, { method: 'PUT', headers, body });
    }));
  }

  const announcements: Announcements = {
    async snapshot(sessionId, signal) {
      return announcementSnapshotSchema.parse(await readJson(await send(
        `/api/announcements?sessionId=${encodeURIComponent(sessionId)}`, { signal: signal ?? null })));
    },
    async execute(sessionId, requestId, command) {
      const response = await post('/api/announcements', { sessionId, requestId, command });
      const result = announcementResultSchema.safeParse(await response.json().catch(() => undefined));
      // Only the endpoint's typed rejection confirms that no command committed.
      if (result.success && result.data.outcome === 'rejected') {
        throw new AnnouncementRejectedError(result.data.error ?? 'Check the announcement and try again.',
          result.data.reason === 'conflict');
      }
      if (!response.ok || !result.success || result.data.outcome !== 'committed') {
        throw new Error('Announcement outcome is unknown. Retry the same request.');
      }
      return result.data.id;
    },
    async uploadImage({ sessionId, announcementId, requestId, file, onProgress }) {
      const bytes = await file.arrayBuffer();
      const kind = imageKind(new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength)));
      if (!kind) throw new ImageRequestError('Choose a JPEG, PNG, or WebP image.', { validation: true });
      const started = reservedSchema.parse(await imageResult(await post('/api/announcement-images',
        { action: 'begin', sessionId, announcementId, requestId, name: file.name, bytes: file.size })));
      onProgress(0);
      await putImage(announcementImagePath(started.path), file, kind, bytes);
      onProgress(100);
      await imageResult(await post('/api/announcement-images', { action: 'finish', sessionId, imageId: started.id }));
    },
    async removeImage(sessionId, imageId) {
      await imageResult(await post('/api/announcement-images', { action: 'remove', sessionId, imageId }));
    },
    async downloadImage(image) {
      const response = await send(announcementImagePath([image.session_id, 'announcements', image.announcement_id, image.id].join('/')));
      if (!response.ok) {
        await imageResult(response);
        throw new ImageRequestError('This announcement image could not be opened.');
      }
      return response.blob();
    },
  };

  const avatars: Avatars = {
    async list(sessionId) {
      return z.array(avatarSchema).parse(await imageResult(await send(`/api/avatars?sessionId=${encodeURIComponent(sessionId)}`)));
    },
    async upload({ requestId, file }) {
      const bytes = await file.arrayBuffer();
      const kind = imageKind(new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength)));
      if (!kind || bytes.byteLength > AVATAR_MAX_BYTES) {
        throw new ImageRequestError(`Choose a JPEG, PNG, or WebP picture of up to ${AVATAR_MAX_BYTES / 1024} KB.`, { validation: true });
      }
      return avatarSchema.parse(await putImage(`/api/avatar/${encodeURIComponent(requestId)}`, file, kind, bytes));
    },
    async remove() {
      await imageResult(await post('/api/avatars', { action: 'remove' }));
    },
    async download(sessionId, avatar) {
      const response = await send(`/api/avatar/${encodeURIComponent(sessionId)}/${encodeURIComponent(avatar.avatar_id)}`);
      if (!response.ok) {
        await imageResult(response);
        throw new ImageRequestError('This picture could not be opened.');
      }
      return response.blob();
    },
  };

  async function executeWorkflow(sessionId: string, requestId: string, command: Command): Promise<{ issueId: string; snapshot: Snapshot | undefined }> {
    const response = await post('/api/workflow', { sessionId, requestId, command });
    const result = workflowSchema.safeParse(await response.json().catch(() => undefined));
    // Only the endpoint's typed rejection confirms that no command committed.
    if (result.success && result.data.outcome === 'rejected') {
      throw new WorkflowRejectedError(workflowRejectionMessage(result.data.reason));
    }
    if (!response.ok || !result.success || result.data.outcome !== 'committed') {
      throw new Error('Workflow outcome is unknown. Retry the same request.');
    }
    const snapshot = snapshotSchema.safeParse(result.data.snapshot);
    return { issueId: result.data.issueId, snapshot: snapshot.success ? snapshot.data : undefined };
  }

  const updates: LiveUpdates = {
    subscribe(input) {
      let active = true;
      let socket: WebSocket | undefined;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let handshake: ReturnType<typeof setTimeout> | undefined;
      let delay = 500;
      let connected = false;
      const report = (value: boolean) => {
        if (!active || value === connected) return;
        connected = value;
        input.onConnection(value);
      };
      const connect = () => {
        if (!active) return;
        const url = new URL('/api/updates', origin);
        url.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('sessionId', input.sessionId);
        const schedule = () => {
          if (!active || retry !== undefined) return;
          clearTimeout(handshake);
          report(false);
          retry = setTimeout(() => { retry = undefined; connect(); }, delay);
          delay = Math.min(delay * 2, 30_000);
        };
        try {
          const current = (options.webSocket ?? ((value) => new WebSocket(value)))(url.href);
          socket = current;
          handshake = setTimeout(() => {
            if (!active || socket !== current) return;
            current.close();
            schedule();
          }, 10_000);
          current.onmessage = (event) => {
            if (!active || socket !== current || typeof event.data !== 'string') return;
            let message: unknown;
            try { message = JSON.parse(event.data); } catch { return; }
            const hint = z.object({ type: z.enum(['ready', 'change']) }).safeParse(message);
            if (!hint.success) return;
            if (hint.data.type === 'ready') {
              clearTimeout(handshake);
              delay = 500;
              report(true);
            } else if (connected) {
              input.onChange();
            }
          };
          current.onclose = () => { if (socket === current) schedule(); };
          current.onerror = () => {
            if (socket !== current) return;
            current.close();
            schedule();
          };
        } catch {
          schedule();
        }
      };
      connect();
      return () => {
        if (!active) return;
        active = false;
        clearTimeout(retry);
        clearTimeout(handshake);
        socket?.close();
      };
    },
  };

  return {
    auth,
    workflows: {
      async contests(query) {
        const search = query?.eventId === undefined ? '' : `?eventId=${encodeURIComponent(query.eventId)}`;
        return contestsSchema.parse(await readJson(await send(`/api/contests${search}`)));
      },
      async snapshot(sessionId) {
        return snapshotSchema.parse(await readJson(await send(`/api/snapshot?sessionId=${encodeURIComponent(sessionId)}`)));
      },
      async execute(sessionId, requestId, command) {
        return (await executeWorkflow(sessionId, requestId, command)).issueId;
      },
      executeAndRead: executeWorkflow,
    },
    manage: {
      async site() { return siteSchema.nullable().parse(await readJson(await send('/api/site'))); },
      async event(eventId) {
        return consoleSchema.parse(await readJson(await send(eventId === undefined ? '/api/event' : `/api/event?eventId=${encodeURIComponent(eventId)}`)));
      },
      async execute(requestId, command) {
        return receiptSchema.parse(await readJson(await post('/api/manage', { requestId, command })));
      },
      async issueCredentials(requestId, { eventId, accountIds }) {
        return issuedSchema.parse(await readJson(await post('/api/credentials', { requestId, eventId, accountIds })));
      },
    },
    images: {
      async begin(input) { return startedSchema.parse(await imageResult(await post('/api/images', { action: 'begin', ...input }))); },
      async upload(path, body, contentType, onProgress) {
        await putImage(imagePath(path), body, contentType, await body.arrayBuffer());
        onProgress(body.size);
      },
      async finish(sessionId, attachmentId) { await imageResult(await post('/api/images', { action: 'finish', sessionId, attachmentId })); },
      async remove(sessionId, attachmentId) { await imageResult(await post('/api/images', { action: 'remove', sessionId, attachmentId })); },
      async abandon(sessionId, attachmentId) { await imageResult(await post('/api/images', { action: 'abandon', sessionId, attachmentId })); },
      async download(path) {
        const response = await send(imagePath(path));
        if (!response.ok) {
          await imageResult(response);
          throw new ImageRequestError('This image could not be opened.');
        }
        return response.blob();
      },
    },
    announcements,
    avatars,
    updates,
  };
}
