import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';
import { afterEach, test, vi } from 'vitest';
import HostedProgressReporter from './hosted-progress-reporter.mjs';
import { metricsPrefix, parseHostedProgress, progressPrefix, runHostedChild } from './hosted-progress.mjs';
import { repositoryRoot } from './configuration.mjs';

const secret = 'fictional-password-cookie-body-SQL-stack-title';
const directories = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const progress = (event, completed, overrides = {}) => progressPrefix + JSON.stringify({ event, completed, total: 2, durationMs: event ? 150 : 0, active: event ? 0 : 1, activeMs: 0, ...overrides });
const metrics = (overrides = {}) => metricsPrefix + JSON.stringify({ source: 0, calls: 3, statements: 7, wallMs: 1234.5, sqlMs: 1.25, inFlight: 1, ...overrides });
const fakeTimers = {
  setInterval: (...args) => globalThis.setInterval(...args),
  clearInterval: (id) => globalThis.clearInterval(id),
  setTimeout: (...args) => globalThis.setTimeout(...args),
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

function childFixture() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const signals = [];
  child.kill = (signal) => { signals.push(signal); return true; };
  const reports = [];
  let options;
  const promise = runHostedChild(['private-runner.mjs'], { timeout: 30_000, maxBuffer: 2048, stdio: 'inherit' }, {
    expectedTotal: 2, heartbeatMs: 1000, now: () => Date.now(), timer: fakeTimers,
    spawn: (_file, _args, value) => { options = value; return child; },
    report: (line) => reports.push(line),
  });
  return { child, signals, reports, promise, options };
}

test('progress protocol accepts only exact finite numeric fields and the fixed case count', () => {
  assert.deepEqual(parseHostedProgress(progress(0, 0), 2), { kind: 'case', value: { event: 0, completed: 0, total: 2, durationMs: 0, active: 1, activeMs: 0 } });
  assert.equal(parseHostedProgress(metrics(), 2).kind, 'metrics');
  for (const line of [secret, `${secret} ${progress(0, 0)}`, progress(0, 0, { title: secret }),
    progress(1, 1, { error: secret }), progress(1, 1, { durationMs: secret }), progress(1, 1, { total: 1 }),
    progress(1, 3), progress(3, 1), progress(0, 0, { durationMs: 1 }), progress(1, -1),
    progress(1, 1, { durationMs: null }), progress(1, 1, { completed: 0.5 }),
    metrics({ values: secret }), metrics({ sqlMs: secret }), metrics({ wallMs: -1 }),
    metrics({ calls: 0, inFlight: 1 }), metrics({ calls: 1.1 }), metrics({ statements: Number.MAX_SAFE_INTEGER + 1 }),
    metrics({ source: -1 }), metrics({ source: 5 }), metrics({ source: secret }),
    progress(0, 0, { active: 0 }), progress(0, 0, { active: 3 }), progress(1, 1, { activeMs: 1 }),
    `${progressPrefix}{"event":1,"completed":1,"total":2,"durationMs":1e999}`,
    progressPrefix + secret.repeat(100),
  ]) assert.equal(parseHostedProgress(line, 2), undefined);
});

test('Vitest reporter reads no task titles, errors, SQL, diagnostics, or credentials', () => {
  const lines = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((line) => { lines.push(line); return true; });
  const task = new Proxy({}, { get() { throw new Error(secret); } });
  const reporter = new HostedProgressReporter({ total: 2 });
  reporter.onTestCaseReady(task);
  reporter.onTestCaseReady(task);
  reporter.onTestCaseResult(task);
  reporter.onTestCaseResult(task);
  reporter.onTestCaseResult({});
  reporter.onUserConsoleLog({ content: `${secret}\n${metrics()}\n${metrics({ values: secret })}\n` });
  assert.equal(lines.length, 4);
  const values = lines.slice(0, 3).map((line) => parseHostedProgress(line.trim(), 2).value);
  assert.deepEqual(values.map(({ event, completed, total }) => ({ event, completed, total })), [
    { event: 0, completed: 0, total: 2 }, { event: 1, completed: 1, total: 2 }, { event: 1, completed: 2, total: 2 },
  ]);
  assert.equal(JSON.stringify(lines).includes(secret), false);
  assert.throws(() => new HostedProgressReporter({ total: '2' }));
});

test('validated progress is public before exit while diagnostics and result JSON stay private', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const fixture = childFixture();
  let exited = false;
  fixture.promise.then(() => { exited = true; });
  assert.deepEqual(fixture.options.stdio, ['ignore', 'pipe', 'pipe']);
  fixture.child.stderr.write(`${secret}\n${progress(0, 0)}\n`);
  fixture.child.stdout.write(`${secret}\n${progress(0, 0).slice(0, 15)}`);
  fixture.child.stdout.write(progress(0, 0).slice(15) + '\n');
  assert.equal(exited, false);
  assert.equal(fixture.reports.length, 1);
  fixture.child.stdout.write(metrics() + '\n');
  await vi.advanceTimersByTimeAsync(2000);
  assert.match(fixture.reports.at(-1), /0\/2 complete; elapsed 2s; active 1; oldest case 2s; DB 3 calls, 7 statements, wall 1235ms, reported SQL 1ms, 1 in flight/);
  fixture.child.stdout.write(progress(1, 1) + '\n');
  fixture.child.stdout.write(progress(1, 1) + '\n');
  fixture.child.stdout.write(progress(0, 1) + '\n');
  fixture.child.stdout.write(metrics({ calls: 2 }) + '\n');
  fixture.child.stdout.write(metrics({ calls: 5, statements: 10, inFlight: 0 }) + '\n');
  fixture.child.stdout.write(progress(1, 2) + '\n');
  const json = JSON.stringify({ numTotalTests: 2, privateTitle: secret });
  fixture.child.stdout.write(json + '\n');
  fixture.child.emit('close', 0, null);
  const result = await fixture.promise;
  assert.equal(result.status, 0);
  assert.equal(result.error, undefined);
  assert.equal(result.stdout.includes(json), true);
  assert.equal(result.stderr.includes(secret), true);
  assert.equal(fixture.reports.length, 6);
  assert.match(fixture.reports.at(-1), /2\/2 complete/);
  assert.equal(fixture.reports.some((line) => line.includes(secret) || line.includes('privateTitle')), false);
  assert.equal(vi.getTimerCount(), 0);
  await vi.advanceTimersByTimeAsync(60_000);
  assert.equal(fixture.reports.length, 6);
});

test('concurrent case completion retains the oldest active time and sums each numeric metric source', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const fixture = childFixture();
  fixture.child.stdout.write(progress(0, 0) + '\n');
  await vi.advanceTimersByTimeAsync(1000);
  fixture.child.stdout.write(progress(0, 0, { active: 2, activeMs: 1000 }) + '\n');
  fixture.child.stdout.write(metrics({ source: 1, calls: 100, statements: 120, wallMs: 5000, sqlMs: 10, inFlight: 2 }) + '\n');
  fixture.child.stdout.write(metrics({ source: 2, calls: 2, statements: 3, wallMs: 20, sqlMs: 1, inFlight: 1 }) + '\n');
  fixture.child.stdout.write(metrics({ source: 1, calls: 99 }) + '\n');
  await vi.advanceTimersByTimeAsync(1000);
  // The newer case finishes first. The older case's clock must continue.
  fixture.child.stdout.write(progress(1, 1, { active: 1, activeMs: 2000 }) + '\n');
  await vi.advanceTimersByTimeAsync(1000);
  assert.match(fixture.reports.at(-1), /1\/2 complete; elapsed 3s; active 1; oldest case 3s; DB 102 calls, 123 statements, wall 5020ms, reported SQL 11ms, 3 in flight/);
  fixture.child.stdout.write(progress(1, 2) + '\n');
  fixture.child.emit('close', 0, null);
  assert.equal((await fixture.promise).status, 0);
  assert.equal(vi.getTimerCount(), 0);
});

test('nonzero exits remain failures and do not publish child error messages', async () => {
  vi.useFakeTimers();
  const fixture = childFixture();
  fixture.child.stdout.write(progress(1, 1) + '\n');
  fixture.child.stderr.write(secret);
  fixture.child.emit('close', 1, null);
  const result = await fixture.promise;
  assert.equal(result.status, 1);
  assert.equal(result.error, undefined);
  assert.equal(JSON.stringify(fixture.reports).includes(secret), false);
  assert.equal(vi.getTimerCount(), 0);
});

test('timeout stops progress, escalates a stuck child, and clears every heartbeat', async () => {
  vi.useFakeTimers();
  const fixture = childFixture();
  await vi.advanceTimersByTimeAsync(30_000);
  assert.deepEqual(fixture.signals, ['SIGTERM']);
  const count = fixture.reports.length;
  await vi.advanceTimersByTimeAsync(1000);
  assert.deepEqual(fixture.signals, ['SIGTERM', 'SIGKILL']);
  fixture.child.emit('close', null, 'SIGKILL');
  const result = await fixture.promise;
  assert.equal(result.error.code, 'ETIMEDOUT');
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.status, null);
  assert.equal(vi.getTimerCount(), 0);
  await vi.advanceTimersByTimeAsync(60_000);
  assert.equal(fixture.reports.length, count);
});

test('either output stream exceeding its private limit terminates the child safely', async () => {
  vi.useFakeTimers();
  for (const stream of ['stdout', 'stderr']) {
    const fixture = childFixture();
    fixture.child[stream].write(secret.repeat(100));
    assert.deepEqual(fixture.signals, ['SIGTERM']);
    fixture.child.emit('close', null, 'SIGTERM');
    const result = await fixture.promise;
    assert.equal(result.error.code, 'ENOBUFS');
    assert.equal(result[stream], '');
    assert.deepEqual(fixture.reports, []);
    assert.equal(vi.getTimerCount(), 0);
  }
});

test('spawn and stream errors use fixed errors without copying private messages', async () => {
  const spawned = await runHostedChild([], { timeout: 100, maxBuffer: 100 }, {
    expectedTotal: 2, spawn: () => { throw new Error(secret); },
  });
  assert.equal(spawned.error.code, 'SPAWN_ERROR');
  assert.equal(spawned.error.message.includes(secret), false);
  vi.useFakeTimers();
  const fixture = childFixture();
  fixture.child.stdout.emit('error', new Error(secret));
  fixture.child.emit('close', null, 'SIGTERM');
  const streamed = await fixture.promise;
  assert.equal(streamed.error.code, 'STREAM_ERROR');
  assert.equal(streamed.error.message.includes(secret), false);
  assert.equal(vi.getTimerCount(), 0);
});

test('a throwing report callback stops the child and releases its timers', async () => {
  vi.useFakeTimers();
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.emit('close', null, 'SIGTERM'); return true; };
  const promise = runHostedChild([], { timeout: 1000, maxBuffer: 1000 }, { expectedTotal: 2, timer: fakeTimers,
    spawn: () => child, report: () => { throw new Error(secret); } });
  child.stdout.write(progress(0, 0) + '\n');
  const result = await promise;
  assert.equal(result.error.code, 'REPORT_ERROR');
  assert.equal(result.error.message.includes(secret), false);
  assert.equal(vi.getTimerCount(), 0);
});

test('real Vitest hooks emit numeric progress before a temporary suite exits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'minsky-hosted-progress-'));
  directories.push(directory);
  const config = join(directory, 'vitest.config.mjs');
  const suite = join(directory, 'fixture.test.mjs');
  await writeFile(suite, `import { test } from ${JSON.stringify(resolve(repositoryRoot, 'node_modules/vitest/dist/index.js'))};
    import { setTimeout } from 'node:timers/promises';
    import process from 'node:process';
    test.concurrent(${JSON.stringify(secret)}, async () => { process.stdout.write(${JSON.stringify(secret + '\n' + metrics({ source: 1 }) + '\n')}); await setTimeout(180); });
    test.concurrent('second private title', async () => { process.stdout.write(${JSON.stringify(metrics({ source: 2, calls: 2, statements: 3 }) + '\n')}); await setTimeout(20); });\n`);
  await writeFile(config, `export default ${JSON.stringify({ root: repositoryRoot, test: { include: [suite],
    maxWorkers: 1, fileParallelism: false, reporters: [
      [resolve(repositoryRoot, 'src/server/adapters/cloudflare/tooling/hosted-progress-reporter.mjs'), { total: 2 }],
      ['json', { stdout: true }],
    ] } })};\n`);
  const reports = [];
  let exited = false;
  let beforeExit = false;
  const promise = runHostedChild([resolve(repositoryRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config], {
    cwd: repositoryRoot, env: { ...process.env, CI: '1', NO_COLOR: '1' }, timeout: 20_000, maxBuffer: 1024 * 1024,
  }, { expectedTotal: 2, heartbeatMs: 50, report: (line) => {
    reports.push(line);
    if (line.includes('last case') && !exited) beforeExit = true;
  } });
  const result = await promise; exited = true;
  assert.equal(result.status, 0);
  assert.equal(result.error, undefined);
  assert.equal(beforeExit, true, JSON.stringify({ publicReports: reports.length,
    rawStdoutProgress: result.stdout.split(progressPrefix).length - 1,
    rawStderrProgress: result.stderr.split(progressPrefix).length - 1 }));
  assert.equal(reports.filter((line) => line.includes('last case')).length, 2);
  assert.equal(reports.some((line) => line.includes('2/2 complete')), true);
  assert.equal(reports.some((line) => line.includes('active 2')), true);
  assert.equal(reports.some((line) => line.includes('DB 5 calls, 10 statements')), true);
  assert.equal(reports.some((line) => line.includes(secret) || line.includes('second private title')), false);
  const json = result.stdout.split('\n').find((line) => line.startsWith('{"numTotalTestSuites":'));
  assert.equal(JSON.parse(json).numPassedTests, 2);
}, 25_000);
