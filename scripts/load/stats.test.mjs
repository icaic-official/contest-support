import { describe, expect, it } from 'vitest';
import { joinLiveDelivery, percentile, summarizeSamples } from './stats.mjs';

const team = 'team-a';
const otherTeam = 'team-b';
const window = (observer, staff, teamId, from = 0, to = 100_000) => ({ observer, staff, teamId, from, to });

describe('load-test statistics', () => {
  it('reports nearest-rank percentiles', () => {
    const sorted = Array.from({ length: 100 }, (_, index) => index + 1);
    expect([percentile(sorted, 50), percentile(sorted, 95), percentile(sorted, 99), percentile(sorted, 100)]).toEqual([50, 95, 99, 100]);
    expect(percentile([], 50)).toBeUndefined();
  });

  it('counts failures but not workflow conflicts or user actions in the error rate', () => {
    const summary = summarizeSamples({
      snapshot: { ms: [10, 20, 30, 40], outcomes: { ok: 3, server: 1 }, bytes: 0 },
      'workflow:claim': { ms: [5, 6], outcomes: { ok: 1, conflict: 1 }, bytes: 0 },
      'action:claim': { ms: [50, 60], outcomes: { ok: 1, conflict: 1 }, bytes: 0 },
    });
    expect(summary).toMatchObject({ requests: 6, failed: 1 });
    expect(summary.errorRate).toBeCloseTo(1 / 6);
    expect(summary.rows['workflow:claim'].failures).toBe(0);
  });

  it('measures each screen in the audience from the commit to the refresh that shows it', () => {
    const commits = [{ actor: 'team-a-1', issueId: 'issue-1', teamId: team, minRevision: null, sentAt: 1000, at: 1200 }];
    const windows = [
      window('team-a-1', false, team), window('team-a-2', false, team), window('team-b-1', false, otherTeam),
      window('staff-1', true, null), window('staff-2', true, null), window('late-staff', true, null, 5000),
    ];
    const observations = [
      { observer: 'team-a-1', issueId: 'issue-1', revision: 1, at: 1300, hintAt: null },
      { observer: 'team-a-2', issueId: 'issue-1', revision: 1, at: 2000, hintAt: 1500 },
      { observer: 'staff-1', issueId: 'issue-1', revision: 1, at: 4200, hintAt: null },
      { observer: 'team-b-1', issueId: 'issue-1', revision: 1, at: 1250, hintAt: 1250 },
    ];
    const result = joinLiveDelivery(commits, observations, windows, { deadlineMs: 15_000 });
    expect(result).toMatchObject({ pairs: 3, missed: 1, viaPoll: 1 });
    expect(result.data).toMatchObject({ count: 2, p50: 800, max: 3000 });
    expect(result.hint).toMatchObject({ count: 1, p50: 300 });
    expect(result.withinThreeSeconds).toBeCloseTo(2 / 3);
  });

  it('waits for the revision that the command produced', () => {
    const commits = [{ actor: 'staff-1', issueId: 'issue-1', teamId: team, minRevision: 3, sentAt: 1000, at: 1100 }];
    const observations = [
      { observer: 'team-a-1', issueId: 'issue-1', revision: 2, at: 1050, hintAt: null },
      { observer: 'team-a-1', issueId: 'issue-1', revision: 3, at: 6100, hintAt: 6000 },
    ];
    const result = joinLiveDelivery(commits, observations, [window('team-a-1', false, team)], { deadlineMs: 15_000 });
    expect(result.data).toMatchObject({ count: 1, p50: 5000 });
    expect(result.withinThreeSeconds).toBe(0);
  });
});
