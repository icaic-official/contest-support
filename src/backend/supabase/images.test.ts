import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageRequestError } from '../errors';
import { createImageTransport } from './images';

function setup(reply: (request: Request) => Response | Promise<Response>) {
  const client = createClient('https://adapter.test', 'fixture-public-key', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: async (input, init) => reply(new Request(input, init)) },
  });
  return {
    client,
    images: createImageTransport(
      client,
      'https://adapter.test',
      'fixture-public-key',
    ),
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Supabase image adapter', () => {
  it('preserves the upload identity, visibility, and file paths across begin retries', async () => {
    const requests: unknown[] = [];
    const started = {
      id: 'image-id',
      original_path: 'session/issue/image/original',
      thumbnail_path: 'session/issue/image/thumbnail',
    };
    const { images } = setup(async (request) => {
      requests.push(await request.json());
      return json(started);
    });
    const input = {
      requestId: 'request-id',
      sessionId: 'session-id',
      issueId: 'issue-id',
      visibility: 'internal',
      name: 'screen.png',
      bytes: 120,
    } as const;
    await expect(images.begin(input)).resolves.toEqual(started);
    await expect(images.begin(input)).resolves.toEqual(started);
    expect(requests).toEqual(
      Array(2).fill({
        action: 'begin',
        request_id: 'request-id',
        session_id: 'session-id',
        issue_id: 'issue-id',
        visibility: 'internal',
        name: 'screen.png',
        bytes: 120,
      }),
    );
  });

  it('translates a missing original into a typed incomplete-upload error', async () => {
    const { images } = setup(() =>
      json({
        error: 'Upload the image before finishing.',
        restart: true,
        validation: false,
      }, 409)
    );
    const result = images.finish('session-id', 'image-id');
    await expect(result).rejects.toBeInstanceOf(ImageRequestError);
    await expect(result).rejects.toMatchObject({
      incomplete: true,
      restart: true,
      validation: false,
    });
  });

  it('keeps explicit retry flags and does not mistake a network failure for a missing original', async () => {
    const explicit = setup(() =>
      json({ error: 'Upload failed.', restart: false, validation: true }, 403)
    );
    await expect(explicit.images.finish('session-id', 'image-id')).rejects
      .toMatchObject({
        incomplete: false,
        restart: false,
        validation: true,
      });
    const network = setup(() => {
      throw new TypeError('Network connection lost');
    });
    await expect(network.images.finish('session-id', 'image-id')).rejects
      .toMatchObject({
        incomplete: false,
        restart: true,
        validation: false,
      });
  });

  it('rejects a begin response that has no storage paths', async () => {
    const { images } = setup(() => json({ id: 'image-id' }));
    await expect(
      images.begin({
        requestId: 'request',
        sessionId: 'session',
        issueId: 'issue',
        visibility: 'public',
        name: 'screen.png',
        bytes: 120,
      }),
    )
      .rejects.toMatchObject({ restart: true });
  });

  it('sends finish, remove, and abandon to the authorized attachment function', async () => {
    const requests: unknown[] = [];
    const { images } = setup(async (request) => {
      expect(new URL(request.url).pathname).toBe('/functions/v1/attachments');
      requests.push(await request.json());
      return json({ ok: true });
    });
    await images.finish('session-id', 'image-id');
    await images.remove('session-id', 'image-id');
    await images.abandon('session-id', 'image-id');
    expect(requests).toEqual(['finish', 'remove', 'abandon'].map((action) => ({
      action,
      session_id: 'session-id',
      attachment_id: 'image-id',
    })));
  });

  it('downloads from the private bucket and rejects denied downloads', async () => {
    const accepted = setup((request) => {
      expect(new URL(request.url).pathname).toBe(
        '/storage/v1/object/issue-attachments/session/issue/image/original',
      );
      return new Response('image-bytes', {
        headers: { 'Content-Type': 'image/png' },
      });
    });
    expect(
      await (await accepted.images.download('session/issue/image/original'))
        .text(),
    ).toBe('image-bytes');
    const denied = setup(() => json({ message: 'Access denied' }, 403));
    await expect(denied.images.download('session/issue/image/original')).rejects
      .toThrow('This image could not be opened.');
  });

  it('uploads with the current token, encoded path, private cache settings, and byte progress', async () => {
    const uploads: TestUpload[] = [];
    class TestUpload {
      status = 0;
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn();
      upload = {
        onprogress: vi.fn<
          (event: { lengthComputable: boolean; loaded: number }) => void
        >(),
      };
      onload = () => {};
      onerror = () => {};
      constructor() {
        uploads.push(this);
      }
    }
    vi.stubGlobal('XMLHttpRequest', TestUpload);
    const { client, images } = setup(() => json(null));
    vi.spyOn(client.auth, 'getSession').mockResolvedValue({
      data: {
        session: {
          access_token: 'current-token',
          refresh_token: 'refresh',
          expires_in: 3600,
          token_type: 'bearer',
          user: {
            id: 'user-id',
            aud: 'authenticated',
            created_at: '2026-10-17T00:00:00Z',
            app_metadata: {},
            user_metadata: {},
          },
        },
      },
      error: null,
    });
    const body = new Blob(['image-bytes'], { type: 'image/png' });
    const progress = vi.fn();
    const result = images.upload(
      'session/image name/original',
      body,
      'image/png',
      progress,
    );
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    const upload = uploads[0];
    expect(upload.open).toHaveBeenCalledWith(
      'POST',
      'https://adapter.test/storage/v1/object/issue-attachments/session/image%20name/original',
    );
    expect(upload.setRequestHeader.mock.calls).toEqual([
      ['Authorization', 'Bearer current-token'],
      ['apikey', 'fixture-public-key'],
      ['Content-Type', 'image/png'],
      ['x-upsert', 'true'],
      ['cache-control', 'private, max-age=0'],
    ]);
    expect(upload.send).toHaveBeenCalledWith(body);
    upload.upload.onprogress({ lengthComputable: true, loaded: 4 });
    expect(progress).toHaveBeenLastCalledWith(4);
    upload.status = 201;
    upload.onload();
    await result;
    expect(progress).toHaveBeenLastCalledWith(body.size);
  });

  it('requires an authenticated session before creating an upload request', async () => {
    const { images } = setup(() => json(null));
    await expect(images.upload('path', new Blob(), 'image/png', () => {}))
      .rejects.toThrow('Sign in first.');
  });
});
