import { z } from 'zod';
import type { Caller } from '../../authentication';
import type { D1Connection } from '../d1/connection';
import { logEvent, requestFields } from './log';
import { currentAccessForLoginsSql, type CurrentAccessRow } from './application';

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
const signalSchema = z.object({
  id: uuid,
  sessionId: uuid,
  audience: z.string().regex(/^(staff|(?:team|account):[0-9a-f-]{36})$/i),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
type Signal = z.infer<typeof signalSchema>;
type SocketAttachment = z.infer<typeof attachmentSchema>;

type LiveAccess = CurrentAccessRow;
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

const cleanupSchema = z.object({ sessionId: uuid, eventId: uuid, runId: uuid }).strict();
type CleanupTarget = z.infer<typeof cleanupSchema>;

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
        const { results } = await this.env.DB.prepare(currentAccessForLoginsSql)
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
      if (['/prepare-cleanup', '/finish-cleanup'].includes(path) && request.method === 'POST') {
        const parsed = cleanupSchema.safeParse(await request.json());
        if (!parsed.success) return new Response(null, { status: 400 });
        return await this.serialize(() => this.cleanup(parsed.data, path === '/prepare-cleanup'));
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
    if (await this.state.storage.get('fixtureCleanup')) return new Response(null, { status: 403 });
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
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit & { webSocket: LiveSocket });
  }

  private async notify(signal: Signal): Promise<void> {
    // A notification can outlive its D1 transaction and race fixture cleanup.
    // Missing sessions and cleanup-fenced sessions must never recreate cursors.
    if (await this.state.storage.get('fixtureCleanup') || !await this.sessionExists(signal.sessionId)) return;
    const key = `sequence:${signal.sessionId}:${signal.audience}`;
    const prior = await this.state.storage.get<number>(key) ?? 0;
    for (const { socket, attachment, row } of await this.grants()) {
      if (attachment.sessionId !== signal.sessionId || signal.sequence <= prior) continue;
      const audience = row.staff ? 'staff' : `team:${row.team_id}`;
      if (signal.audience !== audience && signal.audience !== `account:${row.account_id}`) continue;
      try { socket.send(JSON.stringify({ type: 'change' })); }
      catch { close(socket, 1011, 'Updates are unavailable. Reconnect.'); }
    }
    // A crash before this write can duplicate a harmless refresh hint. A crash
    // afterward is safe because every new connection starts with a full refresh.
    if (signal.sequence > prior) await this.state.storage.put(key, signal.sequence);
    await this.scheduleAlarm();
  }

  async alarm(): Promise<void> {
    await this.serialize(async () => {
      if (await this.state.storage.get('fixtureCleanup')) return;
      await this.grants();
      await this.scheduleAlarm();
    }).catch((error: unknown) => {
      logEvent('error', 'live.alarm_error', { task: 'alarm', error });
      throw error;
    });
  }

  private async cleanup(target: CleanupTarget, prepare: boolean): Promise<Response> {
    const stored = await this.state.storage.get<CleanupTarget>('fixtureCleanup');
    if (stored && !Object.keys(target).every((key) => stored[key as keyof CleanupTarget] === target[key as keyof CleanupTarget])) {
      return new Response(null, { status: 409 });
    }
    const records = await this.state.storage.list();
    if ([...records.keys()].some((key) => key !== 'fixtureCleanup' && !key.startsWith(`sequence:${target.sessionId}:`))) {
      return new Response(null, { status: 409 });
    }
    if (this.state.getWebSockets().some((socket) => {
      const attachment = this.attachment(socket);
      return attachment && attachment.sessionId !== target.sessionId;
    })) return new Response(null, { status: 409 });
    const present = await this.sessionExists(target.sessionId);
    if (prepare && present) {
      const owned = await this.env.DB.prepare(`SELECT 1 FROM sessions s JOIN events e ON e.id = s.event_id
        WHERE s.id = ? AND e.id = ? AND e.name = ?
          AND NOT EXISTS (SELECT 1 FROM installation WHERE event_id = e.id)`)
        .bind(target.sessionId, target.eventId, `Provider contract ${target.runId}`).first();
      if (!owned) return new Response(null, { status: 409 });
      await this.state.storage.put('fixtureCleanup', target);
    } else if (present || !stored && records.size > 0) {
      // A retry after a successful wipe is empty. A nonempty object without its
      // prepared ownership grant cannot be erased after D1 ownership is gone.
      return new Response(null, { status: 409 });
    }
    for (const socket of this.state.getWebSockets()) {
      socket.serializeAttachment(null);
      close(socket, 1008, 'The session is no longer available.');
    }
    if (this.state.getWebSockets().some((socket) => socket.readyState === 1 || socket.deserializeAttachment() != null)) {
      return new Response(null, { status: 503 });
    }
    await this.state.storage.deleteAlarm();
    if (prepare && present) return Response.json({ prepared: true });
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

/** Send committed outbox records. A failed or uncertain delivery stays retryable. */
export async function dispatchNotifications(env: LiveEnvironment, limit = 100): Promise<{ delivered: number; failed: number }> {
  const result = await env.DB.prepare(`SELECT id, session_id AS sessionId, audience, sequence FROM notifications
    WHERE delivered = 0 ORDER BY COALESCE(last_attempt_at, 0), session_id, audience, sequence LIMIT ?`).bind(Math.max(1, Math.min(1000, limit))).all<Signal>();
  let delivered = 0;
  let failed = 0;
  for (const signal of result.results) {
    try {
      await env.DB.prepare('UPDATE notifications SET attempts = attempts + 1, last_attempt_at = unixepoch() WHERE id = ? AND delivered = 0')
        .bind(signal.id).run();
      const coordinator = env.LIVE_UPDATES.get(env.LIVE_UPDATES.idFromName(signal.sessionId));
      const response = await coordinator.fetch(new Request('https://live.internal/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signal),
      }));
      if (!response.ok) { failed++; logEvent('warn', 'live.notify_rejected', { task: 'notify', status: response.status }); continue; }
      await env.DB.prepare('UPDATE notifications SET delivered = 1 WHERE id = ? AND delivered = 0').bind(signal.id).run();
      delivered++;
    } catch (error) { failed++; logEvent('error', 'live.notify_error', { task: 'notify', error }); }
  }
  return { delivered, failed };
}


/** Binding-only maintenance. The public application fetch handler never calls this. */
export async function maintainFixtureSessions(request: Request, env: LiveEnvironment): Promise<Response> {
  if (request.method === 'GET' && new URL(request.url).pathname === '/capabilities') {
    return Response.json({ fixtureSessionCleanup: 1 });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  let input: unknown;
  try { input = await request.json(); } catch { return new Response(null, { status: 400 }); }
  const parsed = z.object({ phase: z.enum(['prepare', 'finish']), eventId: uuid, runId: uuid,
    sessionIds: z.tuple([uuid, uuid]).refine((ids) => ids[0] !== ids[1]) }).strict().safeParse(input);
  if (!parsed.success) return new Response(null, { status: 400 });
  for (const sessionId of parsed.data.sessionIds) {
    const coordinator = env.LIVE_UPDATES.get(env.LIVE_UPDATES.idFromName(sessionId));
    const response = await coordinator.fetch(new Request(`https://live.internal/${parsed.data.phase}-cleanup`, {
      method: 'POST', body: JSON.stringify({ sessionId, eventId: parsed.data.eventId, runId: parsed.data.runId }),
    }));
    if (!response.ok) return new Response(null, { status: 409 });
    const result = await response.json() as { prepared?: boolean; empty?: boolean };
    if (parsed.data.phase === 'finish' ? result.empty !== true : result.prepared !== true && result.empty !== true) {
      return new Response(null, { status: 503 });
    }
  }
  return Response.json({ verified: true });
}
