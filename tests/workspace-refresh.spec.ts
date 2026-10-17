import { expect, test, type Page } from '@playwright/test';
import type { Command, Membership, Snapshot } from '../src/connected/model';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const MEMBER_ID = '00000000-0000-4000-8000-000000000002';
const SESSION_ID = '00000000-0000-4000-8000-000000000100';
const TEAM_ID = '00000000-0000-4000-8000-000000000200';

/** Opens the real UI with isolated Auth and database responses. */
async function openWorkspace(page: Page, firstWrite?: 'uncertain' | 'rejected') {
  const membership: Membership = {
    session_id: SESSION_ID,
    user_id: USER_ID,
    team_id: null,
    roles: ['volunteer'],
    is_admin: true,
  };
  const state: Snapshot = {
    session: {
      id: SESSION_ID,
      event_id: '00000000-0000-4000-8000-000000000090',
      name: 'Review session',
      intake_open: true,
      categories: ['Network'],
      revision: 0,
      max_image_bytes: 10 * 1024 * 1024,
      max_images_per_issue: 20,
      max_image_bytes_per_issue: 120 * 1024 * 1024,
    },
    event: {
      id: '00000000-0000-4000-8000-000000000090',
      name: 'Review event',
      archived: false,
    },
    membership,
    teams: [
      {
        id: TEAM_ID,
        session_id: SESSION_ID,
        name: 'Aurora',
        location: 'Desk 12',
      },
    ],
    issues: [
      {
        id: '00000000-0000-4000-8000-000000000300',
        number: 1,
        session_id: SESSION_ID,
        team_id: TEAM_ID,
        reporter: USER_ID,
        reporter_name: 'Review administrator',
        category: 'Network',
        description: 'Original issue',
        status: 'open',
        created_at: '2026-10-15T00:00:00Z',
        first_assigned_at: null,
        owner: null,
        owner_name: null,
        resolved_at: null,
        revision: 0,
      },
    ],
    resolutions: [],
    history: [],
    attachments: [],
    pending_removals: [],
    awards: [],
    audit: [],
    members: [
      {
        membership: {
          ...membership,
          user_id: MEMBER_ID,
          roles: ['volunteer'],
          is_admin: false,
        },
        person: { id: MEMBER_ID, name: 'Review helper', username: 'helper' },
      },
    ],
    server_time: '2026-10-15T00:00:00Z',
  };
  const writes: Array<{ path: string; body: unknown }> = [];
  const workflowRequests: Array<{ p_request: string; p_action: Command }> = [];
  const user = {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'reviewer@accounts.minsky.invalid',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { name: 'Review administrator' },
    created_at: state.server_time,
  };
  await page.routeWebSocket(/supabase\.co/, (socket) => socket.close());
  await page.route('https://example.supabase.co/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown;
    switch (path) {
      case '/auth/v1/token': {
        const expires = Math.floor(Date.now() / 1000) + 3600;
        const header = Buffer.from(
          JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
        ).toString('base64url');
        const payload = Buffer.from(
          JSON.stringify({ sub: USER_ID, exp: expires, role: 'authenticated' }),
        ).toString('base64url');
        result = {
          access_token: `${header}.${payload}.fixture`,
          refresh_token: 'review-fixture',
          expires_in: 3600,
          expires_at: expires,
          token_type: 'bearer',
          user,
        };
        break;
      }
      case '/auth/v1/user':
        result = user;
        break;
      case '/rest/v1/rpc/account_status':
        result = {
          username: 'reviewer',
          must_change: false,
          session_valid: true,
        };
        break;
      case '/rest/v1/memberships':
        result = [state.membership];
        break;
      case '/rest/v1/sessions':
        result = [{ id: SESSION_ID, name: 'Review session' }];
        break;
      case '/rest/v1/rpc/session_snapshot':
        result = state;
        break;
      case '/rest/v1/rpc/manage_member':
        writes.push({ path, body: route.request().postDataJSON() });
        result = null;
        break;
      case '/rest/v1/rpc/workflow': {
        const body = route.request().postDataJSON();
        workflowRequests.push(body);
        if (workflowRequests.length === 1 && firstWrite === 'uncertain') {
          await route.abort('failed');
          return;
        }
        if (workflowRequests.length === 1 && firstWrite === 'rejected') {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'P0001', message: 'The issue changed. Try again.' }),
          });
          return;
        }
        writes.push({ path, body: body.p_action });
        result = body.p_action.issue_id;
        break;
      }
      default:
        throw new Error(`Unexpected fixture request: ${path}`);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    });
  });
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('reviewer');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#issue-heading')).toHaveText('Original issue');
  return { state, writes, workflowRequests };
}

test('an uncertain write retains its request ID until the user retries', async ({ page }) => {
  const { workflowRequests } = await openWorkspace(page, 'uncertain');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Preserve this reply.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Retry last request', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send reply', exact: true })).toBeDisabled();
  await retry.click();
  await expect(retry).not.toBeVisible();
  expect(workflowRequests).toHaveLength(2);
  expect(workflowRequests[1]).toEqual(workflowRequests[0]);
});

test('a definitive rejection allows a new command with a new request ID', async ({ page }) => {
  const { workflowRequests } = await openWorkspace(page, 'rejected');
  const reply = page.getByRole('textbox', { name: 'Message', exact: true });
  await reply.fill('Rejected reply.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The issue changed. Try again.');
  await expect(page.getByRole('button', { name: 'Retry last request', exact: true })).not.toBeVisible();
  await reply.fill('Updated reply.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect.poll(() => workflowRequests.length).toBe(2);
  expect(workflowRequests[1].p_request).not.toBe(workflowRequests[0].p_request);
  expect(workflowRequests[1].p_action).toMatchObject({ type: 'message', text: 'Updated reply.' });
});

test('an incoming issue preserves the displayed issue and sends its existing reply draft', async ({
  page,
}) => {
  const { state, writes } = await openWorkspace(page);
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Keep this reply on the original issue.');
  state.issues.unshift({
    ...state.issues[0],
    id: '00000000-0000-4000-8000-000000000301',
    number: 2,
    description: 'New incoming issue',
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.locator('.issue-card .description-cell > span:last-child'),
  ).toHaveText(['New incoming issue', 'Original issue']);
  await expect(page.locator('#issue-heading')).toHaveText('Original issue');
  await expect(
    page.getByRole('textbox', { name: 'Message', exact: true }),
  ).toHaveValue('Keep this reply on the original issue.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect
    .poll(() => writes)
    .toEqual([
      {
        path: '/rest/v1/rpc/workflow',
        body: {
          type: 'message',
          issue_id: '00000000-0000-4000-8000-000000000300',
          revision: 0,
          text: 'Keep this reply on the original issue.',
          visibility: 'public',
        },
      },
    ]);
});

test('refreshed roles and team assignments are the values saved by the membership form', async ({
  page,
}) => {
  const { state, writes } = await openWorkspace(page);
  await page
    .getByRole('button', { name: 'Administration', exact: true })
    .click();
  const entry = page.locator('.account-entry');
  await entry.locator('summary').click();
  const jury = entry.getByRole('checkbox', { name: 'jury', exact: true });
  await jury.check();
  state.members[0].person.name = 'Updated helper';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(entry.locator('summary')).toContainText('Updated helper');
  await expect(jury).toBeChecked();

  state.members[0].membership.roles = ['volunteer', 'specialist'];
  state.members[0].membership.is_admin = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(entry.locator('.account-role')).toHaveText(
    'volunteer + specialist + admin',
  );
  await expect(
    entry.getByRole('checkbox', { name: 'specialist', exact: true }),
  ).toBeChecked();
  await expect(
    entry.getByRole('checkbox', { name: 'Admin', exact: true }),
  ).toBeChecked();
  await expect(jury).not.toBeChecked();
  await entry
    .getByRole('button', { name: 'Save membership', exact: true })
    .click();
  await expect
    .poll(() => writes)
    .toEqual([
      {
        path: '/rest/v1/rpc/manage_member',
        body: {
          p_session: '00000000-0000-4000-8000-000000000100',
          p_user: '00000000-0000-4000-8000-000000000002',
          p_team: null,
          p_roles: ['volunteer', 'specialist'],
          p_admin: true,
          p_remove: false,
        },
      },
    ]);

  state.members[0].membership = {
    ...state.members[0].membership,
    team_id: TEAM_ID,
    roles: [],
    is_admin: false,
  };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(entry.locator('.account-role')).toHaveText('Aurora');
  await expect(entry.getByLabel('Contestant team')).toHaveValue(
    '00000000-0000-4000-8000-000000000200',
  );
  await entry
    .getByRole('button', { name: 'Save membership', exact: true })
    .click();
  await expect
    .poll(() => writes[1])
    .toEqual({
      path: '/rest/v1/rpc/manage_member',
      body: {
        p_session: '00000000-0000-4000-8000-000000000100',
        p_user: '00000000-0000-4000-8000-000000000002',
        p_team: '00000000-0000-4000-8000-000000000200',
        p_roles: [],
        p_admin: false,
        p_remove: false,
      },
    });
});
