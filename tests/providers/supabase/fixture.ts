import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { createSupabaseBackend } from '../../../src/backend/supabase/backend';
import type { Actor, ScenarioData, TestAccount } from '../contracts';

export interface SupabaseFixture extends ScenarioData {
  url: string;
  publicKey: string;
}

const uuid = z.string().uuid();
const journalSchema = z.object({
  version: z.literal(1),
  provider: z.literal('supabase'),
  project: z.string().regex(/^[a-z]{20}$/),
  runId: uuid,
  eventId: uuid,
  sessionIds: z.tuple([uuid, uuid]),
  teamIds: z.tuple([uuid, uuid, uuid]),
  accountIds: z.array(uuid),
}).strict();
type Journal = z.infer<typeof journalSchema>;

const actors: Actor[] = [
  'admin',
  'otherAdmin',
  'contestant',
  'otherTeam',
  'volunteer',
  'specialist',
  'jury',
  'isolated',
  'temporary',
  'revoked',
];

function configuration() {
  const project = process.env.MINSKY_TEST_PROJECT_REF ?? '';
  const publicKey = process.env.SUPABASE_ANON_KEY ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!/^[a-z]{20}$/.test(project) || project === 'ovymmobupzowotvrywek') {
    throw new Error(
      'Select an isolated Supabase test project. Development is forbidden.',
    );
  }
  if (!publicKey || !serviceKey) {
    throw new Error('Supply the isolated test project credentials.');
  }
  return {
    project,
    publicKey,
    serviceKey,
    url: `https://${project}.supabase.co`,
  };
}

function service(): SupabaseClient {
  const config = configuration();
  return createClient(config.url, config.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function saveJournal(path: string, journal: Journal): Promise<void> {
  // An interruption leaves either the previous complete journal or the new one.
  await writeFile(`${path}.next`, JSON.stringify(journal), { mode: 0o600 });
  await rename(`${path}.next`, path);
}

function checked(error: unknown, operation: string): void {
  if (error) {
    throw new Error(`Provider fixture operation failed: ${operation}.`);
  }
}

/** The journal contains only UUIDs and the provider target. It contains no credentials. */
export async function createFixture(path: string): Promise<SupabaseFixture> {
  const config = configuration();
  const journal: Journal = {
    version: 1,
    provider: 'supabase',
    project: config.project,
    runId: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    sessionIds: [crypto.randomUUID(), crypto.randomUUID()],
    teamIds: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
    accountIds: [],
  };
  // Never overwrite a recovery file from an interrupted run.
  await writeFile(path, JSON.stringify(journal), { mode: 0o600, flag: 'wx' });
  const admin = service();
  try {
    checked(
      (await admin.from('events').insert({
        id: journal.eventId,
        name: `Provider contract ${journal.runId}`,
      })).error,
      'create fixture event',
    );
    checked(
      (await admin.from('sessions').insert(
        journal.sessionIds.map((id, index) => ({
          id,
          event_id: journal.eventId,
          name: index === 0 ? 'Provider primary' : 'Provider isolation',
          intake_open: true,
        })),
      )).error,
      'create fixture sessions',
    );
    checked(
      (await admin.from('teams').insert(journal.teamIds.map((id, index) => ({
        id,
        session_id: journal.sessionIds[index === 2 ? 1 : 0],
        name: `Provider team ${index}`,
        location: `Fixture desk ${index}`,
      })))).error,
      'create fixture teams',
    );
    const accounts: Partial<Record<Actor, TestAccount>> = {};
    for (const actor of actors) {
      const username = `pc-${
        journal.runId.slice(0, 12)
      }-${actor.toLowerCase()}`;
      const password = crypto.randomUUID() + 'A9!';
      const created = await admin.auth.admin.createUser({
        email: `${username}@accounts.minsky.invalid`,
        password,
        email_confirm: true,
        user_metadata: {
          name: `Provider ${actor}`,
          provider_test_run: journal.runId,
        },
      });
      checked(created.error, `create ${actor} fixture account`);
      if (!created.data.user) {
        throw new Error(
          'The provider did not return the created fixture account.',
        );
      }
      const id = created.data.user.id;
      journal.accountIds.push(id);
      await saveJournal(path, journal);
      checked(
        (await admin.rpc('initialize_account', {
          p_target: id,
          p_username: username,
        })).error,
        'initialize fixture username',
      );
      const team = actor === 'contestant' || actor === 'temporary'
        ? 0
        : actor === 'otherTeam'
        ? 1
        : actor === 'isolated'
        ? 2
        : null;
      const roles = actor === 'volunteer' || actor === 'revoked'
        ? ['volunteer']
        : actor === 'specialist'
        ? ['specialist']
        : actor === 'jury'
        ? ['jury']
        : [];
      checked(
        (await admin.from('memberships').insert({
          user_id: id,
          session_id: journal.sessionIds[
            actor === 'isolated' || actor === 'otherAdmin' ? 1 : 0
          ],
          team_id: team === null ? null : journal.teamIds[team],
          roles,
          is_admin: actor === 'admin' || actor === 'otherAdmin',
        })).error,
        'assign fixture membership',
      );
      if (actor === 'revoked') {
        checked(
          (await admin.from('memberships').insert({
            user_id: id,
            session_id: journal.sessionIds[1],
            team_id: null,
            roles: ['volunteer'],
            is_admin: false,
          })).error,
          'assign cross-session fixture membership',
        );
      }
      let readyPassword = password;
      if (actor !== 'temporary') {
        const client = createClient(config.url, config.publicKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const backend = createSupabaseBackend(
          config.url,
          config.publicKey,
          client,
        );
        try {
          await backend.auth.signIn(username, password);
          readyPassword = crypto.randomUUID() + 'A9!';
          await backend.auth.changePassword(password, readyPassword);
        } finally {
          await client.auth.signOut({ scope: 'local' });
        }
      }
      accounts[actor] = { id, username, password: readyPassword };
    }
    for (const actor of actors) {
      if (!accounts[actor]) {
        throw new Error('Fixture account preparation is incomplete.');
      }
    }
    const data: ScenarioData = {
      sessionId: journal.sessionIds[0],
      otherSessionId: journal.sessionIds[1],
      teamId: journal.teamIds[0],
      accounts: accounts as Record<Actor, TestAccount>,
    };
    return { ...data, url: config.url, publicKey: config.publicKey };
  } catch (error) {
    try {
      await cleanupFixture(path);
    } catch {
      throw new Error(
        'Fixture setup and cleanup failed. Use the retained recovery journal.',
      );
    }
    throw error;
  }
}

/** Refuse a target or ownership mismatch before deleting any fixture data. */
export async function cleanupFixture(path: string): Promise<void> {
  const journal = journalSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  if (journal.project !== configuration().project) {
    throw new Error(
      'Recovery project does not match the selected test project.',
    );
  }
  const admin = service();
  const event = await admin.from('events').select('id,name').eq(
    'id',
    journal.eventId,
  ).maybeSingle();
  checked(event.error, 'validate recovery event');
  if (event.data && event.data.name !== `Provider contract ${journal.runId}`) {
    throw new Error('Recovery event does not belong to this run.');
  }
  const sessions = await admin.from('sessions').select('id,event_id').in(
    'id',
    journal.sessionIds,
  );
  checked(sessions.error, 'validate recovery sessions');
  if (sessions.data?.some((item) => item.event_id !== journal.eventId)) {
    throw new Error('Recovery session does not belong to this run.');
  }
  // Scan exact run metadata as well as recorded IDs. This recovers a createUser
  // response lost before its ID could be saved. It never matches username prefixes.
  const users = [];
  for (let page = 1;; page++) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 100 });
    checked(listed.error, 'find fixture accounts');
    users.push(
      ...listed.data.users.filter((user) =>
        user.user_metadata.provider_test_run === journal.runId
      ),
    );
    if (listed.data.users.length < 100) break;
  }
  for (const id of journal.accountIds) {
    const existing = await admin.auth.admin.getUserById(id);
    if (existing.error && existing.error.status !== 404) {
      checked(existing.error, 'validate recovery account');
    }
    if (
      existing.data.user &&
      existing.data.user.user_metadata.provider_test_run !== journal.runId
    ) {
      throw new Error('Recovery account does not belong to this run.');
    }
  }
  const attachments = await admin.from('attachments').select(
    'id,session_id,issue_id',
  ).in('session_id', journal.sessionIds);
  checked(attachments.error, 'find fixture image objects');
  const paths = (attachments.data ?? []).flatMap((image) =>
    ['original', 'thumbnail'].map((kind) =>
      `${image.session_id}/${image.issue_id}/${image.id}/${kind}`
    )
  );
  if (paths.length) {
    checked(
      (await admin.storage.from('issue-attachments').remove(paths)).error,
      'remove fixture image objects',
    );
  }
  for (
    const table of [
      'attachments',
      'admin_audit',
      'history',
      'awards',
      'resolutions',
      'issues',
      'changes',
      'staff_changes',
      'memberships',
      'teams',
    ]
  ) {
    checked(
      (await admin.from(table).delete().in('session_id', journal.sessionIds))
        .error,
      `remove fixture ${table}`,
    );
  }
  checked(
    (await admin.from('sessions').delete().in('id', journal.sessionIds)).error,
    'remove fixture sessions',
  );
  checked(
    (await admin.from('events').delete().eq('id', journal.eventId)).error,
    'remove fixture event',
  );
  for (const user of users) {
    checked(
      (await admin.from('people').delete().eq('id', user.id)).error,
      'remove fixture person',
    );
    checked(
      (await admin.auth.admin.deleteUser(user.id)).error,
      'remove fixture login',
    );
  }
  await unlink(path);
}
