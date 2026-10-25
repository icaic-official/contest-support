import { failureClasses } from './client.mjs';

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted, p) {
  if (!sorted.length) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export function summarize(values) {
  const sorted = Float64Array.from(values).sort();
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1] : undefined,
    mean: sorted.length ? total / sorted.length : undefined,
  };
}

export function addSample(samples, name, ms, outcome, bytes = 0) {
  const entry = samples[name] ??= { ms: [], outcomes: {}, bytes: 0 };
  entry.ms.push(ms);
  entry.outcomes[outcome] = (entry.outcomes[outcome] ?? 0) + 1;
  entry.bytes += bytes;
}

export function mergeSamples(target, source) {
  for (const [name, entry] of Object.entries(source)) {
    const into = target[name] ??= { ms: [], outcomes: {}, bytes: 0 };
    for (const value of entry.ms) into.ms.push(value);
    for (const [outcome, count] of Object.entries(entry.outcomes)) into.outcomes[outcome] = (into.outcomes[outcome] ?? 0) + count;
    into.bytes += entry.bytes;
  }
  return target;
}

export function failures(outcomes) {
  return failureClasses.reduce((sum, outcome) => sum + (outcomes[outcome] ?? 0), 0);
}

/**
 * Latency per name over every attempt, plus counts by outcome. Names that start
 * with `action:` are user actions, and the rest are single requests.
 */
export function summarizeSamples(samples) {
  const rows = {};
  let requests = 0;
  let failed = 0;
  for (const [name, entry] of Object.entries(samples)) {
    const count = Object.values(entry.outcomes).reduce((sum, value) => sum + value, 0);
    rows[name] = { ...summarize(entry.ms), outcomes: entry.outcomes, failures: failures(entry.outcomes), bytes: entry.bytes };
    if (!name.startsWith('action:') && !name.startsWith('canary:')) {
      requests += count;
      failed += failures(entry.outcomes);
    }
  }
  return { rows, requests, failed, errorRate: requests ? failed / requests : 0 };
}

/**
 * Joins committed commands with what other people's screens later showed.
 *
 * A commit is `{ actor, issueId, teamId, minRevision, sentAt, at }`. `minRevision`
 * is null for a new issue, which becomes visible when it first appears.
 * An observation is `{ observer, issueId, revision, at, hintAt }`. Each observer
 * emits one when its snapshot first shows an issue or a higher revision. `hintAt`
 * is the time of the live `change` message that started that refresh, or null
 * when a poll or another trigger started it.
 * An observer window is `{ observer, staff, teamId, from, to }`.
 *
 * Every observer in the command's audience (all staff, and the issue's team)
 * that was watching from before the command until after `deadline` counts once.
 */
export function joinLiveDelivery(commits, observations, windows, { deadlineMs }) {
  const byObserverIssue = new Map();
  for (const observation of observations) {
    const key = `${observation.observer}|${observation.issueId}`;
    let list = byObserverIssue.get(key);
    if (!list) byObserverIssue.set(key, list = []);
    list.push(observation);
  }
  for (const list of byObserverIssue.values()) list.sort((a, b) => a.at - b.at);
  const data = [];
  const hint = [];
  let viaPoll = 0;
  let missed = 0;
  for (const commit of commits) {
    for (const window of windows) {
      if (window.observer === commit.actor || window.from > commit.sentAt || window.to < commit.at + deadlineMs) continue;
      if (!window.staff && window.teamId !== commit.teamId) continue;
      const seen = (byObserverIssue.get(`${window.observer}|${commit.issueId}`) ?? [])
        .find((observation) => observation.at >= commit.sentAt &&
          (commit.minRevision === null || observation.revision >= commit.minRevision));
      if (!seen || seen.at > commit.at + deadlineMs) { missed++; continue; }
      data.push(Math.max(0, seen.at - commit.at));
      if (seen.hintAt === null) viaPoll++;
      else hint.push(Math.max(0, seen.hintAt - commit.at));
    }
  }
  const pairs = data.length + missed;
  return {
    pairs,
    data: summarize(data),
    hint: summarize(hint),
    viaPoll,
    missed,
    withinThreeSeconds: pairs ? data.filter((ms) => ms <= 3000).length / pairs : undefined,
  };
}
