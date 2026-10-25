import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { clearTimeout, setInterval, setTimeout } from 'node:timers';
import { parentPort, workerData } from 'node:worker_threads';
import { createClient, csrfToken, now, RequestFailure } from './client.mjs';
import { derivePassword } from './fixtures.mjs';
import { addSample, failures } from './stats.mjs';

const { AbortController } = globalThis;

// Worker thread. Each virtual user repeats the requests that the Minsky
// frontend sends for one signed-in browser tab (src/connected/hooks/*,
// src/connected/Avatars.tsx, src/backend/cloudflare/*). Keep it in step with them.

const { origin, sessionId, runId, secret, settings } = workerData;
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

let samples = {};
let commits = [];
let observations = [];
let hints = 0;
let droppedRefreshes = 0;
let largestSnapshotIssues = 0;
let stepRequests = 0;
let stepFailures = 0;
let activeStaff = 1;
let commandsEnabled = true;
const users = [];

function record(name, ms, outcome, bytes) {
  addSample(samples, name, ms, outcome, bytes);
  stepRequests++;
  if (failures({ [outcome]: 1 })) stepFailures++;
}

const random = (low, high) => low + Math.random() * (high - low);
const exponential = (perSecond) => (-Math.log(1 - Math.random()) / perSecond) * 1000;

class VirtualUser {
  constructor(account) {
    this.account = account;
    this.id = account.username;
    this.staff = account.kind === 'staff';
    this.client = createClient(origin, { record, timeoutMs: settings.timeoutMs });
    this.active = false;
    this.connected = false;
    this.timers = new Map();
    this.seen = new Map();
    this.replied = new Set();
    this.queue = Promise.resolve();
    this.pending = 0;
    this.reconnectDelay = 500;
    this.submitted = 0;
  }

  /** Replaces the named timer. Timers stop with the user. */
  after(name, ms, run) {
    clearTimeout(this.timers.get(name));
    this.timers.set(name, setTimeout(() => { if (this.active) run(); }, ms));
  }

  get(name, path, options) {
    return this.client.request(name, path, options);
  }

  /** Resolves true when the account had to replace its temporary password. */
  async signIn() {
    const { username, temporary, changed } = this.account;
    const derived = derivePassword(secret, username);
    let used;
    for (const password of changed ? [derived, temporary] : [temporary, derived]) {
      try {
        await this.client.request('sign-in', '/api/auth/sign-in', { method: 'POST', body: { username, password } });
        used = password;
        break;
      } catch (error) {
        if (!(error instanceof RequestFailure && error.status === 401)) throw error;
      }
    }
    if (!used) throw new Error('The account rejected both of its known passwords.');
    let session = (await this.get('auth-session', '/api/auth/session')).body;
    const first = session.status.must_change;
    if (first) {
      const csrf = await csrfToken(this.client);
      await this.client.request('change-password', '/api/auth/change-password', {
        method: 'POST', csrf, body: { currentPassword: used, newPassword: derived },
      });
      session = (await this.get('auth-session', '/api/auth/session')).body;
    }
    parentPort.postMessage({ type: 'changed', username });
    this.userId = session.user.id;
    return first;
  }

  async start(delayMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    this.active = true;
    const started = now();
    try {
      const first = await this.signIn();
      addSample(samples, first ? 'action:first-sign-in' : 'action:sign-in', now() - started, 'ok');
    } catch (error) {
      addSample(samples, this.account.changed ? 'action:sign-in' : 'action:first-sign-in', now() - started,
        error instanceof RequestFailure ? error.outcome : 'client');
      this.active = false;
      return;
    }
    const loaded = now();
    void this.accountStatus();
    await this.refresh(null);
    addSample(samples, 'action:first-load', now() - loaded, this.snapshot ? 'ok' : 'server');
    parentPort.postMessage({ type: 'window', observer: this.id, staff: this.staff, teamId: this.account.teamId, from: now() });
    this.side();
    this.connect();
    this.after('poll', random(0, settings.pollMs), () => this.poll());
    this.after('status', random(0, settings.pollMs), () => this.accountStatus());
    this.after('auth', random(0, settings.authPollMs), () => this.authCheck());
    if (this.staff) this.after('work', random(0, settings.thinkMs[1]), () => this.staffTurn());
    else if (settings.submitPerSecondPerAccount > 0) this.after('work', exponential(settings.submitPerSecondPerAccount), () => this.teamTurn());
  }

  stop() {
    this.active = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.announcements?.abort();
    this.connected = false;
    try { this.socket?.close(); } catch { /* already closed */ }
    parentPort.postMessage({ type: 'window', observer: this.id, to: now() });
  }

  /** useSessionSnapshot: reads queue one after another, without merging. */
  refresh(hintAt) {
    if (this.pending >= settings.maxQueuedRefreshes) {
      droppedRefreshes++;
      return this.queue;
    }
    this.pending++;
    this.queue = this.queue.then(() => this.load(hintAt)).finally(() => { this.pending--; });
    return this.queue;
  }

  async load(hintAt) {
    if (!this.active) return;
    try {
      await this.get('sessions', '/api/sessions');
      const snapshot = (await this.get('snapshot', `/api/snapshot?sessionId=${sessionId}`)).body;
      this.observe(snapshot, now(), hintAt);
      this.snapshot = snapshot;
    } catch { /* The request was recorded. The next trigger reads again. */ }
  }

  observe(snapshot, at, hintAt) {
    largestSnapshotIssues = Math.max(largestSnapshotIssues, snapshot.issues?.length ?? 0);
    for (const issue of snapshot.issues ?? []) {
      const prior = this.seen.get(issue.id);
      if (prior !== undefined && issue.revision <= prior) continue;
      this.seen.set(issue.id, issue.revision);
      observations.push({ observer: this.id, issueId: issue.id, revision: issue.revision, at, hintAt });
    }
  }

  /** Announcements and Avatars restart their 10 s polls on every live signal. */
  side() {
    this.announcements?.abort();
    const controller = new AbortController();
    this.announcements = controller;
    this.get('announcements', `/api/announcements?sessionId=${sessionId}`, { signal: controller.signal }).catch(() => {});
    this.get('avatars', `/api/avatars?sessionId=${sessionId}`).catch(() => {});
    this.after('side', settings.pollMs, () => this.side());
  }

  poll() {
    void this.refresh(null);
    this.after('poll', settings.pollMs, () => this.poll());
  }

  async accountStatus() {
    this.after('status', settings.pollMs, () => this.accountStatus());
    await this.get('auth-session', '/api/auth/session').catch(() => {});
  }

  async authCheck() {
    this.after('auth', settings.authPollMs, () => this.authCheck());
    await this.get('auth-session', '/api/auth/session').catch(() => {});
  }

  connect() {
    if (!this.active) return;
    const started = now();
    let ready = false;
    let ended = false;
    let socket;
    // A socket can stall before it opens without a close event. End it here
    // once, so a stalled handshake still counts and reconnects.
    const end = (outcome) => {
      if (ended) return;
      ended = true;
      clearTimeout(handshake);
      try { socket?.close(); } catch { /* already closed */ }
      if (!this.active) return;
      this.connected = false;
      record(ready ? 'ws-drop' : 'ws-ready', ready ? 0 : now() - started, outcome, 0);
      this.after('reconnect', this.reconnectDelay, () => this.connect());
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    };
    const handshake = setTimeout(() => end('timeout'), 10_000);
    try {
      socket = this.client.webSocket(`/api/updates?sessionId=${sessionId}`);
    } catch {
      end('socket');
      return;
    }
    this.socket = socket;
    socket.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'ready' && !ready) {
        ready = true;
        clearTimeout(handshake);
        record('ws-ready', now() - started, 'ok', 0);
        this.reconnectDelay = 500;
        this.connected = true;
        void this.refresh(null);
        this.side();
      } else if (message.type === 'change' && ready) {
        hints++;
        void this.refresh(now());
        this.side();
      }
    };
    socket.onclose = () => end('socket');
    socket.onerror = () => end('socket');
  }

  /** The command, then the refresh that the frontend waits for before it enables controls again. */
  async act(kind, command, minRevision, teamId) {
    const started = now();
    let outcome = 'ok';
    try {
      const csrf = await csrfToken(this.client);
      const sentAt = now();
      const result = await this.client.request(`workflow:${kind}`, '/api/workflow', {
        method: 'POST', csrf, body: { sessionId, requestId: randomUUID(), command },
      });
      const at = now();
      if (result.body?.outcome === 'committed') {
        commits.push({ actor: this.id, kind, issueId: result.body.issueId, teamId, minRevision, sentAt, at });
      } else {
        outcome = ['state', 'request_id'].includes(result.body?.reason) ? 'conflict' : 'client';
      }
      await this.refresh(null);
    } catch (error) {
      outcome = error instanceof RequestFailure ? error.outcome : 'client';
    }
    addSample(samples, `action:${kind}`, now() - started, outcome);
  }

  async teamTurn() {
    if (commandsEnabled && this.snapshot) {
      const claimed = this.snapshot.issues.filter((issue) => issue.status === 'claimed');
      const session = this.snapshot.session;
      if (claimed.length && Math.random() < settings.teamReplyShare) {
        const issue = claimed[Math.floor(Math.random() * claimed.length)];
        await this.act('message', { type: 'message', issue_id: issue.id, revision: issue.revision,
          text: 'Fictional load-test team reply.', visibility: 'public' }, issue.revision + 1, issue.team_id);
      } else if (session?.intake_open) {
        this.submitted++;
        await this.act('submit', { type: 'submit', category: session.categories[this.submitted % session.categories.length],
          description: `Fictional load-test issue ${runId} ${this.id} ${this.submitted}.` }, null, this.account.teamId);
      }
    }
    this.after('work', exponential(settings.submitPerSecondPerAccount), () => this.teamTurn());
  }

  async staffTurn() {
    if (commandsEnabled && this.snapshot) {
      const issues = this.snapshot.issues;
      const mine = issues.find((issue) => issue.status === 'claimed' && issue.owner === this.userId);
      if (mine && !this.replied.has(mine.id)) {
        this.replied.add(mine.id);
        await this.act('message', { type: 'message', issue_id: mine.id, revision: mine.revision,
          text: 'Fictional load-test staff reply.', visibility: 'public' }, mine.revision + 1, mine.team_id);
      } else if (mine) {
        await this.act('resolve', { type: 'resolve', issue_id: mine.id, revision: mine.revision,
          summary: 'Fictional load-test resolution.' }, mine.revision + 1, mine.team_id);
      } else {
        // Staff split open issues by number so that two volunteers rarely claim the same one.
        const open = issues.filter((issue) => issue.status === 'open' && issue.number % activeStaff === this.account.staffIndex % activeStaff)
          .sort((a, b) => a.number - b.number)[0];
        if (open) {
          await this.act('claim', { type: 'claim', issue_id: open.id, revision: open.revision }, open.revision + 1, open.team_id);
        }
      }
    }
    this.after('work', random(...settings.thinkMs), () => this.staffTurn());
  }
}

setInterval(() => parentPort.postMessage({ type: 'progress', requests: stepRequests, failures: stepFailures }), 2000).unref();

parentPort.on('message', (message) => {
  if (message.type === 'activate') {
    for (const [index, account] of message.accounts.entries()) {
      const user = new VirtualUser(account);
      users.push(user);
      void user.start(message.rampMs * (index + Math.random()) / message.accounts.length);
    }
  } else if (message.type === 'step') {
    activeStaff = Math.max(1, message.activeStaff);
    stepRequests = 0;
    stepFailures = 0;
  } else if (message.type === 'commands') {
    commandsEnabled = message.enabled;
  } else if (message.type === 'flush') {
    parentPort.postMessage({
      type: 'flushed', samples, commits, observations, hints, droppedRefreshes,
      loopDelayMs: { p50: loop.percentile(50) / 1e6, p99: loop.percentile(99) / 1e6, max: loop.max / 1e6 },
      connected: users.filter((user) => user.connected).length, largestSnapshotIssues,
    });
    samples = {};
    commits = [];
    observations = [];
    hints = 0;
    droppedRefreshes = 0;
    loop.reset();
  } else if (message.type === 'stop') {
    for (const user of users) user.stop();
    parentPort.postMessage({ type: 'stopped' });
  }
});
