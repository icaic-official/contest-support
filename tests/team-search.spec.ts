import type { Locator, Page } from '@playwright/test';
import type { Command, Issue, Membership } from '../src/connected/model';
import { type FakeWorker, appErrors, expect, fixtureAccount, sessionSnapshot, test } from './support/worker';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000002';
const SECOND_SESSION_ID = '00000000-0000-4000-8000-000000000003';
const EVENT_ID = '00000000-0000-4000-8000-000000000004';
const AURORA_ID = '00000000-0000-4000-8000-000000000005';
const CEDAR_ID = '00000000-0000-4000-8000-000000000006';
const SECOND_TEAM_ID = '00000000-0000-4000-8000-000000000007';
const ISSUE_IDS = [
  '00000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000022',
];

/** The desktop console at its smallest supported size. */
const desktop = { width: 1280, height: 800 };
/** A common phone size for the organiser phone app. */
const phone = { width: 390, height: 844 };

type Viewport = typeof desktop;

const sessionNames: Record<string, string> = {
  [SESSION_ID]: 'Session one',
  [SECOND_SESSION_ID]: 'Session two',
};

/**
 * Serves fictional session reads through the Worker fixture.
 * Session one has Aurora (issue 1 open, issue 2 resolved) and Cedar (issue 3
 * open). Session two has one team, Another, with all three issues.
 */
async function signIn(page: Page, api: FakeWorker, viewport: Viewport) {
  await page.setViewportSize(viewport);
  let memberships: Membership[] = [SESSION_ID, SECOND_SESSION_ID].map(
    (sessionId) => ({
      session_id: sessionId,
      user_id: USER_ID,
      team_id: null,
      roles: ['volunteer'],
      is_admin: false,
    }),
  );
  let removedTeam: string | null = null;
  const errors = appErrors(page);
  api.account = fixtureAccount(USER_ID, 'reviewer', 'Review fixture');
  api.snapshots = () => memberships.map((member) => {
    const sessionId = member.session_id;
    const teams = sessionId === SESSION_ID
      ? [
          { id: AURORA_ID, session_id: sessionId, name: 'Aurora', location: 'Hall A · Desk 12' },
          { id: CEDAR_ID, session_id: sessionId, name: 'Cedar', location: 'Hall B · Desk 04' },
        ]
      : [{ id: SECOND_TEAM_ID, session_id: sessionId, name: 'Another', location: 'Hall C · Desk 1234' }];
    const visibleTeams = teams.filter((team) =>
      team.id !== removedTeam && (!member.team_id || team.id === member.team_id),
    );
    return sessionSnapshot(member, {
      session: {
        event_id: EVENT_ID,
        name: sessionNames[sessionId],
        categories: ['Network', 'Device'],
        max_image_bytes: 10 * 1048576,
        max_images_per_issue: 12,
        max_image_bytes_per_issue: 120 * 1048576,
      },
      event: { id: EVENT_ID, name: 'Review event', archived: false },
      teams: visibleTeams,
      issues: ISSUE_IDS.map((id, index): Issue => ({
        id,
        number: index + 1,
        session_id: sessionId,
        team_id: sessionId === SESSION_ID
          ? (index < 2 ? AURORA_ID : CEDAR_ID)
          : SECOND_TEAM_ID,
        reporter: USER_ID,
        reporter_name: 'Review fixture',
        category: 'Network',
        description: `Fixture issue ${index + 1}`,
        status: index === 1 ? 'resolved' : 'open',
        created_at: '2026-10-14T00:00:00Z',
        first_assigned_at: index === 1 ? '2026-10-14T00:05:00Z' : null,
        owner: index === 1 ? USER_ID : null,
        owner_name: index === 1 ? 'Review fixture' : null,
        resolved_at: index === 1 ? '2026-10-14T01:00:00Z' : null,
        revision: 0,
      })).filter((issue) => visibleTeams.some((team) => team.id === issue.team_id)),
      members: [{ membership: member, person: { id: USER_ID, name: 'Review fixture', username: 'reviewer' } }],
      server_time: new Date().toISOString(),
    });
  });
  await page.goto('/');
  await expect(page).toHaveTitle(/^Minsky\b/);
  await page.getByLabel('Username', { exact: true }).fill('reviewer');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (viewport.width >= 1024) {
    await expect(page.locator('[data-ui="organiser-desktop"]')).toBeVisible();
    await expect(page.locator('#queue-team-search')).toBeVisible();
    // The Active tab hides the resolved issue 2.
    await expect(issueRows(page)).toHaveCount(2);
  } else {
    await expect(page.locator('[data-ui="organiser-phone"]')).toBeVisible();
    await expect(page.locator('[id^="issue-card-"]')).toHaveCount(2);
  }
  return {
    commands: () => api.bodies<{ command: Command }>('/api/workflow').map((body) => body.command),
    errors,
    assignContestant: () => {
      memberships = memberships.map((member) => member.session_id === SESSION_ID
        ? { ...member, roles: [], is_admin: false, team_id: AURORA_ID }
        : member);
    },
    revokeFirstSession: () => {
      memberships = memberships.filter((member) => member.session_id !== SESSION_ID);
    },
    removeTeam: (teamId: string) => { removedTeam = teamId; },
  };
}

/** The issue number buttons of the desktop queue table. */
function issueRows(page: Page): Locator {
  return page.locator('[data-issue-row]');
}

/** The team names in the Team column of the desktop queue table. */
function rowTeams(page: Page): Locator {
  return page.locator('tbody tr td:nth-child(4) div:first-child');
}

function statusTab(page: Page, label: string): Locator {
  return page
    .getByRole('group', { name: 'Filter by status' })
    .getByRole('button', { name: new RegExp(`^${label} \\d+$`) });
}

/** Asks the app to read the session again, as a returning window does. */
async function refresh(page: Page) {
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
}

/** Opens the staff report dialog (desktop) or sheet (phone). */
async function openReport(page: Page): Promise<Locator> {
  const name = (page.viewportSize()?.width ?? 0) >= 1024 ? 'Report for a team' : 'Report';
  await page.getByRole('button', { name, exact: true }).click();
  const report = page.getByRole('dialog', { name: 'Report for a team' });
  await expect(report).toBeVisible();
  return report;
}

test('desktop queue filter: Tab leaves open suggestions, and keyboard and pointer select a team', async ({ page, api }) => {
  const fixture = await signIn(page, api, desktop);
  const queue = page.locator('#queue-team-search');
  const options = page.getByRole('option');
  await queue.fill('aur');
  await expect(options).toHaveCount(1);
  await queue.press('Tab');
  await expect(queue).not.toBeFocused();
  await expect(options).toHaveCount(0);
  await expect(issueRows(page)).toHaveCount(2);
  await queue.focus();
  await queue.press('ArrowDown');
  await queue.press('Enter');
  await expect(queue).toHaveValue('Aurora');
  await expect(issueRows(page)).toHaveCount(1);
  await expect(page.locator('#queue-team-search-chosen')).toContainText('1 unresolved issue');
  await statusTab(page, 'All').click();
  await expect(issueRows(page)).toHaveCount(2);
  await statusTab(page, 'Resolved').click();
  await expect(issueRows(page)).toHaveCount(1);
  await expect(issueRows(page)).toHaveText('Open ISS-2');

  // The report dialog has its own team choice. It does not change the queue filter.
  const report = await openReport(page);
  const reportTeam = report.locator('#report-team-search');
  const submit = report.getByRole('button', { name: 'Submit issue', exact: true });
  await expect(reportTeam).toHaveValue('');
  await reportTeam.fill('ced');
  await expect(options).toHaveCount(1);
  await reportTeam.press('Tab');
  await expect(report.getByRole('radio', { name: 'Network', exact: true })).toBeFocused();
  await expect(options).toHaveCount(0);
  await report.getByLabel('What’s happening?').fill('Review submission');
  await expect(submit).toBeDisabled();
  await reportTeam.focus();
  await options.click();
  await expect(reportTeam).toHaveValue('Cedar');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(report).toBeHidden();
  await expect.poll(() => fixture.commands()).toEqual([
    { type: 'submit', team_id: CEDAR_ID, category: 'Network', description: 'Review submission' },
  ]);
  await expect(queue).toHaveValue('Aurora');
  expect(fixture.errors).toEqual([]);
});

test('phone report sheet: Tab leaves open suggestions, and keyboard and pointer select a team', async ({ page, api }) => {
  const fixture = await signIn(page, api, phone);
  const options = page.getByRole('option');
  const report = await openReport(page);
  const reportTeam = report.locator('#report-team-search');
  const submit = report.getByRole('button', { name: 'Submit issue', exact: true });
  await reportTeam.fill('ced');
  await expect(options).toHaveCount(1);
  await reportTeam.press('Tab');
  await expect(report.getByRole('radio', { name: 'Network', exact: true })).toBeFocused();
  await expect(options).toHaveCount(0);
  await expect(submit).toBeDisabled();
  await reportTeam.focus();
  await options.click();
  await expect(reportTeam).toHaveValue('Cedar');
  await reportTeam.fill('aur');
  await reportTeam.press('ArrowDown');
  await reportTeam.press('Enter');
  await expect(reportTeam).toHaveValue('Aurora');
  await expect(report.locator('#report-team-search-chosen')).toContainText('1 unresolved issue');
  await report.getByLabel('What’s happening?').fill('Phone submission');
  await submit.click();
  await expect.poll(() => fixture.commands()).toEqual([
    { type: 'submit', team_id: AURORA_ID, category: 'Network', description: 'Phone submission' },
  ]);
  expect(fixture.errors).toEqual([]);
});

test('phone report sheet sends one submit command per chosen team', async ({ page, api }) => {
  const fixture = await signIn(page, api, phone);
  const report = await openReport(page);
  const reportTeam = report.locator('#report-team-search');
  const addTeam = report.getByRole('button', { name: 'Add another team', exact: true });
  await expect(addTeam).toBeDisabled();
  await reportTeam.fill('ced');
  await page.getByRole('option').click();
  await addTeam.click();
  await reportTeam.fill('aur');
  await page.getByRole('option').click();
  await expect(report.getByRole('list', { name: 'Teams to report' })).toContainText('Cedar');
  await report.getByLabel('What’s happening?').fill('Shared outage');
  await report.getByRole('button', { name: 'Submit 2 issues', exact: true }).click();
  await expect.poll(() => fixture.commands()).toEqual([
    { type: 'submit', team_id: CEDAR_ID, category: 'Network', description: 'Shared outage' },
    { type: 'submit', team_id: AURORA_ID, category: 'Network', description: 'Shared outage' },
  ]);
  expect(fixture.errors).toEqual([]);
});

test('phone Find tab searches teams by name and location and opens a team', async ({ page, api }) => {
  const fixture = await signIn(page, api, phone);
  await page
    .getByRole('navigation', { name: 'Organiser sections' })
    .getByRole('button', { name: 'Find', exact: true })
    .click();
  const find = page.getByLabel('Find a team, table or issue number');
  const teams = page.getByRole('region', { name: 'Teams' }).getByRole('button');
  await expect(teams).toHaveCount(2);
  await find.fill('hall b');
  await expect(teams).toHaveCount(1);
  await expect(teams).toContainText('Cedar');
  await find.fill('aur');
  await expect(teams).toHaveCount(1);
  await teams.click();
  await expect(page.getByRole('heading', { name: 'Aurora', exact: true })).toBeVisible();
  await expect(page.locator('[id^="issue-card-"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'All teams', exact: true }).click();
  await expect(find).toHaveValue('aur');
  await find.fill('zzz');
  await expect(page.getByText('No matching teams.')).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

/**
 * Chooses Cedar in the open report form, then clears it with the keyboard
 * and the pointer. The category and description stay.
 */
async function clearReportTeam(page: Page, report: Locator, activation: string) {
  const reportTeam = report.locator('#report-team-search');
  const clear = report.getByRole('button', { name: 'Clear team', exact: true });
  const submit = report.getByRole('button', { name: 'Submit issue', exact: true });
  const description = report.getByLabel('What’s happening?');
  const device = report.getByRole('radio', { name: 'Device', exact: true });
  await reportTeam.fill('ced');
  await page.getByRole('option').click();
  await expect(reportTeam).toHaveValue('Cedar');
  await report.getByText('Device', { exact: true }).click();
  await expect(device).toBeChecked();
  await description.fill('Keep this draft');
  await expect(submit).toBeEnabled();
  await reportTeam.focus();
  await reportTeam.press('Tab');
  await expect(clear).toBeFocused();
  await page.keyboard.press(activation);
  await expect(reportTeam).toHaveValue('');
  await expect(reportTeam).toBeFocused();
  await expect(submit).toBeDisabled();
  await expect(clear).toHaveCount(0);
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(description).toHaveValue('Keep this draft');
  await expect(device).toBeChecked();

  // A new choice enables submission again, and pointer clearing still works.
  await reportTeam.fill('aur');
  await page.getByRole('option').click();
  await expect(submit).toBeEnabled();
  await clear.click();
  await expect(reportTeam).toHaveValue('');
  await expect(reportTeam).toBeFocused();
  await expect(submit).toBeDisabled();
}

test('Clear team with Enter resets the desktop queue filter and the report team', async ({ page, api }) => {
  const fixture = await signIn(page, api, desktop);
  const queue = page.locator('#queue-team-search');
  const open = statusTab(page, 'Open');
  await open.click();
  await queue.fill('aur');
  await queue.press('ArrowDown');
  await queue.press('Enter');
  await expect(queue).toHaveValue('Aurora');
  await expect(issueRows(page)).toHaveCount(1);
  await queue.press('Tab');
  await expect(page.getByRole('button', { name: 'Clear team', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(queue).toHaveValue('');
  await expect(queue).toBeFocused();
  await expect(issueRows(page)).toHaveCount(2);
  await expect(open).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Clear team', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option')).toHaveCount(0);

  await clearReportTeam(page, await openReport(page), 'Enter');
  await page.keyboard.press('Escape');
  await expect(queue).toHaveValue('');
  await expect(issueRows(page)).toHaveCount(2);
  expect(fixture.commands()).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('Clear team with Space resets the report team in a 320 px phone sheet', async ({ page, api }) => {
  const fixture = await signIn(page, api, { width: 320, height: 844 });
  await clearReportTeam(page, await openReport(page), 'Space');
  expect(fixture.commands()).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('a refreshed contestant membership drops the hidden staff team filter', async ({ page, api }) => {
  const fixture = await signIn(page, api, desktop);
  await page.locator('#queue-team-search').fill('ced');
  await page.getByRole('option').click();
  await expect(issueRows(page)).toHaveCount(1);
  fixture.assignContestant();
  await refresh(page);
  await expect(page.locator('[data-ui="contestant"]')).toBeVisible();
  await expect(page.locator('#queue-team-search')).toHaveCount(0);
  // Aurora's open and resolved issues show. The Cedar filter is gone.
  await expect(page.getByRole('navigation', { name: 'Reports' }).getByRole('button')).toHaveCount(2);
  await page.getByRole('button', { name: 'Report an issue', exact: true }).click();
  await expect(page.getByLabel('What is happening?')).toBeVisible();
  await expect(page.locator('#report-team-search')).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});

test('automatic session fallback drops the previous session’s desktop team selections', async ({ page, api }) => {
  const fixture = await signIn(page, api, desktop);
  const queue = page.locator('#queue-team-search');
  await queue.fill('ced');
  await page.getByRole('option').click();
  await expect(queue).toHaveValue('Cedar');
  const report = await openReport(page);
  await report.locator('#report-team-search').fill('ced');
  await page.getByRole('option').click();
  await report.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(report).toBeHidden();
  fixture.revokeFirstSession();
  await refresh(page);
  await expect(page.getByText('Session two', { exact: true }).first()).toBeVisible();
  await expect(queue).toHaveValue('');
  await expect(issueRows(page)).toHaveCount(2);
  await expect(rowTeams(page)).toHaveText(['Another', 'Another']);
  await expect((await openReport(page)).locator('#report-team-search')).toHaveValue('');
  expect(fixture.errors).toEqual([]);
});

test('automatic session fallback drops the previous session’s phone report team', async ({ page, api }) => {
  const fixture = await signIn(page, api, phone);
  const report = await openReport(page);
  await report.locator('#report-team-search').fill('ced');
  await page.getByRole('option').click();
  await report.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(report).toBeHidden();
  fixture.revokeFirstSession();
  await refresh(page);
  await expect(page.getByText('Review event · Session two')).toBeVisible();
  await expect((await openReport(page)).locator('#report-team-search')).toHaveValue('');
  expect(fixture.errors).toEqual([]);
});

test('a team removed from the snapshot cannot filter the desktop queue or receive a staff report', async ({ page, api }) => {
  const fixture = await signIn(page, api, desktop);
  const queue = page.locator('#queue-team-search');
  await queue.fill('ced');
  await page.getByRole('option').click();
  await expect(issueRows(page)).toHaveCount(1);
  const report = await openReport(page);
  const reportTeam = report.locator('#report-team-search');
  await reportTeam.fill('ced');
  await page.getByRole('option').click();
  await report.getByLabel('What’s happening?').fill('Stale team report');
  fixture.removeTeam(CEDAR_ID);
  await refresh(page);
  await expect(reportTeam).toHaveValue('');
  await expect(report.getByRole('button', { name: 'Submit issue', exact: true })).toBeDisabled();
  await reportTeam.fill('ced');
  await expect(report.getByText('No matching teams.')).toBeVisible();
  await report.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(queue).toHaveValue('');
  await expect(issueRows(page)).toHaveCount(1);
  await expect(rowTeams(page)).toHaveText(['Aurora']);
  expect(fixture.commands()).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('an empty filtered queue offers a way back to the active issues', async ({ page, api }) => {
  const fixture = await signIn(page, api, desktop);
  const queue = page.locator('#queue-team-search');
  await queue.fill('ced');
  await page.getByRole('option').click();
  await statusTab(page, 'Resolved').click();
  await expect(issueRows(page)).toHaveCount(0);
  await expect(page.getByText('No issues in this view.')).toBeVisible();
  await page.getByRole('button', { name: 'Show active issues', exact: true }).click();
  await expect(statusTab(page, 'Active')).toHaveAttribute('aria-pressed', 'true');
  await expect(statusTab(page, 'Active')).toBeFocused();
  await expect(queue).toHaveValue('');
  await expect(issueRows(page)).toHaveCount(2);
  expect(fixture.commands()).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('a team removed from the snapshot leaves the phone Find tab and report sheet', async ({ page, api }) => {
  const fixture = await signIn(page, api, phone);
  const report = await openReport(page);
  await report.locator('#report-team-search').fill('ced');
  await page.getByRole('option').click();
  await report.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(report).toBeHidden();
  await page
    .getByRole('navigation', { name: 'Organiser sections' })
    .getByRole('button', { name: 'Find', exact: true })
    .click();
  await page.getByRole('region', { name: 'Teams' }).getByRole('button', { name: /Cedar/ }).click();
  await expect(page.getByRole('heading', { name: 'Cedar', exact: true })).toBeVisible();
  fixture.removeTeam(CEDAR_ID);
  await refresh(page);
  await expect(page.getByRole('heading', { name: 'Cedar', exact: true })).toHaveCount(0);
  const teams = page.getByRole('region', { name: 'Teams' }).getByRole('button');
  await expect(teams).toHaveCount(1);
  await expect(teams).toContainText('Aurora');
  await page
    .getByRole('navigation', { name: 'Organiser sections' })
    .getByRole('button', { name: 'Queue', exact: true })
    .click();
  await expect(page.locator('[id^="issue-card-"]')).toHaveCount(1);
  const reopened = await openReport(page);
  await expect(reopened.locator('#report-team-search')).toHaveValue('');
  await expect(reopened.getByRole('button', { name: 'Submit issue', exact: true })).toBeDisabled();
  expect(fixture.commands()).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
