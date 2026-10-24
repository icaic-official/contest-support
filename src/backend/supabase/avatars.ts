import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Avatars } from '../contracts';
import { errorMessage, ImageRequestError } from '../errors';

const bucket = 'person-avatars';
const avatarSchema = z.object({ person_id: z.string().uuid(), avatar_id: z.string().uuid() });
const failureSchema = z.object({
  error: z.string(), validation: z.boolean().optional(), restart: z.boolean().optional(),
});

/** Avatars use database functions for reads, the avatars function for writes, and a private bucket. */
export function createAvatars(client: SupabaseClient): Avatars {
  async function invoke(body: FormData | { action: 'remove' }): Promise<unknown> {
    const { data, error } = await client.functions.invoke('avatars', { body });
    if (!error) return data;
    const context = 'context' in error ? error.context : undefined;
    const failure = failureSchema.safeParse(
      context instanceof Response ? await context.json().catch(() => undefined) : undefined,
    );
    throw new ImageRequestError(
      failure.success ? failure.data.error : 'The picture request failed. Try again.',
      failure.success ? failure.data : undefined,
    );
  }

  async function list(sessionId: string) {
    const { data, error } = await client.rpc('avatar_list', { p_session: sessionId });
    if (error) throw new ImageRequestError(errorMessage(error));
    return z.array(avatarSchema).parse(data);
  }

  return {
    list,
    async upload({ requestId, file }) {
      const body = new FormData();
      body.set('request_id', requestId);
      body.set('image', file);
      return avatarSchema.parse(await invoke(body));
    },
    async remove() {
      await invoke({ action: 'remove' });
    },
    async download(sessionId, avatar) {
      // Storage allows a read in any session where both people are staff. The list checks this session.
      const visible = (await list(sessionId)).some((item) =>
        item.person_id === avatar.person_id && item.avatar_id === avatar.avatar_id);
      if (!visible) throw new ImageRequestError('Picture unavailable.', { validation: true });
      // Recheck current access instead of reusing a cached authorized response.
      const { data, error } = await client.storage.from(bucket).download(
        `${avatar.person_id}/${avatar.avatar_id}`,
        { cacheNonce: crypto.randomUUID() },
        { cache: 'no-store' },
      );
      if (error || !data) throw new ImageRequestError('This picture could not be opened.');
      return data;
    },
  };
}
