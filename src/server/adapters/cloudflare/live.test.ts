import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { D1Connection, D1Statement } from '../d1/connection';
import { D1Fixture, applyMigrations } from '../d1/testFixture';
import type { Caller } from '../../authentication';
import { currentAccessBindings, currentAccessForLoginsSql, currentAccessSql, type CurrentAccessRow } from './application';
import { connectLive, dispatchNotifications, maintainFixtureSessions, SessionLiveCoordinator, type LiveEnvironment } from './live';

class FakeSocket {
  messages: string[] = [];
  closed = false;
  failSend = false;
  failClose = false;
  get readyState() { return this.closed ? 3 : 1; }
  private attachment: unknown;
  send(value: string) {
    if (this.failSend) throw new Error('Socket write failed.');
    this.messages.push(value);
  }
  close() { if (this.failClose) throw new Error('Close failed.'); this.closed = true; }
  serializeAttachment(value: unknown) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return structuredClone(this.attachment); }
}

class FakeState {
  sockets: FakeSocket[] = [];
  data = new Map<string, unknown>();
  alarmAt: number | undefined;
  storage = {
    get: async <T>(key: string) => this.data.get(key) as T | undefined,
    put: async <T>(key: string, value: T) => { this.data.set(key, value); },
    setAlarm: async (at: number) => { this.alarmAt = at; },
    deleteAlarm: async () => { this.alarmAt = undefined; },
    getAlarm: async () => this.alarmAt ?? null,
    deleteAll: async () => { this.data.clear(); this.alarmAt = undefined; },
    list: async <T>() => new Map(this.data) as Map<string, T>,
  };
  acceptWebSocket(socket: FakeSocket) { this.sockets.push(socket); }
  getWebSockets() { return this.sockets.filter((socket) => !socket.closed); }
}

interface PendingSignal {
  id: string; sessionId: string; audience: string; sequence: number;
  delivered: number; attempts: number;
  lastAttemptAt?: number;
}

class FakeDatabase implements D1Connection {
  access = new Map<string, CurrentAccessRow>();
  sessions = new Map<string, { eventId: string; runId: string }>();
  pending: PendingSignal[] = [];
  reads = 0;
  unavailable = false;
  failMark = false;
  prepare(sql: string): D1Statement {
    let values: Array<string | number | null> = [];
    return {
      bind(...input) { values = input; return this; },
      first: async <T>() => {
        if (this.unavailable) throw new Error('Database is unavailable.');
        if (sql === 'SELECT id FROM sessions WHERE id = ?') return (this.sessions.has(String(values[0])) ? { id: values[0] } : null) as T | null;
        if (sql.includes('FROM sessions s JOIN events e')) {
          const session = this.sessions.get(String(values[0]));
          return (session?.eventId === values[1] && `Provider contract ${session.runId}` === values[2] ? { owned: 1 } : null) as T | null;
        }
        throw new Error(`Unexpected first: ${sql}`);
      },
      all: async <T>() => {
        if (sql === currentAccessForLoginsSql) {
          if (this.unavailable) throw new Error('Database is unavailable.');
          this.reads++;
          const [sessionId, logins] = [String(values[0]), new Set(JSON.parse(String(values[1])) as string[])];
          return { results: [...this.access].filter(([key, row]) => logins.has(row.login_id) &&
            key === [row.account_id, row.login_id, sessionId].join(':')).map(([, row]) => row) as T[] };
        }
        return this.notifications<T>(Number(values[0]));
      },
      run: async () => {
        const signal = this.pending.find((item) => item.id === values[0]);
        if (!signal) return;
        if (sql.includes('attempts = attempts + 1')) {
          signal.attempts++;
          signal.lastAttemptAt = Math.floor(Date.now() / 1000);
        }
        if (sql.includes('delivered = 1')) {
          if (this.failMark) { this.failMark = false; throw new Error('Commit response unavailable.'); }
          signal.delivered = 1;
        }
      },
    };
  }
  private notifications<T>(limit: number) {
    return { results: this.pending.filter((signal) => !signal.delivered)
      .sort((left, right) => (left.lastAttemptAt ?? 0) - (right.lastAttemptAt ?? 0) ||
        left.sessionId.localeCompare(right.sessionId) || left.audience.localeCompare(right.audience) || left.sequence - right.sequence)
      .slice(0, limit).map(({ id, sessionId, audience, sequence }) => ({ id, sessionId, audience, sequence })) as T[] };
  }
  async batch(): Promise<unknown[]> { throw new Error('Unexpected batch.'); }
}

const NativeResponse = Response;

beforeEach(() => {
  // Node rejects 101, while the Worker runtime returns its paired WebSocket.
  vi.stubGlobal('Response', class extends NativeResponse {
    readonly webSocket: unknown;
    constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
      super(body, init?.status === 101 ? { status: 200 } : init);
      this.webSocket = init?.webSocket;
    }
  });
  vi.stubGlobal('WebSocketPair', class {
    0 = new FakeSocket();
    1 = new FakeSocket();
  });
});

describe('outbox retry fairness with real local D1', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    const platform = await getPlatformProxy<{ DB: D1Connection }>({
      configPath: 'wrangler.auth-ci.jsonc', persist: false, remoteBindings: false, envFiles: [],
    });
    db = platform.env.DB;
    dispose = platform.dispose;
    await applyMigrations(db);
  }, 120_000);
  afterAll(async () => { if (dispose) await dispose(); }, 120_000);

  it('reads the same grants in one batch as the single-caller check', async () => {
    const fixture = new D1Fixture(db, 'wrangler.auth-ci.jsonc', true);
    await fixture.create();
    try {
      await db.prepare('UPDATE logins SET revoked = 1 WHERE id = ?').bind(fixture.specialist.loginId).run();
      const callers = [fixture.staff, fixture.specialist, fixture.contestant, fixture.otherContestant,
        { accountId: fixture.staff.accountId, loginId: fixture.contestant.loginId }];
      for (const sessionId of [fixture.sessionId, fixture.secondSessionId]) {
        const single = (await Promise.all(callers.map((caller) => db.prepare(currentAccessSql)
          .bind(...currentAccessBindings(caller, sessionId)).first<CurrentAccessRow>()))).filter((row) => row !== null);
        const batched = await db.prepare(currentAccessForLoginsSql)
          .bind(sessionId, JSON.stringify(callers.map((caller) => caller.loginId))).all<CurrentAccessRow>();
        const byLogin = (rows: CurrentAccessRow[]) => [...rows].sort((left, right) => left.login_id.localeCompare(right.login_id));
        expect(byLogin(batched.results)).toEqual(byLogin(single));
        expect(single.length).toBe(sessionId === fixture.sessionId ? 3 : 1);
      }

      let reads = 0;
      const counted: D1Connection = { batch: (statements) => db.batch(statements), prepare: (sql) => {
        const statement = db.prepare(sql);
        const wrap = (inner: D1Statement): D1Statement => ({
          bind: (...values) => wrap(inner.bind(...values)),
          first: () => { reads++; return inner.first(); },
          all: () => { reads++; return inner.all(); },
          run: () => { reads++; return inner.run(); },
        });
        return wrap(statement);
      } };
      const state = new FakeState();
      const coordinator = new SessionLiveCoordinator(state, { DB: counted });
      const env: LiveEnvironment = { DB: counted, LIVE_UPDATES: { idFromName: (name) => name, get: () => ({ fetch: (request) => coordinator.fetch(request) }) } };
      const connect = async (caller: Caller) => {
        expect((await connectLive(new Request('https://example.invalid', { headers: { Upgrade: 'websocket' } }), env, caller, fixture.sessionId)).ok).toBe(true);
        return state.sockets.at(-1)!;
      };
      const [staff, contestant, other] = [await connect(fixture.staff), await connect(fixture.contestant), await connect(fixture.otherContestant)];
      const mispaired = new FakeSocket();
      mispaired.serializeAttachment({ accountId: fixture.staff.accountId, loginId: fixture.contestant.loginId,
        sessionId: fixture.sessionId, expiresAt: Date.now() + 60_000 });
      state.acceptWebSocket(mispaired);
      const signal = (audience: string, sequence: number) => coordinator.fetch(new Request('https://live.internal/notify', {
        method: 'POST', body: JSON.stringify({ id: randomUUID(), sessionId: fixture.sessionId, audience, sequence }) }));
      reads = 0;
      expect((await signal(`team:${fixture.teamId}`, 1)).status).toBe(204);
      expect(reads).toBe(2);
      expect([staff, contestant, other].map((socket) => socket.messages.length)).toEqual([1, 2, 1]);
      expect(mispaired.closed).toBe(true);
      expect(mispaired.messages).toEqual([]);
      await db.prepare('UPDATE logins SET revoked = 1 WHERE id = ?').bind(fixture.staff.loginId).run();
      expect((await signal('staff', 1)).status).toBe(204);
      expect(staff.closed).toBe(true);
      expect(staff.messages).toHaveLength(1);
    } finally { await fixture.cleanup(); }
  }, 120_000);

  it('delivers a later session while the first 100 records keep failing', async () => {
    const fixture = new D1Fixture(db, 'wrangler.auth-ci.jsonc');
    await fixture.create();
    try {
      const [unavailable, healthy] = [fixture.sessionId, fixture.secondSessionId].sort();
      await db.batch([
        fixture.statement("INSERT INTO audience_sequences (session_id, audience, sequence) VALUES (?, 'staff', 100), (?, 'staff', 1)", unavailable, healthy),
        ...Array.from({ length: 100 }, (_, index) => fixture.statement(
          "INSERT INTO notifications (id, session_id, audience, sequence) VALUES (?, ?, 'staff', ?)", randomUUID(), unavailable, index + 1)),
        fixture.statement("INSERT INTO notifications (id, session_id, audience, sequence) VALUES (?, ?, 'staff', 1)", randomUUID(), healthy),
      ]);
      const env: LiveEnvironment = { DB: db, LIVE_UPDATES: {
        idFromName: (name) => name,
        get: (id) => ({ fetch: async () => new NativeResponse(null, { status: id === healthy ? 204 : 503 }) }),
      } };
      expect(await dispatchNotifications(env)).toEqual({ delivered: 0, failed: 100 });
      expect(await dispatchNotifications(env)).toEqual({ delivered: 1, failed: 99 });
      expect(await fixture.rows('SELECT delivered, attempts FROM notifications WHERE session_id = ?', healthy))
        .toEqual([{ delivered: 1, attempts: 1 }]);
      expect(await fixture.rows('SELECT count(*) AS count FROM notifications WHERE session_id = ? AND delivered = 0', unavailable))
        .toEqual([{ count: 100 }]);
    } finally { await fixture.cleanup(); }
  }, 120_000);
});
afterEach(() => { vi.unstubAllGlobals(); });

function fixture() {
  const sessionId = randomUUID();
  const teamId = randomUUID();
  const otherTeamId = randomUUID();
  const db = new FakeDatabase();
  const eventId = randomUUID();
  const runId = randomUUID();
  db.sessions.set(sessionId, { eventId, runId });
  const state = new FakeState();
  const coordinator = new SessionLiveCoordinator(state, { DB: db });
  const account = (staff: boolean, team: string | null) => {
    const caller = { accountId: randomUUID(), loginId: randomUUID() };
    db.access.set([caller.accountId, caller.loginId, sessionId].join(':'), {
      account_id: caller.accountId, account_name: 'Fictional person', login_id: caller.loginId,
      access_version: 1, credential_generation: 1, login_version: 1, membership_version: 1,
      session_version: 1, event_version: 1, archived: 0, team_id: team, is_admin: 0,
      staff: Number(staff), roles: staff ? '["volunteer"]' : '[]',
      login_expires_at: Math.floor(Date.now() / 1000) + 3600,
      identity_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    return caller;
  };
  const staff = account(true, null);
  const contestant = account(false, teamId);
  const otherContestant = account(false, otherTeamId);
  const env: LiveEnvironment = { DB: db, LIVE_UPDATES: {
    idFromName: (name) => name,
    get: () => ({ fetch: (request) => coordinator.fetch(request) }),
  } };
  const connect = async (caller = staff) => {
    const response = await connectLive(new Request('https://example.invalid/api/updates', { headers: { Upgrade: 'websocket' } }), env, caller, sessionId);
    expect(response.ok).toBe(true);
    return state.sockets.at(-1)!;
  };
  const signal = async (audience: string, sequence = 1) => coordinator.fetch(new Request('https://live.internal/notify', {
    method: 'POST', body: JSON.stringify({ id: randomUUID(), sessionId, audience, sequence }),
  }));
  return { sessionId, eventId, runId, teamId, otherTeamId, staff, contestant, otherContestant, db, state, coordinator, env, connect, signal, account };
}

describe('Durable Object live updates', () => {
  it('authorizes the connection, sends ready, and stores no client role claim', async () => {
    const test = fixture();
    const socket = await test.connect();
    expect(socket.messages).toEqual(['{"type":"ready"}']);
    expect(socket.deserializeAttachment()).toEqual({ ...test.staff, sessionId: test.sessionId, expiresAt: expect.any(Number) });
    expect(test.db.reads).toBe(1);
    expect(test.state.alarmAt).toBeGreaterThan(Date.now());
    expect(test.state.alarmAt).toBeLessThanOrEqual(Date.now() + 30_000);
    test.db.access.clear();
    const denied = await connectLive(new Request('https://example.invalid', { headers: { Upgrade: 'websocket' } }), test.env, test.staff, test.sessionId);
    expect(denied.status).toBe(403);
  });

  it('separates staff, team, and account audiences and sends only refresh hints', async () => {
    const test = fixture();
    const staff = await test.connect();
    const team = await test.connect(test.contestant);
    const other = await test.connect(test.otherContestant);
    expect((await test.signal('staff')).status).toBe(204);
    expect(staff.messages).toEqual(['{"type":"ready"}', '{"type":"change"}']);
    expect(team.messages).toHaveLength(1);
    expect(other.messages).toHaveLength(1);
    await test.signal(`team:${test.teamId}`);
    expect(team.messages).toEqual(['{"type":"ready"}', '{"type":"change"}']);
    expect(other.messages).toHaveLength(1);
    await test.signal(`account:${test.otherContestant.accountId}`);
    expect(other.messages).toEqual(['{"type":"ready"}', '{"type":"change"}']);
    // One read for each connection and one batched read for each signal.
    expect(test.db.reads).toBe(6);
  });

  it('closes revoked sessions before delivery and rechecks changed role and team grants', async () => {
    const test = fixture();
    const staff = await test.connect();
    const contestant = await test.connect(test.contestant);
    const key = [test.contestant.accountId, test.contestant.loginId, test.sessionId].join(':');
    const member = test.db.access.get(key)!;
    test.db.access.set(key, { ...member, team_id: test.otherTeamId });
    await test.signal(`team:${test.teamId}`);
    expect(contestant.messages).toHaveLength(1);
    test.db.access.delete([test.staff.accountId, test.staff.loginId, test.sessionId].join(':'));
    await test.signal('staff');
    expect(staff.closed).toBe(true);
    expect(staff.messages).toHaveLength(1);
    await test.signal(`team:${test.otherTeamId}`);
    expect(contestant.messages).toHaveLength(2);
  });

  it('deduplicates ordered and late signals after hibernation while still checking revocation', async () => {
    const test = fixture();
    const socket = await test.connect();
    await test.signal('staff', 2);
    await test.signal('staff', 1);
    await test.signal('staff', 2);
    expect(socket.messages).toHaveLength(2);
    const resumed = new SessionLiveCoordinator(test.state, { DB: test.db });
    const notify = (sequence: number) => resumed.fetch(new Request('https://live.internal/notify', {
      method: 'POST', body: JSON.stringify({ id: randomUUID(), sessionId: test.sessionId, audience: 'staff', sequence }),
    }));
    await notify(2);
    expect(socket.messages).toHaveLength(2);
    await notify(3);
    expect(socket.messages).toHaveLength(3);
    test.db.access.clear();
    await notify(3);
    expect(socket.closed).toBe(true);
  });

  it('retains retryability during a database failure and recovers after an uncertain response', async () => {
    const test = fixture();
    const socket = await test.connect();
    test.db.pending.push({ id: randomUUID(), sessionId: test.sessionId, audience: 'staff', sequence: 1, delivered: 0, attempts: 0 });
    test.db.unavailable = true;
    expect(await dispatchNotifications(test.env)).toEqual({ delivered: 0, failed: 1 });
    expect(test.db.pending[0]).toMatchObject({ delivered: 0, attempts: 1 });
    test.db.unavailable = false;
    test.db.failMark = true;
    expect(await dispatchNotifications(test.env)).toEqual({ delivered: 0, failed: 1 });
    expect(socket.messages).toHaveLength(2);
    expect(await dispatchNotifications(test.env)).toEqual({ delivered: 1, failed: 0 });
    expect(test.db.pending[0]).toMatchObject({ delivered: 1, attempts: 3 });
    expect(socket.messages).toHaveLength(2);
  });

  it('refreshes after reconnect and recovers revocation through an alarm if delivery was interrupted', async () => {
    const test = fixture();
    const first = await test.connect();
    first.close();
    const second = await test.connect();
    expect(second.messages).toEqual(['{"type":"ready"}']);
    test.db.access.clear();
    await test.coordinator.alarm();
    expect(second.closed).toBe(true);
    expect(test.state.alarmAt).toBeUndefined();
  });

  it('uses the earliest credential expiry for an idle socket alarm', async () => {
    const test = fixture();
    const key = [test.staff.accountId, test.staff.loginId, test.sessionId].join(':');
    const row = test.db.access.get(key)!;
    const expiry = Date.now() + 1000;
    test.db.access.set(key, { ...row, identity_expires_at: new Date(expiry).toISOString() });
    await test.connect();
    expect(test.state.alarmAt).toBe(expiry);
    test.db.access.clear();
    await test.coordinator.alarm();
    expect(test.state.sockets[0].closed).toBe(true);
  });

  it('closes a failed transport and lets a new connection refresh without poisoning dispatch', async () => {
    const test = fixture();
    const socket = await test.connect();
    socket.failSend = true;
    expect((await test.signal('staff')).status).toBe(204);
    expect(socket.closed).toBe(true);
    const replacement = await test.connect();
    expect(replacement.messages).toEqual(['{"type":"ready"}']);
    test.coordinator.webSocketMessage(replacement);
    expect(replacement.closed).toBe(true);
  });

  it('checks 1,000 sockets with batched reads and still closes revoked members and separates teams', async () => {
    const test = fixture();
    const teams = [test.teamId, test.otherTeamId];
    const callers = Array.from({ length: 1000 }, (_, index) => {
      const team = index % 5 === 0 ? null : teams[index % 2];
      const caller = test.account(team === null, team);
      const socket = new FakeSocket();
      socket.serializeAttachment({ ...caller, sessionId: test.sessionId, expiresAt: Date.now() + 60_000 });
      test.state.acceptWebSocket(socket);
      return { caller, team, socket };
    });
    const revoked = callers.find(({ team }) => team === test.teamId)!;
    test.db.access.delete([revoked.caller.accountId, revoked.caller.loginId, test.sessionId].join(':'));
    const teamLogin = callers.filter(({ team }) => team === test.teamId)[1].caller.loginId;
    const mispaired = new FakeSocket();
    mispaired.serializeAttachment({ accountId: test.staff.accountId, loginId: teamLogin, sessionId: test.sessionId, expiresAt: Date.now() + 60_000 });
    test.state.acceptWebSocket(mispaired);
    const changed = () => callers.filter(({ socket }) => socket.messages.length > 0);
    test.db.reads = 0;
    expect((await test.signal(`team:${test.teamId}`)).status).toBe(204);
    expect(test.db.reads).toBe(2);
    expect(revoked.socket.closed).toBe(true);
    expect(mispaired.closed).toBe(true);
    expect(mispaired.messages).toEqual([]);
    expect(changed().map(({ team }) => team)).toEqual(Array(399).fill(test.teamId));
    test.db.reads = 0;
    await test.coordinator.alarm();
    expect(test.db.reads).toBe(2);
    expect(test.state.getWebSockets()).toHaveLength(999);
    test.db.unavailable = true;
    expect((await test.signal('staff')).status).toBe(503);
    expect(callers.filter(({ team, socket }) => team === null && socket.messages.length > 0)).toEqual([]);
    expect(test.state.getWebSockets()).toHaveLength(999);
  });

  it('rejects malformed notifications and unsupported connection inputs', async () => {
    const test = fixture();
    expect((await test.coordinator.fetch(new Request('https://live.internal/notify', { method: 'POST', body: '{}' }))).status).toBe(400);
    expect((await connectLive(new Request('https://example.invalid'), test.env, test.staff, test.sessionId)).status).toBe(400);
    expect((await test.coordinator.fetch(new Request('https://live.internal/unknown'))).status).toBe(404);
    expect(test.state.sockets).toEqual([]);
  });
});


describe('binding-only fixture Durable Object cleanup', () => {
  async function cleanup(test: ReturnType<typeof fixture>, phase: 'prepare' | 'finish', changes = {}) {
    return test.coordinator.fetch(new Request(`https://live.internal/${phase}-cleanup`, {
      method: 'POST', body: JSON.stringify({ sessionId: test.sessionId, eventId: test.eventId, runId: test.runId, ...changes }),
    }));
  }

  it('requires an owned fixture before preparing and an absent session before erasing storage', async () => {
    const test = fixture();
    const socket = await test.connect();
    await test.signal('staff');
    const stored = new Map(test.state.data);
    expect((await cleanup(test, 'prepare', { runId: randomUUID() })).status).toBe(409);
    expect(test.state.data).toEqual(stored);
    expect(socket.closed).toBe(false);
    expect((await cleanup(test, 'finish')).status).toBe(409);
    expect((await cleanup(test, 'prepare')).status).toBe(200);
    expect(socket.closed).toBe(true);
    expect(socket.deserializeAttachment()).toBeNull();
    expect(test.state.alarmAt).toBeUndefined();
    expect((await cleanup(test, 'finish')).status).toBe(409);
    expect(test.state.data.size).toBeGreaterThan(0);
    test.db.sessions.delete(test.sessionId);
    test.db.access.clear();
    expect(await (await cleanup(test, 'finish')).json()).toEqual({ empty: true });
    expect(test.state.data.size).toBe(0);
    expect(test.state.alarmAt).toBeUndefined();
  });

  it('survives lost responses, fences late messages, and does not recreate deleted-session cursors', async () => {
    const test = fixture();
    await test.connect();
    await test.signal('staff');
    expect((await cleanup(test, 'prepare')).status).toBe(200);
    const fenced = new Map(test.state.data);
    await test.signal('staff', 2);
    expect(test.state.data).toEqual(fenced);
    const denied = await connectLive(new Request('https://example.invalid', { headers: { Upgrade: 'websocket' } }), test.env, test.staff, test.sessionId);
    expect(denied.status).toBe(403);
    expect((await cleanup(test, 'prepare', { eventId: randomUUID() })).status).toBe(409);
    test.db.sessions.delete(test.sessionId);
    test.db.access.clear();
    // A resumed coordinator reads the persisted ownership grant.
    const resumed = new SessionLiveCoordinator(test.state, { DB: test.db });
    test.coordinator = resumed;
    expect((await cleanup(test, 'finish')).status).toBe(200);
    expect((await cleanup(test, 'finish')).status).toBe(200);
    await test.signal('staff', 99);
    await resumed.alarm();
    expect(test.state.data.size).toBe(0);
    expect(test.state.alarmAt).toBeUndefined();
  });

  it('refuses foreign cursor or attachment state and requires a successful socket close', async () => {
    const test = fixture();
    const socket = await test.connect();
    test.state.data.set(`sequence:${randomUUID()}:staff`, 1);
    expect((await cleanup(test, 'prepare')).status).toBe(409);
    expect(socket.closed).toBe(false);
    test.state.data.clear();
    socket.serializeAttachment({ ...test.staff, sessionId: randomUUID(), expiresAt: Date.now() + 1000 });
    expect((await cleanup(test, 'prepare')).status).toBe(409);
    socket.serializeAttachment({ ...test.staff, sessionId: test.sessionId, expiresAt: Date.now() + 1000 });
    socket.failClose = true;
    expect((await cleanup(test, 'prepare')).status).toBe(503);
    expect(test.state.data.has('fixtureCleanup')).toBe(true);
    socket.failClose = false;
    expect((await cleanup(test, 'prepare')).status).toBe(200);
  });

  it('does not erase nonempty absent-session state without a prepared ownership grant', async () => {
    const test = fixture();
    await test.signal('staff');
    test.db.sessions.delete(test.sessionId);
    expect((await cleanup(test, 'finish')).status).toBe(409);
    expect(test.state.data.size).toBe(1);
  });

  it('verifies both exact session objects through the internal maintenance binding', async () => {
    const calls: Array<{ name: unknown; body: unknown }> = [];
    const sessions = [randomUUID(), randomUUID()];
    let selected: unknown;
    const env: LiveEnvironment = { DB: new FakeDatabase(), LIVE_UPDATES: {
      idFromName: (name) => name,
      get: (name) => { selected = name; return { fetch: async (request) => {
        calls.push({ name: selected, body: await request.json() });
        return Response.json({ empty: true });
      } }; },
    } };
    const request = () => new Request('https://maintenance.internal/sessions', { method: 'POST',
      body: JSON.stringify({ phase: 'finish', eventId: randomUUID(), runId: randomUUID(), sessionIds: sessions }) });
    expect(await (await maintainFixtureSessions(request(), env)).json()).toEqual({ verified: true });
    expect(calls.map((call) => call.name)).toEqual(sessions);
    expect((await maintainFixtureSessions(new Request('https://maintenance.internal/capabilities'), env)).status).toBe(200);
    expect((await maintainFixtureSessions(new Request('https://maintenance.internal/sessions'), env)).status).toBe(405);
  });
});

describe('real local named maintenance service binding', () => {
  it('uses the internal entrypoint to erase only prepared fixture objects and rejects late persistence', async () => {
    const { createTestHarness } = await import('wrangler');
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join, resolve } = await import('node:path');
    const directory = await mkdtemp(join(tmpdir(), 'minsky-maintenance-binding-'));
    const clientPath = join(directory, 'client.ts');
    await writeFile(clientPath, 'export default { fetch(request, env) { return env.MAINTENANCE.fetch(request); } };');
    const harness = createTestHarness({ workers: [
      { config: {
        name: 'minsky-maintenance-application-local', main: resolve('src/server/adapters/cloudflare/applicationWorker.ts'),
        compatibility_date: '2026-10-13', compatibility_flags: ['nodejs_compat'],
        d1_databases: [{ binding: 'DB', database_name: 'minsky-maintenance-local', database_id: randomUUID() }],
        durable_objects: { bindings: [{ name: 'LIVE_UPDATES', class_name: 'SessionLiveCoordinator' }] },
        migrations: [{ tag: 'v1', new_sqlite_classes: ['SessionLiveCoordinator'] }],
      } },
      { config: {
        name: 'minsky-maintenance-client-local', main: clientPath, compatibility_date: '2026-10-13',
        services: [{ binding: 'MAINTENANCE', service: 'minsky-maintenance-application-local', entrypoint: 'SessionMaintenance' }],
      } },
    ] });
    try {
      await harness.listen();
      const application = harness.getWorker<LiveEnvironment>('minsky-maintenance-application-local');
      const client = harness.getWorker('minsky-maintenance-client-local');
      const env = await application.getEnv();
      await applyMigrations(env.DB);
      const eventId = randomUUID();
      const runId = randomUUID();
      const sessionIds = [randomUUID(), randomUUID()];
      const controlEvent = randomUUID();
      const controlSession = randomUUID();
      await env.DB.batch([
        env.DB.prepare('INSERT INTO events (id, name) VALUES (?, ?), (?, ?)').bind(eventId, `Provider contract ${runId}`, controlEvent, 'Unrelated control'),
        env.DB.prepare('INSERT INTO sessions (id, event_id) VALUES (?, ?), (?, ?), (?, ?)')
          .bind(sessionIds[0], eventId, sessionIds[1], eventId, controlSession, controlEvent),
      ]);
      const signal = (sessionId: string) => env.LIVE_UPDATES.get(env.LIVE_UPDATES.idFromName(sessionId)).fetch(
        new Request('https://live.internal/notify', { method: 'POST',
          body: JSON.stringify({ id: randomUUID(), sessionId, audience: 'staff', sequence: 1 }) }));
      expect((await signal(sessionIds[0])).status).toBe(204);
      expect((await signal(controlSession)).status).toBe(204);
      const maintenance = (phase: string) => client.fetch('https://maintenance.internal/sessions', {
        method: 'POST', body: JSON.stringify({ phase, eventId, runId, sessionIds }),
      });
      expect((await client.fetch('https://maintenance.internal/capabilities')).status).toBe(200);
      expect(await (await maintenance('prepare')).json()).toEqual({ verified: true });
      expect((await maintenance('finish')).status).toBe(409);
      await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(eventId).run();
      expect(await (await maintenance('finish')).json()).toEqual({ verified: true });
      expect(await (await maintenance('finish')).json()).toEqual({ verified: true });
      expect((await signal(sessionIds[0])).status).toBe(204);
      // Finalization itself verifies the real storage list and alarm. An
      // unexpected cursor recreated by the late signal has no grant and fails.
      expect(await (await maintenance('finish')).json()).toEqual({ verified: true });
      expect(await env.DB.prepare('SELECT id FROM sessions WHERE id = ?').bind(controlSession).first()).not.toBeNull();
    } finally {
      await harness.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
