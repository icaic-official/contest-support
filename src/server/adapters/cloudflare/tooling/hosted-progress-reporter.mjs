import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { metricsPrefix, parseHostedProgress, progressPrefix } from './hosted-progress.mjs';

/** Vitest 5 reporter. Never read titles, errors, bodies, or task diagnostics. */
export default class HostedProgressReporter {
  constructor({ total } = {}) {
    if (!Number.isSafeInteger(total) || total < 1) throw new Error('Set the fixed hosted case count for progress.');
    this.total = total;
    this.completed = 0;
    this.finished = new WeakSet();
    this.active = new Map();
  }

  onTestCaseReady(testCase) {
    if (this.active.has(testCase) || this.finished.has(testCase)) return;
    this.active.set(testCase, performance.now());
    this.emit(0, 0);
  }

  onTestCaseResult(testCase) {
    if (this.finished.has(testCase)) return;
    const start = this.active.get(testCase);
    this.finished.add(testCase);
    this.active.delete(testCase);
    this.completed++;
    this.emit(1, start === undefined ? 0 : Math.max(0, Math.round(performance.now() - start)));
  }

  emit(event, durationMs) {
    const activeMs = this.active.size ? Math.max(0, Math.round(performance.now() - Math.min(...this.active.values()))) : 0;
    process.stdout.write(progressPrefix + JSON.stringify({ event, completed: this.completed, total: this.total,
      durationMs, active: this.active.size, activeMs }) + '\n');
  }

  onUserConsoleLog(log) {
    // Vitest captures worker stdout. Forward only exact numeric metric records.
    // Test titles and ordinary logs never become public reporter output.
    if (typeof log.content !== 'string' || log.content.length > 16_384) return;
    for (const line of log.content.split('\n')) {
      const parsed = parseHostedProgress(line.replace(/\r$/, ''), this.total);
      if (parsed?.kind === 'metrics') process.stdout.write(metricsPrefix + JSON.stringify(parsed.value) + '\n');
    }
  }
}
