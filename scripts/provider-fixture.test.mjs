import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  cleanupFixture,
  createFixture,
} from '../tests/providers/supabase/fixture';
import { createdAccountMarkers } from '../tests/providers/contracts';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

let directory;
let path;
let journal;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'minsky-provider-unit-'));
  path = join(directory, 'recovery.json');
  journal = {
    version: 1,
    provider: 'supabase',
    project: 'ghtztmovdkhuketcbjmq',
    runId: randomUUID(),
    eventId: randomUUID(),
    sessionIds: [randomUUID(), randomUUID()],
    teamIds: [randomUUID(), randomUUID(), randomUUID()],
    accountIds: [],
    createdAccounts: [],
  };
  vi.stubEnv('MINSKY_TEST_PROJECT_REF', journal.project);
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-public');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-private');
  vi.mocked(createClient).mockReset();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

/** A narrow control-plane double. It does not implement Backend behavior. */
function controlPlane(
  { event, sessions = [], users = [], memberships = [], people = [], failDelete = false } = {},
) {
  const deletions = [];
  const client = {
    from: vi.fn((table) => ({
      insert: vi.fn(async () => ({
        error: new Error('Fixture creation failed.'),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: async () => ({ data: event ?? null, error: null }),
        })),
        in: vi.fn(async () => ({
          data: table === 'sessions' ? sessions : table === 'memberships' ? memberships : table === 'people' ? people : [],
          error: null,
        })),
      })),
      delete: vi.fn(() => ({
        in: vi.fn(async (_column, ids) => {
          deletions.push({ table, ids });
          return { error: failDelete ? new Error('Deletion failed.') : null };
        }),
        eq: vi.fn(async (_column, id) => {
          deletions.push({ table, ids: [id] });
          return { error: null };
        }),
      })),
    })),
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({ data: { users }, error: null })),
        getUserById: vi.fn(async (id) => ({
          data: { user: users.find((user) => user.id === id) ?? null },
          error: null,
        })),
        deleteUser: vi.fn(async (id) => {
          deletions.push({ table: 'auth.users', ids: [id] });
          return { error: null };
        }),
      },
    },
  };
  vi.mocked(createClient).mockReturnValue(client);
  return { client, deletions };
}

describe('provider fixture recovery boundaries', () => {
  test('rejects a target mismatch before opening a privileged client', async () => {
    await writeFile(
      path,
      JSON.stringify({ ...journal, project: 'aaaaaaaaaaaaaaaaaaaa' }),
    );
    await expect(cleanupFixture(path)).rejects.toThrow(
      'Recovery project does not match',
    );
    expect(createClient).not.toHaveBeenCalled();
    expect(existsSync(path)).toBe(true);
  });

  test('rejects malformed or credential-bearing journals before any provider request', async () => {
    for (
      const invalid of [{ ...journal, sessionIds: ['not-a-uuid'] }, {
        ...journal,
        password: 'must-not-be-saved',
      }]
    ) {
      await writeFile(path, JSON.stringify(invalid));
      await expect(cleanupFixture(path)).rejects.toThrow();
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  test('refuses event and session ownership mismatches before deletion', async () => {
    await writeFile(path, JSON.stringify(journal));
    const wrongEvent = controlPlane({
      event: { id: journal.eventId, name: 'Unrelated event' },
    });
    await expect(cleanupFixture(path)).rejects.toThrow(
      'Recovery event does not belong',
    );
    expect(wrongEvent.deletions).toEqual([]);
    const wrongSession = controlPlane({
      sessions: [{ id: journal.sessionIds[0], event_id: randomUUID() }],
    });
    await expect(cleanupFixture(path)).rejects.toThrow(
      'Recovery session does not belong',
    );
    expect(wrongSession.deletions).toEqual([]);
  });

  test('refuses development before setup or recovery opens a client', async () => {
    await writeFile(path, JSON.stringify(journal));
    vi.stubEnv('MINSKY_TEST_PROJECT_REF', 'ovymmobupzowotvrywek');
    await expect(createFixture(path)).rejects.toThrow(
      'Development is forbidden',
    );
    await expect(cleanupFixture(path)).rejects.toThrow(
      'Development is forbidden',
    );
    expect(createClient).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(journal);
  });

  test('refuses a recorded account from another run before any deletion', async () => {
    const foreign = {
      id: randomUUID(),
      user_metadata: { provider_test_run: randomUUID() },
    };
    journal.accountIds.push(foreign.id);
    await writeFile(path, JSON.stringify(journal));
    const { deletions } = controlPlane({ users: [foreign] });
    await expect(cleanupFixture(path)).rejects.toThrow(
      'Recovery account does not belong',
    );
    expect(deletions).toEqual([]);
    expect(existsSync(path)).toBe(true);
  });

  test('recovers a lost account-creation response by exact run metadata only', async () => {
    const prefix = `pc-${journal.runId.slice(0, 12)}`;
    const owned = {
      id: randomUUID(),
      email: `${prefix}-admin@accounts.minsky.invalid`,
      user_metadata: { provider_test_run: journal.runId },
    };
    const foreign = {
      id: randomUUID(),
      email: `${prefix}-volunteer@accounts.minsky.invalid`,
      user_metadata: { provider_test_run: randomUUID() },
    };
    await writeFile(path, JSON.stringify(journal));
    const { deletions } = controlPlane({ users: [owned, foreign] });
    await cleanupFixture(path);
    const accountDeletes = deletions.filter((deletion) =>
      ['people', 'auth.users'].includes(deletion.table)
    );
    expect(accountDeletes).toEqual([
      { table: 'people', ids: [owned.id] },
      { table: 'auth.users', ids: [owned.id] },
    ]);
    expect(JSON.stringify(deletions)).not.toContain(foreign.id);
    expect(existsSync(path)).toBe(false);
  });

  test('retains the journal when cleanup fails', async () => {
    await writeFile(path, JSON.stringify(journal));
    controlPlane({ failDelete: true });
    await expect(cleanupFixture(path)).rejects.toThrow(
      'remove fixture attachments',
    );
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(journal);
  });

  test('retains exact account UUIDs before cleanup after a lost application create response', async () => {
    const marker = createdAccountMarkers(journal.runId).staff;
    journal.createdAccounts = [marker];
    const owned = { id: randomUUID(), email: `${marker.username}@accounts.minsky.invalid`, user_metadata: { name: marker.name } };
    const foreign = { id: randomUUID(), email: `${marker.username}-foreign@accounts.minsky.invalid`, user_metadata: { name: marker.name } };
    await writeFile(path, JSON.stringify(journal));
    const setup = { users: [owned, foreign], memberships: [{ user_id: owned.id, session_id: journal.sessionIds[0] }],
      people: [{ id: owned.id, name: marker.name, username: marker.username }] };
    const failed = controlPlane({ ...setup, failDelete: true });
    await expect(cleanupFixture(path)).rejects.toThrow('remove fixture attachments');
    const saved = JSON.parse(await readFile(path, 'utf8'));
    expect(saved.accountIds).toEqual([owned.id]);
    expect(saved.createdAccounts).toEqual([{ ...marker, id: owned.id }]);
    expect(JSON.stringify(saved)).not.toContain('test-private');
    expect(failed.deletions).toHaveLength(1);
    const recovered = controlPlane(setup);
    await cleanupFixture(path);
    expect(recovered.deletions.filter(({ table }) => ['people', 'auth.users'].includes(table))).toEqual([
      { table: 'people', ids: [owned.id] }, { table: 'auth.users', ids: [owned.id] },
    ]);
    expect(JSON.stringify(recovered.deletions)).not.toContain(foreign.id);
    expect(existsSync(path)).toBe(false);
  });

  test('refuses a created account with foreign membership or a changed person marker before deletion', async () => {
    const marker = createdAccountMarkers(journal.runId).contestant;
    journal.createdAccounts = [marker];
    const user = { id: randomUUID(), email: `${marker.username}@accounts.minsky.invalid`, user_metadata: { name: marker.name } };
    await writeFile(path, JSON.stringify(journal));
    const foreign = controlPlane({ users: [user], memberships: [{ user_id: user.id, session_id: randomUUID() }] });
    await expect(cleanupFixture(path)).rejects.toThrow('crosses this fixture boundary');
    expect(foreign.deletions).toEqual([]);
    const changed = controlPlane({ users: [user], people: [{ id: user.id, name: 'Unrelated person', username: marker.username }] });
    await expect(cleanupFixture(path)).rejects.toThrow('exact fixture marker');
    expect(changed.deletions).toEqual([]);
    expect(existsSync(path)).toBe(true);
  });

  test('attempts scoped cleanup after partial setup fails and saves no credentials', async () => {
    const { deletions } = controlPlane({ failDelete: true });
    await expect(createFixture(path)).rejects.toThrow(
      'Fixture setup and cleanup failed',
    );
    const recovery = JSON.parse(await readFile(path, 'utf8'));
    expect(Object.keys(recovery).sort()).toEqual(Object.keys(journal).sort());
    expect(recovery.accountIds).toEqual([]);
    expect(deletions).toEqual([{
      table: 'attachments',
      ids: recovery.sessionIds,
    }]);
    const contents = JSON.stringify(recovery);
    expect(contents).not.toContain(process.env.SUPABASE_SERVICE_ROLE_KEY);
    expect(contents).not.toContain(process.env.SUPABASE_ANON_KEY);
  });

  test('deletes only recorded session and event IDs and then removes the journal', async () => {
    await writeFile(path, JSON.stringify(journal));
    const { deletions } = controlPlane();
    await cleanupFixture(path);
    expect(existsSync(path)).toBe(false);
    for (const deletion of deletions) {
      expect(deletion.ids).toEqual(
        deletion.table === 'events' ? [journal.eventId] : journal.sessionIds,
      );
    }
  });
});
