import { expect, test as base } from '@playwright/test';
import type { Command } from '../src/connected/model';
import { createJuryFixture } from './jury-fixture';

const test = base.extend<{
  local: Awaited<ReturnType<typeof createJuryFixture>>;
}>({
  local: async ({ context }, provide) => {
    const local = await createJuryFixture();
    await local.attach(context);
    try {
      await provide(local);
    } finally {
      await local.close();
    }
  },
});

interface WorkflowRequest {
  p_session: string;
  p_request: string;
  p_action: Command;
}

for (const committed of [false, true]) {
  test(`an uncertain ${committed ? 'committed' : 'uncommitted'} contestant request keeps its session after access removal`, async ({
    page,
    local,
  }) => {
    const [originalSession, otherSession] = local.sessions;
    await local.db.query(
      'insert into public.memberships(session_id,user_id,team_id,roles) values($1,$2,$3,array[]::text[])',
      [otherSession, local.users.contestant, local.teams[2]],
    );
    const requests: WorkflowRequest[] = [];
    await page.route('**/rest/v1/rpc/workflow', async (route) => {
      const request: WorkflowRequest = route.request().postDataJSON();
      requests.push(request);
      if (requests.length > 1) {
        await route.fallback();
        return;
      }
      if (committed) {
        await local.act(
          local.users.contestant,
          request.p_action,
          request.p_request,
          request.p_session,
        );
      }
      await local.db.query(
        'delete from public.memberships where session_id=$1 and user_id=$2',
        [originalSession, local.users.contestant],
      );
      await route.abort('failed');
    });

    await page.goto('/issues');
    await page.getByLabel('Username', { exact: true }).fill('contestant');
    await page.getByLabel('Password', { exact: true }).fill(crypto.randomUUID());
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Contest session', exact: true })).toHaveValue(originalSession);
    await page.getByRole('button', { name: 'Report an issue', exact: true }).click();
    await page.getByLabel('What’s happening?', { exact: true }).fill('The primary-session printer is unavailable.');
    await page.getByRole('button', { name: 'Submit issue', exact: true }).click();

    const retry = page.getByRole('button', { name: 'Retry last request', exact: true });
    await expect(retry).toBeEnabled();
    await expect(page.locator('.session-name')).toHaveText('Secondary');
    await retry.click();
    await expect(retry).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0].p_session).toBe(originalSession);
    // A retry still reaches the original server access check. It cannot create
    // the report under the contestant's membership in the other session.
    const recorded = await local.db.query<{ session_id: string }>(
      'select session_id from public.issues where reporter=$1',
      [local.users.contestant],
    );
    expect(recorded.rows).toEqual(committed ? [{ session_id: originalSession }] : []);
    await expect(page.getByRole('button', { name: 'Submit issue', exact: true })).toBeEnabled();
  });
}

test('a response after the account gate remount keeps an explicit retry and does not focus the old form', async ({
  page,
  local,
}) => {
  const requests: WorkflowRequest[] = [];
  let failAccountCheck = false;
  let completeResponse = () => {};
  const responseReady = new Promise<void>((resolve) => {
    completeResponse = resolve;
  });
  await page.route('**/rest/v1/rpc/account_status', async (route) => {
    if (failAccountCheck) {
      await route.fulfill({ status: 503, json: { message: 'Account check unavailable' } });
    } else {
      await route.fallback();
    }
  });
  await page.route('**/rest/v1/rpc/workflow', async (route) => {
    const request: WorkflowRequest = route.request().postDataJSON();
    requests.push(request);
    if (requests.length > 1) {
      await route.fallback();
      return;
    }
    const id = await local.act(
      local.users.contestant,
      request.p_action,
      request.p_request,
      request.p_session,
    );
    await responseReady;
    await route.fulfill({ json: id });
  });

  try {
    await page.goto('/issues');
    await page.getByLabel('Username', { exact: true }).fill('contestant');
    await page.getByLabel('Password', { exact: true }).fill(crypto.randomUUID());
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Report an issue', exact: true }).click();
    await page.getByLabel('What’s happening?', { exact: true }).fill('Keep this response pending across the account gate.');
    await page.getByRole('button', { name: 'Submit issue', exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    await expect.poll(async () =>
      (await local.db.query('select id from public.issues where reporter=$1', [local.users.contestant])).rows.length,
    ).toBe(1);

    failAccountCheck = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const accountRetry = page.getByRole('button', { name: 'Retry account check', exact: true });
    await expect(accountRetry).toBeVisible();
    failAccountCheck = false;
    await accountRetry.click();
    const retry = page.getByRole('button', { name: 'Retry last request', exact: true });
    await expect(retry).toBeVisible();
    const heading = page.getByRole('heading', { name: 'My team’s issues', exact: true });
    await heading.focus();
    const response = page.waitForResponse('**/rest/v1/rpc/workflow');
    completeResponse();
    await (await response).finished();
    await expect(heading).toBeFocused();
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(retry).toHaveCount(0);
    expect(requests).toEqual([requests[0], requests[0]]);
    const recorded = await local.db.query('select id from public.issues where reporter=$1', [local.users.contestant]);
    expect(recorded.rows).toHaveLength(1);
    await expect(page.getByRole('status')).toContainText('Action recorded in shared history.');
  } finally {
    completeResponse();
  }
});
