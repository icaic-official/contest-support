import { z } from 'zod';
import type { Backend, LiveUpdates } from '../contracts';
import { ImageRequestError, WorkflowRejectedError } from '../errors';
import { snapshotSchema } from '../../connected/model';
import { createCloudflareAuthentication } from './authentication';

const sessionSchema = z.object({ csrf: z.string().min(1) });
const sessionsSchema = z.array(z.object({ id: z.uuid(), name: z.string() }));
const startedSchema = z.object({ id: z.uuid(), original_path: z.string(), thumbnail_path: z.string() });
const workflowSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('committed'), issueId: z.uuid() }),
  z.object({ outcome: z.literal('rejected'), reason: z.enum(['input', 'access', 'state', 'request_id']) }),
  z.object({ outcome: z.literal('unknown') }),
]);
const failureSchema = z.object({
  error: z.string(), validation: z.boolean().optional(),
  restart: z.boolean().optional(), incomplete: z.boolean().optional(),
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

  async function csrfHeaders(contentType: string): Promise<Headers> {
    const response = await send('/api/auth/session');
    if (response.status === 401) throw new Error('Sign in to continue.');
    const current = sessionSchema.parse(await readJson(response));
    return new Headers({
      'Content-Type': contentType, 'X-Minsky-Request': '1', 'X-CSRF-Token': current.csrf,
    });
  }

  async function post(path: string, body: unknown): Promise<Response> {
    return send(path, {
      method: 'POST', headers: await csrfHeaders('application/json'), body: JSON.stringify(body),
    });
  }

  async function readJson(response: Response): Promise<unknown> {
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = failureSchema.safeParse(body);
      throw new Error(error.success ? error.data.error : 'The request could not be completed.');
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

  function imagePath(path: string): string {
    return `/api/image/${path.split('/').map(encodeURIComponent).join('/')}`;
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
      async sessions() { return sessionsSchema.parse(await readJson(await send('/api/sessions'))); },
      async snapshot(sessionId) {
        return snapshotSchema.parse(await readJson(await send(`/api/snapshot?sessionId=${encodeURIComponent(sessionId)}`)));
      },
      async execute(sessionId, requestId, command) {
        const response = await post('/api/workflow', { sessionId, requestId, command });
        const result = workflowSchema.safeParse(await response.json().catch(() => undefined));
        // Only the endpoint's typed rejection confirms that no command committed.
        if (result.success && result.data.outcome === 'rejected') {
          throw new WorkflowRejectedError(`Workflow rejected: ${result.data.reason}.`);
        }
        if (!response.ok || !result.success || result.data.outcome !== 'committed') {
          throw new Error('Workflow outcome is unknown. Retry the same request.');
        }
        return result.data.issueId;
      },
    },
    admin: {
      account: auth.account,
      async setIntake(sessionId, open) { await readJson(await post('/api/admin', { action: 'set_intake', sessionId, open })); },
      async setImageLimits(sessionId, limits) { await readJson(await post('/api/admin', { action: 'set_image_limits', sessionId, limits })); },
      async saveMember(sessionId, userId, member) { await readJson(await post('/api/admin', { action: 'save_member', sessionId, userId, member })); },
      async removeMember(sessionId, userId) { await readJson(await post('/api/admin', { action: 'remove_member', sessionId, userId })); },
    },
    images: {
      async begin(input) { return startedSchema.parse(await imageResult(await post('/api/images', { action: 'begin', ...input }))); },
      async upload(path, body, contentType, onProgress) {
        const digest = await crypto.subtle.digest('SHA-256', await body.arrayBuffer());
        const headers = await csrfHeaders(contentType);
        headers.set('X-Minsky-Digest', Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''));
        const response = await send(imagePath(path), {
          method: 'PUT', headers, body,
        });
        await imageResult(response);
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
    updates,
  };
}
