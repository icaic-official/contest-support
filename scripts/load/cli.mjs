import { cpus, loadavg } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { fetchAnalytics } from './analytics.mjs';
import { createClient, csrfToken, now, RequestFailure } from './client.mjs';
import {
  accountPrefix, checkTarget, derivePassword, newFixtures, readFixtures, writeFixtures,
} from './fixtures.mjs';
import { addSample, joinLiveDelivery, mergeSamples, summarizeSamples } from './stats.mjs';

const { fetch } = globalThis;

const usage = `Usage: npm run load -- <command> [--option=value ...]

  competition --teams=N                 Print a bootstrap competition file with N fictional teams.
  setup --origin=URL --owner=FILE --fixtures=FILE --staff=N --team-accounts=N [--accounts-per-team=2] [--session=UUID]
                                        Create the run's accounts through the admin API. Safe to repeat.
                                        FILE is the private result of cloudflare:install bootstrap or recover.
  run --fixtures=FILE --results=FILE [--steps=50,200,800] [--ramp-seconds=60] [--step-seconds=120]
      [--issues-per-team-hour=4] [--threads=8] [--max-error-rate=0.05]
                                        Hold each step of simultaneous users and record latency and live delay.
  analytics --results=FILE --account=ID --database=UUID --worker=NAME
                                        Add D1, Worker, and Durable Object cost to the results. Reads CLOUDFLARE_API_TOKEN.
  cleanup --fixtures=FILE               Remove the run's accounts from the session.

Every command accepts --isolated-origin=URL to confirm a target that is not a minsky-preview* Worker.`;

function parseOptions(arguments_) {
  const [command, ...rest] = arguments_;
  const options = { command };
  for (const argument of rest) {
    const match = /^--([a-z-]+)=(.*)$/.exec(argument);
    if (!match) throw new Error(`Unknown argument ${JSON.stringify(argument)}.\n\n${usage}`);
    options[match[1]] = match[2];
  }
  return options;
}

function required(options, ...names) {
  const missing = names.filter((name) => !options[name]);
  if (missing.length) throw new Error(`Supply ${missing.map((name) => `--${name}`).join(', ')}.\n\n${usage}`);
}

const number = (value, fallback) => (value === undefined ? fallback : Number(value));
const log = (message) => process.stdout.write(`${message}\n`);

async function competition(options) {
  required(options, 'teams');
  const teams = Array.from({ length: Number(options.teams) }, (_, index) => ({
    name: `Fictional team ${String(index + 1).padStart(4, '0')}`, location: `Fictional desk ${index + 1}`,
  }));
  log(JSON.stringify({
    adminUsername: 'load-organizer', adminName: 'Fictional load-test organizer', eventName: 'Fictional load test',
    sessionName: 'Fictional load session', categories: ['Problem statement', 'Devices', 'Network', 'Other'], teams,
  }, null, 2));
}

/** Sign the organizer in, and replace the bootstrap password with the derived one on first use. */
async function signInAdmin(fixtures, path) {
  const client = createClient(fixtures.origin, { record: () => {} });
  const { admin } = fixtures;
  const derived = derivePassword(fixtures.secret, admin.username);
  const password = admin.changed ? derived : admin.temporary;
  // The bootstrap account is a webmaster, so it signs in to the site.
  await client.request('sign-in', '/api/auth/sign-in', { method: 'POST', body: { event: null, handle: admin.username, password } });
  const session = (await client.request('auth-session', '/api/auth/session')).body;
  if (session.status.must_change) {
    await client.request('change-password', '/api/auth/change-password', {
      method: 'POST', csrf: session.csrf, body: { currentPassword: password, newPassword: derived },
    });
    admin.changed = true;
    await writeFixtures(path, fixtures);
  }
  return client;
}

async function post(client, path, body) {
  return (await client.request('admin', path, { method: 'POST', csrf: await csrfToken(client), body })).body;
}

async function snapshot(client, sessionId) {
  return (await client.request('snapshot', `/api/snapshot?sessionId=${sessionId}`)).body;
}

async function setup(options) {
  required(options, 'fixtures');
  let fixtures;
  try {
    fixtures = await readFixtures(options.fixtures);
    log(`Continuing run ${fixtures.runId} from ${options.fixtures}.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    required(options, 'origin', 'owner');
    const owner = JSON.parse(await readFile(options.owner, 'utf8'));
    checkTarget(options.origin, options['isolated-origin']);
    fixtures = newFixtures({ origin: options.origin, owner });
    await writeFixtures(options.fixtures, fixtures);
    log(`Started run ${fixtures.runId}. The private fixture file is ${options.fixtures}.`);
  }
  checkTarget(fixtures.origin, options['isolated-origin']);
  required(options, 'staff', 'team-accounts');
  const staffCount = Number(options.staff);
  const teamAccounts = Number(options['team-accounts']);
  const perTeam = number(options['accounts-per-team'], 2);
  const client = await signInAdmin(fixtures, options.fixtures);
  if (!fixtures.sessionId) {
    const sessions = (await client.request('sessions', '/api/sessions')).body;
    fixtures.sessionId = options.session ?? (sessions.length === 1 ? sessions[0].id : undefined);
    if (!sessions.some((session) => session.id === fixtures.sessionId)) {
      throw new Error(`The organizer belongs to ${sessions.length} sessions. Choose one with --session.`);
    }
    await writeFixtures(options.fixtures, fixtures);
  }
  await post(client, '/api/admin', { action: 'set_intake', sessionId: fixtures.sessionId, open: true });
  const current = await snapshot(client, fixtures.sessionId);
  const teams = [...current.teams].sort((a, b) => a.name.localeCompare(b.name));
  if (teams.length < Math.ceil(teamAccounts / perTeam)) {
    throw new Error(`The session has ${teams.length} teams. ${teamAccounts} team accounts at ${perTeam} per team need more.`);
  }
  const prefix = accountPrefix(fixtures);
  const wanted = [
    ...Array.from({ length: staffCount }, (_, index) => ({
      username: `${prefix}s${String(index + 1).padStart(4, '0')}`, kind: 'staff', teamId: null,
    })),
    ...Array.from({ length: teamAccounts }, (_, index) => {
      const team = Math.floor(index / perTeam);
      return { username: `${prefix}t${String(team + 1).padStart(4, '0')}-${(index % perTeam) + 1}`, kind: 'team', teamId: teams[team].id };
    }),
  ];
  const members = new Map(current.members.map((member) => [member.person.username, member.person.id]));
  const known = new Map(fixtures.accounts.map((account) => [account.username, account]));
  // An account from a fixture file older than event sign-in has no event code, so it gets a reset.
  const todo = wanted.filter((account) => !known.get(account.username)?.event || !members.has(account.username));
  log(`${wanted.length - todo.length} of ${wanted.length} accounts exist. Creating or resetting ${todo.length}.`);
  let done = 0;
  const work = async (account) => {
    const command = members.has(account.username)
      ? { action: 'reset_password', userId: members.get(account.username) }
      : { action: 'create_account', username: account.username, name: `Fictional ${account.username}`,
          teamId: account.teamId, roles: account.kind === 'staff' ? ['volunteer'] : [], isAdmin: false };
    const result = await post(client, '/api/accounts', { sessionId: fixtures.sessionId, command });
    known.set(account.username, { ...account, event: result.signIn.code, temporary: result.temporaryPassword, changed: false });
    if (++done % 50 === 0) {
      fixtures.accounts = [...known.values()];
      await writeFixtures(options.fixtures, fixtures);
      log(`${done} of ${todo.length} accounts ready.`);
    }
  };
  const queue = [...todo];
  try {
    await Promise.all(Array.from({ length: number(options.concurrency, 6) }, async () => {
      while (queue.length) await work(queue.shift());
    }));
  } finally {
    fixtures.accounts = [...known.values()];
    await writeFixtures(options.fixtures, fixtures);
  }
  log(`Setup complete: ${staffCount} staff and ${teamAccounts} team accounts in session ${fixtures.sessionId}.`);
}

async function cleanup(options) {
  required(options, 'fixtures');
  const fixtures = await readFixtures(options.fixtures);
  checkTarget(fixtures.origin, options['isolated-origin']);
  const client = await signInAdmin(fixtures, options.fixtures);
  const prefix = accountPrefix(fixtures);
  const members = (await snapshot(client, fixtures.sessionId)).members
    .filter((member) => member.person.username?.startsWith(prefix));
  for (const member of members) {
    await post(client, '/api/admin', { action: 'remove_member', sessionId: fixtures.sessionId, userId: member.person.id });
  }
  log(`Removed ${members.length} run ${fixtures.runId} accounts from the session. Issues and history stay, because Minsky keeps them.`);
}

/**
 * A run against a live channel that is still busy would measure that backlog,
 * not the load. Bulk account creation leaves such a backlog for many minutes.
 */
async function preflight(fixtures, path) {
  const client = await signInAdmin(fixtures, path);
  const started = now();
  const socket = client.webSocket(`/api/updates?sessionId=${fixtures.sessionId}`);
  const ready = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    socket.onmessage = (event) => { clearTimeout(timer); resolve(JSON.parse(event.data).type === 'ready'); };
    socket.onclose = () => { clearTimeout(timer); resolve(false); };
  });
  try { socket.close(); } catch { /* already closed */ }
  if (!ready) {
    throw new Error('The live channel did not answer within 5 s, so the run did not start. ' +
      'Undelivered notifications, for example from account setup, can keep it busy. Wait a few minutes and try again.');
  }
  log(`Preflight: the live channel answered in ${Math.round(now() - started)} ms.`);
}

function activeCounts(users, staffShare) {
  const staff = Math.max(1, Math.round(users * staffShare));
  return { staff, team: users - staff };
}

async function run(options) {
  required(options, 'fixtures', 'results');
  const fixtures = await readFixtures(options.fixtures);
  checkTarget(fixtures.origin, options['isolated-origin']);
  const steps = (options.steps ?? '50,200,800').split(',').map(Number);
  const rampMs = number(options['ramp-seconds'], 60) * 1000;
  const holdMs = number(options['step-seconds'], 120) * 1000;
  const maxErrorRate = number(options['max-error-rate'], 0.05);
  const threadCount = number(options.threads, Math.min(8, Math.max(1, Math.floor(cpus().length / 2))));
  const staffAccounts = fixtures.accounts.filter((account) => account.kind === 'staff');
  const teamAccounts = fixtures.accounts.filter((account) => account.kind === 'team');
  const staffShare = staffAccounts.length / fixtures.accounts.length;
  const perTeam = teamAccounts.length / new Set(teamAccounts.map((account) => account.teamId)).size;
  for (const users of steps) {
    const counts = activeCounts(users, staffShare);
    if (counts.staff > staffAccounts.length || counts.team > teamAccounts.length) {
      throw new Error(`A step of ${users} users needs ${counts.staff} staff and ${counts.team} team accounts. Run setup with more.`);
    }
  }
  const settings = {
    pollMs: 10_000, authPollMs: 60_000, thinkMs: [4_000, 10_000], timeoutMs: 30_000, maxQueuedRefreshes: 20,
    teamReplyShare: 0.3,
    submitPerSecondPerAccount: number(options['issues-per-team-hour'], 4) / perTeam / 3600,
  };
  const revision = await fetch(new URL('/minsky-revision.json', fixtures.origin)).then((response) => response.json()).catch(() => undefined);
  log(`Target ${fixtures.origin}, revision ${revision?.sha?.slice(0, 12) ?? 'unknown'}. ${threadCount} threads.`);
  await preflight(fixtures, options.fixtures);

  const byUsername = new Map(fixtures.accounts.map((account) => [account.username, account]));
  let saving = Promise.resolve();
  let dirty = false;
  const windows = new Map();
  const progress = new Map();
  const workers = Array.from({ length: threadCount }, (_, index) => {
    const worker = new Worker(new URL('./user.mjs', import.meta.url), {
      workerData: { origin: fixtures.origin, sessionId: fixtures.sessionId, runId: fixtures.runId, secret: fixtures.secret, settings },
    });
    worker.on('message', (message) => {
      if (message.type === 'progress') progress.set(index, message);
      else if (message.type === 'changed') {
        const account = byUsername.get(message.username);
        if (account && !account.changed) { account.changed = true; dirty = true; }
      } else if (message.type === 'window') {
        windows.set(message.observer, { ...windows.get(message.observer), ...message });
      }
    });
    worker.on('error', (error) => { process.stderr.write(`Load thread ${index} failed: ${error.stack}\n`); process.exitCode = 1; });
    return worker;
  });
  const persist = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    saving = saving.then(() => writeFixtures(options.fixtures, fixtures));
  }, 2000);

  function collect(type) {
    return Promise.all(workers.map((worker) => new Promise((resolve) => {
      const listener = (message) => {
        if (message.type !== type) return;
        worker.off('message', listener);
        resolve(message);
      };
      worker.on('message', listener);
      worker.postMessage({ type: type === 'flushed' ? 'flush' : 'stop' });
    })));
  }

  const canarySamples = {};
  const anonymous = createClient(fixtures.origin, { record: (...sample) => addSample(canarySamples, ...sample) });
  let canaries = true;
  const canaryLoop = (async () => {
    while (canaries) {
      await Promise.allSettled([
        anonymous.request('canary:static', '/minsky-revision.json'),
        anonymous.request('canary:anonymous-api', '/api/sessions', { expected: 401 }),
      ]);
      await delay(2000);
    }
  })();

  const results = { origin: fixtures.origin, revision, runId: fixtures.runId, settings, threads: threadCount, steps: [] };
  const allCommits = [];
  const allObservations = [];
  let staffActive = 0;
  let teamActive = 0;
  for (const [index, users] of steps.entries()) {
    const counts = activeCounts(users, staffShare);
    const added = [
      ...staffAccounts.slice(staffActive, counts.staff).map((account, offset) => ({ ...account, staffIndex: staffActive + offset })),
      ...teamAccounts.slice(teamActive, counts.team),
    ];
    staffActive = counts.staff;
    teamActive = counts.team;
    const startedAt = now();
    const cpuBefore = process.cpuUsage();
    progress.clear();
    for (const [thread, worker] of workers.entries()) {
      worker.postMessage({ type: 'step', index, activeStaff: staffActive });
      worker.postMessage({ type: 'activate', rampMs, accounts: added.filter((_, position) => position % threadCount === thread) });
    }
    log(`Step ${index + 1}: ${users} users (${staffActive} staff, ${teamActive} team accounts). Ramp ${rampMs / 1000} s, hold ${holdMs / 1000} s.`);
    let aborted = false;
    while (now() - startedAt < rampMs + holdMs) {
      await delay(2000);
      const requests = [...progress.values()].reduce((sum, value) => sum + value.requests, 0);
      const failed = [...progress.values()].reduce((sum, value) => sum + value.failures, 0);
      if (requests >= 200 && failed / requests > maxErrorRate) {
        log(`Stopping step ${index + 1}: ${failed} of ${requests} requests failed.`);
        aborted = true;
        break;
      }
    }
    const endedAt = now();
    const cpu = process.cpuUsage(cpuBefore);
    const flushed = await collect('flushed');
    const samples = {};
    for (const part of flushed) {
      mergeSamples(samples, part.samples);
      allCommits.push(...part.commits.map((commit) => ({ ...commit, step: index })));
      allObservations.push(...part.observations);
    }
    mergeSamples(samples, canarySamples);
    for (const key of Object.keys(canarySamples)) delete canarySamples[key];
    const seconds = (endedAt - startedAt) / 1000;
    const summary = summarizeSamples(samples);
    const step = {
      users, staff: staffActive, teamAccounts: teamActive, startedAt, endedAt, aborted, summary,
      throughput: { requestsPerSecond: summary.requests / seconds,
        decodedMegabytesPerSecond: Object.values(samples).reduce((sum, entry) => sum + entry.bytes, 0) / seconds / 1e6 },
      live: { hints: flushed.reduce((sum, part) => sum + part.hints, 0) },
      harness: {
        cpuCores: (cpu.user + cpu.system) / 1e3 / (endedAt - startedAt),
        loadAverage: loadavg()[0],
        loopDelayMs: {
          p99: Math.max(...flushed.map((part) => part.loopDelayMs.p99)),
          max: Math.max(...flushed.map((part) => part.loopDelayMs.max)),
        },
        connectedSockets: flushed.reduce((sum, part) => sum + part.connected, 0),
        droppedRefreshes: flushed.reduce((sum, part) => sum + part.droppedRefreshes, 0),
        largestSnapshotIssues: Math.max(...flushed.map((part) => part.largestSnapshotIssues)),
      },
    };
    results.steps.push(step);
    printStep(step, index);
    if (aborted) break;
  }
  log('Draining: no new commands for 20 s while screens keep refreshing.');
  for (const worker of workers) worker.postMessage({ type: 'commands', enabled: false });
  await delay(20_000);
  for (const part of await collect('flushed')) allObservations.push(...part.observations);
  const stoppedAt = now();
  await collect('stopped');
  canaries = false;
  await canaryLoop;
  clearInterval(persist);
  await Promise.all(workers.map((worker) => worker.terminate()));
  await saving;
  await writeFixtures(options.fixtures, fixtures);

  const observerWindows = [...windows.values()].filter((window) => window.from)
    .map((window) => ({ ...window, to: window.to ?? stoppedAt }));
  for (const [index, step] of results.steps.entries()) {
    const commits = allCommits.filter((commit) => commit.step === index);
    Object.assign(step.live, joinLiveDelivery(commits, allObservations, observerWindows, { deadlineMs: 15_000 }), {
      commits: commits.length, commitsPerSecond: commits.length / ((step.endedAt - step.startedAt) / 1000),
    });
    log(`Step ${index + 1} live delivery: ${formatLive(step.live)}`);
  }
  if (options['keep-events'] === 'true') Object.assign(results, { commits: allCommits, observations: allObservations, windows: observerWindows });
  await writeFile(options.results, JSON.stringify(results, null, 2) + '\n');
  log(`Results written to ${options.results}.`);
}

const ms = (value) => (value === undefined ? '-' : `${Math.round(value)}`);

function printStep(step, index) {
  log(`Step ${index + 1} (${step.users} users${step.aborted ? ', stopped early' : ''}): ` +
    `${step.summary.requests} requests, ${(step.summary.errorRate * 100).toFixed(2)}% failed, ` +
    `${step.throughput.requestsPerSecond.toFixed(1)} req/s, harness CPU ${step.harness.cpuCores.toFixed(2)} cores, ` +
    `event-loop delay p99 ${ms(step.harness.loopDelayMs.p99)} ms, ${step.harness.connectedSockets} sockets open.`);
  log('  name                         count     p50     p95     p99     max  failures');
  for (const [name, row] of Object.entries(step.summary.rows).sort(([a], [b]) => a.localeCompare(b))) {
    log(`  ${name.padEnd(26)} ${String(row.count).padStart(7)} ${ms(row.p50).padStart(7)} ${ms(row.p95).padStart(7)} ` +
      `${ms(row.p99).padStart(7)} ${ms(row.max).padStart(7)} ${String(row.failures).padStart(9)}`);
  }
}

function formatLive(live) {
  if (live.commits < 20) return `${live.commits} commands. Too few for percentiles; raise --issues-per-team-hour or --step-seconds.`;
  return `${live.commits} commands, ${live.pairs} screen updates expected, ` +
    `data visible p50 ${ms(live.data.p50)} / p95 ${ms(live.data.p95)} / p99 ${ms(live.data.p99)} ms, ` +
    `${live.withinThreeSeconds === undefined ? '-' : (live.withinThreeSeconds * 100).toFixed(1)}% within 3 s, ` +
    `hint p95 ${ms(live.hint.p95)} ms, ${live.viaPoll} found by polling, ${live.missed} missed.`;
}

async function analytics(options) {
  required(options, 'results', 'account', 'database', 'worker');
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('Set CLOUDFLARE_API_TOKEN to a token that can read account analytics.');
  const results = JSON.parse(await readFile(options.results, 'utf8'));
  results.analytics = await fetchAnalytics({
    token, accountId: options.account, databaseId: options.database, workerName: options.worker, steps: results.steps,
  });
  await writeFile(options.results, JSON.stringify(results, null, 2) + '\n');
  for (const [index, step] of results.analytics.steps.entries()) {
    if (!step.worker?.minutes) {
      log(`Step ${index + 1}: no whole minute inside the step. Use --step-seconds of at least 120 for server-side cost.`);
      continue;
    }
    const requests = step.worker?.['sum.requests'];
    const queries = (step.d1?.['sum.readQueries'] ?? 0) + (step.d1?.['sum.writeQueries'] ?? 0);
    log(`Step ${index + 1} per minute: ${ms(requests)} Worker requests, ${ms(queries)} D1 queries ` +
      `(${requests ? (queries / requests).toFixed(1) : '-'} per request), ${ms(step.d1?.['sum.rowsRead'])} rows read, ` +
      `Worker CPU p99 ${ms((step.worker?.['quantiles.cpuTimeP99'] ?? 0) / 1000)} ms, ` +
      `Durable Object CPU ${ms(step.durableObjects?.['sum.cpuTime'] / 1000)} ms.`);
  }
}

const commands = { competition, setup, run, analytics, cleanup };

const options = parseOptions(process.argv.slice(2));
if (!commands[options.command]) {
  log(usage);
  process.exitCode = 1;
} else {
  commands[options.command](options).catch((error) => {
    process.stderr.write(`${error instanceof RequestFailure ? `${error.message} ${JSON.stringify(error.body ?? {})}` : error.stack}\n`);
    process.exitCode = 1;
  });
}
