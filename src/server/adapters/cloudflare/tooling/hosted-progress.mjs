import { spawn as spawnChild } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { StringDecoder } from 'node:string_decoder';
import * as timers from 'node:timers';

export const progressPrefix = 'MINSKY_HOSTED_PROGRESS ';
export const metricsPrefix = 'MINSKY_D1_METRICS ';
const progressFields = ['event', 'completed', 'total', 'durationMs', 'active', 'activeMs'];
const metricFields = ['source', 'calls', 'statements', 'wallMs', 'sqlMs', 'inFlight'];
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const duration = (value) => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

function exactFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

/** Unknown fields and nonnumeric values never reach the public report. */
export function parseHostedProgress(line, expectedTotal) {
  if (line.length > 1024) return undefined;
  let value;
  try {
    if (line.startsWith(progressPrefix)) {
      value = JSON.parse(line.slice(progressPrefix.length));
      if (!exactFields(value, progressFields) || ![0, 1].includes(value.event) ||
          !integer(value.completed) || value.total !== expectedTotal || value.completed > value.total ||
          !duration(value.durationMs) || value.event === 0 && value.durationMs !== 0 ||
          !integer(value.active) || value.active > expectedTotal - value.completed || !duration(value.activeMs) ||
          value.active === 0 && value.activeMs !== 0 || value.event === 0 && value.active === 0) return undefined;
      return { kind: 'case', value };
    }
    if (line.startsWith(metricsPrefix)) {
      value = JSON.parse(line.slice(metricsPrefix.length));
      if (!exactFields(value, metricFields) || !integer(value.source) || value.source > 4 || !integer(value.calls) || !integer(value.statements) ||
          !integer(value.inFlight) || value.inFlight > value.calls || !duration(value.wallMs) || !duration(value.sqlMs)) return undefined;
      return { kind: 'metrics', value };
    }
  } catch { /* Provider text is private even when it resembles a progress line. */ }
  return undefined;
}

/** Build messages only from local counters and validated numeric aggregates. */
function formatHostedProgress(value) {
  let message = `Hosted cases: ${value.completed}/${value.total} complete; elapsed ${Math.floor(value.elapsedMs / 1000)}s; active ${value.active}; oldest case ${Math.floor(value.activeMs / 1000)}s`;
  if (value.event === 1) message += `; last case ${Math.round(value.durationMs)}ms`;
  if (value.metrics) {
    const metrics = value.metrics;
    message += `; DB ${metrics.calls} calls, ${metrics.statements} statements, wall ${Math.round(metrics.wallMs)}ms, reported SQL ${Math.round(metrics.sqlMs)}ms, ${metrics.inFlight} in flight`;
  }
  return message + '.';
}

function privateError(code) {
  return Object.assign(new Error('The hosted child did not finish normally. Private output was withheld.'), { code });
}

/**
 * Async replacement for a captured spawnSync execute callback. Only validated
 * progress is public. Callers retain their final-count and cleanup assertions.
 */
export function runHostedChild(argumentsChild, options, dependencies = {}) {
  const { expectedTotal, report = (line) => process.stdout.write(line + '\n'), heartbeatMs = 15_000,
    spawn = spawnChild, now = () => performance.now(), timer = timers } = dependencies;
  if (!integer(expectedTotal) || expectedTotal < 1 || !integer(heartbeatMs) || heartbeatMs < 1 || heartbeatMs > 30_000) {
    throw new Error('Set a fixed positive case count and a heartbeat of at most 30 seconds.');
  }
  const { timeout = 30 * 60_000, maxBuffer = 16 * 1024 * 1024, encoding: _encoding,
    stdio: _stdio, ...spawnOptions } = options;
  if (!integer(timeout) || timeout < 1 || !integer(maxBuffer) || maxBuffer < 1) {
    throw new Error('Set positive hosted timeout and private output limits.');
  }
  // These documented spawnSync options have explicit handling below.
  void _encoding;
  void _stdio;
  return new Promise((resolve) => {
    const startedAt = now();
    let active = 0;
    let activeSince = 0;
    const metricSources = new Map();
    const stdout = [];
    const stderr = [];
    const bytes = { stdout: 0, stderr: 0 };
    const decoder = new StringDecoder('utf8');
    let pendingLine = '';
    let completed = 0;
    let metrics;
    let error;
    let child;
    let heartbeat;
    let deadline;
    let forceKill;
    let settled = false;

    function clearTimers() {
      timer.clearInterval(heartbeat);
      timer.clearTimeout(deadline);
      timer.clearTimeout(forceKill);
    }

    function finish(status, signal) {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({ status, signal, error, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    }

    function stop(code) {
      if (settled || error) return;
      error = privateError(code);
      clearTimers();
      // A child that ignores SIGTERM must not keep the operator waiting forever.
      forceKill = timer.setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 1000);
      child.kill('SIGTERM');
    }

    function publish(event, durationMs = 0) {
      const at = now();
      try {
        report(formatHostedProgress({ event, completed, total: expectedTotal, durationMs,
          elapsedMs: Math.max(0, at - startedAt), active, activeMs: active ? Math.max(0, at - activeSince) : 0, metrics }));
      } catch {
        stop('REPORT_ERROR');
      }
    }

    function line(value) {
      if (settled || error) return;
      const parsed = parseHostedProgress(value, expectedTotal);
      if (!parsed) return;
      if (parsed.kind === 'metrics') {
        // Each worker has its own numeric source. Never compare one worker's
        // totals with another worker's totals. inFlight may decrease.
        const prior = metricSources.get(parsed.value.source);
        if (prior && ['calls', 'statements', 'wallMs', 'sqlMs'].some((key) => parsed.value[key] < prior[key])) return;
        metricSources.set(parsed.value.source, parsed.value);
        const sum = { calls: 0, statements: 0, wallMs: 0, sqlMs: 0, inFlight: 0 };
        for (const source of metricSources.values()) for (const key of Object.keys(sum)) sum[key] += source[key];
        if (Object.values(sum).every(duration)) metrics = sum;
        return;
      }
      const progress = parsed.value;
      if (progress.event === 0 && progress.completed === completed && completed < expectedTotal) {
        active = progress.active;
        activeSince = now() - progress.activeMs;
        publish(0);
      } else if (progress.event === 1 && progress.completed === completed + 1) {
        completed = progress.completed;
        active = progress.active;
        activeSince = now() - progress.activeMs;
        publish(1, progress.durationMs);
      }
    }

    function output(name, value) {
      if (settled || error) return;
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes[name] += chunk.length;
      if (bytes[name] > maxBuffer) { stop('ENOBUFS'); return; }
      (name === 'stdout' ? stdout : stderr).push(chunk);
      if (name !== 'stdout') return;
      pendingLine += decoder.write(chunk);
      let boundary;
      while (!error && (boundary = pendingLine.indexOf('\n')) !== -1) {
        const next = pendingLine.slice(0, boundary).replace(/\r$/, '');
        pendingLine = pendingLine.slice(boundary + 1);
        line(next);
      }
    }

    try {
      child = spawn(process.execPath, argumentsChild, { ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      error = privateError('SPAWN_ERROR');
      finish(null, null);
      return;
    }
    heartbeat = timer.setInterval(() => publish(2), heartbeatMs);
    deadline = timer.setTimeout(() => stop('ETIMEDOUT'), timeout);
    child.stdout.on('data', (value) => output('stdout', value));
    child.stderr.on('data', (value) => output('stderr', value));
    child.stdout.on('error', () => stop('STREAM_ERROR'));
    child.stderr.on('error', () => stop('STREAM_ERROR'));
    child.on('error', () => {
      error ??= privateError('SPAWN_ERROR');
      finish(null, null);
    });
    child.on('close', (status, signal) => {
      if (!error && !settled) line(pendingLine + decoder.end());
      finish(status, signal);
    });
  });
}
