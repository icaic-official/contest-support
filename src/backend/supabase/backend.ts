import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import { z } from 'zod';
import { membershipSchema, snapshotSchema } from '../../connected/model';
import type { AccountIdentity, Backend } from '../contracts';
import { errorMessage, WorkflowRejectedError } from '../errors';
import { createImageTransport } from './images';

const accountStatusSchema = z.object({
  username: z.string().nullable(),
  must_change: z.boolean(),
  session_valid: z.boolean(),
});
const sessionListSchema = z.array(
  z.object({ id: z.string().uuid(), name: z.string() }),
);
const accountResultSchema = z.object({
  temporary_password: z.string().optional(),
});
const functionErrorSchema = z.object({ error: z.string() });

export function loginIdentifier(value: string): string {
  const identifier = value.trim().toLowerCase();
  // Existing accounts retain email login until an admin assigns a username.
  if (identifier.includes('@')) return identifier;
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(identifier)) {
    throw new Error('Enter your organizer-provided username.');
  }
  return `${identifier}@accounts.minsky.invalid`;
}

function identity(user: User | undefined): AccountIdentity | undefined {
  if (!user) return undefined;
  return {
    id: user.id,
    email: user.email,
    name: typeof user.user_metadata.name === 'string'
      ? user.user_metadata.name
      : undefined,
  };
}

async function resultData(
  request: PromiseLike<{ data: unknown; error: unknown }>,
): Promise<unknown> {
  try {
    const { data, error } = await request;
    if (error) throw error;
    return data;
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause });
  }
}

export function createSupabaseBackend(
  url: string,
  key: string,
  client: SupabaseClient = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }),
): Backend {
  return {
    auth: {
      async currentUser() {
        const { data, error } = await client.auth.getSession();
        if (error) throw new Error(errorMessage(error));
        return identity(data.session?.user);
      },
      subscribe(onChange) {
        let active = true;
        const { data } = client.auth.onAuthStateChange((_event, session) => {
          if (active) onChange(identity(session?.user));
        });
        return () => {
          if (!active) return;
          active = false;
          data.subscription.unsubscribe();
        };
      },
      async signIn(username, password) {
        await resultData(client.auth.signInWithPassword({
          email: loginIdentifier(username),
          password,
        }));
      },
      async signOut() {
        const { error } = await client.auth.signOut();
        if (error) throw new Error(errorMessage(error));
      },
      async accountStatus() {
        return accountStatusSchema.parse(
          await resultData(client.rpc('account_status')),
        );
      },
      async changePassword(currentPassword, newPassword) {
        await resultData(client.auth.updateUser({
          password: newPassword,
          current_password: currentPassword,
        }));
        await resultData(client.rpc('complete_password_change'));
      },
    },
    workflows: {
      async sessions(userId) {
        const members = z.array(membershipSchema).parse(
          await resultData(
            client.from('memberships').select('*').eq('user_id', userId),
          ),
        );
        return sessionListSchema.parse(
          await resultData(
            client.from('sessions').select('id,name').in(
              'id',
              members.map((m) => m.session_id),
            ),
          ),
        );
      },
      async snapshot(sessionId) {
        return snapshotSchema.parse(
          await resultData(
            client.rpc('session_snapshot', { p_session: sessionId }),
          ),
        );
      },
      async execute(sessionId, requestId, command) {
        const { data, error } = await client.rpc('workflow', {
          p_session: sessionId,
          p_request: requestId,
          p_action: command,
        });
        if (error) {
          // PostgREST gives database rejections a code. Network failures have no code.
          if (error.code) throw new WorkflowRejectedError(error.message);
          throw new Error(errorMessage(error));
        }
        return z.string().uuid().parse(data);
      },
    },
    admin: {
      async account(sessionId, command) {
        const body = command.action === 'create_account'
          ? {
            action: command.action,
            session_id: sessionId,
            username: command.username,
            name: command.name,
            team_id: command.teamId,
            roles: command.roles,
            is_admin: command.isAdmin,
          }
          : {
            action: command.action,
            session_id: sessionId,
            user_id: command.userId,
            ...(command.action === 'set_username'
              ? { username: command.username }
              : {}),
          };
        const { data, error } = await client.functions.invoke('admin', {
          body,
        });
        if (error) {
          if (error.context instanceof Response) {
            const failure = functionErrorSchema.safeParse(
              await error.context.json().catch(() => undefined),
            );
            if (failure.success) throw new Error(failure.data.error);
          }
          throw new Error(errorMessage(error));
        }
        const parsed = accountResultSchema.parse(data);
        return { temporaryPassword: parsed.temporary_password };
      },
      async setIntake(sessionId, open) {
        await resultData(
          client.rpc('set_intake', { p_session: sessionId, p_open: open }),
        );
      },
      async setImageLimits(sessionId, limits) {
        await resultData(client.rpc('set_image_limits', {
          p_session: sessionId,
          p_file_mb: limits.fileMegabytes,
          p_count: limits.count,
          p_total_mb: limits.totalMegabytes,
        }));
      },
      async saveMember(sessionId, userId, member) {
        await resultData(client.rpc('manage_member', {
          p_session: sessionId,
          p_user: userId,
          p_team: member.teamId,
          p_roles: member.roles,
          p_admin: member.isAdmin,
          p_remove: false,
        }));
      },
      async removeMember(sessionId, userId) {
        await resultData(client.rpc('manage_member', {
          p_session: sessionId,
          p_user: userId,
          p_remove: true,
        }));
      },
    },
    images: createImageTransport(client, url, key),
    updates: {
      subscribe({ sessionId, userId, onChange, onConnection }) {
        let active = true;
        const changed = () => {
          if (active) onChange();
        };
        // A channel can join before Postgres starts streaming its changes.
        // Report connected only after the server confirms that subscription.
        const channel = client.channel(`session-${sessionId}-${userId}`, {
          config: { postgres_changes_options: { wait: true } },
        })
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'changes',
            filter: `session_id=eq.${sessionId}`,
          }, changed)
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'sessions',
            filter: `id=eq.${sessionId}`,
          }, changed)
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'staff_changes',
            filter: `session_id=eq.${sessionId}`,
          }, changed)
          .subscribe((status) => {
            if (active) onConnection(status === 'SUBSCRIBED');
          });
        return () => {
          if (!active) return;
          active = false;
          void client.removeChannel(channel);
        };
      },
    },
  };
}
