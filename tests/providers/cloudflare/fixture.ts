import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { getPlatformProxy } from 'wrangler';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { D1Connection, D1Statement } from '../../../src/server/adapters/d1/connection';
import { attachmentPath } from '../../../src/connected/imageFile';
import type { EventCode, SignInTarget } from '../../../src/backend/contracts';
import { avatarKey } from '../../../src/server/adapters/cloudflare/avatars';
import { loginKeyFor } from '../../../src/server/adapters/cloudflare/credentials';
import { deleteFixtureRows, fenceFixtureEvent, forgetFixtureEvent } from '../../../src/server/adapters/cloudflare/eventDeletionFixture';
import { passwordHasher, randomSecret } from '../../../src/server/adapters/cloudflare/password';
import { createdAccountMarkers, type Actor, type ScenarioData, type TestAccount } from '../contracts';
import { confirmFixtureTarget, readFixtureTarget, type FixtureTarget } from './target.mjs';
import { readD1AuthFlags } from './diagnostics';

const actors = ['eventAdmin', 'admin', 'otherAdmin', 'contestant', 'otherTeam', 'volunteer', 'specialist', 'jury', 'isolated', 'temporary', 'revoked'] as const satisfies readonly Actor[];
const uuid = z.uuid();
const journalSchema = z.strictObject({
  version: z.literal(1), provider: z.literal('cloudflare'), runId: uuid, eventId: uuid,
  sessionIds: z.tuple([uuid, uuid]), teamIds: z.tuple([uuid, uuid, uuid]),
  accountIds: z.record(z.enum(actors), uuid),
  createdAccounts: z.array(z.strictObject({ name: z.string(), username: z.string(), id: uuid.optional() })).default([]),
  images: z.array(z.strictObject({ id: uuid, session_id: uuid, issue_id: uuid })).default([]),
  avatars: z.array(z.strictObject({ id: uuid, account_id: uuid })).default([]),
  target: z.strictObject({
    accountId: z.string(), databaseId: uuid, databaseName: z.string(), workerName: z.string(),
    bucketName: z.string(), origin: z.url(), configPath: z.string(),
  }),
}).refine((journal) => {
  const ids = [journal.runId, journal.eventId, ...journal.sessionIds, ...journal.teamIds, ...Object.values(journal.accountIds)];
  const markers = Object.values(createdAccountMarkers(journal.runId));
  const createdIds = journal.createdAccounts.flatMap((account) => account.id ? [account.id] : []);
  return new Set([...ids, ...createdIds]).size === ids.length + createdIds.length &&
    new Set(journal.createdAccounts.map((account) => account.username)).size === journal.createdAccounts.length &&
    journal.createdAccounts.every((account) => markers.some((marker) => marker.name === account.name && marker.username === account.username)) &&
    new Set(journal.images.map((image) => image.id)).size === journal.images.length &&
    journal.images.every((image) => journal.sessionIds.includes(image.session_id)) &&
    new Set(journal.avatars.map((avatar) => avatar.id)).size === journal.avatars.length &&
    journal.avatars.every((avatar) => Object.values(journal.accountIds).includes(avatar.account_id) || createdIds.includes(avatar.account_id));
});
type Journal = z.infer<typeof journalSchema>;
type Bind = string | number | null;

interface FixtureBucket {
  delete(keys: string[]): Promise<void>;
  head(key: string): Promise<unknown | null>;
}

interface Platform {
  env: { DB: D1Connection; IMAGES: FixtureBucket; MAINTENANCE: { fetch(input: string, init?: RequestInit): Promise<Response> } };
  dispose(): Promise<void>;
}

interface Dependencies {
  confirmTarget?(target: FixtureTarget): Promise<void>;
  openPlatform?(configPath: string): Promise<Platform>;
}

export interface CloudflareFixture extends ScenarioData { origin: string }

function statement(db: D1Connection, sql: string, ...values: Bind[]): D1Statement {
  return db.prepare(sql).bind(...values);
}

async function configuration(): Promise<FixtureTarget> {
  return readFixtureTarget({
    account: process.env.MINSKY_CF_TEST_ACCOUNT ?? '', database: process.env.MINSKY_CF_TEST_DATABASE ?? '',
    config: process.env.MINSKY_CF_TEST_CONFIG ?? '', origin: process.env.MINSKY_CF_TEST_ORIGIN ?? '',
  });
}

async function open(target: FixtureTarget, dependencies: Dependencies): Promise<Platform> {
  await (dependencies.confirmTarget ?? confirmFixtureTarget)(target);
  let platform: Platform | undefined;
  let directory: string | undefined;
  try {
    if (dependencies.openPlatform) platform = await dependencies.openPlatform(target.configPath);
    else {
      // Remote Durable Objects cannot be bound directly. The named internal
      // entrypoint is accessible only with this account-authorized service binding.
      directory = await mkdtemp(join(tmpdir(), 'minsky-fixture-bindings-'));
      const configPath = join(directory, 'wrangler.json');
      await writeFile(configPath, JSON.stringify({ name: `${target.workerName}-fixture-proxy`, account_id: target.accountId,
        compatibility_date: '2026-10-13', compatibility_flags: ['nodejs_compat'],
        d1_databases: [{ binding: 'DB', database_name: target.databaseName, database_id: target.databaseId, remote: true }],
        r2_buckets: [{ binding: 'IMAGES', bucket_name: target.bucketName, remote: true }],
        services: [{ binding: 'MAINTENANCE', service: target.workerName, entrypoint: 'SessionMaintenance', remote: true }],
      }), { mode: 0o600 });
      const remote = await getPlatformProxy<Platform['env']>({ configPath, remoteBindings: true, persist: false, envFiles: [] });
      const ownedDirectory = directory;
      platform = { env: remote.env, dispose: async () => {
        try { await remote.dispose(); } finally { await rm(ownedDirectory, { recursive: true, force: true }); }
      } };
    }
    const response = await platform.env.MAINTENANCE.fetch('https://maintenance.internal/capabilities');
    const result = response.ok ? await response.json() as { eventLiveErase?: number } : undefined;
    if (result?.eventLiveErase !== 1) throw new Error('Unsupported maintenance entrypoint.');
    return platform;
  } catch {
    if (platform) await platform.dispose().catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true });
    throw new Error('The authenticated fixture maintenance binding is unavailable. Deploy the current connector before fixture work.');
  }
}

/** Reject a stale schema before fixture records or a recovery journal are created. */
export async function checkFixtureSchema(db: D1Connection): Promise<void> {
  const expected = (await readdir(new URL('../../../src/server/adapters/d1/migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql'));
  let applied: string[];
  try {
    applied = (await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()).results.map((row) => row.name);
    // These columns and guards are required by the deployed full connector.
    await db.prepare(`SELECT a.credential_generation, a.credential_state, b.expiresAt,
      s.categories, s.max_image_bytes, i.reporter_name, x.request_command,
      x.original_digest, n.attempts FROM accounts a
      LEFT JOIN ba_session b ON b.userId = a.id LEFT JOIN sessions s ON 0
      LEFT JOIN issues i ON 0 LEFT JOIN issue_images x ON 0 LEFT JOIN notifications n ON 0 LIMIT 0`).all();
  } catch {
    throw new Error('The isolated connector database is missing the required application schema. No fixtures were created.');
  }
  if (expected.some((name) => !applied.includes(name))) {
    throw new Error('Apply every current connector migration before provider verification. No fixtures were created.');
  }
}

function name(journal: Journal, actor: Actor): string { return `Provider ${actor} ${journal.runId}`; }
function username(journal: Journal, actor: Actor): string { return `pc-${journal.runId.slice(0, 12)}-${actor.toLowerCase()}`; }
/** The run's event code. Each fixture account and each created account signs in with it. */
function eventCode(journal: Journal): EventCode { return `pc-${journal.runId}` as EventCode; }
const marks = (count: number) => Array<string>(count).fill('?').join(',');

/** All IDs exist in a private journal before the first atomic fixture write. */
export async function createFixture(path: string, dependencies: Dependencies = {}): Promise<CloudflareFixture> {
  const target = await configuration();
  const platform = await open(target, dependencies);
  let saved = false;
  try {
    await checkFixtureSchema(platform.env.DB);
    const accountIds = Object.fromEntries(actors.map((actor) => [actor, crypto.randomUUID()])) as Record<Actor, string>;
    const journal: Journal = {
      version: 1, provider: 'cloudflare', target, runId: crypto.randomUUID(), eventId: crypto.randomUUID(),
      sessionIds: [crypto.randomUUID(), crypto.randomUUID()],
      teamIds: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], accountIds, images: [], avatars: [], createdAccounts: [],
    };
    const createdAccounts = createdAccountMarkers(journal.runId);
    journal.createdAccounts = Object.values(createdAccounts);
    const signIn: SignInTarget = { kind: 'event', code: eventCode(journal) };
    const accounts = Object.fromEntries(actors.map((actor) => [actor, {
      id: accountIds[actor], target: signIn, username: username(journal, actor), password: randomSecret() + 'A9!',
    }])) as Record<Actor, TestAccount>;
    const hashes = new Map<Actor, string>();
    // Maintained production hashing stays outside D1. Passwords and hashes
    // remain in memory and never enter the recovery journal or provider output.
    for (const actor of actors) {
      hashes.set(actor, await passwordHasher.hash(accounts[actor].password));
    }
    await writeFile(path, JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
    saved = true;
    const db = platform.env.DB;
    const queries: D1Statement[] = [
      statement(db, 'INSERT INTO events (id, name, code) VALUES (?, ?, ?)', journal.eventId, `Provider contract ${journal.runId}`, eventCode(journal)),
      ...journal.sessionIds.map((id, index) => statement(db,
        'INSERT INTO sessions (id, event_id, name, intake_open) VALUES (?, ?, ?, 1)',
        id, journal.eventId, index === 0 ? 'Provider primary' : 'Provider isolation')),
      ...journal.teamIds.map((id, index) => statement(db,
        'INSERT INTO teams (id, session_id, name, location) VALUES (?, ?, ?, ?)',
        id, journal.sessionIds[index === 2 ? 1 : 0], `Provider team ${index}`, `Fixture desk ${index}`)),
    ];
    for (const actor of actors) {
      const account = accounts[actor];
      const sessionId = journal.sessionIds[actor === 'isolated' || actor === 'otherAdmin' ? 1 : 0];
      const team = actor === 'contestant' || actor === 'temporary' ? journal.teamIds[0]
        : actor === 'otherTeam' ? journal.teamIds[1] : actor === 'isolated' ? journal.teamIds[2] : null;
      const role = actor === 'volunteer' || actor === 'revoked' ? 'volunteer'
        : actor === 'specialist' ? 'specialist' : actor === 'jury' ? 'jury' : undefined;
      queries.push(
        statement(db, 'INSERT INTO accounts (id, name, username, handle, event_id, must_change) VALUES (?, ?, ?, ?, ?, ?)',
          account.id, name(journal, actor), account.username, account.username, journal.eventId, Number(actor === 'temporary')),
        statement(db, `INSERT INTO ba_user (id, name, email, username, emailVerified, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        account.id, name(journal, actor), `${account.username}@accounts.minsky.invalid`, account.username),
        statement(db, `INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
          VALUES (?, ?, 'credential', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        crypto.randomUUID(), account.id, account.id, hashes.get(actor)!),
        ...(actor === 'eventAdmin'
          // The event admin holds no seat. Its grant reaches every contest of the event.
          ? [statement(db, `INSERT INTO grants (account_id, scope, event_id, granted_by) VALUES (?, 'event', ?, 'fixture')`,
            account.id, journal.eventId)]
          : [statement(db, 'INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, ?, ?)',
            sessionId, account.id, team, Number(actor === 'admin' || actor === 'otherAdmin'))]),
      );
      if (role) queries.push(statement(db,
        'INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, ?)', sessionId, account.id, role));
      if (actor === 'revoked') queries.push(
        statement(db, 'INSERT INTO memberships (session_id, account_id) VALUES (?, ?)', journal.sessionIds[1], account.id),
        statement(db, "INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')", journal.sessionIds[1], account.id),
      );
    }
    // A team's default entrant has the team's ID. Linking the sign-in lets an event admin move the seat.
    for (const actor of actors) {
      const team = actor === 'contestant' || actor === 'temporary' ? journal.teamIds[0]
        : actor === 'otherTeam' ? journal.teamIds[1] : actor === 'isolated' ? journal.teamIds[2] : undefined;
      if (team) queries.push(statement(db, 'UPDATE accounts SET entrant_id = ? WHERE id = ?', team, accounts[actor].id));
    }
    await db.batch(queries);
    return { eventId: journal.eventId, sessionId: journal.sessionIds[0], otherSessionId: journal.sessionIds[1], teamId: journal.teamIds[0], accounts, createdAccounts, signIn, origin: target.origin };
  } catch {
    if (saved && existsSync(path)) {
      try {
        await cleanupOnPlatform(path, platform, target);
      } catch {
        throw new Error('Fixture setup and cleanup failed. Use the retained IDs-only Cloudflare recovery journal.');
      }
    }
    throw new Error('The isolated Cloudflare fixture could not be prepared. No credentials were logged.');
  } finally {
    await platform.dispose();
  }
}

async function readJournal(path: string, target: FixtureTarget): Promise<Journal> {
  const journal = journalSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  if (Object.entries(target).some(([key, value]) => journal.target[key as keyof FixtureTarget] !== value)) {
    throw new Error('Recovery target does not match the selected isolated Cloudflare configuration.');
  }
  return journal;
}

/** Read only the failed client's fixture account before browser logout or cleanup. */
export async function inspectFixtureAuthentication(path: string, accountId: string, dependencies: Dependencies = {}) {
  const target = await configuration();
  const journal = await readJournal(path, target);
  const actor = actors.find((candidate) => journal.accountIds[candidate] === accountId);
  if (!actor) throw new Error('The diagnostic account does not belong to this fixture.');
  const platform = await open(target, dependencies);
  try {
    const owned = await statement(platform.env.DB,
      'SELECT 1 AS owned FROM accounts WHERE id = ? AND name = ? AND username = ?',
      accountId, name(journal, actor), username(journal, actor)).first();
    if (!owned) throw new Error('The diagnostic account marker does not match this fixture.');
    return await readD1AuthFlags(platform.env.DB, accountId, new Set(Object.values(journal.accountIds)));
  } finally {
    await platform.dispose();
  }
}

interface OwnedImage { id: string; session_id: string; issue_id: string; original_path: string; thumbnail_path: string }
interface OwnedAvatar { id: string; account_id: string }

function ownedAccountIds(journal: Journal): string[] {
  return [...actors.map((actor) => journal.accountIds[actor]), ...journal.createdAccounts.flatMap((account) => account.id ? [account.id] : [])];
}

async function discoverCreatedAccounts(db: D1Connection, journal: Journal): Promise<void> {
  for (const marker of journal.createdAccounts) {
    // A created account types its marker as handle. Its login key comes from its ID.
    const rows = (await statement(db, 'SELECT id FROM accounts WHERE name = ? AND handle = ? AND event_id = ?',
      marker.name, marker.username, journal.eventId).all<{ id: string }>()).results;
    if (rows.length > 1 || rows.some((row) => !uuid.safeParse(row.id).success || marker.id && row.id !== marker.id || Object.values(journal.accountIds).includes(row.id))) {
      throw new Error('A created fixture account has an ambiguous ownership marker.');
    }
    // The fixture event holds the marker's name and handle once. Nothing else creates accounts there.
    if (!marker.id && rows[0]) marker.id = rows[0].id;
  }
}

async function validateOwnership(db: D1Connection, journal: Journal): Promise<OwnedImage[]> {
  const ids = ownedAccountIds(journal);
  const idSet = new Set(ids);
  const event = await statement(db, 'SELECT name FROM events WHERE id = ?', journal.eventId).first<{ name: string }>();
  if (event && event.name !== `Provider contract ${journal.runId}`) throw new Error('Recovery event does not belong to this run.');
  const sessions = (await statement(db, 'SELECT id, event_id FROM sessions WHERE id IN (?, ?) OR event_id = ?',
    ...journal.sessionIds, journal.eventId).all<{ id: string; event_id: string }>()).results;
  if (sessions.some((row) => row.event_id !== journal.eventId || !journal.sessionIds.includes(row.id))) {
    throw new Error('Recovery session does not belong to this run.');
  }
  const teams = (await statement(db, 'SELECT id, session_id FROM teams WHERE id IN (?, ?, ?) OR session_id IN (?, ?)',
    ...journal.teamIds, ...journal.sessionIds).all<{ id: string; session_id: string }>()).results;
  // An entrant that a scenario created has an entry (a teams row) with its own ID, in a fixture contest.
  if (teams.some((row) => !journal.sessionIds.includes(row.session_id) ||
      journal.teamIds.includes(row.id) && row.session_id !== journal.sessionIds[journal.teamIds.indexOf(row.id) === 2 ? 1 : 0])) {
    throw new Error('Recovery team does not belong to this run.');
  }
  const accounts = (await statement(db, `SELECT id, name, username, handle FROM accounts WHERE id IN (${marks(ids.length)})`, ...ids)
    .all<{ id: string; name: string; username: string; handle: string | null }>()).results;
  for (const row of accounts) {
    const actor = actors.find((actor) => journal.accountIds[actor] === row.id);
    const marker = journal.createdAccounts.find((account) => account.id === row.id);
    const handle = actor ? username(journal, actor) : marker?.username;
    if (row.name !== (actor ? name(journal, actor) : marker?.name) || row.handle !== handle ||
        row.username !== (actor ? handle : loginKeyFor(row.id))) throw new Error('Recovery account does not belong to this run.');
  }
  const identities = (await statement(db, `SELECT id, name, username, email FROM ba_user WHERE id IN (${marks(ids.length)})`, ...ids)
    .all<{ id: string; name: string; username: string; email: string }>()).results;
  for (const row of identities) {
    const actor = actors.find((actor) => journal.accountIds[actor] === row.id);
    const marker = journal.createdAccounts.find((account) => account.id === row.id);
    if (row.name !== (actor ? name(journal, actor) : marker?.name) || row.username !== (actor ? username(journal, actor) : loginKeyFor(row.id)) || row.email !== `${row.username}@accounts.minsky.invalid`) {
      throw new Error('Recovery identity does not belong to this run.');
    }
  }
  const memberships = (await statement(db, `SELECT session_id, account_id FROM memberships
    WHERE session_id IN (?, ?) OR account_id IN (${marks(ids.length)})`, ...journal.sessionIds, ...ids)
    .all<{ session_id: string; account_id: string }>()).results;
  if (memberships.some((row) => !journal.sessionIds.includes(row.session_id) || !idSet.has(row.account_id))) {
    throw new Error('A recovery membership crosses this fixture boundary.');
  }
  const operations = (await statement(db, `SELECT account_id, actor, session_id FROM account_operations
    WHERE account_id IN (${marks(ids.length)}) OR actor IN (${marks(ids.length)})`, ...ids, ...ids)
    .all<{ account_id: string; actor: string; session_id: string | null }>()).results;
  if (operations.some((row) => !idSet.has(row.account_id) || !idSet.has(row.actor) || row.session_id !== null && !journal.sessionIds.includes(row.session_id))) {
    throw new Error('A recovery credential operation crosses this fixture boundary.');
  }
  const images = (await statement(db, 'SELECT id, session_id, issue_id, uploader, original_path, thumbnail_path FROM issue_images WHERE session_id IN (?, ?)',
    ...journal.sessionIds).all<{ id: string; session_id: string; issue_id: string; uploader: string; original_path: string; thumbnail_path: string }>()).results;
  for (const image of images) {
    const recorded = journal.images.find((entry) => entry.id === image.id);
    if (!idSet.has(image.uploader) || !uuid.safeParse(image.id).success || !uuid.safeParse(image.issue_id).success ||
        recorded && (recorded.session_id !== image.session_id || recorded.issue_id !== image.issue_id) ||
        image.original_path !== attachmentPath(image.session_id, image.issue_id, image.id, 'original') ||
        image.thumbnail_path !== attachmentPath(image.session_id, image.issue_id, image.id, 'thumbnail')) {
      throw new Error('Recovery image keys do not belong to this run.');
    }
  }
  const owned = new Map(images.map((image) => [image.id, image]));
  for (const image of journal.images) {
    if (!owned.has(image.id)) owned.set(image.id, { ...image, uploader: '',
      original_path: attachmentPath(image.session_id, image.issue_id, image.id, 'original'),
      thumbnail_path: attachmentPath(image.session_id, image.issue_id, image.id, 'thumbnail') });
  }
  return [...owned.values()];
}

/** Avatar rows belong to accounts. Every state can have a stored file, so all rows count. */
async function ownedAvatars(db: D1Connection, journal: Journal): Promise<OwnedAvatar[]> {
  const ids = ownedAccountIds(journal);
  const rows = (await statement(db, `SELECT id, account_id FROM account_avatars WHERE account_id IN (${marks(ids.length)})`, ...ids)
    .all<OwnedAvatar>()).results;
  const owned = new Map([...journal.avatars, ...rows].map((avatar) => [avatar.id, { id: avatar.id, account_id: avatar.account_id }]));
  return [...owned.values()];
}

async function eraseLiveState(platform: Platform, journal: Journal): Promise<void> {
  const response = await platform.env.MAINTENANCE.fetch('https://maintenance.internal/sessions', {
    method: 'POST', body: JSON.stringify({ eventId: journal.eventId }),
  });
  const result = response.ok ? await response.json() as { verified?: boolean } : undefined;
  if (result?.verified !== true) throw new Error('Fixture Durable Object cleanup is unverified. Retain the recovery journal.');
}

async function cleanupOnPlatform(path: string, platform: Platform, target: FixtureTarget): Promise<void> {
  const journal = await readJournal(path, target);
  const db = platform.env.DB;
  await discoverCreatedAccounts(db, journal);
  await validateOwnership(db, journal);
  // Retain discovered UUIDs before any deletion, including a lost create response.
  const discoveredPath = `${path}.${crypto.randomUUID()}.next`;
  await writeFile(discoveredPath, JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
  await rename(discoveredPath, path);
  const ids = ownedAccountIds(journal);
  // Fence new commands and reservations before collecting the final object IDs.
  // These UUID-owned accounts have no membership outside the validated fixture.
  await fenceFixtureEvent(db, journal.eventId);
  const images = await validateOwnership(db, journal);
  journal.images = images.map(({ id, session_id, issue_id }) => ({ id, session_id, issue_id }));
  const avatars = await ownedAvatars(db, journal);
  journal.avatars = avatars;
  // Keep exact object identities before removing their database metadata. A
  // lost cleanup response can then recover objects after a committed DB batch.
  const nextPath = `${path}.${crypto.randomUUID()}.next`;
  await writeFile(nextPath, JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
  await rename(nextPath, path);
  const keys = [...images.flatMap((image) => [image.original_path, image.thumbnail_path]),
    ...avatars.map((avatar) => avatarKey(avatar.account_id, avatar.id))];
  // No list or prefix deletion can reach another fixture's objects.
  for (let index = 0; index < keys.length; index += 1000) await platform.env.IMAGES.delete(keys.slice(index, index + 1000));
  for (const key of keys) if (await platform.env.IMAGES.head(key)) throw new Error('Fixture image cleanup is incomplete.');
  const rateKeys = [...actors.map((actor) => `handle:${journal.eventId}:${username(journal, actor)}`),
    ...journal.createdAccounts.filter((account) => account.id).map((account) => `handle:${journal.eventId}:${account.username}`), ...ids.map((id) => `change:${id}`)];
  await deleteFixtureRows(db, journal.eventId);
  const checks: D1Statement[] = [
    statement(db, 'SELECT count(*) AS count FROM events WHERE id = ?', journal.eventId),
    statement(db, 'SELECT count(*) AS count FROM sessions WHERE id IN (?, ?)', ...journal.sessionIds),
    statement(db, 'SELECT count(*) AS count FROM entrants WHERE event_id = ?', journal.eventId),
    statement(db, `SELECT count(*) AS count FROM authority_audit WHERE event_id = ? OR actor IN (${marks(ids.length)})`, journal.eventId, ...ids),
    ...['teams', 'issues', 'resolutions', 'awards', 'memberships', 'membership_roles', 'admin_audit', 'command_receipts', 'audience_sequences', 'notifications', 'session_issue_sequences', 'issue_images']
      .map((table) => statement(db, `SELECT count(*) AS count FROM ${table} WHERE session_id IN (?, ?)`, ...journal.sessionIds)),
    ...['accounts', 'ba_user'].map((table) => statement(db, `SELECT count(*) AS count FROM ${table} WHERE id IN (${marks(ids.length)})`, ...ids)),
    ...['logins', 'account_avatars'].map((table) => statement(db, `SELECT count(*) AS count FROM ${table} WHERE account_id IN (${marks(ids.length)})`, ...ids)),
    ...['ba_session', 'ba_account'].map((table) => statement(db, `SELECT count(*) AS count FROM ${table} WHERE userId IN (${marks(ids.length)})`, ...ids)),
    statement(db, `SELECT count(*) AS count FROM account_operations WHERE account_id IN (${marks(ids.length)}) OR actor IN (${marks(ids.length)})`, ...ids, ...ids),
    statement(db, `SELECT count(*) AS count FROM authentication_limits WHERE key IN (${marks(rateKeys.length)})`, ...rateKeys),
    statement(db, `SELECT count(*) AS count FROM history WHERE actor IN (${marks(ids.length)})`, ...ids),
    statement(db, `SELECT count(*) AS count FROM image_deletions WHERE attachment_id IN (${marks(images.length || 1)})`, ...(images.length ? images.map((image) => image.id) : [''])),
  ];
  const results = await db.batch(checks) as Array<{ results: Array<{ count: number }> }>;
  if (results.some((result) => result.results[0]?.count !== 0)) throw new Error('Fixture records remain after cleanup. Retain the recovery journal.');
  // Browser clients have closed before fixture cleanup. Repeat exact deletes
  // after DB commit to remove a transfer that finished during the first pass.
  for (let index = 0; index < keys.length; index += 1000) await platform.env.IMAGES.delete(keys.slice(index, index + 1000));
  for (const key of keys) if (await platform.env.IMAGES.head(key)) throw new Error('Fixture image cleanup is incomplete.');
  // Each object rechecks the journal and the contest's absence, clears its
  // cursors, attachments, and alarm, and proves its storage empty.
  await eraseLiveState(platform, journal);
  await forgetFixtureEvent(db, journal.eventId);
  // Shared IP rate counters belong to the hosted service, not to this UUID run.
  await unlink(path);
}

/** Validate exact target and every ownership marker before deleting any record. */
export async function cleanupFixture(path: string, dependencies: Dependencies = {}): Promise<void> {
  const target = await configuration();
  await readJournal(path, target);
  const platform = await open(target, dependencies);
  try { await cleanupOnPlatform(path, platform, target); }
  finally { await platform.dispose(); }
}
