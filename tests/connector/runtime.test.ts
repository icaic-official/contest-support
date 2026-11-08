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
import { bootstrapSite } from '../../src/server/adapters/cloudflare/installation';
import { loginKeyFor } from '../../src/server/adapters/cloudflare/credentials';
import { randomSecret } from '../../src/server/adapters/cloudflare/password';
import { avatarKey } from '../../src/server/adapters/cloudflare/avatars';
import { removeFixtureEvent } from '../../src/server/adapters/cloudflare/eventDeletionFixture';
import type { IssuedCredential, ManageCommand, ManageReceipt, PersonAvatar, StartedImage } from '../../src/backend/contracts';

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
  const usernames: string[] = [`rt_${unique}_webmaster`];
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
  let installation: Awaited<ReturnType<typeof bootstrapSite>> | undefined;
  /** Direct fixture rows: bootstrap makes only the webmaster, so the event, the contest, and its admin come from SQL. */
  const fixture = { event: randomUUID(), session: randomUUID(), eventAdmin: randomUUID() };
  const eventAdminHandle = `rt_${unique}_eadmin`;
  /** The fixture event's code, which D1 chose. Created accounts sign in with it. */
  let eventCode = '';
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
    const current = await json<{ user: { id: string }; status: { handle: string | null; must_change: boolean }; csrf: string }>(actor, '/api/auth/session');
    actor.csrf = current.csrf;
    actor.id = current.user.id;
    return current;
  }

  /** `event` null is a site sign-in, as the bootstrap webmaster uses. */
  async function authenticated(username: string, temporaryPassword: string, event: string | null = eventCode): Promise<Actor> {
    if (!browser) throw new Error('The local browser did not start.');
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    accountContexts.push(context);
    const page = await context.newPage();
    const actor: Actor = { context, page, id: '', username, csrf: '' };
    await json(actor, '/api/auth/sign-in', { event, handle: username, password: temporaryPassword });
    const before = await session(actor);
    expect(before.status.must_change).toBe(true);
    await json(actor, '/api/contests', undefined, 403);
    await json(actor, '/api/auth/change-password', { currentPassword: temporaryPassword, newPassword: randomSecret() + 'A9!' });
    expect((await session(actor)).status.must_change).toBe(false);
    await page.goto(origin);
    return actor;
  }

  async function snapshot(actor: Actor): Promise<Snapshot> {
    return snapshotSchema.parse(await json(actor, `/api/snapshot?sessionId=${fixture.session}`));
  }

  /** One management command. Resolves to the receipt of created IDs. */
  async function manage(actor: Actor, command: ManageCommand): Promise<ManageReceipt> {
    return json<ManageReceipt>(actor, '/api/manage', { requestId: randomUUID(), command });
  }

  /** Issues temporary passwords for accounts of the fixture event. */
  async function issue(actor: Actor, accountIds: string[]): Promise<IssuedCredential[]> {
    const issued = await json<IssuedCredential[]>(actor, '/api/credentials', { requestId: randomUUID(), eventId: fixture.event, accountIds });
    if (issued.some((item) => typeof item.temporaryPassword !== 'string')) throw new Error('A credential request did not return its temporary credential.');
    return issued;
  }

  async function workflow(actor: Actor, command: Command, requestId = randomUUID()): Promise<string> {
    const result = await json<{ outcome: string; issueId: string }>(actor, '/api/workflow', { sessionId: fixture.session, requestId, command });
    expect(result.outcome).toBe('committed');
    return result.issueId;
  }

  /** A staff person of the event who sits in the contest with the given seat. */
  async function createStaff(eventAdmin: Actor, suffix: string, seat: { roles: Array<'volunteer' | 'specialist' | 'jury'>; admin: boolean }): Promise<Actor> {
    const username = `rt_${unique}_${suffix}`;
    usernames.push(username);
    const created = await manage(eventAdmin, { type: 'create_people', eventId: fixture.event, people: [{ handle: username, name: `Fictional ${suffix}` }] });
    const [accountId] = created.accountIds!;
    await manage(eventAdmin, { type: 'assign_staff', contestId: fixture.session, accountId: accountId!, ...seat });
    const [credential] = await issue(eventAdmin, [accountId!]);
    const actor = await authenticated(username, credential!.temporaryPassword!);
    accountIds.push(actor.id);
    return actor;
  }

  /** A team of the event, seated in the contest at the given location. */
  async function createTeam(eventAdmin: Actor, suffix: string, name: string, location: string): Promise<Actor> {
    const username = `rt_${unique}_${suffix}`;
    usernames.push(username);
    const created = await manage(eventAdmin, { type: 'create_entrants', eventId: fixture.event, entrants: [{ kind: 'team', name, handle: username }] });
    await manage(eventAdmin, { type: 'assign_entrants', contestId: fixture.session, entries: [{ entrantId: created.entrantIds![0]!, location }] });
    const [credential] = await issue(eventAdmin, [created.accountIds![0]!]);
    const actor = await authenticated(username, credential!.temporaryPassword!);
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
      socket.onmessage = (event) => { state.messages.push(JSON.parse(String(event.data)) as { type: string }); };
      socket.onclose = () => { state.closed = true; };
      socket.onerror = () => { state.closed = true; };
    }, { sessionId: fixture.session, key });
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
    return json<PersonAvatar[]>(actor, `/api/avatars?sessionId=${fixture.session}`);
  }

  async function image(actor: Actor, issueId: string, visibility: 'public' | 'internal'): Promise<StartedImage> {
    const begin = { action: 'begin', sessionId: fixture.session,
      requestId: randomUUID(), issueId, visibility, name: `fictional-${visibility}.png`, bytes: imageBytes.length };
    const started = await json<StartedImage>(actor, '/api/images', begin);
    expect(await json<StartedImage>(actor, '/api/images', begin)).toEqual(started);
    for (const path of [started.original_path, started.thumbnail_path]) await transfer(actor, path);
    const finish = { action: 'finish', sessionId: fixture.session, attachmentId: started.id };
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
      installation = await bootstrapSite(setup.env.DB, { webmasterHandle: usernames[0], webmasterName: 'Fictional webmaster' });
      accountIds.push(installation.accountId, fixture.eventAdmin);
      await setup.env.DB.batch([
        setup.env.DB.prepare('INSERT INTO events (id, name) VALUES (?, ?)').bind(fixture.event, `runtime:${unique}`),
        setup.env.DB.prepare('INSERT INTO sessions (id, event_id, name, categories, intake_open) VALUES (?, ?, ?, ?, 0)')
          .bind(fixture.session, fixture.event, 'Fictional contest', JSON.stringify(['Devices', 'Other'])),
        // The event admin that create_event would make. It waits for a password from the webmaster.
        setup.env.DB.prepare(`INSERT INTO accounts (id, name, username, handle, event_id, must_change, credential_state)
          VALUES (?, 'Fictional event admin', ?, ?, ?, 1, 'pending')`).bind(fixture.eventAdmin, loginKeyFor(fixture.eventAdmin), eventAdminHandle, fixture.event),
        setup.env.DB.prepare(`INSERT INTO grants (account_id, scope, event_id, granted_by) VALUES (?, 'event', ?, 'fixture')`)
          .bind(fixture.eventAdmin, fixture.event),
      ]);
      usernames.push(eventAdminHandle);
      eventCode = (await setup.env.DB.prepare('SELECT code FROM events WHERE id = ?').bind(fixture.event)
        .first<{ code: string }>())!.code;
      await setup.env.DB.batch([
        setup.env.DB.prepare('INSERT INTO events (id, name) VALUES (?, ?)').bind(sentinel.event, sentinel.name),
        setup.env.DB.prepare('INSERT INTO accounts (id, name) VALUES (?, ?)').bind(sentinel.account, sentinel.name),
        setup.env.DB.prepare('INSERT INTO authentication_limits (key, window_start, attempts) VALUES (?, unixepoch(), 1)').bind(sentinelLimit),
        setup.env.DB.prepare('INSERT INTO accounts (id, name, event_id) VALUES (?, ?, ?)').bind(legacyId, `Fictional unconfigured ${unique}`, fixture.event),
        setup.env.DB.prepare('INSERT INTO memberships (session_id, account_id) VALUES (?, ?)').bind(fixture.session, legacyId),
        setup.env.DB.prepare("INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')").bind(fixture.session, legacyId),
      ]);
      await setup.env.IMAGES.put(sentinel.name, Uint8Array.from([1, 2, 3]));
    } finally { await setup.dispose(); }
    worker = await unstable_dev(bindings.main, {
      config: configPath, persistTo: storage, local: true, localProtocol: 'https', port,
      vars: { AUTH_ORIGIN: origin, AUTH_SECRET: authenticationSecret }, envFiles: [], logLevel: 'error',
      experimental: { disableExperimentalWarning: true, testScheduled: true },
    });
    browser = await chromium.launch({ headless: true });
    const webmaster = await authenticated(installation.handle, installation.temporaryPassword, null);
    // The webmaster gives the event admin a first password, as the site page does after create_event.
    const [adminCredential] = await issue(webmaster, [fixture.eventAdmin]);
    const eventAdmin = await authenticated(eventAdminHandle, adminCredential!.temporaryPassword!);
    expect(eventAdmin.id).toBe(fixture.eventAdmin);
    const organizer = await createStaff(eventAdmin, 'organizer', { roles: ['volunteer', 'jury'], admin: true });
    // A contest admin sets the contest's own settings.
    await manage(organizer, { type: 'set_intake', contestId: fixture.session, mode: 'open' });
    await manage(organizer, { type: 'set_image_limits', contestId: fixture.session, fileMegabytes: 1, count: 3, totalMegabytes: 3 });
    const specialist = await createStaff(eventAdmin, 'specialist', { roles: ['specialist'], admin: false });
    const leaver = await createStaff(eventAdmin, 'leaver', { roles: ['volunteer'], admin: false });
    const contestant = await createTeam(eventAdmin, 'team', 'Fictional Alpha', 'Desk A');
    const other = await createTeam(eventAdmin, 'other', 'Fictional Beta', 'Desk B');
    const assignedUsername = `rt_${unique}_assigned`;
    usernames.push(assignedUsername);
    await manage(eventAdmin, { type: 'set_handle', eventId: fixture.event, accountId: legacyId, handle: assignedUsername });
    expect((await snapshot(organizer)).members.find((member) => member.person.id === legacyId)?.person.username).toBe(assignedUsername);
    const contests = await json<Array<{ id: string; name: string; eventId: string; eventName: string; manage: string }>>(contestant, '/api/contests');
    expect(contests).toEqual([{
      id: fixture.session, name: 'Fictional contest', eventId: fixture.event, eventName: contests[0]?.eventName, timeZone: 'UTC',
      contestType: 'teams', schedule: null, intake: { open: true, reason: 'override_open', changesAt: null }, canOpen: true, manage: 'none',
    }]);
    expect(contests[0]?.eventName).toBeTruthy();
    // The calendar lists scheduled contests only, and refuses a window that is open-ended or too long.
    const calendar = `from=${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString())}`;
    expect(await json(contestant, `/api/contests?${calendar}`)).toEqual([]);
    await json(contestant, `/api/contests?from=${encodeURIComponent(new Date().toISOString())}`, undefined, 400);
    expect((await json<Array<{ manage: string }>>(eventAdmin, '/api/contests')).map((item) => item.manage)).toEqual(['event']);
    await json(contestant, '/api/sessions', undefined, 404);
    await json(organizer, '/api/admin', {}, 404);
    await json(contestant, '/api/manage', { requestId: randomUUID(), command: { type: 'set_intake', contestId: fixture.session, mode: 'closed' } }, 403);
    expect((await json<{ event: { id: string } }>(eventAdmin, '/api/event')).event.id).toBe(fixture.event);
    await json(organizer, '/api/event', undefined, 403);
    const issueId = await workflow(contestant, { type: 'submit', category: 'Devices', description: 'Fictional device failure' });
    const unrelated = await workflow(other, { type: 'submit', category: 'Other', description: 'Other fictional team' });
    expect((await snapshot(contestant)).issues.map((issue) => issue.id)).toEqual([issueId]);
    expect((await snapshot(other)).issues.map((issue) => issue.id)).toEqual([unrelated]);
    await flush();
    await connect(organizer, 'staff');
    await connect(leaver, 'leaver');
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
    await json(specialist, '/api/images', { action: 'remove', sessionId: fixture.session, attachmentId: publicImage.id }, 409);
    for (const image of [publicImage, privateImage]) {
      const remove = { action: 'remove', sessionId: fixture.session, attachmentId: image.id };
      await json(organizer, '/api/images', remove);
      await json(organizer, '/api/images', remove);
    }
    const pending = await json<StartedImage>(organizer, '/api/images', { action: 'begin', sessionId: fixture.session,
      requestId: randomUUID(), issueId, visibility: 'internal', name: 'fictional-partial.png', bytes: imageBytes.length });
    await transfer(organizer, pending.original_path);
    await json(organizer, '/api/images', { action: 'finish', sessionId: fixture.session, attachmentId: pending.id }, 409);
    await json(organizer, '/api/images', { action: 'abandon', sessionId: fixture.session, attachmentId: pending.id });
    expect((await snapshot(organizer)).attachments).toEqual([]);
    const replacedAvatar = await avatar(organizer);
    const organizerAvatar = await avatar(organizer);
    const teamAvatar = await avatar(contestant);
    expect(await avatars(specialist)).toEqual([organizerAvatar]);
    expect(await avatars(contestant)).toEqual([teamAvatar]);
    const avatarPath = (picture: PersonAvatar) => `/api/avatar/${fixture.session}/${picture.avatar_id}`;
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
    await manage(organizer, { type: 'set_intake', contestId: fixture.session, mode: 'closed' });
    await json(contestant, '/api/workflow', { sessionId: fixture.session, requestId: randomUUID(),
      command: { type: 'submit', category: 'Devices', description: 'Closed fictional intake' } }, 409);
    await manage(organizer, { type: 'set_intake', contestId: fixture.session, mode: 'open' });
    await organizer.page.evaluate(() => (window as RuntimeWindow).fixtureSockets!.staff!.socket.close());
    await connect(organizer, 'reconnected');
    expect((await snapshot(organizer)).issues).toHaveLength(2);
    await manage(eventAdmin, { type: 'unassign_staff', contestId: fixture.session, accountId: leaver.id });
    await expect.poll(async () => (await socketState(leaver, 'leaver')).closed, { timeout: 15_000 }).toBe(true);
    expect((await snapshot(leaver)).membership).toBeNull();
    const [reset] = await issue(eventAdmin, [specialist.id]);
    await json(specialist, '/api/auth/session', undefined, 401);
    const recovered = await authenticated(specialist.username, reset!.temporaryPassword!);
    expect(recovered.id).toBe(specialist.id);
    expect((await snapshot(recovered)).issues.find((issue) => issue.id === issueId)?.owner).toBe(specialist.id);
    const renamed = `rt_${unique}_renamed`;
    usernames.push(renamed);
    await manage(eventAdmin, { type: 'set_handle', eventId: fixture.event, accountId: recovered.id, handle: renamed });
    expect((await snapshot(organizer)).members.find((member) => member.person.id === recovered.id)?.person.username).toBe(renamed);
    // A handle change keeps the open session.
    expect((await session(recovered)).status.handle).toBe(renamed);
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
        const owned = await db.prepare('SELECT id FROM events WHERE id = ? AND name = ?').bind(fixture.event, `runtime:${unique}`).first();
        expect(owned, 'Fixture ownership must match before scoped cleanup.').toEqual({ id: fixture.event });
        const discovered = await db.prepare('SELECT id FROM accounts WHERE handle LIKE ?').bind(`rt_${unique}_%`).all<{ id: string }>();
        const ownedAccounts = [...new Set([...accountIds, ...discovered.results.map((row) => row.id)])];
        const images = await db.prepare('SELECT original_path, thumbnail_path FROM issue_images WHERE session_id = ?').bind(fixture.session)
          .all<{ original_path: string; thumbnail_path: string }>();
        const ownedAvatars = await db.prepare(`SELECT id, account_id FROM account_avatars WHERE account_id IN (${ownedAccounts.map(() => '?').join(', ')})`)
          .bind(...ownedAccounts).all<{ id: string; account_id: string }>();
        if (scenarioCompleted) expect(ownedAvatars.results.length, 'The scenario must leave avatar rows for cleanup.').toBeGreaterThan(0);
        const keys = [...images.results.flatMap((row) => [row.original_path, row.thumbnail_path]),
          ...ownedAvatars.results.map((row) => avatarKey(row.account_id, row.id))];
        if (keys.length) await cleanup.env.IMAGES.delete(keys);
        const remainingObjects = await cleanup.env.IMAGES.list({ prefix: fixture.session });
        expect(remainingObjects.objects).toEqual([]);
        if (scenarioCompleted) expect((await cleanup.env.IMAGES.list({})).objects.map((object) => object.key)).toEqual([sentinel.name]);
        const limits = await db.prepare('SELECT key FROM authentication_limits').all<{ key: string }>();
        const ownedLimits = limits.results.filter(({ key }) => fixtureIpKeys.includes(key) ||
          ownedAccounts.some((id) => key === `change:${id}`) ||
          usernames.some((username) => [`handle:${fixture.event}:${username}`, `handle:site:${username}`].includes(key)));
        await removeFixtureEvent(db, fixture.event);
        await db.batch(ownedLimits.map(({ key }) => db.prepare('DELETE FROM authentication_limits WHERE key = ?').bind(key)));
        // The webmaster that bootstrap made has no event, so it stays with its login, audit, and receipts.
        // This local database is temporary.
        const site = installation.accountId;
        const accounts = await db.prepare('SELECT id FROM accounts WHERE id <> ?').bind(site).all<{ id: string }>();
        const events = await db.prepare('SELECT id, name FROM events').all<{ id: string; name: string }>();
        expect(accounts.results).toEqual([{ id: sentinel.account }]);
        expect(events.results).toEqual([{ id: sentinel.event, name: sentinel.name }]);
        const tables = ['entrants', 'authority_audit', 'manage_receipts', 'sessions', 'teams', 'memberships', 'membership_roles', 'logins', 'ba_user', 'ba_session', 'ba_account',
          'ba_verification', 'issues', 'history', 'resolutions', 'awards', 'issue_images', 'image_deletions', 'command_receipts',
          'audience_sequences', 'notifications', 'admin_audit', 'account_operations', 'command_assertions', 'workflow_commit_times', 'session_issue_sequences',
          'account_avatars'];
        const siteRows: Record<string, string> = {
          authority_audit: 'event_id IS NULL', manage_receipts: 'actor = ?', logins: 'account_id = ?',
          ba_user: 'id = ?', ba_session: 'userId = ?', ba_account: 'userId = ?', account_operations: 'account_id = ?',
        };
        for (const table of tables) {
          const keep = siteRows[table];
          const count = await db.prepare(`SELECT count(*) AS count FROM ${table}${keep ? ` WHERE NOT (${keep})` : ''}`)
            .bind(...(keep?.includes('?') ? [site] : [])).first<{ count: number }>();
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
