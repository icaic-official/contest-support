import { z } from 'zod';
import type { Caller } from '../../authentication';
import type { D1Connection } from '../d1/connection';
import { logEvent, requestFields } from './log';
import { type ContestAuthorityRow, contestDataSql } from './authority';

interface LiveSocket {
  readonly readyState: number;
  send(message: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

interface LiveStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAll(): Promise<void>;
  list<T>(): Promise<Map<string, T>>;
}

interface LiveState {
  storage: LiveStorage;
  acceptWebSocket(socket: LiveSocket): void;
  getWebSockets(): LiveSocket[];
}

export interface LiveNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export interface LiveEnvironment {
  DB: D1Connection;
  LIVE_UPDATES: LiveNamespace;
}

declare const WebSocketPair: { new(): { 0: LiveSocket; 1: LiveSocket } };

const uuid = z.string().uuid();
const attachmentSchema = z.object({
  accountId: uuid,
  loginId: uuid,
  sessionId: uuid,
  expiresAt: z.number().finite(),
});
// One claim round sends at most this many outbox rows.
const claimLimit = 500;
const audienceSchema = z.string().regex(/^(staff|(?:team|account):[0-9a-f-]{36})$/i);
const sequenceSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
/** The highest pending sequence for each audience of one session. */
const signalSchema = z.object({
  sessionId: uuid,
  audiences: z.array(z.object({ audience: audienceSchema, sequence: sequenceSchema }).strict()).min(1).max(claimLimit),
}).strict();
type Signal = z.infer<typeof signalSchema>;
type SocketAttachment = z.infer<typeof attachmentSchema>;

type LiveAccess = ContestAuthorityRow;
type Grantee = Caller & { sessionId: string };

interface Grant {
  socket: LiveSocket;
  attachment: SocketAttachment;
  row: LiveAccess;
}

// 500 login IDs make a JSON value of about 20 KB, far below D1's 2 MB value limit.
const accessBatchSize = 500;

function grantKey({ sessionId, accountId, loginId }: Grantee): string {
  return `${sessionId}:${accountId}:${loginId}`;
}

const eraseSchema = z.object({ sessionId: uuid, eventId: uuid }).strict();
type EraseTarget = z.infer<typeof eraseSchema>;

function close(socket: LiveSocket, code = 1008, reason = 'Access changed. Sign in again.') {
  try { socket.close(code, reason); } catch { /* A peer can close before this event. */ }
}

/** One hibernating coordinator per session. Notifications contain no application data. */
export class SessionLiveCoordinator {
  // D1 reads can yield. Serialize delivery so stored audience cursors never move backward.
  private delivery: Promise<void> = Promise.resolve();

  constructor(private readonly state: LiveState, private readonly env: Pick<LiveEnvironment, 'DB'>) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.delivery.then(operation);
    this.delivery = task.then(() => undefined, () => undefined);
    return task;
  }

  private async sessionExists(sessionId: string): Promise<boolean> {
    return !!(await this.env.DB.prepare('SELECT id FROM sessions WHERE id = ?').bind(sessionId).first());
  }

  /** Read current grants with one D1 query for each session and batch of logins. */
  private async access(grantees: Grantee[]): Promise<Map<string, LiveAccess>> {
    const logins = new Map<string, Set<string>>();
    for (const { sessionId, loginId } of grantees) {
      logins.set(sessionId, (logins.get(sessionId) ?? new Set()).add(loginId));
    }
    const rows = new Map<string, LiveAccess>();
    for (const [sessionId, ids] of logins) {
      const list = [...ids];
      for (let start = 0; start < list.length; start += accessBatchSize) {
        const { results } = await this.env.DB.prepare(contestDataSql('logins'))
          .bind(sessionId, JSON.stringify(list.slice(start, start + accessBatchSize))).all<LiveAccess>();
        for (const row of results) {
          if (row.staff || row.team_id) rows.set(grantKey({ sessionId, accountId: row.account_id, loginId: row.login_id }), row);
        }
      }
    }
    return rows;
  }

  /**
   * Check every current session grant before every delivery, including a
   * duplicate signal. Saved socket roles never grant later access. A failed
   * read throws before any socket receives a hint.
   */
  private async grants(): Promise<Grant[]> {
    const sockets = this.state.getWebSockets().flatMap((socket) => {
      const attachment = this.attachment(socket);
      if (!attachment) { close(socket); return []; }
      return [{ socket, attachment }];
    });
    const rows = await this.access(sockets.map(({ attachment }) => attachment));
    return sockets.flatMap(({ socket, attachment }) => {
      const row = rows.get(grantKey(attachment));
      if (!row) { close(socket); return []; }
      socket.serializeAttachment({ ...attachment, expiresAt: this.expiry(row) });
      return [{ socket, attachment, row }];
    });
  }

  private attachment(socket: LiveSocket): SocketAttachment | undefined {
    const parsed = attachmentSchema.safeParse(socket.deserializeAttachment());
    return parsed.success ? parsed.data : undefined;
  }

  private expiry(row: LiveAccess): number {
    return Math.min(row.login_expires_at * 1000, Date.parse(row.identity_expires_at));
  }

  private async scheduleAlarm(): Promise<void> {
    const expiries = this.state.getWebSockets().filter((socket) => socket.readyState === 1)
      .flatMap((socket) => { const attachment = this.attachment(socket); return attachment ? [attachment.expiresAt] : []; });
    if (!expiries.length) return this.state.storage.deleteAlarm();
    // Revocations also arrive through the outbox. This alarm recovers if dispatch
    // is interrupted, and closes an idle connection at its known session expiry.
    await this.state.storage.setAlarm(Math.max(Date.now() + 1, Math.min(Date.now() + 30_000, ...expiries)));
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/connect' && request.method === 'GET') return await this.serialize(() => this.connect(request));
      if (path === '/erase' && request.method === 'POST') {
        const parsed = eraseSchema.safeParse(await request.json());
        if (!parsed.success) return new Response(null, { status: 400 });
        return await this.serialize(() => this.erase(parsed.data));
      }
      if (path === '/notify' && request.method === 'POST') {
        const parsed = signalSchema.safeParse(await request.json());
        if (!parsed.success) return new Response(null, { status: 400 });
        await this.serialize(() => this.notify(parsed.data));
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      logEvent('error', 'live.coordinator_error', { ...requestFields(request), status: 503, error });
      // Leave the outbox record pending. Retried delivery is safe after an
      // uncertain response or a coordinator restart.
      return new Response(null, { status: 503 });
    }
  }

  private async connect(request: Request): Promise<Response> {
    const parsed = attachmentSchema.omit({ expiresAt: true }).safeParse({
      accountId: request.headers.get('X-Minsky-Account'),
      loginId: request.headers.get('X-Minsky-Login'),
      sessionId: request.headers.get('X-Minsky-Session'),
    });
    if (!parsed.success || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(null, { status: 400 });
    }
    const row = (await this.access([parsed.data])).get(grantKey(parsed.data));
    if (!row) return new Response(null, { status: 403 });
    const pair = new WebSocketPair();
    const server = pair[1];
    server.serializeAttachment({ ...parsed.data, expiresAt: this.expiry(row) });
    this.state.acceptWebSocket(server);
    try {
      server.send(JSON.stringify({ type: 'ready' }));
      await this.scheduleAlarm();
    } catch (error) {
      close(server, 1011, 'Updates are unavailable. Reconnect.');
      throw error;
    }
    // Workers accept a webSocket field that the DOM ResponseInit type lacks.
    const upgrade: ResponseInit & { webSocket: LiveSocket } = { status: 101, webSocket: pair[0] };
    return new Response(null, upgrade);
  }

  private async notify({ sessionId, audiences }: Signal): Promise<void> {
    // A notification can outlive its D1 transaction and race an erase. A missing
    // session must never recreate cursors.
    if (!await this.sessionExists(sessionId)) return;
    const fresh = new Map<string, number>();
    for (const { audience, sequence } of audiences) {
      const prior = await this.state.storage.get<number>(`sequence:${sessionId}:${audience}`) ?? 0;
      if (sequence > Math.max(prior, fresh.get(audience) ?? 0)) fresh.set(audience, sequence);
    }
    // Check grants even when every sequence is old, so a duplicate still closes revoked sockets.
    for (const { socket, attachment, row } of await this.grants()) {
      if (attachment.sessionId !== sessionId) continue;
      if (!fresh.has(row.staff ? 'staff' : `team:${row.team_id}`) && !fresh.has(`account:${row.account_id}`)) continue;
      try { socket.send(JSON.stringify({ type: 'change' })); }
      catch { close(socket, 1011, 'Updates are unavailable. Reconnect.'); }
    }
    // A crash before these writes can duplicate a harmless refresh hint. A crash
    // afterward is safe because every new connection starts with a full refresh.
    for (const [audience, sequence] of fresh) await this.state.storage.put(`sequence:${sessionId}:${audience}`, sequence);
    await this.scheduleAlarm();
  }

  async alarm(): Promise<void> {
    await this.serialize(async () => {
      await this.grants();
      await this.scheduleAlarm();
    }).catch((error: unknown) => {
      logEvent('error', 'live.alarm_error', { task: 'alarm', error });
      throw error;
    });
  }

  /**
   * Closes the sockets and deletes the alarm and all storage. It runs only after
   * the journal holds this contest as a target and its row is gone, so no request
   * can wipe a running contest. A repeat finds nothing left and answers the same.
   */
  private async erase({ sessionId, eventId }: EraseTarget): Promise<Response> {
    const allowed = await this.env.DB.prepare(`SELECT 1 FROM event_deletion_targets t
      WHERE t.event_id = ? AND t.kind = 'contest' AND t.id = ? AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = t.id)`)
      .bind(eventId, sessionId).first();
    if (!allowed) return new Response(null, { status: 409 });
    for (const socket of this.state.getWebSockets()) {
      socket.serializeAttachment(null);
      close(socket, 1008, 'The session is no longer available.');
    }
    if (this.state.getWebSockets().some((socket) => socket.readyState === 1 || socket.deserializeAttachment() != null)) {
      return new Response(null, { status: 503 });
    }
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
    if ((await this.state.storage.list()).size || await this.state.storage.getAlarm() !== null) {
      return new Response(null, { status: 503 });
    }
    return Response.json({ empty: true });
  }

  webSocketMessage(socket: LiveSocket): void {
    close(socket, 1008, 'This connection only receives updates.');
  }

  webSocketClose(socket: LiveSocket): void { close(socket, 1000, 'Closed.'); }
  webSocketError(socket: LiveSocket): void { close(socket, 1011, 'Reconnect for updates.'); }
}

/** Only a trusted HTTP boundary supplies the authenticated caller. */
export function connectLive(request: Request, env: LiveEnvironment, caller: Caller, sessionId: string): Promise<Response> {
  if (!uuid.safeParse(sessionId).success || request.method !== 'GET' ||
      request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return Promise.resolve(new Response(null, { status: 400 }));
  }
  const coordinator = env.LIVE_UPDATES.get(env.LIVE_UPDATES.idFromName(sessionId));
  return coordinator.fetch(new Request('https://live.internal/connect', {
    headers: { Upgrade: 'websocket', 'X-Minsky-Account': caller.accountId,
      'X-Minsky-Login': caller.loginId, 'X-Minsky-Session': sessionId },
  }));
}

// A claim that outlives its dispatcher, for example after a crash or a lost
// response, expires after this time. The next dispatcher then retries it.
const leaseSeconds = 30;
// Stop starting new rounds after this time, so the last round can finish
// inside the 30 seconds that waitUntil allows after a response.
const roundBudgetMs = 10_000;

// One statement claims the rows, so concurrent dispatchers never claim the same row.
export const claimSql = `UPDATE notifications SET claimed_until = ?1 + ${leaseSeconds}, attempts = attempts + 1, last_attempt_at = ?1
  WHERE id IN (SELECT id FROM notifications WHERE delivered = 0 AND COALESCE(claimed_until, 0) <= ?1
    ORDER BY COALESCE(last_attempt_at, 0), session_id, audience, sequence LIMIT ?2)
  RETURNING id, session_id AS sessionId, audience, sequence`;

interface Claimed { id: string; sessionId: string; audience: string; sequence: number }

async function deliverSession(env: LiveEnvironment, sessionId: string, rows: Claimed[]): Promise<boolean> {
  const audiences = new Map<string, number>();
  for (const { audience, sequence } of rows) audiences.set(audience, Math.max(sequence, audiences.get(audience) ?? 0));
  try {
    const coordinator = env.LIVE_UPDATES.get(env.LIVE_UPDATES.idFromName(sessionId));
    const response = await coordinator.fetch(new Request('https://live.internal/notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, audiences: [...audiences].map(([audience, sequence]) => ({ audience, sequence })) }),
    }));
    if (!response.ok) { logEvent('warn', 'live.notify_rejected', { task: 'notify', status: response.status }); return false; }
    await env.DB.prepare('UPDATE notifications SET delivered = 1 WHERE id IN (SELECT value FROM json_each(?)) AND delivered = 0')
      .bind(JSON.stringify(rows.map(({ id }) => id))).run();
    return true;
  } catch (error) { logEvent('error', 'live.notify_error', { task: 'notify', error }); return false; }
}

/**
 * Claim committed outbox records and send one coalesced request for each
 * session. A failed or uncertain delivery stays claimed until its lease
 * expires, and then becomes retryable.
 */
export async function dispatchNotifications(env: LiveEnvironment, requested = claimLimit): Promise<{ delivered: number; failed: number }> {
  const limit = Math.max(1, Math.min(claimLimit, requested));
  const started = Date.now();
  let delivered = 0;
  let failed = 0;
  for (;;) {
    const { results } = await env.DB.prepare(claimSql)
      .bind(Math.floor(Date.now() / 1000), limit).all<Claimed>();
    const sessions = new Map<string, Claimed[]>();
    for (const row of results) {
      const rows = sessions.get(row.sessionId);
      if (rows) rows.push(row); else sessions.set(row.sessionId, [row]);
    }
    const outcomes = await Promise.all([...sessions].map(async ([sessionId, rows]) =>
      ({ rows: rows.length, ok: await deliverSession(env, sessionId, rows) })));
    for (const { rows, ok } of outcomes) { if (ok) delivered += rows; else failed += rows; }
    if (results.length < limit || failed || Date.now() - started >= roundBudgetMs) return { delivered, failed };
  }
}

/** Erases the live state of one contest that the journal of `eventId` names. Throws unless the object verified that it is empty. */
export async function eraseLiveContest(env: Pick<LiveEnvironment, 'LIVE_UPDATES'>, eventId: string, sessionId: string): Promise<void> {
  const coordinator = env.LIVE_UPDATES.get(env.LIVE_UPDATES.idFromName(sessionId));
  const response = await coordinator.fetch(new Request('https://live.internal/erase', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, eventId }),
  }));
  const result = response.ok ? await response.json() as { empty?: boolean } : undefined;
  if (result?.empty !== true) throw new Error('The live state of a contest was not erased.');
}

/**
 * Binding-only maintenance. The public application fetch handler never calls this.
 * A hosted fixture has no reach to the application's Durable Objects, so it asks
 * here for the contests of its own event's journal, after its rows step.
 */
export async function maintainFixtureSessions(request: Request, env: LiveEnvironment): Promise<Response> {
  if (request.method === 'GET' && new URL(request.url).pathname === '/capabilities') {
    return Response.json({ eventLiveErase: 1 });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  let input: unknown;
  try { input = await request.json(); } catch { return new Response(null, { status: 400 }); }
  const parsed = z.object({ eventId: uuid }).strict().safeParse(input);
  if (!parsed.success) return new Response(null, { status: 400 });
  const { eventId } = parsed.data;
  const { results } = await env.DB.prepare(`SELECT id FROM event_deletion_targets WHERE event_id = ? AND kind = 'contest'`)
    .bind(eventId).all<{ id: string }>();
  try {
    for (const { id } of results) await eraseLiveContest(env, eventId, id);
  } catch {
    return new Response(null, { status: 409 });
  }
  return Response.json({ verified: true });
}
