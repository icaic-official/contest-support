import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { expect, it } from 'vitest';
import { getPlatformProxy, unstable_dev } from 'wrangler';
import { snapshotSchema, type Command, type Snapshot } from '../../src/connected/model';
import type { D1Connection } from '../../src/server/adapters/d1/connection';
import { applyMigrations } from '../../src/server/adapters/d1/testFixture';
import { bootstrapInstallation } from '../../src/server/adapters/cloudflare/installation';
import { randomSecret } from '../../src/server/adapters/cloudflare/password';
import { avatarKey } from '../../src/server/adapters/cloudflare/avatars';
import type { AccountCommand, PersonAvatar, StartedImage } from '../../src/backend/contracts';

const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7t0AAAAASUVORK5CYII=', 'base64');

interface LocalBucket {
  list(options: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }>;
  delete(keys: string[]): Promise<void>;
  put(key: string, bytes: Uint8Array): Promise<unknown>;
}
interface Actor {
  context: BrowserContext;
  page: Page;
  id: string;
  username: string;
  csrf: string;
}
interface SocketState { messages: Array<{ type: string }>; closed: boolean }
interface RuntimeWindow extends Window {
  fixtureSockets?: Record<string, { socket: WebSocket; state: SocketState }>;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The local test port could not be selected.');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

/** All credentials stay in memory. Assertion errors identify endpoints and status only. */
it('runs the complete application through isolated HTTPS, D1, R2, and Durable Objects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'minsky-connector-runtime-'));
  const storage = join(directory, 'storage');
  const assets = join(directory, 'assets');
  const configPath = join(directory, 'wrangler.json');
  const proxyPath = join(directory, 'proxy.json');
  const port = await unusedPort();
  const origin = `https://127.0.0.1:${port}`;
  const unique = randomUUID().replaceAll('-', '').slice(0, 16);
  const usernames: string[] = [`rt_${unique}_admin`];
  const legacyId = randomUUID();
  const accountIds: string[] = [legacyId];
  const accountContexts: BrowserContext[] = [];
  const sentinel = { account: randomUUID(), event: randomUUID(), name: `control:${unique}` };
  const sentinelLimit = `ip:${createHash('sha256').update(sentinel.name).digest('hex')}`;
  const authenticationSecret = randomSecret();
  const fixtureIpKeys = ['198.51.100.17', '127.0.0.1', '::1'].map((ip) =>
    `ip:${createHash('sha256').update(`${authenticationSecret}:${ip}`).digest('hex')}`);
  let browser: Browser | undefined;
  let worker: Awaited<ReturnType<typeof unstable_dev>> | undefined;
  let installation: Awaited<ReturnType<typeof bootstrapInstallation>> | undefined;
  let cleanupVerified = false;
  let scenarioCompleted = false;

  async function proxy() {
    return getPlatformProxy<{ DB: D1Connection; IMAGES: LocalBucket }>({
      configPath: proxyPath, persist: { path: join(storage, 'v3') }, remoteBindings: false, envFiles: [],
    });
  }

  async function network(context: BrowserContext, path: string, options?: Parameters<BrowserContext['request']['fetch']>[1]) {
    try { return await context.request.fetch(origin + path, options); }
    catch { throw new Error(`${path.split('?')[0]} could not reach the local HTTPS fixture.`); }
  }

  async function json<T>(actor: Pick<Actor, 'context' | 'csrf'>, path: string, body?: unknown, expected = 200): Promise<T> {
    const response = await network(actor.context, path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, 'X-Minsky-Request': '1', 'X-CSRF-Token': actor.csrf,
        'CF-Connecting-IP': '198.51.100.17', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { data: JSON.stringify(body) }),
    });
    if (response.status() !== expected) throw new Error(`${path.split('?')[0]} returned ${response.status()}, expected ${expected}.`);
    // Do not attach provider response bodies to assertion errors: an account
    // response can contain the temporary credential used by the next request.
    try { return await response.json() as T; }
    catch { throw new Error(`${path.split('?')[0]} did not return JSON.`); }
  }

  async function session(actor: Actor) {
    const current = await json<{ user: { id: string }; status: { must_change: boolean }; csrf: string }>(actor, '/api/auth/session');
    actor.csrf = current.csrf;
    actor.id = current.user.id;
    return current;
  }

  async function authenticated(username: string, temporaryPassword: string): Promise<Actor> {
    if (!browser) throw new Error('The local browser did not start.');
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    accountContexts.push(context);
    const page = await context.newPage();
    const actor: Actor = { context, page, id: '', username, csrf: '' };
    await json(actor, '/api/auth/sign-in', { username, password: temporaryPassword });
    const before = await session(actor);
    expect(before.status.must_change).toBe(true);
    await json(actor, '/api/sessions', undefined, 403);
    await json(actor, '/api/auth/change-password', { currentPassword: temporaryPassword, newPassword: randomSecret() + 'A9!' });
    expect((await session(actor)).status.must_change).toBe(false);
    await page.goto(origin);
    return actor;
  }

  async function snapshot(actor: Actor): Promise<Snapshot> {
    return snapshotSchema.parse(await json(actor, `/api/snapshot?sessionId=${installation!.sessionId}`));
  }

  async function admin(actor: Actor, command: Record<string, unknown>) {
    await json(actor, '/api/admin', { ...command, sessionId: installation!.sessionId });
  }

  async function workflow(actor: Actor, command: Command, requestId = randomUUID()): Promise<string> {
    const result = await json<{ outcome: string; issueId: string }>(actor, '/api/workflow', { sessionId: installation!.sessionId, requestId, command });
    expect(result.outcome).toBe('committed');
    return result.issueId;
  }

  async function createAccount(adminActor: Actor, suffix: string, command: Omit<Extract<AccountCommand, { action: 'create_account' }>, 'action' | 'username' | 'name'>): Promise<Actor> {
    const username = `rt_${unique}_${suffix}`;
    usernames.push(username);
    const result = await json<{ temporaryPassword?: string }>(adminActor, '/api/accounts', { sessionId: installation!.sessionId,
      command: { action: 'create_account', username, name: `Fictional ${suffix}`, ...command } });
    if (typeof result.temporaryPassword !== 'string') throw new Error('Account creation did not return its temporary credential.');
    const actor = await authenticated(username, result.temporaryPassword);
    accountIds.push(actor.id);
    return actor;
  }

  async function connect(actor: Actor, key: string) {
    await actor.page.evaluate(({ sessionId, key }) => {
      const target = window as RuntimeWindow;
      target.fixtureSockets ??= {};
      const url = new URL('/api/updates', location.origin);
      url.protocol = 'wss:';
      url.searchParams.set('sessionId', sessionId);
      const socket = new WebSocket(url);
      const state: SocketState = { messages: [], closed: false };
      target.fixtureSockets[key] = { socket, state };
      socket.onmessage = (event) => { state.messages.push(JSON.parse(event.data)); };
      socket.onclose = () => { state.closed = true; };
      socket.onerror = () => { state.closed = true; };
    }, { sessionId: installation!.sessionId, key });
    await expect.poll(async () => socketState(actor, key), { timeout: 15_000 }).toMatchObject({ messages: [{ type: 'ready' }], closed: false });
  }

  async function socketState(actor: Actor, key: string): Promise<SocketState> {
    return actor.page.evaluate((key) => (window as RuntimeWindow).fixtureSockets![key]!.state, key);
  }

  async function flush() {
    // Wrangler exposes this route only in the local test server. It invokes the
    // real production scheduled handler; no product fixture route is installed.
    const context = accountContexts[0]!;
    const response = await network(context, '/__scheduled');
    if (!response.ok()) throw new Error(`Local scheduled recovery returned ${response.status()}.`);
  }

  async function transfer(actor: Actor, path: string) {
    const digest = createHash('sha256').update(imageBytes).digest('hex');
    const response = await network(actor.context, `/api/image/${path}`, { method: 'PUT', data: imageBytes,
      headers: { Origin: origin, 'X-Minsky-Request': '1', 'X-CSRF-Token': actor.csrf,
        'Content-Type': 'image/png', 'Content-Length': String(imageBytes.length), 'X-Minsky-Digest': digest } });
    if (response.status() !== 200) throw new Error(`Image transfer returned ${response.status()}.`);
  }

  async function avatar(actor: Actor): Promise<PersonAvatar> {
    const digest = createHash('sha256').update(imageBytes).digest('hex');
    const response = await network(actor.context, `/api/avatar/${randomUUID()}`, { method: 'PUT', data: imageBytes,
      headers: { Origin: origin, 'X-Minsky-Request': '1', 'X-CSRF-Token': actor.csrf,
        'Content-Type': 'image/png', 'Content-Length': String(imageBytes.length), 'X-Minsky-Digest': digest } });
    if (response.status() !== 200) throw new Error(`Avatar upload returned ${response.status()}.`);
    return await response.json() as PersonAvatar;
  }

  async function avatars(actor: Actor): Promise<PersonAvatar[]> {
    return json<PersonAvatar[]>(actor, `/api/avatars?sessionId=${installation!.sessionId}`);
  }

  async function image(actor: Actor, issueId: string, visibility: 'public' | 'internal'): Promise<StartedImage> {
    const begin = { action: 'begin', sessionId: installation!.sessionId,
      requestId: randomUUID(), issueId, visibility, name: `fictional-${visibility}.png`, bytes: imageBytes.length };
    const started = await json<StartedImage>(actor, '/api/images', begin);
    expect(await json<StartedImage>(actor, '/api/images', begin)).toEqual(started);
    for (const path of [started.original_path, started.thumbnail_path]) await transfer(actor, path);
    const finish = { action: 'finish', sessionId: installation!.sessionId, attachmentId: started.id };
    await json(actor, '/api/images', finish);
    await json(actor, '/api/images', finish);
    return started;
  }

  try {
    await mkdir(assets);
    await writeFile(join(assets, 'index.html'), '<!doctype html><title>Isolated connector runtime</title><p>Fictional local fixture.</p>');
    const bindings = {
      name: 'minsky-connector-runtime-local-only',
      main: resolve('src/server/adapters/cloudflare/applicationWorker.ts'),
      compatibility_date: '2026-10-13', compatibility_flags: ['nodejs_compat'],
      d1_databases: [{ binding: 'DB', database_name: 'minsky-connector-runtime-local-only', database_id: randomUUID() }],
      r2_buckets: [{ binding: 'IMAGES', bucket_name: 'minsky-connector-runtime-local-only' }],
    };
    await writeFile(proxyPath, JSON.stringify(bindings));
    await writeFile(configPath, JSON.stringify({ ...bindings,
      assets: { directory: assets, binding: 'ASSETS', run_worker_first: true },
      durable_objects: { bindings: [{ name: 'LIVE_UPDATES', class_name: 'SessionLiveCoordinator' }] },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['SessionLiveCoordinator'] }],
    }));
    const setup = await proxy();
    try {
      await applyMigrations(setup.env.DB);
      installation = await bootstrapInstallation(setup.env.DB, { adminUsername: usernames[0], adminName: 'Fictional organizer',
        eventName: `runtime:${unique}`, sessionName: 'Fictional contest', categories: ['Devices', 'Other'],
        teams: [{ name: 'Fictional Alpha', location: 'Desk A' }, { name: 'Fictional Beta', location: 'Desk B' }] });
      accountIds.push(installation.accountId);
      await setup.env.DB.batch([
        setup.env.DB.prepare('INSERT INTO events (id, name) VALUES (?, ?)').bind(sentinel.event, sentinel.name),
        setup.env.DB.prepare('INSERT INTO accounts (id, name) VALUES (?, ?)').bind(sentinel.account, sentinel.name),
        setup.env.DB.prepare('INSERT INTO authentication_limits (key, window_start, attempts) VALUES (?, unixepoch(), 1)').bind(sentinelLimit),
        setup.env.DB.prepare('INSERT INTO accounts (id, name) VALUES (?, ?)').bind(legacyId, `Fictional unconfigured ${unique}`),
        setup.env.DB.prepare('INSERT INTO memberships (session_id, account_id) VALUES (?, ?)').bind(installation.sessionId, legacyId),
        setup.env.DB.prepare("INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')").bind(installation.sessionId, legacyId),
      ]);
      await setup.env.IMAGES.put(sentinel.name, Uint8Array.from([1, 2, 3]));
    } finally { await setup.dispose(); }
    worker = await unstable_dev(bindings.main, {
      config: configPath, persistTo: storage, local: true, localProtocol: 'https', port,
      vars: { AUTH_ORIGIN: origin, AUTH_SECRET: authenticationSecret }, envFiles: [], logLevel: 'error',
      experimental: { disableExperimentalWarning: true, testScheduled: true },
    });
    browser = await chromium.launch({ headless: true });
    const organizer = await authenticated(installation.adminUsername, installation.temporaryPassword);
    await admin(organizer, { action: 'save_member', userId: organizer.id, member: { teamId: null, roles: ['volunteer', 'jury'], isAdmin: true } });
    await admin(organizer, { action: 'set_intake', open: true });
    await admin(organizer, { action: 'set_image_limits', limits: { fileMegabytes: 1, count: 3, totalMegabytes: 3 } });
    const specialist = await createAccount(organizer, 'specialist', { teamId: null, roles: ['specialist'], isAdmin: false });
    const contestant = await createAccount(organizer, 'team', { teamId: installation.teamIds[0]!, roles: [], isAdmin: false });
    const other = await createAccount(organizer, 'other', { teamId: installation.teamIds[1]!, roles: [], isAdmin: false });
    const assignedUsername = `rt_${unique}_assigned`;
    usernames.push(assignedUsername);
    await json(organizer, '/api/accounts', { sessionId: installation.sessionId,
      command: { action: 'set_username', userId: legacyId, username: assignedUsername } });
    expect((await snapshot(organizer)).members.find((member) => member.person.id === legacyId)?.person.username).toBe(assignedUsername);
    const sessions = await json<Array<{ id: string; name: string }>>(contestant, '/api/sessions');
    expect(sessions).toEqual([{ id: installation.sessionId, name: 'Fictional contest' }]);
    expect((await snapshot(contestant)).session).toMatchObject({ max_image_bytes: 1_048_576, max_images_per_issue: 3 });
    const issueId = await workflow(contestant, { type: 'submit', category: 'Devices', description: 'Fictional device failure' });
    const unrelated = await workflow(other, { type: 'submit', category: 'Other', description: 'Other fictional team' });
    expect((await snapshot(contestant)).issues.map((issue) => issue.id)).toEqual([issueId]);
    expect((await snapshot(other)).issues.map((issue) => issue.id)).toEqual([unrelated]);
    await flush();
    await connect(organizer, 'staff');
    await connect(contestant, 'team');
    await connect(other, 'other');
    const privateBefore = await socketState(contestant, 'team');
    const otherBefore = await socketState(other, 'other');
    await workflow(organizer, { type: 'message', issue_id: issueId, revision: 1, text: 'Private fictional note', visibility: 'internal' });
    await expect.poll(async () => (await socketState(organizer, 'staff')).messages.length).toBeGreaterThan(1);
    expect(await socketState(contestant, 'team')).toEqual(privateBefore);
    expect(await socketState(other, 'other')).toEqual(otherBefore);
    expect((await snapshot(contestant)).history.some((row) => row.text === 'Private fictional note')).toBe(false);
    expect((await snapshot(organizer)).history.some((row) => row.text === 'Private fictional note')).toBe(true);
    await workflow(organizer, { type: 'claim', issue_id: issueId, revision: 1 });
    await expect.poll(async () => (await socketState(contestant, 'team')).messages.length).toBeGreaterThan(1);
    await workflow(organizer, { type: 'escalate', issue_id: issueId, revision: 2 });
    expect((await snapshot(contestant)).issues[0]!.owner).toBe(organizer.id);
    await workflow(specialist, { type: 'accept', issue_id: issueId, revision: 3 });
    await workflow(specialist, { type: 'resolve', issue_id: issueId, revision: 4, summary: 'Fictional repair' });
    const awardCommand: Command = { type: 'award', issue_id: issueId, revision: 5, minutes: 3, explanation: 'Fictional delay' };
    const awardRequest = randomUUID();
    await workflow(organizer, awardCommand, awardRequest);
    await workflow(organizer, awardCommand, awardRequest);
    await workflow(organizer, { type: 'apply', issue_id: issueId, revision: 6 });
    const resolved = await snapshot(contestant);
    expect(resolved.issues[0]).toMatchObject({ status: 'resolved', owner: specialist.id });
    expect(resolved.issues[0]!.created_at).toMatch(/^\d{4}-/);
    expect(resolved.issues[0]!.first_assigned_at).toMatch(/^\d{4}-/);
    expect(resolved.issues[0]!.resolved_at).toBe(resolved.resolutions[0]!.at);
    expect(resolved.awards[0]).toMatchObject({ minutes: 3, applied_name: 'Fictional organizer' });
    await workflow(contestant, { type: 'reopen', issue_id: issueId, revision: 7, reason: 'Fictional recurrence' });
    const reopened = await snapshot(contestant);
    expect(reopened.issues[0]).toMatchObject({ owner: specialist.id, status: 'claimed', resolved_at: null,
      first_assigned_at: resolved.issues[0]!.first_assigned_at });
    expect(reopened.awards).toEqual(resolved.awards);
    expect(reopened.resolutions[0]).toMatchObject({ reopened_by: contestant.id, reason: 'Fictional recurrence' });
    await workflow(contestant, { type: 'message', issue_id: issueId, revision: 8, text: 'Public fictional reply', visibility: 'public' });
    expect((await snapshot(contestant)).history.some((row) => row.text === 'Public fictional reply')).toBe(true);
    const publicImage = await image(organizer, issueId, 'public');
    const privateImage = await image(organizer, issueId, 'internal');
    expect((await snapshot(contestant)).attachments.map((attachment) => attachment.id)).toEqual([publicImage.id]);
    expect((await snapshot(organizer)).attachments.map((attachment) => attachment.id).sort()).toEqual([publicImage.id, privateImage.id].sort());
    const download = await network(contestant.context, `/api/image/${publicImage.original_path}`);
    expect(download.status()).toBe(200);
    expect(download.headers()['content-type']).toBe('image/png');
    expect((await download.body()).byteLength).toBeGreaterThan(0);
    const deniedDownload = await network(contestant.context, `/api/image/${privateImage.original_path}`);
    expect(deniedDownload.status()).toBe(409);
    await json(specialist, '/api/images', { action: 'remove', sessionId: installation.sessionId, attachmentId: publicImage.id }, 409);
    for (const image of [publicImage, privateImage]) {
      const remove = { action: 'remove', sessionId: installation.sessionId, attachmentId: image.id };
      await json(organizer, '/api/images', remove);
      await json(organizer, '/api/images', remove);
    }
    const pending = await json<StartedImage>(organizer, '/api/images', { action: 'begin', sessionId: installation.sessionId,
      requestId: randomUUID(), issueId, visibility: 'internal', name: 'fictional-partial.png', bytes: imageBytes.length });
    await transfer(organizer, pending.original_path);
    await json(organizer, '/api/images', { action: 'finish', sessionId: installation.sessionId, attachmentId: pending.id }, 409);
    await json(organizer, '/api/images', { action: 'abandon', sessionId: installation.sessionId, attachmentId: pending.id });
    expect((await snapshot(organizer)).attachments).toEqual([]);
    const replacedAvatar = await avatar(organizer);
    const organizerAvatar = await avatar(organizer);
    const teamAvatar = await avatar(contestant);
    expect(await avatars(specialist)).toEqual([organizerAvatar]);
    expect(await avatars(contestant)).toEqual([teamAvatar]);
    const avatarPath = (picture: PersonAvatar) => `/api/avatar/${installation!.sessionId}/${picture.avatar_id}`;
    const avatarDownload = await network(specialist.context, avatarPath(organizerAvatar));
    expect(avatarDownload.status()).toBe(200);
    expect(avatarDownload.headers()).toMatchObject({ 'content-type': 'image/png', 'cache-control': 'private, no-store' });
    expect(Buffer.from(await avatarDownload.body())).toEqual(imageBytes);
    expect((await network(specialist.context, avatarPath(replacedAvatar))).status()).toBe(409);
    expect((await network(contestant.context, avatarPath(organizerAvatar))).status()).toBe(409);
    expect((await network(organizer.context, avatarPath(teamAvatar))).status()).toBe(409);
    await json(specialist, '/api/avatars', { action: 'remove' });
    await json(organizer, '/api/avatars', { action: 'remove' });
    expect(await avatars(specialist)).toEqual([]);
    await admin(organizer, { action: 'set_intake', open: false });
    await json(contestant, '/api/workflow', { sessionId: installation.sessionId, requestId: randomUUID(),
      command: { type: 'submit', category: 'Devices', description: 'Closed fictional intake' } }, 409);
    await admin(organizer, { action: 'set_intake', open: true });
    await organizer.page.evaluate(() => (window as RuntimeWindow).fixtureSockets!.staff!.socket.close());
    await connect(organizer, 'reconnected');
    expect((await snapshot(organizer)).issues).toHaveLength(2);
    await admin(organizer, { action: 'remove_member', userId: other.id });
    await expect.poll(async () => (await socketState(other, 'other')).closed, { timeout: 15_000 }).toBe(true);
    expect((await snapshot(other)).membership).toBeNull();
    const reset = await json<{ temporaryPassword?: string }>(organizer, '/api/accounts', { sessionId: installation.sessionId,
      command: { action: 'reset_password', userId: specialist.id } });
    if (typeof reset.temporaryPassword !== 'string') throw new Error('Account recovery did not return a temporary credential.');
    await json(specialist, '/api/auth/session', undefined, 401);
    const recovered = await authenticated(specialist.username, reset.temporaryPassword);
    expect(recovered.id).toBe(specialist.id);
    expect((await snapshot(recovered)).issues.find((issue) => issue.id === issueId)?.owner).toBe(specialist.id);
    await json(organizer, '/api/accounts', { sessionId: installation.sessionId,
      command: { action: 'set_username', userId: recovered.id, username: recovered.username } });
    await json(organizer, '/api/accounts', { sessionId: installation.sessionId,
      command: { action: 'set_username', userId: recovered.id, username: `rt_${unique}_renamed` } }, 409);
    expect((await snapshot(organizer)).members.find((member) => member.person.id === recovered.id)?.person.username).toBe(recovered.username);
    await json(contestant, '/api/auth/sign-out', {});
    await expect.poll(async () => (await socketState(contestant, 'team')).closed, { timeout: 15_000 }).toBe(true);
    await json(contestant, '/api/auth/session', undefined, 401);
    await flush();
    scenarioCompleted = true;
  } finally {
    for (const context of accountContexts) await context.close();
    if (browser) await browser.close();
    if (worker) await worker.stop();
    if (installation) {
      const cleanup = await proxy();
      try {
        const db = cleanup.env.DB;
        const state = await db.prepare('SELECT id, owner_account_id, event_id, session_id FROM installation WHERE id = ?').bind(installation.installationId)
          .first<{ id: string; owner_account_id: string; event_id: string; session_id: string }>();
        expect(state, 'Fixture ownership must match before scoped cleanup.').toEqual({
          id: installation.installationId, owner_account_id: installation.accountId,
          event_id: installation.eventId, session_id: installation.sessionId,
        });
        const discovered = await db.prepare('SELECT id FROM accounts WHERE username LIKE ?').bind(`rt_${unique}_%`).all<{ id: string }>();
        const ownedAccounts = [...new Set([...accountIds, ...discovered.results.map((row) => row.id)])];
        const images = await db.prepare('SELECT original_path, thumbnail_path FROM issue_images WHERE session_id = ?').bind(installation.sessionId)
          .all<{ original_path: string; thumbnail_path: string }>();
        const ownedAvatars = await db.prepare(`SELECT id, account_id FROM account_avatars WHERE account_id IN (${ownedAccounts.map(() => '?').join(', ')})`)
          .bind(...ownedAccounts).all<{ id: string; account_id: string }>();
        if (scenarioCompleted) expect(ownedAvatars.results.length, 'The scenario must leave avatar rows for cleanup.').toBeGreaterThan(0);
        const keys = [...images.results.flatMap((row) => [row.original_path, row.thumbnail_path]),
          ...ownedAvatars.results.map((row) => avatarKey(row.account_id, row.id))];
        if (keys.length) await cleanup.env.IMAGES.delete(keys);
        const remainingObjects = await cleanup.env.IMAGES.list({ prefix: installation.sessionId });
        expect(remainingObjects.objects).toEqual([]);
        if (scenarioCompleted) expect((await cleanup.env.IMAGES.list({})).objects.map((object) => object.key)).toEqual([sentinel.name]);
        const limits = await db.prepare('SELECT key FROM authentication_limits').all<{ key: string }>();
        const ownedLimits = limits.results.filter(({ key }) => fixtureIpKeys.includes(key) ||
          ownedAccounts.some((id) => key === `change:${id}`) || usernames.some((username) => key === `username:${username}`));
        await db.batch([
          db.prepare('DELETE FROM installation WHERE id = ? AND owner_account_id = ?').bind(installation.installationId, installation.accountId),
          db.prepare('DELETE FROM events WHERE id = ? AND name = ?').bind(installation.eventId, `runtime:${unique}`),
          ...ownedAccounts.map((id) => db.prepare('DELETE FROM account_operations WHERE account_id = ?').bind(id)),
          ...ownedAccounts.map((id) => db.prepare('DELETE FROM ba_user WHERE id = ?').bind(id)),
          ...ownedAccounts.map((id) => db.prepare('DELETE FROM account_avatars WHERE account_id = ?').bind(id)),
          ...ownedAccounts.map((id) => db.prepare('DELETE FROM accounts WHERE id = ?').bind(id)),
          ...ownedLimits.map(({ key }) => db.prepare('DELETE FROM authentication_limits WHERE key = ?').bind(key)),
        ]);
        const accounts = await db.prepare('SELECT id, name FROM accounts').all<{ id: string; name: string }>();
        const events = await db.prepare('SELECT id, name FROM events').all<{ id: string; name: string }>();
        expect(accounts.results).toEqual([{ id: sentinel.account, name: sentinel.name }]);
        expect(events.results).toEqual([{ id: sentinel.event, name: sentinel.name }]);
        const tables = ['installation', 'sessions', 'teams', 'memberships', 'membership_roles', 'logins', 'ba_user', 'ba_session', 'ba_account',
          'ba_verification', 'issues', 'history', 'resolutions', 'awards', 'issue_images', 'image_deletions', 'command_receipts',
          'audience_sequences', 'notifications', 'admin_audit', 'account_operations', 'command_assertions', 'workflow_commit_times', 'session_issue_sequences',
          'account_avatars'];
        for (const table of tables) {
          const count = await db.prepare(`SELECT count(*) AS count FROM ${table}`).first<{ count: number }>();
          expect(count?.count, `Scoped cleanup must remove fixture records from ${table}.`).toBe(0);
        }
        expect((await db.prepare('SELECT key FROM authentication_limits').all<{ key: string }>()).results).toEqual([{ key: sentinelLimit }]);
        expect((await cleanup.env.IMAGES.list({})).objects.map((object) => object.key)).toEqual([sentinel.name]);
        cleanupVerified = true;
      } finally { await cleanup.dispose(); }
    }
    await rm(directory, { recursive: true, force: true });
  }
  expect(scenarioCompleted).toBe(true);
  expect(cleanupVerified).toBe(true);
}, 180_000);
