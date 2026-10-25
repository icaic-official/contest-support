import type { Page } from '@playwright/test';
import type { Issue, Membership, Snapshot } from '../../src/connected/model';
import { type FakeWorker, appErrors, expect, fixtureAccount, sessionSnapshot } from './worker';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000002';
const EVENT_ID = '00000000-0000-4000-8000-000000000004';
const TEAM_IDS = [
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000006',
  '00000000-0000-4000-8000-000000000007',
];
const issueId = (number: number) => `00000000-0000-4000-8000-0000000001${String(number).padStart(2, '0')}`;
const resolutionId = (number: number) => `00000000-0000-4000-8000-0000000002${String(number).padStart(2, '0')}`;

const teams: Snapshot['teams'] = [
  { id: TEAM_IDS[0], session_id: SESSION_ID, name: 'Aurora', location: 'Hall A · Desk 12' },
  { id: TEAM_IDS[1], session_id: SESSION_ID, name: 'Cedar', location: 'Hall B · Desk 04' },
  { id: TEAM_IDS[2], session_id: SESSION_ID, name: 'Delta', location: 'Hall C · Desk 21' },
];

/** An issue of the fixture. `team` indexes Aurora, Cedar and Delta. */
export interface FixtureIssue {
  number: number;
  status: Issue['status'];
  minutesAgo: number;
  team: 0 | 1 | 2;
  revision?: number;
}

/** Two open issues, one in progress, one awaiting a specialist and one resolved. */
export const defaultIssues: FixtureIssue[] = [
  { number: 1, status: 'open', minutesAgo: 24, team: 0 },
  { number: 2, status: 'claimed', minutesAgo: 14, team: 1 },
  { number: 3, status: 'escalated', minutesAgo: 9, team: 2 },
  { number: 4, status: 'open', minutesAgo: 3, team: 0 },
  { number: 5, status: 'resolved', minutesAgo: 40, team: 1 },
];

/**
 * Signs in through the Worker fixture. All names and records are fictional. The returned `setIssues` changes what the
 * next session read returns, and `refresh` makes the app read it, as a
 * returning window does.
 */
export async function signInConsole(
  page: Page,
  api: FakeWorker,
  viewport: { width: number; height: number },
  options: { contestant?: boolean; issues?: FixtureIssue[] } = {},
) {
  await page.setViewportSize(viewport);
  let list = options.issues ?? defaultIssues;
  const errors = appErrors(page);
  const member: Membership = {
    session_id: SESSION_ID,
    user_id: USER_ID,
    team_id: options.contestant ? TEAM_IDS[0] : null,
    roles: options.contestant ? [] : ['volunteer', 'specialist'],
    is_admin: false,
  };
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const snapshot = (): Snapshot => {
    const visibleTeams = options.contestant ? teams.slice(0, 1) : teams;
    return sessionSnapshot(member, {
      session: {
        event_id: EVENT_ID,
        name: 'Session one',
        categories: ['Network', 'Device'],
        max_image_bytes: 10 * 1048576,
        max_images_per_issue: 12,
        max_image_bytes_per_issue: 120 * 1048576,
      },
      event: { id: EVENT_ID, name: 'Review event', archived: false },
      teams: visibleTeams,
      issues: list
        .map((item): Issue => ({
          id: issueId(item.number),
          number: item.number,
          session_id: SESSION_ID,
          team_id: TEAM_IDS[item.team],
          reporter: USER_ID,
          reporter_name: 'Review fixture',
          category: 'Network',
          description: `Fixture issue ${item.number}`,
          status: item.status,
          created_at: ago(item.minutesAgo),
          first_assigned_at: item.status === 'open' ? null : ago(item.minutesAgo - 2),
          owner: item.status === 'open' ? null : USER_ID,
          owner_name: item.status === 'open' ? null : 'Review fixture',
          resolved_at: item.status === 'resolved' ? ago(5) : null,
          revision: item.revision ?? 0,
        }))
        .filter((issue) => visibleTeams.some((team) => team.id === issue.team_id)),
      resolutions: list
        .filter((item) => item.status === 'resolved')
        .map((item) => ({
          id: resolutionId(item.number),
          session_id: SESSION_ID,
          issue_id: issueId(item.number),
          actor: USER_ID,
          actor_name: 'Review fixture',
          at: ago(5),
          summary: 'Replaced the cable',
          reopened_at: null,
          reopened_by: null,
          reopened_name: null,
          reason: null,
        })),
      members: [{ membership: member, person: { id: USER_ID, name: 'Review fixture', username: 'reviewer' } }],
      server_time: new Date().toISOString(),
    });
  };
  api.account = fixtureAccount(USER_ID, 'reviewer', 'Review fixture');
  api.snapshots = () => [snapshot()];
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('reviewer');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator(options.contestant ? '[data-ui="contestant"]' : '[data-ui="organiser-desktop"], [data-ui="organiser-phone"]')).toBeVisible();
  return {
    errors,
    setIssues: (next: FixtureIssue[]) => { list = next; },
    refresh: () => page.evaluate(() => { window.dispatchEvent(new Event('focus')); }),
  };
}
