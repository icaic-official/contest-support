import {
  createClient,
  REALTIME_SUBSCRIBE_STATES,
  RealtimeChannel,
  type Session,
  type User,
} from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementRejectedError, WorkflowRejectedError } from '../errors';
import { createSupabaseBackend } from './backend';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000100';
const ISSUE_ID = '00000000-0000-4000-8000-000000000300';
const REQUEST_ID = '00000000-0000-4000-8000-000000000400';
const user: User = {
  id: USER_ID,
  email: 'helper@accounts.minsky.invalid',
  aud: 'authenticated',
  created_at: '2026-10-17T00:00:00Z',
  app_metadata: { provider: 'email' },
  user_metadata: { name: 'Test helper', private: 'omit' },
};
const session: Session = {
  access_token: 'fixture-token',
  refresh_token: 'fixture-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  user,
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(reply: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const client = createClient('https://adapter.test', 'fixture-public-key', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request.clone());
        return reply(request);
      },
    },
  });
  return {
    client,
    backend: createSupabaseBackend(
      'https://adapter.test',
      'fixture-public-key',
      client,
    ),
    requests,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Supabase authentication adapter', () => {
  it('returns only the account identity and translates sign-in and sign-out notifications', async () => {
    const { backend, client } = setup(() => json(session));
    const changed = vi.fn();
    const auth = vi.spyOn(client.auth, 'onAuthStateChange');
    const stop = backend.auth.subscribe(changed);
    await expect(backend.auth.currentUser()).resolves.toBeUndefined();
    changed.mockClear();
    await backend.auth.signIn(' HELPER ', 'test-password');
    expect(changed).toHaveBeenCalledWith({
      id: USER_ID,
      email: user.email,
      name: 'Test helper',
    });
    await expect(backend.auth.currentUser()).resolves.toEqual({
      id: USER_ID,
      email: user.email,
      name: 'Test helper',
    });
    await backend.auth.signOut();
    expect(changed).toHaveBeenLastCalledWith(undefined);
    stop();
    stop();
    changed.mockClear();
    // Simulate an already queued provider event after the consumer has unmounted.
    auth.mock.calls[0][0]('SIGNED_IN', session);
    expect(changed).not.toHaveBeenCalled();
  });

  it('clears the temporary-password gate only after the Auth update succeeds', async () => {
    const { backend, client, requests } = setup(() => json(null));
    const update = vi.spyOn(client.auth, 'updateUser').mockResolvedValue({
      data: { user },
      error: null,
    });
    await backend.auth.changePassword('old-password', 'new-password');
    expect(update).toHaveBeenCalledWith({
      current_password: 'old-password',
      password: 'new-password',
    });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/rest/v1/rpc/complete_password_change',
    ]);
  });

  it('does not clear the password gate when the Auth update fails', async () => {
    const { backend, client, requests } = setup(() => json(null));
    vi.spyOn(client.auth, 'updateUser').mockRejectedValue(
      new Error('Current password rejected'),
    );
    await expect(backend.auth.changePassword('wrong', 'new-password')).rejects
      .toThrow('Current password rejected');
    expect(requests).toHaveLength(0);
  });

  it('reports a failed completion check after the password has changed', async () => {
    const { backend, client } = setup(() =>
      json({ message: 'Sign in again', code: 'P0001' }, 400)
    );
    vi.spyOn(client.auth, 'updateUser').mockResolvedValue({
      data: { user },
      error: null,
    });
    await expect(backend.auth.changePassword('old', 'new')).rejects.toThrow(
      'Sign in again',
    );
  });

  it('validates account access responses before the UI can use them', async () => {
    const { backend } = setup(() =>
      json({ username: 'helper', must_change: false, session_valid: 'yes' })
    );
    await expect(backend.auth.accountStatus()).rejects.toThrow();
  });
});

describe('Supabase workflow adapter', () => {
  it('loads the account memberships before listing accessible sessions', async () => {
    const { backend, requests } = setup((request) =>
      new URL(request.url).pathname.endsWith('/memberships')
        ? json([{
          session_id: SESSION_ID,
          user_id: USER_ID,
          team_id: null,
          roles: ['volunteer'],
          is_admin: false,
        }])
        : json([{ id: SESSION_ID, name: 'Test session' }])
    );
    await expect(backend.workflows.sessions(USER_ID)).resolves.toEqual([{
      id: SESSION_ID,
      name: 'Test session',
    }]);
    expect(new URL(requests[0].url).searchParams.get('user_id')).toBe(
      `eq.${USER_ID}`,
    );
    expect(new URL(requests[1].url).searchParams.get('id')).toBe(
      `in.(${SESSION_ID})`,
    );
  });

  it('rejects malformed snapshots instead of exposing unvalidated permissions', async () => {
    const { backend } = setup(() => json({ membership: { is_admin: true } }));
    await expect(backend.workflows.snapshot(SESSION_ID)).rejects.toThrow();
  });

  it('preserves the request ID and command across an uncertain outcome and explicit retry', async () => {
    let attempts = 0;
    const { backend, requests } = setup(() => {
      if (++attempts === 1) throw new TypeError('Network connection lost');
      return json(ISSUE_ID);
    });
    const command = { type: 'claim', issue_id: ISSUE_ID, revision: 7 } as const;
    const first = backend.workflows.execute(SESSION_ID, REQUEST_ID, command);
    await expect(first).rejects.toThrow('Network connection lost');
    await expect(first).rejects.not.toBeInstanceOf(WorkflowRejectedError);
    await expect(backend.workflows.execute(SESSION_ID, REQUEST_ID, command))
      .resolves.toBe(ISSUE_ID);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(await request.json()).toEqual({
        p_session: SESSION_ID,
        p_request: REQUEST_ID,
        p_action: command,
      });
    }
  });

  it('distinguishes a definitive server rejection from a lost or invalid success response', async () => {
    const rejected = setup(() =>
      json({ message: 'Only the owner can resolve', code: 'P0001' }, 400)
    );
    await expect(rejected.backend.workflows.execute(SESSION_ID, REQUEST_ID, {
      type: 'resolve',
      issue_id: ISSUE_ID,
      revision: 7,
      summary: 'Fixed',
    })).rejects.toBeInstanceOf(WorkflowRejectedError);
    const malformed = setup(() => json({ unexpected: true }));
    const result = malformed.backend.workflows.execute(SESSION_ID, REQUEST_ID, {
      type: 'claim',
      issue_id: ISSUE_ID,
      revision: 7,
    });
    await expect(result).rejects.toThrow();
    await expect(result).rejects.not.toBeInstanceOf(WorkflowRejectedError);
  });
});

describe('Supabase administration adapter', () => {
  it('sends typed account commands and returns temporary credentials without provider objects', async () => {
    const { backend, requests } = setup(() =>
      json({
        ok: true,
        user_id: USER_ID,
        temporary_password: 'temporary-test-password',
      })
    );
    await expect(backend.admin.account(SESSION_ID, {
      action: 'create_account',
      username: 'helper',
      name: 'Test helper',
      teamId: null,
      roles: ['volunteer', 'jury'],
      isAdmin: false,
    })).resolves.toEqual({ temporaryPassword: 'temporary-test-password' });
    expect(await requests[0].json()).toEqual({
      action: 'create_account',
      session_id: SESSION_ID,
      username: 'helper',
      name: 'Test helper',
      team_id: null,
      roles: ['volunteer', 'jury'],
      is_admin: false,
    });
    await backend.admin.account(SESSION_ID, {
      action: 'reset_password',
      userId: USER_ID,
    });
    expect(await requests[1].json()).toEqual({
      action: 'reset_password',
      session_id: SESSION_ID,
      user_id: USER_ID,
    });
    await backend.admin.account(SESSION_ID, {
      action: 'set_username',
      userId: USER_ID,
      username: 'renamed',
    });
    expect(await requests[2].json()).toEqual({
      action: 'set_username',
      session_id: SESSION_ID,
      user_id: USER_ID,
      username: 'renamed',
    });
  });

  it('preserves organizer authorization failures from the account function', async () => {
    const { backend } = setup(() =>
      json(
        { error: 'Admin access to every assigned session is required.' },
        403,
      )
    );
    await expect(
      backend.admin.account(SESSION_ID, {
        action: 'reset_password',
        userId: USER_ID,
      }),
    )
      .rejects.toThrow('Admin access to every assigned session is required.');
  });

  it('passes membership, intake, and image limits to the existing server rules', async () => {
    const { backend, requests } = setup(() => json(null));
    await backend.admin.saveMember(SESSION_ID, USER_ID, {
      teamId: null,
      roles: ['specialist'],
      isAdmin: true,
    });
    await backend.admin.removeMember(SESSION_ID, USER_ID);
    await backend.admin.setIntake(SESSION_ID, false);
    await backend.admin.setImageLimits(SESSION_ID, {
      fileMegabytes: 8,
      count: 10,
      totalMegabytes: 40,
    });
    expect(
      await Promise.all(requests.map(async (request) => ({
        path: new URL(request.url).pathname,
        body: await request.json(),
      }))),
    ).toEqual([
      {
        path: '/rest/v1/rpc/manage_member',
        body: {
          p_session: SESSION_ID,
          p_user: USER_ID,
          p_team: null,
          p_roles: ['specialist'],
          p_admin: true,
          p_remove: false,
        },
      },
      {
        path: '/rest/v1/rpc/manage_member',
        body: { p_session: SESSION_ID, p_user: USER_ID, p_remove: true },
      },
      {
        path: '/rest/v1/rpc/set_intake',
        body: { p_session: SESSION_ID, p_open: false },
      },
      {
        path: '/rest/v1/rpc/set_image_limits',
        body: {
          p_session: SESSION_ID,
          p_file_mb: 8,
          p_count: 10,
          p_total_mb: 40,
        },
      },
    ]);
  });
});

describe('Supabase live updates adapter', () => {
  it('keeps subscribers independent while an earlier channel is still closing', async () => {
    const { backend, client } = setup(() => json(null));
    const subscribe = vi.spyOn(RealtimeChannel.prototype, 'subscribe')
      .mockImplementation(function (this: RealtimeChannel) {
        return this;
      });
    let finishClose: ((value: 'ok') => void) | undefined;
    const closing = new Promise<'ok'>((resolve) => {
      finishClose = resolve;
    });
    vi.spyOn(RealtimeChannel.prototype, 'unsubscribe').mockReturnValue(closing);
    const firstChange = vi.fn();
    const firstConnection = vi.fn();
    const subscribeInput = {
      sessionId: SESSION_ID,
      userId: USER_ID,
      onChange: firstChange,
      onConnection: firstConnection,
    };
    const stopFirst = backend.updates.subscribe(subscribeInput);
    const first = client.getChannels()[0];
    stopFirst();
    // The real SDK retains this topic until asynchronous removal completes.
    expect(client.getChannels()).toContain(first);
    const nextConnection = vi.fn();
    const stopNext = backend.updates.subscribe({
      ...subscribeInput,
      onConnection: nextConnection,
    });
    const siblingConnection = vi.fn();
    const stopSibling = backend.updates.subscribe({
      ...subscribeInput,
      onConnection: siblingConnection,
    });
    try {
      expect(new Set(client.getChannels()).size).toBe(3);
      const callbacks = subscribe.mock.calls.map(([callback]) => callback);
      for (const callback of callbacks) {
        callback?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
      }
      expect(firstConnection).not.toHaveBeenCalled();
      expect(nextConnection).toHaveBeenCalledExactlyOnceWith(true);
      expect(siblingConnection).toHaveBeenCalledExactlyOnceWith(true);
      stopNext();
      callbacks[1]?.(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);
      callbacks[2]?.(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);
      expect(nextConnection).toHaveBeenCalledTimes(1);
      expect(siblingConnection).toHaveBeenLastCalledWith(false);
    } finally {
      stopNext();
      stopSibling();
      finishClose?.('ok');
      await closing;
    }
  });

  it('listens for public and staff invalidations and ignores all callbacks after cleanup', () => {
    const { backend, client } = setup(() => json(null));
    const channel = client.channel('test-channel');
    const on = vi.spyOn(channel, 'on');
    const subscribe = vi.spyOn(channel, 'subscribe').mockReturnValue(channel);
    const createChannel = vi.spyOn(client, 'channel').mockReturnValue(channel);
    const remove = vi.spyOn(client, 'removeChannel').mockResolvedValue('ok');
    const onChange = vi.fn();
    const onConnection = vi.fn();
    const stop = backend.updates.subscribe({
      sessionId: SESSION_ID,
      userId: USER_ID,
      onChange,
      onConnection,
    });
    expect(createChannel).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(
        new RegExp(`^session-${SESSION_ID}-${USER_ID}-[a-f0-9-]+$`),
      ),
      { config: { postgres_changes_options: { wait: true } } },
    );
    expect(on.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'changes',
        filter: `session_id=eq.${SESSION_ID}`,
      }],
      ['postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'sessions',
        filter: `id=eq.${SESSION_ID}`,
      }],
      ['postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'staff_changes',
        filter: `session_id=eq.${SESSION_ID}`,
      }],
    ]);
    const connected = subscribe.mock.calls[0][0];
    connected?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    expect(onConnection).toHaveBeenLastCalledWith(true);
    connected?.(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);
    expect(onConnection).toHaveBeenLastCalledWith(false);
    for (const [, , callback] of on.mock.calls) callback({});
    expect(onChange).toHaveBeenCalledTimes(3);
    stop();
    stop();
    expect(remove).toHaveBeenCalledExactlyOnceWith(channel);
    onChange.mockClear();
    onConnection.mockClear();
    connected?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    for (const [, , callback] of on.mock.calls) callback({});
    expect(onChange).not.toHaveBeenCalled();
    expect(onConnection).not.toHaveBeenCalled();
  });
});

describe('Supabase announcement adapter', () => {
  const ANNOUNCEMENT_ID = '00000000-0000-4000-8000-000000000200';
  const publish = { type: 'publish' as const, title: 'Fictional', details: 'Details.', expires_at: null };

  it('calls the announcement RPCs with the caller request ID and classifies rejections', async () => {
    const { backend, requests } = setup(() => json(ANNOUNCEMENT_ID));
    await expect(backend.announcements.execute(SESSION_ID, REQUEST_ID, publish)).resolves.toBe(ANNOUNCEMENT_ID);
    expect(new URL(requests[0].url).pathname).toBe('/rest/v1/rpc/announcement_command');
    expect(await requests[0].json()).toEqual({ p_session: SESSION_ID, p_request: REQUEST_ID, p_action: publish });
    const stale = setup(() => json({ code: 'MN409', message: 'Announcement changed. Review the latest version and try again.' }, 400));
    await expect(stale.backend.announcements.execute(SESSION_ID, REQUEST_ID, publish))
      .rejects.toMatchObject({ conflict: true });
    const denied = setup(() => json({ code: 'P0001', message: 'Only session admins and jury can manage announcements.' }, 400));
    const rejection = denied.backend.announcements.execute(SESSION_ID, REQUEST_ID, publish);
    await expect(rejection).rejects.toBeInstanceOf(AnnouncementRejectedError);
    await expect(rejection).rejects.toMatchObject({ conflict: false });
    const offline = setup(() => { throw new TypeError('Failed to fetch'); });
    const unknown = offline.backend.announcements.execute(SESSION_ID, REQUEST_ID, publish);
    await expect(unknown).rejects.not.toBeInstanceOf(WorkflowRejectedError);
  });

  it('validates snapshots and aborts an older read', async () => {
    const { backend, requests } = setup((request) => {
      // The stand-in transport honors cancellation as the browser's fetch does.
      if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return json({ announcements: [], images: [], server_time: '2026-10-24T00:00:00.000Z' });
    });
    await expect(backend.announcements.snapshot(SESSION_ID)).resolves.toMatchObject({ announcements: [] });
    expect(new URL(requests[0].url).pathname).toBe('/rest/v1/rpc/announcement_snapshot');
    const controller = new AbortController();
    controller.abort();
    await expect(backend.announcements.snapshot(SESSION_ID, controller.signal)).rejects.toThrow();
    const invalid = setup(() => json({ announcements: 3 }));
    await expect(invalid.backend.announcements.snapshot(SESSION_ID)).rejects.toThrow();
  });

  it('removes images through the function and surfaces its message', async () => {
    const { backend, requests } = setup(() => json({ error: 'The image is hidden. Retry removal to finish deleting its file.' }, 400));
    await expect(backend.announcements.removeImage(SESSION_ID, ANNOUNCEMENT_ID)).rejects.toThrow('Retry removal');
    expect(new URL(requests[0].url).pathname).toBe('/functions/v1/announcement-images');
  });
});
