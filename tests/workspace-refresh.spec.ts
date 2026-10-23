import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Command, Membership, Snapshot } from '../src/connected/model';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const MEMBER_ID = '00000000-0000-4000-8000-000000000002';
const SESSION_ID = '00000000-0000-4000-8000-000000000100';
const TEAM_ID = '00000000-0000-4000-8000-000000000200';
const ISSUE_ID = '00000000-0000-4000-8000-000000000300';

/** The desktop console at its smallest supported size. */
const desktop = { width: 1280, height: 800 };
/** A common phone size for the organiser phone app. */
const phone = { width: 390, height: 844 };

type Viewport = typeof desktop;

const viewports = [
  ['desktop console', desktop],
  ['phone', phone],
] as const;

interface WorkflowRequest {
  p_session: string;
  p_request: string;
  p_action: Command;
}

function isDesktop(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

/** The desktop issue number buttons, or the phone queue cards. */
function issueOpeners(page: Page): Locator {
  return page.locator(isDesktop(page) ? '[data-issue-row]' : '[id^="issue-card-"]');
}

/** Asks the app to read the session again, as a returning window does. */
async function refresh(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

/** The labels of the audience switch in each layout. */
function audienceLabels(page: Page) {
  return isDesktop(page)
    ? { public: 'Public reply', internal: 'Internal note' }
    : { public: 'To the team', internal: 'Staff only' };
}

/**
 * The reply form of the original issue. On the desktop it is the composer of
 * the issue side sheet. On a phone it is the Reply sheet of the issue view.
 */
interface Composer {
  /** The side sheet, or the phone Reply sheet. */
  scope: Locator;
  message: Locator;
  send: Locator;
  retry: Locator;
  /** Selects an audience with the pointer, as a person does. */
  chooseAudience: (visibility: 'public' | 'internal') => Promise<void>;
  audience: (visibility: 'public' | 'internal') => Locator;
}

function composer(page: Page): Composer {
  const scope = isDesktop(page)
    ? page.getByRole('dialog', { name: /ISS-1: Original issue/ })
    : page.getByRole('dialog', { name: 'Reply', exact: true });
  const labels = audienceLabels(page);
  const audienceGroup = scope.getByRole('group', { name: 'Audience', exact: true });
  return {
    scope,
    message: scope.getByRole('textbox', { name: /^(Message|Internal note)$/ }),
    send: scope.getByRole('button', {
      name: /^(Send|Add note|Send to team|Add internal note)$/,
    }),
    retry: scope.getByRole('button', { name: 'Retry last request', exact: true }),
    chooseAudience: async (visibility) => {
      await audienceGroup.getByText(labels[visibility], { exact: true }).click();
    },
    audience: (visibility) =>
      audienceGroup.getByRole('radio', { name: labels[visibility], exact: true }),
  };
}

/**
 * Opens the original issue and its reply form. Set `issueOpen` when the
 * phone issue view already shows the issue.
 */
async function openReply(page: Page, issueOpen = false): Promise<Composer> {
  if (!issueOpen) await issueOpeners(page).first().click();
  if (!isDesktop(page)) {
    await expect(page.getByRole('heading', { name: 'ISS-1, Aurora', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
  }
  const form = composer(page);
  await expect(form.message).toBeVisible();
  return form;
}

/**
 * The Activity heading of the open issue. The phone Reply sheet hides the
 * issue view from assistive technology, so check it after the sheet closes.
 */
function activityHeading(page: Page): Locator {
  return page.getByRole('heading', { name: /^Activity · / });
}

/**
 * Opens the real UI with isolated Auth and database responses. The signed-in
 * person is a volunteer and session admin. The desktop console opens at
 * 1024 px and wider; the phone app opens below that.
 */
async function openWorkspace(
  page: Page,
  viewport: Viewport = desktop,
  firstWrite?: 'uncertain' | 'rejected',
) {
  await page.setViewportSize(viewport);
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
  await expect(
    page.locator(isDesktop(page) ? '[data-ui="organiser-desktop"]' : '[data-ui="organiser-phone"]'),
  ).toBeVisible();
  await expect(issueOpeners(page)).toHaveCount(1);
  return { state, writes, workflowRequests };
}

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

for (const [layout, viewport] of viewports) {
  test.describe(layout, () => {
    test('an uncertain write retains its request ID until the user retries', async ({ page }) => {
      const { workflowRequests } = await openWorkspace(page, viewport, 'uncertain');
      const form = await openReply(page);
      await form.message.fill('Preserve this reply.');
      await form.send.click();
      await expect(form.retry).toBeVisible();
      await expect(form.send).toBeDisabled();
      await form.retry.click();
      await expect(form.retry).not.toBeVisible();
      expect(workflowRequests).toHaveLength(2);
      expect(workflowRequests[1]).toEqual(workflowRequests[0]);
    });

    test('a definitive rejection allows a new command with a new request ID', async ({ page }) => {
      const { workflowRequests } = await openWorkspace(page, viewport, 'rejected');
      const form = await openReply(page);
      await form.message.fill('Rejected reply.');
      await form.send.click();
      await expect(form.scope.getByRole('alert').first()).toContainText(
        'The issue changed. Try again.',
      );
      await expect(form.retry).not.toBeVisible();
      await form.message.fill('Updated reply.');
      await form.send.click();
      await expect.poll(() => workflowRequests.length).toBe(2);
      expect(workflowRequests[1].p_request).not.toBe(workflowRequests[0].p_request);
      expect(workflowRequests[1].p_action).toMatchObject({ type: 'message', text: 'Updated reply.' });
    });

    test('an incoming issue preserves the displayed issue and sends its existing reply draft', async ({
      page,
    }) => {
      const { state, writes } = await openWorkspace(page, viewport);
      const form = await openReply(page);
      await form.message.fill('Keep this reply on the original issue.');
      state.issues.unshift({
        ...state.issues[0],
        id: '00000000-0000-4000-8000-000000000301',
        number: 2,
        description: 'New incoming issue',
      });
      await refresh(page);
      // The list behind the open issue gets the new issue.
      await expect(issueOpeners(page)).toHaveCount(isDesktop(page) ? 2 : 0);
      await expect(form.scope).toBeVisible();
      await expect(form.message).toHaveValue('Keep this reply on the original issue.');
      await form.send.click();
      await expect
        .poll(() => writes)
        .toEqual([
          {
            path: '/rest/v1/rpc/workflow',
            body: {
              type: 'message',
              issue_id: ISSUE_ID,
              revision: 0,
              text: 'Keep this reply on the original issue.',
              visibility: 'public',
            },
          },
        ]);
      if (!isDesktop(page)) {
        await expect(form.scope).toBeHidden();
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(issueOpeners(page)).toHaveCount(2);
      }
    });

    for (const visibility of ['public', 'internal'] as const) {
      test(`a successful ${visibility} reply retry clears the completed draft`, async ({ page }) => {
        const { state } = await openWorkspace(page, viewport);
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

        let form = await openReply(page);
        const draft = 'Keep this reply until the retry succeeds.';
        await form.chooseAudience(visibility);
        await expect(form.audience(visibility)).toBeChecked();
        await form.message.fill(draft);
        await form.send.click();
        await expect(form.retry).toBeEnabled();
        await form.retry.click();
        await expect.poll(() => requests.length).toBe(2);
        await expect(form.retry).toBeEnabled();
        await expect(form.message).toHaveValue(draft);
        await expect(form.audience(visibility)).toBeChecked();
        await expect(form.send).toBeDisabled();

        await form.retry.click();
        await expect(form.retry).toHaveCount(0);
        if (!isDesktop(page)) {
          // A recorded reply closes the phone sheet. Open it again.
          await expect(form.scope).toBeHidden();
          await expect(activityHeading(page)).toHaveText('Activity · 1 entry');
          form = await openReply(page, true);
        }
        await expect(form.message).toHaveValue('');
        await expect(form.audience('public')).toBeChecked();
        await expect(form.send).toBeDisabled();
        if (isDesktop(page)) {
          await expect(activityHeading(page)).toHaveText('Activity · 1 entry');
        }
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

        await form.message.fill('A fresh reply after the retry.');
        await form.send.click();
        if (isDesktop(page)) {
          await expect(form.message).toHaveValue('');
          await expect(form.send).toBeDisabled();
        } else {
          await expect(form.scope).toBeHidden();
        }
        await expect(activityHeading(page)).toHaveText('Activity · 2 entries');
        expect(requests).toHaveLength(4);
        expect(requests[3].p_request).not.toBe(requests[0].p_request);
        expect(state.history.map((item) => item.text)).toEqual([
          draft,
          'A fresh reply after the retry.',
        ]);
      });
    }

    test('a rejected reply keeps its draft available for correction', async ({ page }) => {
      await openWorkspace(page, viewport);
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
      const form = await openReply(page);
      await form.chooseAudience('internal');
      await form.message.fill('Keep this rejected draft.');
      await form.send.click();
      await expect(form.scope.getByRole('alert').first()).toHaveText(
        'Issue changed. Refresh and try again.',
      );
      await expect(form.message).toHaveValue('Keep this rejected draft.');
      await expect(form.message).toBeEditable();
      await expect(form.audience('internal')).toBeChecked();
      await expect(form.send).toBeEnabled();
      await expect(form.retry).toHaveCount(0);
      if (isDesktop(page)) {
        await expect(activityHeading(page)).toHaveText('Activity · 0 entries');
      } else {
        await form.scope.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(activityHeading(page)).toHaveText('Activity · 0 entries');
      }
    });

    test('refreshed roles and team assignments are the values saved by the membership form', async ({
      page,
    }) => {
      const { state, writes } = await openWorkspace(page, viewport);
      if (isDesktop(page)) {
        await page
          .getByRole('navigation', { name: 'Console pages' })
          .getByRole('button', { name: /^Accounts/ })
          .click();
      } else {
        await page
          .getByRole('navigation', { name: 'Organiser sections' })
          .getByRole('button', { name: 'Session', exact: true })
          .click();
      }
      const openAccount = async (name: string) => {
        await (isDesktop(page)
          ? page.getByRole('button', { name: `Manage ${name}`, exact: true })
          : page.getByRole('button', { name: new RegExp(`^${name}`) })
        ).click();
        const sheet = page.getByRole('dialog', { name, exact: true });
        await expect(sheet).toBeVisible();
        return sheet;
      };
      const role = (sheet: Locator, name: string) =>
        sheet.getByRole('checkbox', { name, exact: true });

      let sheet = await openAccount('Review helper');
      await sheet.getByText('Jury', { exact: true }).click();
      await expect(role(sheet, 'Jury')).toBeChecked();
      state.members[0].person.name = 'Updated helper';
      await refresh(page);
      // The account name updates and the unsaved choice stays.
      sheet = page.getByRole('dialog', { name: 'Updated helper', exact: true });
      await expect(sheet).toBeVisible();
      await expect(role(sheet, 'Jury')).toBeChecked();

      state.members[0].membership.roles = ['volunteer', 'specialist'];
      state.members[0].membership.is_admin = true;
      await refresh(page);
      await expect(role(sheet, 'Specialist')).toBeChecked();
      await expect(role(sheet, 'Admin')).toBeChecked();
      await expect(role(sheet, 'Volunteer')).toBeChecked();
      await expect(role(sheet, 'Jury')).not.toBeChecked();
      await sheet.getByRole('button', { name: 'Save membership', exact: true }).click();
      await expect
        .poll(() => writes)
        .toEqual([
          {
            path: '/rest/v1/rpc/manage_member',
            body: {
              p_session: SESSION_ID,
              p_user: MEMBER_ID,
              p_team: null,
              p_roles: ['volunteer', 'specialist'],
              p_admin: true,
              p_remove: false,
            },
          },
        ]);
      await expect(sheet).toBeHidden();

      state.members[0].membership = {
        ...state.members[0].membership,
        team_id: TEAM_ID,
        roles: [],
        is_admin: false,
      };
      await refresh(page);
      const account = isDesktop(page)
        ? page.getByRole('row', { name: /Updated helper/ })
        : page.getByRole('button', { name: /^Updated helper/ });
      await expect(account).toContainText('Aurora');
      sheet = await openAccount('Updated helper');
      await expect(sheet.getByRole('radio', { name: /^Team/ })).toBeChecked();
      await expect(sheet.getByLabel('Contestant team')).toHaveValue(TEAM_ID);
      await sheet.getByRole('button', { name: 'Save membership', exact: true }).click();
      await expect
        .poll(() => writes[1])
        .toEqual({
          path: '/rest/v1/rpc/manage_member',
          body: {
            p_session: SESSION_ID,
            p_user: MEMBER_ID,
            p_team: TEAM_ID,
            p_roles: [],
            p_admin: false,
            p_remove: false,
          },
        });
    });

    /** Records the open issue as claimed when the held workflow call returns. */
    async function holdClaim(page: Page, state: Snapshot) {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started: () => void = () => {};
      const inFlight = new Promise<void>((resolve) => {
        started = resolve;
      });
      await page.route('https://example.supabase.co/rest/v1/rpc/workflow', async (route) => {
        started();
        const body = route.request().postDataJSON();
        const issue = state.issues[0];
        issue.status = 'claimed';
        issue.owner = USER_ID;
        issue.owner_name = 'Review administrator';
        issue.first_assigned_at = state.server_time;
        issue.revision += 1;
        await gate;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body.p_action.issue_id),
        });
      });
      return { release, inFlight };
    }

    function claimButton(page: Page): Locator {
      return page.getByRole('button', { name: 'Claim ISS-1', exact: true });
    }

    function openIssueVisible(page: Page): Locator {
      return isDesktop(page)
        ? page.getByRole('dialog', { name: /ISS-1: Original issue/ })
        : page.getByRole('heading', { name: 'ISS-1, Aurora', exact: true });
    }

    test('a queue claim stays on the list', async ({ page }) => {
      const { state } = await openWorkspace(page, viewport);
      const held = await holdClaim(page, state);
      await claimButton(page).click();
      await held.inFlight;
      await page.evaluate((desktop) => {
        const opened = () =>
          desktop
            ? document.querySelector('[role="dialog"]') !== null
            : [...document.querySelectorAll('button')].some(
                (button) => button.textContent?.trim() === 'Back',
              );
        const record = () => {
          if (opened()) {
            (window as unknown as { issueOpened: boolean }).issueOpened = true;
          }
        };
        (window as unknown as { issueOpened: boolean }).issueOpened = false;
        record();
        const observer = new MutationObserver(record);
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
        });
      }, isDesktop(page));
      held.release();
      await expect(claimButton(page)).toHaveCount(0);
      await expect(openIssueVisible(page)).toHaveCount(0);
      expect(await page.evaluate(() =>
        (window as unknown as { issueOpened: boolean }).issueOpened,
      )).toBe(false);
      const opener = isDesktop(page)
        ? page.getByRole('button', { name: 'Open ISS-1', exact: true })
        : page.locator(`#issue-card-${ISSUE_ID}`);
      await expect(opener).toBeFocused();
    });

    test('an issue opened during a queue claim stays open', async ({ page }) => {
      const { state } = await openWorkspace(page, viewport);
      const held = await holdClaim(page, state);
      await claimButton(page).click();
      await held.inFlight;
      await issueOpeners(page).first().click();
      await expect(openIssueVisible(page)).toBeVisible();
      held.release();
      await expect(claimButton(page)).toHaveCount(0);
      await expect(openIssueVisible(page)).toBeVisible();
    });
  });
}
