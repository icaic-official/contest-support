import { randomUUID } from 'node:crypto';
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

  site                                  Print a bootstrap site file for the load-test webmaster.
  setup --origin=URL --owner=FILE --fixtures=FILE --staff=N --team-accounts=N
                                        Create the run's event, contest, and accounts. The webmaster creates the
                                        event and its event admin, and the event admin does the rest. Safe to repeat.
                                        FILE is the private result of cloudflare:install bootstrap or recover.
  run --fixtures=FILE --results=FILE [--steps=50,200,800] [--ramp-seconds=60] [--step-seconds=120]
      [--issues-per-team-hour=4] [--threads=8] [--max-error-rate=0.05]
                                        Hold each step of simultaneous users and record latency and live delay.
  analytics --results=FILE --account=ID --database=UUID --worker=NAME
                                        Add D1, Worker, and Durable Object cost to the results. Reads CLOUDFLARE_API_TOKEN.
  cleanup --fixtures=FILE               Remove the run's staff and unused teams from the contest.

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

async function site() {
  log(JSON.stringify({ webmasterHandle: 'load-webmaster', webmasterName: 'Fictional load-test webmaster' }, null, 2));
}

/**
 * Signs in one of the run's managers and replaces the temporary password with
 * the derived one on first use. The webmaster signs in to the site. The event
 * admin signs in with the event code.
 */
async function signInManager(fixtures, path, who) {
  const client = createClient(fixtures.origin, { record: () => {} });
  const account = fixtures[who];
  const derived = derivePassword(fixtures.secret, account.username);
  const password = account.changed ? derived : account.temporary;
  await client.request('sign-in', '/api/auth/sign-in', {
    method: 'POST', body: { event: who === 'webmaster' ? null : fixtures.eventCode, handle: account.username, password },
  });
  const session = (await client.request('auth-session', '/api/auth/session')).body;
  if (session.status.must_change) {
    await client.request('change-password', '/api/auth/change-password', {
      method: 'POST', csrf: session.csrf, body: { currentPassword: password, newPassword: derived },
    });
    account.changed = true;
    await writeFixtures(path, fixtures);
  }
  return client;
}

async function post(client, path, body) {
  return (await client.request('admin', path, { method: 'POST', csrf: await csrfToken(client), body })).body;
}

/** One management command with a new request ID. */
function manage(client, command) {
  return post(client, '/api/manage', { requestId: randomUUID(), command });
}

async function snapshot(client, sessionId) {
  return (await client.request('snapshot', `/api/snapshot?sessionId=${sessionId}`)).body;
}

const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/** The most accounts that one credential request issues, and the most rows that one command takes. */
const ISSUE_BATCH = 8;
const COMMAND_BATCH = 300;

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
  const prefix = accountPrefix(fixtures);
  if (!fixtures.eventId) {
    // The webmaster makes the event and its first event admin, and issues that admin's first password.
    const webmaster = await signInManager(fixtures, options.fixtures, 'webmaster');
    const code = `load-${fixtures.runId}`;
    const created = await manage(webmaster, {
      type: 'create_event', name: `Fictional load test ${fixtures.runId}`, code, timeZone: 'UTC',
      firstAdmin: { handle: `${prefix}eadmin`, name: 'Fictional load-test event admin' },
    });
    const [issued] = await post(webmaster, '/api/credentials', {
      requestId: randomUUID(), eventId: created.eventId, accountIds: created.accountIds,
    });
    Object.assign(fixtures, { eventId: created.eventId, eventCode: code,
      admin: { username: issued.handle, temporary: issued.temporaryPassword, changed: false } });
    await writeFixtures(options.fixtures, fixtures);
    log(`Created event ${code}.`);
  }
  const client = await signInManager(fixtures, options.fixtures, 'admin');
  if (!fixtures.sessionId) {
    const created = await manage(client, {
      type: 'create_contest', eventId: fixtures.eventId, name: 'Fictional load session', contestType: 'teams',
      categories: ['Problem statement', 'Devices', 'Network', 'Other'],
    });
    fixtures.sessionId = created.contestId;
    await writeFixtures(options.fixtures, fixtures);
    await manage(client, { type: 'set_intake', contestId: fixtures.sessionId, open: true });
  }
  const consoleView = async () => (await client.request('event', '/api/event')).body;
  let view = await consoleView();
  const handles = new Set([...view.people.map((person) => person.handle), ...view.entrants.map((entrant) => entrant.handle)]);
  const staffWanted = Array.from({ length: staffCount }, (_, index) => `${prefix}s${String(index + 1).padStart(4, '0')}`);
  const teamsWanted = Array.from({ length: teamAccounts }, (_, index) => `${prefix}t${String(index + 1).padStart(4, '0')}`);
  for (const batch of chunks(staffWanted.filter((handle) => !handles.has(handle)), COMMAND_BATCH)) {
    await manage(client, { type: 'create_people', eventId: fixtures.eventId,
      people: batch.map((handle) => ({ handle, name: `Fictional ${handle}` })) });
  }
  for (const batch of chunks(teamsWanted.filter((handle) => !handles.has(handle)), COMMAND_BATCH)) {
    await manage(client, { type: 'create_entrants', eventId: fixtures.eventId,
      entrants: batch.map((handle) => ({ kind: 'team', handle, name: `Fictional team ${handle}` })) });
  }
  view = await consoleView();
  const person = new Map(view.people.map((item) => [item.handle, item]));
  const entrant = new Map(view.entrants.map((item) => [item.handle, item]));
  const seatedStaff = new Set(view.staffAssignments.filter((item) => item.contestId === fixtures.sessionId).map((item) => item.accountId));
  const seatedEntrants = new Set(view.entries.filter((item) => item.contestId === fixtures.sessionId).map((item) => item.entrantId));
  for (const handle of staffWanted) {
    const id = person.get(handle).id;
    if (!seatedStaff.has(id)) await manage(client, { type: 'assign_staff', contestId: fixtures.sessionId, accountId: id, roles: ['volunteer'], admin: false });
  }
  const unseated = teamsWanted.map((handle) => entrant.get(handle)).filter((item) => !seatedEntrants.has(item.id));
  for (const batch of chunks(unseated, COMMAND_BATCH)) {
    await manage(client, { type: 'assign_entrants', contestId: fixtures.sessionId,
      entries: batch.map((item) => ({ entrantId: item.id, location: `Fictional desk ${item.handle}` })) });
  }
  // A team account submits for its entry, which is the contest's teams row with the entrant's name.
  const entries = new Map((await snapshot(client, fixtures.sessionId)).teams.map((team) => [team.name, team.id]));
  const known = new Map(fixtures.accounts.map((account) => [account.username, account]));
  const wanted = [
    ...staffWanted.map((handle) => ({ username: handle, kind: 'staff', teamId: null, id: person.get(handle).id })),
    ...teamsWanted.map((handle) => ({ username: handle, kind: 'team', teamId: entries.get(entrant.get(handle).name), id: entrant.get(handle).accountId })),
  ];
  const todo = wanted.filter((account) => !known.get(account.username)?.event);
  log(`${wanted.length - todo.length} of ${wanted.length} accounts exist. Issuing passwords for ${todo.length}.`);
  let done = 0;
  const queue = chunks(todo, ISSUE_BATCH);
  const work = async (batch) => {
    const issued = await post(client, '/api/credentials', {
      requestId: randomUUID(), eventId: fixtures.eventId, accountIds: batch.map((account) => account.id),
    });
    for (const [index, account] of batch.entries()) {
      known.set(account.username, { ...account, event: fixtures.eventCode, temporary: issued[index].temporaryPassword, changed: false });
    }
    done += batch.length;
    if (Math.floor(done / 50) !== Math.floor((done - batch.length) / 50)) {
      fixtures.accounts = [...known.values()];
      await writeFixtures(options.fixtures, fixtures);
      log(`${done} of ${todo.length} accounts ready.`);
    }
  };
  try {
    await Promise.all(Array.from({ length: number(options.concurrency, 6) }, async () => {
      while (queue.length) await work(queue.shift());
    }));
  } finally {
    fixtures.accounts = [...known.values()];
    await writeFixtures(options.fixtures, fixtures);
  }
  log(`Setup complete: ${staffCount} staff and ${teamAccounts} team accounts in contest ${fixtures.sessionId}.`);
}

async function cleanup(options) {
  required(options, 'fixtures');
  const fixtures = await readFixtures(options.fixtures);
  checkTarget(fixtures.origin, options['isolated-origin']);
  const client = await signInManager(fixtures, options.fixtures, 'admin');
  const prefix = accountPrefix(fixtures);
  const view = (await client.request('event', '/api/event')).body;
  let removed = 0;
  for (const item of view.people.filter((candidate) => candidate.handle?.startsWith(prefix))) {
    await manage(client, { type: 'unassign_staff', contestId: fixtures.sessionId, accountId: item.id });
    removed++;
  }
  let kept = 0;
  for (const item of view.entrants.filter((candidate) => candidate.handle?.startsWith(prefix))) {
    // A team with an issue stays, because Minsky keeps issues and their history.
    try {
      await manage(client, { type: 'unassign_entrant', contestId: fixtures.sessionId, entrantId: item.id });
      removed++;
    } catch { kept++; }
  }
  log(`Removed ${removed} run ${fixtures.runId} seats from the contest. ${kept} teams with issues stay, because Minsky keeps issues and history.`);
}

/**
 * A run against a live channel that is still busy would measure that backlog,
 * not the load. Bulk account creation leaves such a backlog for many minutes.
 */
async function preflight(fixtures, path) {
  const client = await signInManager(fixtures, path, 'admin');
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
  // An entrant has one sign-in, so a team has one account.
  const perTeam = 1;
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
        anonymous.request('canary:anonymous-api', '/api/contests', { expected: 401 }),
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

const commands = { site, setup, run, analytics, cleanup };

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
