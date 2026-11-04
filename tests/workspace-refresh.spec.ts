import type { Locator, Page } from '@playwright/test';
import type { Command, Membership, Snapshot } from '../src/connected/model';
import {
  type FakeWorker,
  EVENT_ID,
  SESSION_ID,
  TEAM_ID,
  USER_ID,
  expect,
  fixtureAccount,
  sessionSnapshot,
  test,
} from './support/worker';

const MEMBER_ID = '00000000-0000-4000-8000-000000000002';
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
  sessionId: string;
  requestId: string;
  command: Command;
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
 * Opens the real UI with an isolated Worker fixture. The signed-in person is a
 * volunteer and session admin. The desktop console opens at 1024 px and wider;
 * the phone app opens below that.
 */
async function openWorkspace(
  page: Page,
  api: FakeWorker,
  viewport: Viewport = desktop,
  firstWrite?: 'uncertain' | 'rejected',
  options: { teamId?: string } = {},
) {
  await page.setViewportSize(viewport);
  const membership: Membership = {
    session_id: SESSION_ID,
    user_id: USER_ID,
    team_id: options.teamId ?? null,
    roles: options.teamId ? [] : ['volunteer'],
    is_admin: !options.teamId,
  };
  const state: Snapshot = sessionSnapshot(membership, {
    session: { name: 'Review session' },
    event: { id: EVENT_ID, name: 'Review event', archived: false },
    issues: [
      {
        id: ISSUE_ID,
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
  });
  /** The workflow commands that the Worker recorded. */
  const committed: Command[] = [];
  const account = fixtureAccount(USER_ID, 'reviewer', 'Review administrator');
  api.account = account;
  api.snapshots = () => [state];
  if (firstWrite === 'uncertain') api.loseNext('/api/workflow', 'request');
  api.workflow = async (command) => {
    if (firstWrite === 'rejected' && api.bodies('/api/workflow').length === 1) {
      return { outcome: 'rejected', reason: 'state' };
    }
    committed.push(command);
    return { outcome: 'committed', issueId: 'issue_id' in command ? command.issue_id : ISSUE_ID };
  };
  await page.goto('/sign-in');
  await page.getByLabel('Username', { exact: true }).fill('reviewer');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.locator(options.teamId ? '[data-ui="contestant"]' : isDesktop(page) ? '[data-ui="organiser-desktop"]' : '[data-ui="organiser-phone"]'),
  ).toBeVisible();
  if (!options.teamId) await expect(issueOpeners(page)).toHaveCount(1);
  return {
    state,
    account,
    committed,
    workflowRequests: () => api.bodies<WorkflowRequest>('/api/workflow'),
  };
}

test('waits for a selected session before subscribing to live updates', async ({ page, api }) => {
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
  await openWorkspace(page, api);
  await expect.poll(() => sessions).toContain(SESSION_ID);
  expect(sessions.every((sessionId) => sessionId === SESSION_ID)).toBe(true);
});

for (const [layout, viewport] of viewports) {
  test.describe(layout, () => {
    test('an uncertain write retains its request ID until the user retries', async ({ page, api }) => {
      const { workflowRequests } = await openWorkspace(page, api, viewport, 'uncertain');
      const form = await openReply(page);
      await form.message.fill('Preserve this reply.');
      await form.send.click();
      await expect(form.retry).toBeVisible();
      await expect(form.send).toBeDisabled();
      await form.retry.click();
      await expect(form.retry).not.toBeVisible();
      expect(workflowRequests()).toHaveLength(2);
      expect(workflowRequests()[1]).toEqual(workflowRequests()[0]);
    });

    test('a definitive rejection allows a new command with a new request ID', async ({ page, api }) => {
      const { workflowRequests } = await openWorkspace(page, api, viewport, 'rejected');
      const form = await openReply(page);
      await form.message.fill('Rejected reply.');
      await form.send.click();
      await expect(form.scope.getByRole('alert').first()).toContainText(
        'This issue changed while you were working. Refresh and try again.',
      );
      await expect(form.retry).not.toBeVisible();
      await form.message.fill('Updated reply.');
      await form.send.click();
      await expect.poll(() => workflowRequests().length).toBe(2);
      const [first, second] = workflowRequests();
      expect(second!.requestId).not.toBe(first!.requestId);
      expect(second!.command).toMatchObject({ type: 'message', text: 'Updated reply.' });
    });

    test('an incoming issue preserves the displayed issue and sends its existing reply draft', async ({
      page,
      api,
    }) => {
      const { state, committed } = await openWorkspace(page, api, viewport);
      const form = await openReply(page);
      await form.message.fill('Keep this reply on the original issue.');
      state.issues.unshift({
        ...state.issues[0]!,
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
        .poll(() => committed)
        .toEqual([
          {
            type: 'message',
            issue_id: ISSUE_ID,
            revision: 0,
            text: 'Keep this reply on the original issue.',
            visibility: 'public',
          },
        ]);
      if (!isDesktop(page)) {
        await expect(form.scope).toBeHidden();
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(issueOpeners(page)).toHaveCount(2);
      }
    });

    for (const visibility of ['public', 'internal'] as const) {
      test(`a successful ${visibility} reply retry clears the completed draft`, async ({ page, api }) => {
        const { state } = await openWorkspace(page, api, viewport);
        const requests: WorkflowRequest[] = [];
        await page.route('**/api/workflow', async (route) => {
          const request = route.request().postDataJSON() as WorkflowRequest;
          const action = request.command;
          if (action.type !== 'message') throw new Error('Expected a reply request.');
          requests.push(request);
          // Record the reply once, then lose the first two responses.
          if (!state.history.some((item) => item.id === request.requestId)) {
            state.history.push({
              id: request.requestId,
              issue_id: action.issue_id,
              at: state.server_time,
              actor: USER_ID,
              actor_name: 'Review administrator',
              text: action.text,
              visibility: action.visibility,
            });
            if (action.visibility === 'public') state.issues[0]!.revision++;
          }
          if (requests.length <= 2) {
            await route.abort('failed');
            return;
          }
          await route.fallback();
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
          sessionId: SESSION_ID,
          requestId: expect.any(String),
          command: {
            type: 'message',
            issue_id: state.issues[0]!.id,
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
        expect(requests[3]!.requestId).not.toBe(requests[0]!.requestId);
        expect(state.history.map((item) => item.text)).toEqual([
          draft,
          'A fresh reply after the retry.',
        ]);
      });
    }

    test('a rejected reply keeps its draft available for correction', async ({ page, api }) => {
      await openWorkspace(page, api, viewport);
      api.workflow = async () => ({ outcome: 'rejected', reason: 'state' });
      const form = await openReply(page);
      await form.chooseAudience('internal');
      await form.message.fill('Keep this rejected draft.');
      await form.send.click();
      await expect(form.scope.getByRole('alert').first()).toHaveText(
        'This issue changed while you were working. Refresh and try again.',
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

    test('a refresh updates the open account dialog and keeps an unsaved username', async ({
      page,
      api,
    }) => {
      const { state } = await openWorkspace(page, api, viewport);
      if (isDesktop(page)) {
        await page
          .getByRole('navigation', { name: 'Console pages' })
          .getByRole('button', { name: /^Accounts/ })
          .click();
      } else {
        await page
          .getByRole('navigation', { name: 'Organizer sections' })
          .getByRole('button', { name: 'Session', exact: true })
          .click();
      }
      await (isDesktop(page)
        ? page.getByRole('button', { name: 'Manage Review helper', exact: true })
        : page.getByRole('button', { name: /^Review helper/ })
      ).click();
      let sheet = page.getByRole('dialog', { name: 'Review helper', exact: true });
      await expect(sheet).toBeVisible();
      // The contest panel changes a username and reissues a password. Roles and teams belong to the event console.
      await expect(sheet.getByRole('checkbox')).toHaveCount(0);
      await expect(sheet.getByRole('button', { name: 'Save membership' })).toHaveCount(0);
      await sheet.getByLabel('Change username', { exact: true }).fill('helper-two');
      state.members[0]!.person.name = 'Updated helper';
      await refresh(page);
      sheet = page.getByRole('dialog', { name: 'Updated helper', exact: true });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByLabel('Change username', { exact: true })).toHaveValue('helper-two');
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
      await page.route('**/api/workflow', async (route) => {
        started();
        const issue = state.issues[0]!;
        issue.status = 'claimed';
        issue.owner = USER_ID;
        issue.owner_name = 'Review administrator';
        issue.first_assigned_at = state.server_time;
        issue.revision += 1;
        await gate;
        await route.fallback();
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

    test('a queue claim stays on the list', async ({ page, api }) => {
      const { state } = await openWorkspace(page, api, viewport);
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

    test('an issue opened during a queue claim stays open', async ({ page, api }) => {
      const { state } = await openWorkspace(page, api, viewport);
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

test('a committed submission retains its retry through an account-check failure', async ({ page, api }) => {
  const { state, workflowRequests } = await openWorkspace(page, api, desktop, undefined, {
    teamId: TEAM_ID,
  });
  const receipts = new Map<string, string>();
  const description = 'The contest network disconnected.';
  api.workflow = async (command, requestId) => {
    if (command.type !== 'submit') throw new Error('Expected a submission.');
    let issueId = receipts.get(requestId);
    if (!issueId) {
      issueId = '00000000-0000-4000-8000-000000000301';
      receipts.set(requestId, issueId);
      state.issues.push({
        ...state.issues[0]!,
        id: issueId,
        number: 2,
        category: command.category,
        description: command.description,
      });
    }
    return { outcome: 'committed', issueId };
  };
  api.loseNext('/api/workflow', 'response');
  await page.getByRole('button', { name: 'Report an issue', exact: true }).click();
  await page.getByRole('textbox', { name: 'What is happening?', exact: true }).fill(description);
  await page.getByRole('button', { name: 'Send report', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Retry last request', exact: true });
  await expect(retry).toBeEnabled();
  expect(workflowRequests()).toHaveLength(1);
  expect(receipts.size).toBe(1);

  // The Worker session read is the account check.
  const accountStatusUrl = '**/api/auth/session';
  await page.route(accountStatusUrl, (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Account check unavailable.' }),
  }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Retry account check', exact: true })).toBeVisible();
  await expect(page.locator('[data-ui="contestant"]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your report' })).toHaveCount(0);
  await expect(retry).toHaveCount(0);

  await page.unroute(accountStatusUrl);
  await page.getByRole('button', { name: 'Retry account check', exact: true }).click();
  await expect(retry).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Report an issue', exact: true })).toBeDisabled();
  expect(workflowRequests()).toHaveLength(1);
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Report an issue', exact: true })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Your report' })).toContainText(description);
  expect(workflowRequests()).toEqual([workflowRequests()[0], workflowRequests()[0]]);
  expect(workflowRequests()[0]).toEqual({
    sessionId: SESSION_ID,
    requestId: expect.any(String),
    command: { type: 'submit', category: 'Network', description },
  });
  expect(receipts.size).toBe(1);
  expect(state.issues.filter((issue) => issue.description === description)).toHaveLength(1);
});

for (const nextUserId of [USER_ID, MEMBER_ID]) {
  test(`signout clears an uncertain request before ${nextUserId === USER_ID ? 'the same' : 'another'} actor signs in`, async ({ page, api }) => {
    const { state, account, workflowRequests } = await openWorkspace(page, api, desktop, 'uncertain');
    let form = await openReply(page);
    let message = form.message;
    await message.fill('The prior actor’s uncertain reply.');
    await form.send.click();
    await expect(page.getByRole('button', { name: 'Retry last request', exact: true })).toBeEnabled();
    await form.scope.getByRole('button', { name: 'Close issue', exact: true }).click();
    await page.getByRole('button', { name: /^Account settings for/ }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();

    account.id = nextUserId;
    if (!state.membership) throw new Error('The fixture membership is missing.');
    state.membership.user_id = nextUserId;
    await page.getByLabel('Username', { exact: true }).fill('reviewer');
    await page.getByLabel('Password', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    // Signing out from the account page keeps that address for the next sign in.
    await expect(page).toHaveURL('/account');
    await page.getByRole('navigation', { name: 'Console pages' }).getByRole('button', { name: /^Queue/ }).click();
    form = await openReply(page);
    message = form.message;
    await expect(page.getByRole('button', { name: 'Retry last request', exact: true })).toHaveCount(0);
    await expect(message).toHaveValue('');
    await message.fill('A reply from the current actor.');
    await form.send.click();
    await expect.poll(() => workflowRequests().length).toBe(2);
    const [first, second] = workflowRequests();
    expect(second!.requestId).not.toBe(first!.requestId);
    expect(second!.command).toMatchObject({
      type: 'message',
      text: 'A reply from the current actor.',
    });
  });
}
