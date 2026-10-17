import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { ImageTransport } from '../contracts';
import { ImageRequestError } from '../errors';
import { classifyAttachmentError } from '../../connected/imageFile';

const bucket = 'issue-attachments';

export function createImageTransport(
  client: SupabaseClient,
  url: string,
  key: string,
): ImageTransport {
  const payloadSchema = z.object({
    error: z.string().optional(),
    validation: z.boolean().optional(),
    restart: z.boolean().optional(),
    id: z.string().optional(),
    original_path: z.string().optional(),
    thumbnail_path: z.string().optional(),
  });
  type FunctionPayload = z.infer<typeof payloadSchema>;

  async function invoke(
    body: Record<string, unknown>,
  ): Promise<FunctionPayload> {
    const result = await client.functions.invoke('attachments', { body });
    if (result.error) {
      let message = 'Upload failed. Check your connection and try again.';
      let failure: FunctionPayload | undefined;
      const context = 'context' in result.error
        ? result.error.context
        : undefined;
      if (context instanceof Response) {
        const payload = payloadSchema.safeParse(
          await context.json().catch(() => undefined),
        );
        if (payload.success) {
          if (payload.data.error) message = payload.data.error;
          failure = payload.data;
        }
      }
      const classified = classifyAttachmentError(message);
      throw new ImageRequestError(message, {
        validation: failure?.validation ?? classified.validation,
        restart: failure?.restart ?? classified.restart,
        incomplete: message.startsWith('Upload the image before finishing.'),
      });
    }
    return payloadSchema.parse(result.data ?? {});
  }

  const transport: ImageTransport = {
    async begin(input) {
      const data = await invoke({
        action: 'begin',
        session_id: input.sessionId,
        request_id: input.requestId,
        issue_id: input.issueId,
        visibility: input.visibility,
        name: input.name,
        bytes: input.bytes,
      });
      if (!data.id || !data.original_path || !data.thumbnail_path) {
        throw new ImageRequestError(
          'Upload failed. Check your connection and try again.',
          { restart: true },
        );
      }
      return {
        id: data.id,
        original_path: data.original_path,
        thumbnail_path: data.thumbnail_path,
      };
    },
    upload(path, body, contentType, onProgress) {
      return uploadStoredObject(path, body, contentType, onProgress);
    },
    async finish(sessionId, attachmentId) {
      await invoke({
        action: 'finish',
        session_id: sessionId,
        attachment_id: attachmentId,
      });
    },
    async remove(sessionId, attachmentId) {
      await invoke({
        action: 'remove',
        session_id: sessionId,
        attachment_id: attachmentId,
      });
    },
    async abandon(sessionId, attachmentId) {
      await invoke({
        action: 'abandon',
        session_id: sessionId,
        attachment_id: attachmentId,
      });
    },
    async download(path) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) {
        throw new ImageRequestError('This image could not be opened.');
      }
      return data;
    },
  };

  async function uploadStoredObject(
    path: string,
    body: Blob,
    contentType: string,
    onProgress: (loaded: number) => void,
  ): Promise<void> {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!url || !key || !token) {
      throw new ImageRequestError('Sign in first.', { restart: true });
    }
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${url}/storage/v1/object/${bucket}/${encoded}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', key);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.setRequestHeader('x-upsert', 'true');
      xhr.setRequestHeader('cache-control', 'private, max-age=0');
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(body.size);
          resolve();
          return;
        }
        if (xhr.status === 401 || xhr.status === 403) {
          reject(
            new ImageRequestError(
              'You do not have permission to add images to this issue.',
              { validation: true },
            ),
          );
          return;
        }
        reject(
          new ImageRequestError(
            'Upload failed. Check your connection and try again.',
          ),
        );
      };
      xhr.onerror = () => {
        reject(
          new ImageRequestError(
            'Upload failed. Check your connection and try again.',
          ),
        );
      };
      xhr.send(body);
    });
  }

  return transport;
}
