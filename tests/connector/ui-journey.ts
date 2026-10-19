import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { ScenarioData } from '../providers/contracts';
import type { Actor } from '../providers/contracts';

export interface UiFixture extends Pick<ScenarioData, 'sessionId' | 'otherSessionId' | 'teamId' | 'accounts'> { origin: string }

interface Probe { ready: number; changes: number; closed: number; invalid: boolean }
interface Workspace { page: Page; context: BrowserContext; probe: Probe }

async function privateFill(locator: Locator, value: string) {
  try { await locator.fill(value); }
  catch { throw new Error('A credential field could not be filled. Its value was withheld.'); }
}

async function privateValue(locator: Locator): Promise<string> {
  try { return await locator.inputValue(); }
  catch { throw new Error('The one-time credential could not be read. Its value was withheld.'); }
}

async function redact(page: Page) {
  try {
    await page.evaluate(() => {
      for (const input of document.querySelectorAll('input')) input.value = '';
      for (const section of document.querySelectorAll('.credential-result')) section.remove();
    });
  } catch { /* A closed page has no DOM left to capture. */ }
}

function elapsed(value: string): number {
  const match = /^(\d+):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error('The issue timer did not have the expected minutes and seconds.');
  return Number(match[1]) * 60 + Number(match[2]);
}

async function chooseIssue(page: Page, description: string) {
  const row = page.locator('.issue-card').filter({ hasText: description });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('#issue-heading')).toHaveText(description);
}

function owner(page: Page) {
  return page.locator('.detail .facts > div').filter({ hasText: 'Current owner' }).locator('dd');
}

async function upload(page: Page, visibility: 'public' | 'internal') {
  const base64 = await page.evaluate((visibility) => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The fictional image could not be prepared.');
    context.fillStyle = visibility === 'public' ? '#008844' : '#ee8800';
    context.fillRect(0, 0, 8, 8);
    return canvas.toDataURL('image/png').split(',')[1];
  }, visibility);
  const images = page.locator('.images');
  await images.getByLabel('Who can see this image').selectOption(visibility);
  await images.getByLabel('Image file').setInputFiles({
    name: `fictional-${visibility}.png`, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64'),
  });
  await images.getByRole('button', { name: 'Add image', exact: true }).click();
  await expect(images.getByRole('status')).toHaveText('Image added.', { timeout: 45_000 });
}

/** Actual React pages and server responses. Provider fixtures stay in the wrappers. */
export async function runUiJourney(browser: Browser, fixture: UiFixture, options: { ignoreHTTPSErrors?: boolean } = {}): Promise<void> {
  const workspaces: Workspace[] = [];
  const requests = new Set<string>();
  let externalBackend = false;
  let phase = 'fixture setup';

  async function login(actor: Actor, password?: string): Promise<Workspace> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: options.ignoreHTTPSErrors ?? false });
    const page = await context.newPage();
    const probe: Probe = { ready: 0, changes: 0, closed: 0, invalid: false };
    const workspace = { page, context, probe };
    let currentOriginAuthentication = false;
    workspaces.push(workspace);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.hostname.endsWith('.supabase.co')) externalBackend = true;
      if (url.origin === fixture.origin && url.pathname === '/api/auth/session') currentOriginAuthentication = true;
      if (url.origin === fixture.origin && url.pathname.startsWith('/api/')) requests.add(`${request.method()} ${url.pathname}`);
    });
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/api/updates') return;
      socket.on('framereceived', ({ payload }) => {
        try {
          const value = JSON.parse(typeof payload === 'string' ? payload : payload.toString());
          if (Object.keys(value).length !== 1 || !['ready', 'change'].includes(value.type)) { probe.invalid = true; return; }
          if (value.type === 'ready') probe.ready++;
          else probe.changes++;
        } catch { probe.invalid = true; }
      });
      socket.on('close', () => { probe.closed++; });
    });
    await page.goto(fixture.origin);
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    // Establish the selected adapter before entering a fixture credential. A
    // frontend built for another provider must fail before any login attempt.
    await expect.poll(() => currentOriginAuthentication).toBe(true);
    expect(externalBackend).toBe(false);
    await privateFill(page.getByLabel('Username', { exact: true }), fixture.accounts[actor].username);
    await privateFill(page.getByLabel('Password', { exact: true }), password ?? fixture.accounts[actor].password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    if (actor === 'temporary') {
      await expect(page.getByRole('heading', { name: 'Change your temporary password', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toHaveCount(0);
      const replacement = crypto.randomUUID() + 'A9!';
      await privateFill(page.getByLabel('Current password', { exact: true }), password ?? fixture.accounts[actor].password);
      await privateFill(page.getByLabel('New password', { exact: true }), replacement);
      await privateFill(page.getByLabel('Confirm password', { exact: true }), replacement);
      await page.getByRole('button', { name: 'Save password', exact: true }).click();
      fixture.accounts[actor].password = replacement;
    }
    const title = ['contestant', 'otherTeam', 'temporary'].includes(actor) ? 'My team’s issues' : actor === 'jury' ? 'Award review' : 'Issue Queue';
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 45_000 });
    const selector = page.getByRole('combobox', { name: 'Contest session', exact: true });
    if (await selector.count()) await selector.selectOption(fixture.sessionId);
    await expect(page.locator('.connection-status')).toContainText('Live', { timeout: 30_000 });
    await expect.poll(() => probe.ready).toBeGreaterThan(0);
    return workspace;
  }

  async function administration(workspace: Workspace) {
    await workspace.page.getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Administration', exact: true }).click();
    await expect(workspace.page.getByRole('heading', { name: 'Session administration', exact: true })).toBeVisible();
  }

  async function completed(page: Page) {
    await expect(page.locator('.admin-panel').getByRole('status')).toHaveText('Administration action completed.');
  }

  async function adminAction(page: Page, button: Locator) {
    const response = page.waitForResponse((response) => response.url() === `${fixture.origin}/api/admin`
      && response.request().method() === 'POST');
    await button.click();
    expect((await response).status()).toBe(200);
    await completed(page);
  }

  try {
    phase = 'temporary password change';
    const temporary = await login('temporary');
    const contestant = await login('contestant');
    const other = await login('otherTeam');
    const volunteer = await login('volunteer');
    const specialist = await login('specialist');
    const jury = await login('jury');
    const admin = await login('admin');
    phase = 'administration settings';
    await administration(admin);
    await adminAction(admin.page, admin.page.getByRole('button', { name: 'Close contestant intake', exact: true }));
    await expect(contestant.page.getByRole('button', { name: 'Report an issue', exact: true })).toBeDisabled();
    await adminAction(admin.page, admin.page.getByRole('button', { name: 'Open contestant intake', exact: true }));
    await expect(contestant.page.getByRole('button', { name: 'Report an issue', exact: true })).toBeEnabled();
    await admin.page.getByLabel('Maximum size of one image (MB)', { exact: true }).fill('1');
    await admin.page.getByLabel('Maximum images on one issue', { exact: true }).fill('3');
    await admin.page.getByLabel('Maximum combined size on one issue (MB)', { exact: true }).fill('3');
    await adminAction(admin.page, admin.page.getByRole('button', { name: 'Save image limits', exact: true }));
    const member = admin.page.locator('.account-entry').filter({ hasText: fixture.accounts.volunteer.username });
    await member.locator('summary').click();
    await member.getByRole('checkbox', { name: 'jury', exact: true }).check();
    await adminAction(admin.page, member.getByRole('button', { name: 'Save membership', exact: true }));
    await expect(member.locator('.account-role')).toContainText('jury');
    await expect(member.locator('.account-role')).toContainText('volunteer');
    await member.getByRole('checkbox', { name: 'jury', exact: true }).uncheck();
    await adminAction(admin.page, member.getByRole('button', { name: 'Save membership', exact: true }));
    await expect(member.locator('.account-role')).not.toContainText('jury');
    phase = 'phone and keyboard navigation';
    await volunteer.page.setViewportSize({ width: 320, height: 740 });
    const navigation = volunteer.page.getByRole('navigation', { name: 'Workspace navigation' });
    const menu = volunteer.page.getByRole('button', { name: 'Menu', exact: true });
    await menu.focus();
    await volunteer.page.keyboard.press('Enter');
    await expect(navigation).toBeVisible();
    await navigation.getByRole('link', { name: 'My account', exact: true }).focus();
    await volunteer.page.keyboard.press('Enter');
    await expect(volunteer.page.getByRole('heading', { name: 'My account', exact: true })).toBeFocused();
    await menu.click();
    await navigation.getByRole('link', { name: 'Issues', exact: true }).focus();
    await volunteer.page.keyboard.press('Enter');
    await expect(volunteer.page.locator('#workspace-heading')).toBeFocused();
    expect(await volunteer.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    phase = 'contestant submission and first assignment';
    const description = `UI fictional device ${crypto.randomUUID()}`;
    let teamChanges = contestant.probe.changes;
    await contestant.page.getByRole('button', { name: 'Report an issue', exact: true }).click();
    await contestant.page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('Devices');
    await contestant.page.getByLabel('What’s happening?', { exact: true }).fill(description);
    await contestant.page.getByRole('button', { name: 'Submit issue', exact: true }).click();
    await chooseIssue(contestant.page, description);
    await expect.poll(() => contestant.probe.changes).toBeGreaterThan(teamChanges);
    await chooseIssue(volunteer.page, description);
    await volunteer.page.locator('.issue-card').filter({ hasText: description }).focus();
    await volunteer.page.keyboard.press('Enter');
    await expect(volunteer.page.locator('#issue-heading')).toBeFocused();
    teamChanges = contestant.probe.changes;
    await volunteer.page.getByRole('button', { name: 'Claim issue', exact: true }).click();
    await expect.poll(() => contestant.probe.changes).toBeGreaterThan(teamChanges);
    const volunteerName = (await volunteer.page.locator('.sidebar-person strong').textContent())!;
    await expect(owner(contestant.page)).toHaveText(volunteerName);
    phase = 'specialist handoff';
    teamChanges = contestant.probe.changes;
    await volunteer.page.getByRole('button', { name: 'Escalate to specialist', exact: true }).click();
    await expect.poll(() => contestant.probe.changes).toBeGreaterThan(teamChanges);
    await expect(volunteer.page.locator('.handoff')).toContainText(`${volunteerName} remains responsible until acceptance.`);
    await expect(owner(contestant.page)).toHaveText(volunteerName);
    await chooseIssue(specialist.page, description);
    teamChanges = contestant.probe.changes;
    await specialist.page.getByRole('button', { name: 'Accept handoff', exact: true }).click();
    await expect.poll(() => contestant.probe.changes).toBeGreaterThan(teamChanges);
    const specialistName = (await specialist.page.locator('.sidebar-person strong').textContent())!;
    await expect(owner(contestant.page)).toHaveText(specialistName);
    phase = 'private and public conversation';
    const privateText = `Private fictional diagnosis ${crypto.randomUUID()}`;
    const publicText = `Public fictional response ${crypto.randomUUID()}`;
    const teamBeforePrivate = contestant.probe.changes;
    const otherBeforePrivate = other.probe.changes;
    const staffBeforePrivate = volunteer.probe.changes;
    await specialist.page.getByRole('combobox', { name: 'Audience', exact: true }).selectOption('internal');
    await specialist.page.getByLabel('Message', { exact: true }).fill(privateText);
    await specialist.page.getByRole('button', { name: 'Send reply', exact: true }).click();
    await expect(volunteer.page.getByText(privateText, { exact: true })).toBeVisible();
    await expect.poll(() => volunteer.probe.changes).toBeGreaterThan(staffBeforePrivate);
    expect(contestant.probe.changes).toBe(teamBeforePrivate);
    expect(other.probe.changes).toBe(otherBeforePrivate);
    await expect(contestant.page.getByText(privateText, { exact: true })).toHaveCount(0);
    await specialist.page.getByRole('combobox', { name: 'Audience', exact: true }).selectOption('public');
    await specialist.page.getByLabel('Message', { exact: true }).fill(publicText);
    await specialist.page.getByRole('button', { name: 'Send reply', exact: true }).click();
    await expect(contestant.page.getByText(publicText, { exact: true })).toBeVisible();
    await expect.poll(() => contestant.probe.changes).toBeGreaterThan(teamBeforePrivate);
    await expect(other.page.locator('.issue-card').filter({ hasText: description })).toHaveCount(0);
    phase = 'private and team images';
    const teamBeforeImage = contestant.probe.changes;
    await expect(specialist.page.locator('.images')).toContainText('Up to 1 MB each, 3 images, and 3 MB per issue.');
    await upload(specialist.page, 'internal');
    await expect(volunteer.page.locator('.images .image-thumb')).toHaveCount(1);
    expect(contestant.probe.changes).toBe(teamBeforeImage);
    await expect(contestant.page.locator('.images .image-thumb')).toHaveCount(0);
    await upload(specialist.page, 'public');
    await expect(contestant.page.locator('.images .image-thumb')).toHaveCount(1);
    await expect(specialist.page.locator('.images .image-thumb')).toHaveCount(2);
    await expect(contestant.page.locator('.images').getByText('Staff only', { exact: true })).toHaveCount(0);
    await contestant.page.locator('.images .image-thumb').click();
    const teamDialog = contestant.page.getByRole('dialog');
    await expect(teamDialog.getByRole('img')).toBeVisible();
    await expect.poll(() => teamDialog.getByRole('img').evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await expect(teamDialog.getByRole('button', { name: 'Remove image', exact: true })).toHaveCount(0);
    await teamDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await specialist.page.locator('.images .image-thumb').filter({ hasText: 'Staff only' }).click();
    await expect(specialist.page.getByRole('dialog').getByRole('img')).toBeVisible();
    await specialist.page.getByRole('dialog').getByRole('button', { name: 'Remove image', exact: true }).click();
    await expect(specialist.page.getByRole('dialog')).toBeHidden();
    await expect(specialist.page.locator('.images .image-thumb')).toHaveCount(1);
    phase = 'resolution award and external confirmation';
    await specialist.page.getByRole('combobox', { name: 'Resolution summary · visible to the team', exact: true }).selectOption('Service restored');
    await specialist.page.getByRole('button', { name: 'Resolve issue', exact: true }).click();
    await expect(contestant.page.getByText('Service restored', { exact: true })).toBeVisible();
    await expect(contestant.page.locator('.detail .timer-state')).toContainText('Stopped');
    const stoppedTimer = (await contestant.page.locator('.detail .elapsed-time').textContent())!;
    const firstAssignment = (await contestant.page.locator('.detail .facts > div').filter({ hasText: 'First assignment' }).locator('dd').textContent())!;
    const issueReference = (await contestant.page.locator('.detail-heading > strong').textContent())!.trim();
    expect(issueReference).toMatch(/^ISS-\d+$/);
    await jury.page.getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Jury worklist', exact: true }).click();
    await expect(jury.page.getByRole('heading', { name: 'Jury worklist', exact: true })).toBeVisible();
    const decisionRow = jury.page.locator('#jury-decision').getByRole('article', { name: `Issue ${issueReference}`, exact: true });
    const applicationRow = jury.page.locator('#jury-application').getByRole('article', { name: `Issue ${issueReference}`, exact: true });
    await expect(decisionRow).toBeVisible();
    await expect(applicationRow).toHaveCount(0);
    await decisionRow.getByRole('button', { name: `View issue ${issueReference}`, exact: true }).click();
    await expect(jury.page.locator('#issue-heading')).toHaveText(description);
    await expect(jury.page.locator('#issue-heading')).toBeFocused();
    await jury.page.getByRole('combobox', { name: 'Award minutes', exact: true }).selectOption('5');
    await jury.page.getByLabel('Public award explanation', { exact: true }).fill('Fictional device delay');
    await jury.page.getByRole('button', { name: 'Record award', exact: true }).click();
    await expect(contestant.page.getByRole('heading', { name: '5 minutes awarded', exact: true })).toBeVisible();
    await jury.page.getByRole('button', { name: 'Back to jury worklist', exact: true }).click();
    await expect(decisionRow).toHaveCount(0);
    await expect(applicationRow).toBeVisible();
    await applicationRow.getByRole('button', { name: `View issue ${issueReference}`, exact: true }).click();
    await expect(jury.page.locator('#issue-heading')).toHaveText(description);
    await expect(jury.page.locator('#issue-heading')).toBeFocused();
    await jury.page.getByRole('checkbox', { name: /I confirm this award was applied/ }).check();
    await jury.page.getByRole('button', { name: 'Confirm applied externally', exact: true }).click();
    await expect(contestant.page.getByText('Applied externally', { exact: true })).toBeVisible();
    await expect(decisionRow).toHaveCount(0);
    await expect(applicationRow).toHaveCount(0);
    await expect(jury.page.locator('.jury-worklist').getByRole('status'))
      .toHaveText(`${issueReference} is no longer in the worklist. Its current status has been refreshed.`);
    await expect(jury.page.locator('#jury-application-heading')).toBeFocused();
    await expect(contestant.page.locator('.detail .elapsed-time')).toHaveText(stoppedTimer);
    phase = 'reopening and persisted refresh';
    await contestant.page.getByLabel('Public reopening reason', { exact: true }).fill('Fictional device failure returned');
    await contestant.page.getByRole('button', { name: 'Reopen issue', exact: true }).click();
    await expect(owner(contestant.page)).toHaveText(specialistName);
    await expect(contestant.page.getByRole('heading', { name: 'Previous resolution', exact: true })).toBeVisible();
    await expect(contestant.page.getByRole('heading', { name: '5 minutes awarded', exact: true })).toBeVisible();
    await expect(contestant.page.getByText('Applied externally', { exact: true })).toBeVisible();
    await expect(contestant.page.locator('.detail .timer-state')).toContainText('Running');
    const reloaded = await contestant.page.reload();
    expect(reloaded?.status()).toBe(200);
    await expect(contestant.page).toHaveURL(new URL('/issues', fixture.origin).href);
    await chooseIssue(contestant.page, description);
    await expect(owner(contestant.page)).toHaveText(specialistName);
    await expect(contestant.page.getByText(publicText, { exact: true })).toBeVisible();
    await expect(contestant.page.getByText(privateText, { exact: true })).toHaveCount(0);
    await expect(contestant.page.getByRole('heading', { name: 'Previous resolution', exact: true })).toBeVisible();
    await expect(contestant.page.getByText('Applied externally', { exact: true })).toBeVisible();
    await expect(contestant.page.locator('.detail .facts > div').filter({ hasText: 'First assignment' }).locator('dd')).toHaveText(firstAssignment);
    expect(elapsed((await contestant.page.locator('.detail .elapsed-time').textContent())!)).toBeGreaterThanOrEqual(elapsed(stoppedTimer));
    await expect(contestant.page.locator('.images .image-thumb')).toHaveCount(1);
    await expect.poll(() => contestant.probe.ready).toBeGreaterThan(1);
    await expect(contestant.page.locator('.connection-status')).toContainText('Live');
    phase = 'membership revocation and restoration';
    const otherMember = admin.page.locator('.account-entry').filter({ hasText: fixture.accounts.otherTeam.username });
    await otherMember.locator('summary').click();
    admin.page.once('dialog', (dialog) => { void dialog.accept(); });
    await adminAction(admin.page, otherMember.getByRole('button', { name: 'Revoke session access', exact: true }));
    await expect.poll(() => other.probe.closed).toBeGreaterThan(0);
    await expect(other.page.getByRole('heading', { name: 'Session access', exact: true })).toBeVisible({ timeout: 30_000 });
    const assign = admin.page.locator('.admin-advanced').filter({ hasText: 'Assign an existing account by ID' });
    await assign.locator('summary').click();
    await assign.getByLabel('Auth user UUID', { exact: true }).fill(fixture.accounts.otherTeam.id);
    await assign.getByRole('combobox', { name: 'Contestant team', exact: true }).selectOption({ label: 'Provider team 1' });
    await adminAction(admin.page, assign.getByRole('button', { name: 'Assign membership', exact: true }));
    await other.page.reload();
    await expect(other.page.getByRole('heading', { name: 'My team’s issues', exact: true })).toBeVisible();
    await expect(other.page.locator('.issue-card').filter({ hasText: description })).toHaveCount(0);
    phase = 'organizer assisted account recovery';
    const temporaryMember = admin.page.locator('.account-entry').filter({ hasText: fixture.accounts.temporary.username });
    await temporaryMember.locator('summary').click();
    admin.page.once('dialog', (dialog) => { void dialog.accept(); });
    await temporaryMember.getByRole('button', { name: 'Reset password', exact: true }).click();
    const credentials = admin.page.getByRole('region', { name: 'Temporary account credentials', exact: true });
    await expect(credentials).toBeVisible({ timeout: 45_000 });
    const recoveredPassword = await privateValue(credentials.getByLabel('Temporary password', { exact: true }));
    await credentials.getByRole('button', { name: 'Dismiss credentials', exact: true }).click();
    expect(recoveredPassword.length > 0).toBe(true);
    await temporary.page.reload();
    await expect(temporary.page.getByRole('heading', { name: /Sign in/ })).toBeVisible({ timeout: 30_000 });
    const recovered = await login('temporary', recoveredPassword);
    await chooseIssue(recovered.page, description);
    await expect(recovered.page.getByText('Applied externally', { exact: true })).toBeVisible();
    phase = 'final provider and notification assertions';
    expect(externalBackend).toBe(false);
    expect(requests.has('POST /api/auth/sign-in')).toBe(true);
    expect(requests.has('POST /api/workflow')).toBe(true);
    expect(requests.has('POST /api/admin')).toBe(true);
    expect(requests.has('POST /api/accounts')).toBe(true);
    expect([...requests].some((request) => request.startsWith('PUT /api/image/'))).toBe(true);
    expect(workspaces.every(({ probe }) => !probe.invalid)).toBe(true);
  } catch (error) {
    // A code location helps repair a selector without emitting page contents or
    // Playwright call arguments, which can contain one-time credentials.
    const location = error instanceof Error ? /ui-journey\.ts:(\d+):(\d+)/.exec(error.stack ?? '') : null;
    // eslint-disable-next-line preserve-caught-error -- Original browser errors can include credentials.
    throw new Error(`Hosted UI journey failed during ${phase}. Assertion location ${location ? `${location[1]}:${location[2]}` : 'unavailable'}. Browser diagnostics were withheld.`);
  } finally {
    const closures = await Promise.allSettled(workspaces.map(async (workspace) => {
      await redact(workspace.page);
      await workspace.context.close();
    }));
    expect(closures.every((result) => result.status === 'fulfilled')).toBe(true);
  }
}
