import { expect, test, type Page } from '@playwright/test';
import type { Command, Issue, Membership, Snapshot } from '../src/connected/model';

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

/** Intercepts Auth and session reads; every identity and record is fictional. */
async function signIn(page: Page) {
  const user = {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'reviewer@accounts.minsky.invalid',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { name: 'Review fixture' },
    created_at: '2026-10-01T00:00:00Z',
  };
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
  const commands: Command[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  page.on('console', (entry) => {
    if (entry.type() === 'error') errors.push(entry.text());
  });
  // The fixture has no Realtime server and must never connect to a provider.
  await page.routeWebSocket(/supabase\.co/, (socket) => {
    socket.close();
  });
  await page.route('https://example.supabase.co/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown;
    if (path === '/auth/v1/token') {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        sub: USER_ID,
        aud: 'authenticated',
        role: 'authenticated',
        iat: now,
        exp: now + 3600,
      })).toString('base64url');
      result = {
        access_token: `${header}.${payload}.fixture`,
        refresh_token: 'review-fixture',
        expires_in: 3600,
        expires_at: now + 3600,
        token_type: 'bearer',
        user,
      };
    } else if (path === '/auth/v1/user') {
      result = user;
    } else if (path === '/rest/v1/rpc/account_status') {
      result = { username: 'reviewer', must_change: false, session_valid: true };
    } else if (path === '/rest/v1/memberships') {
      result = memberships;
    } else if (path === '/rest/v1/sessions') {
      result = memberships.map((member) => ({
        id: member.session_id,
        name: member.session_id === SESSION_ID ? 'Session one' : 'Session two',
      }));
    } else if (path === '/rest/v1/rpc/session_snapshot') {
      const sessionId: string = route.request().postDataJSON().p_session;
      const member = memberships.find((item) => item.session_id === sessionId);
      if (!member) throw new Error('Unknown fixture membership.');
      const teams = sessionId === SESSION_ID
        ? [
            { id: AURORA_ID, session_id: sessionId, name: 'Aurora', location: 'Hall A · Desk 12' },
            { id: CEDAR_ID, session_id: sessionId, name: 'Cedar', location: 'Hall B · Desk 04' },
          ]
        : [{ id: SECOND_TEAM_ID, session_id: sessionId, name: 'Another', location: 'Hall C · Desk 1234' }];
      const visibleTeams = teams.filter((team) =>
        team.id !== removedTeam && (!member.team_id || team.id === member.team_id),
      );
      const snapshot: Snapshot = {
        session: {
          id: sessionId,
          event_id: EVENT_ID,
          name: 'Review session',
          intake_open: true,
          categories: ['Network', 'Device'],
          revision: 0,
          max_image_bytes: 10 * 1048576,
          max_images_per_issue: 12,
          max_image_bytes_per_issue: 120 * 1048576,
        },
        event: { id: EVENT_ID, name: 'Review event', archived: false },
        membership: member,
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
        resolutions: [],
        history: [],
        attachments: [],
        pending_removals: [],
        awards: [],
        members: [{ membership: member, person: { id: USER_ID, name: 'Review fixture', username: 'reviewer' } }],
        audit: [],
        server_time: new Date().toISOString(),
      };
      result = snapshot;
    } else if (path === '/rest/v1/rpc/workflow') {
      commands.push(route.request().postDataJSON().p_action);
      result = ISSUE_IDS[0];
    } else {
      throw new Error(`Unexpected fixture request: ${path}`);
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.goto('/');
  await expect(page).toHaveTitle(/^Minsky\b/);
  await page.getByLabel('Username', { exact: true }).fill('reviewer');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#queue-team-search')).toBeVisible();
  await expect(page.locator('.issue-list .issue-card')).toHaveCount(3);
  return {
    commands,
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

test('Tab leaves open suggestions and selection still supports keyboard and pointer', async ({ page }) => {
  const fixture = await signIn(page);
  const queue = page.locator('#queue-team-search');
  const options = page.locator('.team-suggestions [role=option]');
  await queue.fill('aur');
  await expect(options).toHaveCount(1);
  await queue.press('Tab');
  await expect(page.locator('.filter-label select')).toBeFocused();
  await expect(options).toHaveCount(0);
  await expect(page.locator('.issue-list .issue-card')).toHaveCount(3);
  await queue.focus();
  await queue.press('ArrowDown');
  await queue.press('Enter');
  await expect(queue).toHaveValue('Aurora');
  await expect(page.locator('.issue-list .issue-card')).toHaveCount(2);
  await page.locator('.filter-label select').selectOption('resolved');
  await expect(page.locator('.issue-list .issue-card')).toHaveCount(1);
  await expect(page.locator('#queue-team-search-chosen')).toContainText('1 unresolved issue');
  await page.getByRole('button', { name: 'Report for team', exact: true }).click();
  const report = page.locator('#report-team-search');
  await expect(report).toHaveValue('Aurora');
  await report.fill('ced');
  await expect(options).toHaveCount(1);
  await report.press('Tab');
  await expect(page.locator('select[name=category]')).toBeFocused();
  await expect(options).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Submit issue', exact: true })).toBeDisabled();
  await report.focus();
  await options.click();
  await expect(queue).toHaveValue('Cedar');
  await page.getByLabel('What’s happening?').fill('Review submission');
  await page.getByRole('button', { name: 'Submit issue', exact: true }).click();
  await expect(report).toHaveCount(0);
  expect(fixture.commands).toEqual([{ type: 'submit', team_id: CEDAR_ID, category: 'Network', description: 'Review submission' }]);
  expect(fixture.errors).toEqual([]);
});

for (const activation of ['Enter', 'Space']) {
  test(`Clear team with ${activation} resets both controls and restores the queue`, async ({ page }) => {
    await page.setViewportSize({
      width: activation === 'Enter' ? 1400 : 320,
      height: activation === 'Enter' ? 950 : 844,
    });
    const fixture = await signIn(page);
    const queue = page.locator('#queue-team-search');
    const options = page.locator('.team-suggestions [role=option]');
    const rows = page.locator('.issue-list .issue-card');
    const status = page.locator('.filter-label select');
    await status.selectOption('open');
    await queue.fill('aur');
    await queue.press('ArrowDown');
    await queue.press('Enter');
    await expect(queue).toHaveValue('Aurora');
    await expect(rows).toHaveCount(1);
    await queue.press('Tab');
    await expect(page.locator('.queue-toolbar .team-search-clear')).toBeFocused();
    await page.keyboard.press(activation);
    await expect(queue).toHaveValue('');
    await expect(queue).toBeFocused();
    await expect(rows).toHaveCount(2);
    await expect(status).toHaveValue('open');
    await expect(page.locator('.team-search-clear')).toHaveCount(0);
    await expect(options).toHaveCount(0);

    await queue.fill('ced');
    await options.click();
    await page.getByRole('button', { name: 'Report for team', exact: true }).click();
    const report = page.locator('#report-team-search');
    const submit = page.getByRole('button', { name: 'Submit issue', exact: true });
    await expect(report).toHaveValue('Cedar');
    await expect(submit).toBeEnabled();
    await page.locator('select[name=category]').selectOption('Device');
    await page.getByLabel('What’s happening?').fill('Keep this draft');
    await report.focus();
    await report.press('Tab');
    await expect(page.locator('#issue-report .team-search-clear')).toBeFocused();
    await page.keyboard.press(activation);
    await expect(report).toHaveValue('');
    await expect(report).toBeFocused();
    await expect(queue).toHaveValue('');
    await expect(rows).toHaveCount(2);
    await expect(status).toHaveValue('open');
    await expect(submit).toBeDisabled();
    await expect(page.locator('.team-search-clear')).toHaveCount(0);
    await expect(page.getByLabel('What’s happening?')).toHaveValue('Keep this draft');
    await expect(page.locator('select[name=category]')).toHaveValue('Device');

    // A new choice still enables submission, and pointer clearing still works.
    await report.fill('aur');
    await options.click();
    await expect(queue).toHaveValue('Aurora');
    await expect(submit).toBeEnabled();
    await page.locator('#issue-report .team-search-clear').click();
    await expect(report).toHaveValue('');
    await expect(report).toBeFocused();
    await expect(queue).toHaveValue('');
    await expect(rows).toHaveCount(2);
    await expect(submit).toBeDisabled();
    expect(fixture.commands).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });
}

test('a refreshed contestant membership drops the hidden staff team filter', async ({ page }) => {
  const fixture = await signIn(page);
  await page.locator('#queue-team-search').fill('ced');
  await page.locator('.team-suggestions [role=option]').click();
  await expect(page.locator('.issue-list .issue-card')).toHaveCount(1);
  fixture.assignContestant();
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
  await expect(page.getByRole('heading', { name: 'My team’s issues', exact: true })).toBeVisible();
  await expect(page.locator('#queue-team-search')).toHaveCount(0);
  await expect(page.locator('.issue-list .issue-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Report an issue', exact: true }).click();
  await expect(page.locator('#report-team-search')).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});

test('automatic session fallback drops the previous session’s team selection', async ({ page }) => {
  const fixture = await signIn(page);
  const queue = page.locator('#queue-team-search');
  await queue.fill('ced');
  await page.locator('.team-suggestions [role=option]').click();
  await expect(queue).toHaveValue('Cedar');
  fixture.revokeFirstSession();
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
  await expect(page.locator('.session-name')).toHaveText('Review session');
  await expect(queue).toHaveValue('');
  await expect(page.locator('.issue-list .issue-card')).toHaveCount(3);
  await expect(page.locator('.issue-list .team-cell strong').first()).toHaveText('Another');
  expect(fixture.errors).toEqual([]);
});

test('a team removed from the snapshot cannot filter or receive a staff report', async ({ page }) => {
  const fixture = await signIn(page);
  const queue = page.locator('#queue-team-search');
  await queue.fill('ced');
  await page.locator('.team-suggestions [role=option]').click();
  fixture.removeTeam(CEDAR_ID);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
  await expect(queue).toHaveValue('');
  await expect(page.locator('.issue-list .issue-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Report for team', exact: true }).click();
  await expect(page.locator('#report-team-search')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Submit issue', exact: true })).toBeDisabled();
  expect(fixture.commands).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
