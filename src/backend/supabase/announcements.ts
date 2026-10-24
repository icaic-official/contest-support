import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { announcementSnapshotSchema } from '../../connected/announcementModel';
import type { Announcements } from '../contracts';
import { AnnouncementRejectedError, errorMessage } from '../errors';

const bucket = 'announcement-images';
// PostgreSQL reports a stale revision with this SQLSTATE.
const staleRevision = 'MN409';

const failureSchema = z.object({ error: z.string() });

/** Announcements use database RPCs, the announcement-images function, and a private bucket. */
export function createAnnouncements(
  client: SupabaseClient,
  url: string,
  key: string,
): Announcements {
  async function functionFailure(error: unknown, fallback: string): Promise<Error> {
    const context = error && typeof error === 'object' && 'context' in error
      ? error.context
      : undefined;
    if (context instanceof Response) {
      const failure = failureSchema.safeParse(
        await context.json().catch(() => undefined),
      );
      if (failure.success) return new Error(failure.data.error);
    }
    return new Error(fallback);
  }

  return {
    async snapshot(sessionId, signal) {
      const request = client.rpc('announcement_snapshot', { p_session: sessionId });
      const { data, error } = await (signal ? request.abortSignal(signal) : request);
      if (error) throw new Error(errorMessage(error));
      return announcementSnapshotSchema.parse(data);
    },
    async execute(sessionId, requestId, command) {
      const { data, error } = await client.rpc('announcement_command', {
        p_session: sessionId,
        p_request: requestId,
        p_action: command,
      });
      if (error) {
        // PostgREST gives database rejections a code. Network failures have none.
        if (error.code) {
          throw new AnnouncementRejectedError(error.message, error.code === staleRevision);
        }
        throw new Error(errorMessage(error));
      }
      return z.string().uuid().parse(data);
    },
    async uploadImage({ sessionId, announcementId, requestId, file, onProgress }) {
      const { data } = await client.auth.getSession();
      if (!data.session) throw new Error('Sign in first.');
      const body = new FormData();
      body.set('session_id', sessionId);
      body.set('announcement_id', announcementId);
      body.set('request_id', requestId);
      body.set('image', file);
      // Fetch cannot report upload progress, so use a request object that can.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${url}/functions/v1/announcement-images`);
        xhr.setRequestHeader('Authorization', `Bearer ${data.session!.access_token}`);
        xhr.setRequestHeader('apikey', key);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
            return;
          }
          let message = 'Image upload failed. Retry, or select a new image if its reservation expired.';
          try {
            const failure = failureSchema.safeParse(JSON.parse(xhr.responseText));
            if (failure.success) message = failure.data.error;
          } catch {
            // A proxy can return a non-JSON response. Keep the generic message.
          }
          reject(new Error(message));
        };
        xhr.onerror = () => reject(new Error('Image upload failed. Check your connection and retry.'));
        xhr.send(body);
      });
    },
    async removeImage(sessionId, imageId) {
      const { error } = await client.functions.invoke('announcement-images', {
        body: { action: 'remove', session_id: sessionId, image_id: imageId },
      });
      if (error) throw await functionFailure(error, 'Image removal failed. Try again.');
    },
    async downloadImage(image) {
      // Recheck current access instead of reusing a cached authorized response.
      const { data, error } = await client.storage.from(bucket).download(
        [image.session_id, image.announcement_id, image.id].join('/'),
        { cacheNonce: crypto.randomUUID() },
        { cache: 'no-store' },
      );
      if (error || !data) throw new Error('This announcement image could not be opened.');
      return data;
    },
  };
}
