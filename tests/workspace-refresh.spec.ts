import { expect, test, type Page } from '@playwright/test';
import type { Command, Membership, Snapshot } from '../src/connected/model';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const MEMBER_ID = '00000000-0000-4000-8000-000000000002';
const SESSION_ID = '00000000-0000-4000-8000-000000000100';
const TEAM_ID = '00000000-0000-4000-8000-000000000200';

interface WorkflowRequest {
  p_session: string;
  p_request: string;
  p_action: Command;
}

interface WorkspaceOptions {
  path?: string;
  isAdmin?: boolean;
  roles?: Membership['roles'];
}

/** Opens the real UI with isolated Auth and database responses. */
async function openWorkspace(
  page: Page,
  firstWrite?: 'uncertain' | 'rejected',
  options: WorkspaceOptions = {},
) {
  const membership: Membership = {
    session_id: SESSION_ID,
    user_id: USER_ID,
    team_id: null,
    roles: options.roles ?? ['volunteer'],
    is_admin: options.isAdmin ?? true,
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
  await page.goto(options.path ?? '/');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  if (options.path) await expect(page).toHaveURL(options.path);
  await page.getByLabel('Username', { exact: true }).fill('reviewer');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
  if (!options.path || options.path === '/issues') {
    await expect(page.locator('#issue-heading')).toHaveText('Original issue');
  }
  return { state, writes, workflowRequests };
}

for (const route of [
  { path: '/issues', heading: 'Issue Queue', label: 'Issues' },
  { path: '/administration', heading: 'Session administration', label: 'Administration' },
  { path: '/account', heading: 'My account', label: 'My account' },
  { path: '/jury', heading: 'Jury worklist', label: 'Jury worklist' },
]) {
  test(`direct ${route.path} access keeps its screen through sign-in and reload`, async ({ page }) => {
    await openWorkspace(page, undefined, { path: route.path, roles: ['volunteer', 'jury'] });
    const heading = page.getByRole('heading', { name: route.heading, exact: true });
    const link = page.getByRole('navigation').getByRole('link', {
      name: route.label,
      exact: true,
    });
    await expect(page).toHaveURL(route.path);
    await expect(heading).toBeVisible();
    await expect(link).toHaveAttribute('href', route.path);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await page.reload();
    await expect(page).toHaveURL(route.path);
    await expect(heading).toBeVisible();
    await expect(link).toHaveAttribute('aria-current', 'page');
  });
}

test('workspace links and browser history restore the selected screen', async ({ page }) => {
  await openWorkspace(page);
  const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
  await expect(page).toHaveURL('/issues');
  await navigation.getByRole('link', { name: 'My account', exact: true }).click();
  await expect(page).toHaveURL('/account');
  await expect(page.getByRole('heading', { name: 'My account', exact: true })).toBeFocused();
  await navigation.getByRole('link', { name: 'Administration', exact: true }).click();
  await expect(page).toHaveURL('/administration');
  await expect(
    page.getByRole('heading', { name: 'Administration', exact: true }),
  ).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL('/account');
  await expect(page.getByRole('heading', { name: 'My account', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'My account', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.goBack();
  await expect(page).toHaveURL('/issues');
  await expect(page.locator('#issue-heading')).toHaveText('Original issue');
  await page.goForward();
  await expect(page).toHaveURL('/account');
  await expect(page.getByRole('heading', { name: 'My account', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(navigation).toBeHidden();
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await navigation.getByRole('link', { name: 'My account', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/account');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(navigation).toBeHidden();
  await expect(page.getByRole('heading', { name: 'My account', exact: true })).toBeFocused();
});

test('the issue filters and selected issue survive a visit to My account', async ({ page }) => {
  const { state } = await openWorkspace(page);
  state.issues.push({
    ...state.issues[0],
    id: '00000000-0000-4000-8000-000000000301',
    number: 2,
    description: 'Another open issue',
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.issue-card')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('open');
  const teamSearch = page.locator('#queue-team-search');
  await teamSearch.fill('Aurora');
  await page.getByRole('option', { name: /Aurora/ }).click();
  const selected = page.locator('.issue-card').filter({ hasText: 'Another open issue' });
  await selected.click();
  await expect(page.locator('#issue-heading')).toHaveText('Another open issue');
  const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
  await navigation.getByRole('link', { name: 'My account', exact: true }).click();
  await expect(page).toHaveURL('/account');
  await expect(page.getByRole('heading', { name: 'My account', exact: true })).toBeVisible();
  await navigation.getByRole('link', { name: 'Issues', exact: true }).click();
  await expect(page).toHaveURL('/issues');
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('open');
  await expect(teamSearch).toHaveValue('Aurora');
  await expect(page.locator('.issue-card')).toHaveCount(2);
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#issue-heading')).toHaveText('Another open issue');
});

test('an unknown URL shows a missing page and offers a link to Issues', async ({ page }) => {
  await openWorkspace(page, undefined, { path: '/unknown/page' });
  await expect(page).toHaveURL('/unknown/page');
  await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible();
  const returnLink = page.getByRole('link', { name: 'Return to issues', exact: true });
  await expect(returnLink).toHaveAttribute('href', '/issues');
  await returnLink.click();
  await expect(page).toHaveURL('/issues');
  await expect(page.locator('#issue-heading')).toHaveText('Original issue');
  await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toHaveCount(0);
});

for (const path of ['/administration', '/jury']) {
  test(`a member without permission cannot open ${path}`, async ({ page }) => {
    await openWorkspace(page, undefined, { path, isAdmin: false });
    await expect(page).toHaveURL('/issues');
    await expect(page.locator('#issue-heading')).toHaveText('Original issue');
    await expect(page.getByRole('heading', { name: 'Session administration', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Jury worklist', exact: true })).toHaveCount(0);
    const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
    await expect(navigation.getByRole('link', { name: 'Administration', exact: true })).toHaveCount(0);
    await expect(navigation.getByRole('link', { name: 'Jury worklist', exact: true })).toHaveCount(0);
  });
}

test('a refreshed membership removes administration access and changes the URL', async ({ page }) => {
  const { state } = await openWorkspace(page, undefined, { path: '/administration' });
  await expect(page.getByRole('heading', { name: 'Session administration', exact: true })).toBeVisible();
  if (!state.membership) throw new Error('The fixture membership is missing.');
  state.membership.is_admin = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL('/issues');
  await expect(page.locator('#issue-heading')).toHaveText('Original issue');
  await expect(page.getByRole('heading', { name: 'Session administration', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Administration', exact: true })).toHaveCount(0);
});

test('waits for a selected session before subscribing to live updates', async ({ page }) => {
  const sessions: string[] = [];
  await page.exposeFunction('recordSubscriptionSession', (sessionId: string) => {
    sessions.push(sessionId);
  });
  await page.route('**/src/backend/index.ts', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `${await response.text()}
const originalSubscribe = backend.updates.subscribe.bind(backend.updates);
backend.updates.subscribe = (input) => {
  window.recordSubscriptionSession(input.sessionId);
  return originalSubscribe(input);
};`,
    });
  });
  await openWorkspace(page);
  await expect.poll(() => sessions).toContain(SESSION_ID);
  expect(sessions.every((sessionId) => sessionId === SESSION_ID)).toBe(true);
});

test('an uncertain write blocks workspace links and retains its request ID across browser history', async ({ page }) => {
  const { workflowRequests } = await openWorkspace(page, 'uncertain');
  const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
  const account = navigation.getByRole('link', { name: 'My account', exact: true });
  await account.click();
  await expect(page).toHaveURL('/account');
  await navigation.getByRole('link', { name: 'Issues', exact: true }).click();
  await expect(page).toHaveURL('/issues');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Preserve this reply.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Retry last request', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send reply', exact: true })).toBeDisabled();
  const workspaceLinks = navigation.locator('a[href^="/"]');
  await expect(workspaceLinks).toHaveCount(3);
  for (const link of await workspaceLinks.all()) {
    await expect(link).toHaveAttribute('aria-disabled', 'true');
  }
  // aria-disabled alone cannot stop a browser click. Exercise the link handler.
  await account.click({ force: true });
  await expect(page).toHaveURL('/issues');
  await expect(page.locator('#issue-heading')).toHaveText('Original issue');
  await page.goBack();
  await expect(page).toHaveURL('/account');
  await expect(page.getByRole('heading', { name: 'My account', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change password', exact: true })).toBeDisabled();
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(retry).not.toBeVisible();
  for (const link of await workspaceLinks.all()) {
    await expect(link).toHaveAttribute('aria-disabled', 'false');
  }
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

for (const visibility of ['public', 'internal'] as const) {
  test(`a successful ${visibility} reply retry clears the completed draft`, async ({ page }) => {
    const { state } = await openWorkspace(page);
    const requests: WorkflowRequest[] = [];
    await page.route('https://example.supabase.co/rest/v1/rpc/workflow', async (route) => {
      const request: WorkflowRequest = route.request().postDataJSON();
      const action = request.p_action;
      if (action.type !== 'message') throw new Error('Expected a reply request.');
      requests.push(request);
      // Record the reply once, then lose the first two responses.
      if (!state.history.some((item) => item.id === request.p_request)) {
        state.history.push({
          id: request.p_request,
          issue_id: action.issue_id,
          at: state.server_time,
          actor: USER_ID,
          actor_name: 'Review administrator',
          text: action.text,
          visibility: action.visibility,
        });
        if (action.visibility === 'public') state.issues[0].revision++;
      }
      if (requests.length <= 2) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(action.issue_id),
      });
    });

    const message = page.getByRole('textbox', { name: 'Message', exact: true });
    const audience = page.getByRole('combobox', { name: 'Audience', exact: true });
    const send = page.getByRole('button', { name: 'Send reply', exact: true });
    const retry = page.getByRole('button', { name: 'Retry last request', exact: true });
    const draft = 'Keep this reply until the retry succeeds.';
    await audience.selectOption(visibility);
    await message.fill(draft);
    await send.click();
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect.poll(() => requests.length).toBe(2);
    await expect(retry).toBeEnabled();
    await expect(message).toHaveValue(draft);
    await expect(audience).toHaveValue(visibility);
    await expect(send).toBeDisabled();

    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect(message).toHaveValue('');
    await expect(audience).toHaveValue('public');
    await expect(send).toBeDisabled();
    await expect(page.locator('.activity li')).toHaveCount(1);
    expect(requests).toEqual([requests[0], requests[0], requests[0]]);
    expect(requests[0]).toEqual({
      p_session: SESSION_ID,
      p_request: expect.any(String),
      p_action: {
        type: 'message',
        issue_id: state.issues[0].id,
        revision: 0,
        text: draft,
        visibility,
      },
    });

    await message.fill('A fresh reply after the retry.');
    await send.click();
    await expect(message).toHaveValue('');
    await expect(send).toBeDisabled();
    await expect(page.locator('.activity li')).toHaveCount(2);
    expect(requests).toHaveLength(4);
    expect(requests[3].p_request).not.toBe(requests[0].p_request);
    expect(state.history.map((item) => item.text)).toEqual([
      draft,
      'A fresh reply after the retry.',
    ]);
  });
}

test('a rejected reply keeps its draft available for correction', async ({ page }) => {
  await openWorkspace(page);
  await page.route('https://example.supabase.co/rest/v1/rpc/workflow', async (route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'P0001',
        message: 'Issue changed. Refresh and try again.',
        details: null,
        hint: null,
      }),
    });
  });
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  const send = page.getByRole('button', { name: 'Send reply', exact: true });
  await page.getByRole('combobox', { name: 'Audience', exact: true }).selectOption('internal');
  await message.fill('Keep this rejected draft.');
  await send.click();
  await expect(page.getByRole('alert')).toHaveText('Issue changed. Refresh and try again.');
  await expect(message).toHaveValue('Keep this rejected draft.');
  await expect(message).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'Audience', exact: true })).toHaveValue('internal');
  await expect(send).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Retry last request' })).toHaveCount(0);
  await expect(page.locator('.activity li')).toHaveCount(0);
});

test('refreshed roles and team assignments are the values saved by the membership form', async ({
  page,
}) => {
  const { state, writes } = await openWorkspace(page);
  await page
    .getByRole('link', { name: 'Administration', exact: true })
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
