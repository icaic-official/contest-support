import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { ScenarioData } from '../providers/contracts';
import type { Actor } from '../providers/contracts';
import { leftRedRightBlue } from '../support/pictures';

export interface UiFixture extends Pick<ScenarioData, 'sessionId' | 'otherSessionId' | 'teamId' | 'accounts'> { origin: string }

interface Probe { ready: number; changes: number; closed: number; invalid: boolean; violations: string[] }
interface Workspace { page: Page; context: BrowserContext; probe: Probe }
type Ui = 'contestant' | 'organiser-phone' | 'organiser-desktop';

/** Both provider fixtures give the journey session this name. */
const sessionName = 'Provider primary';
const phone = { width: 390, height: 844 };
const desktop = { width: 1280, height: 900 };

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
      for (const section of document.querySelectorAll('section[aria-label="Temporary account credentials"]')) section.remove();
    });
  } catch { /* A closed page has no DOM left to capture. */ }
}

/** Reads a clock such as "04:07" or "1:02:03" as seconds. */
function seconds(clock: string): number {
  const match = /\d+(?::\d{2})+/.exec(clock);
  if (!match) throw new Error('The issue timer did not have the expected minutes and seconds.');
  return match[0].split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function uiRoot(page: Page, ui?: Ui): Locator {
  return page.locator(ui ? `[data-ui="${ui}"]` : '[data-ui]');
}

/** The Live or Reconnecting badge of the selected UI. */
function liveBadge(page: Page): Locator {
  return uiRoot(page).getByRole('status').filter({ hasText: /^Live$/ });
}

/**
 * Checks a radio button or checkbox that is visually hidden inside a styled
 * label. Space on the focused input is what a keyboard user does.
 */
async function choose(control: Locator, checked = true) {
  await expect(control).toBeEnabled();
  if (await control.isChecked() !== checked) await control.press('Space');
  if (checked) await expect(control).toBeChecked();
  else await expect(control).not.toBeChecked();
}

function phoneTabs(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Organizer sections' });
}

async function phoneTab(page: Page, label: string) {
  await phoneTabs(page).getByRole('button', { name: label, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: label, exact: true })).toBeFocused();
}

/** A sidebar link of the desktop console. Its name can end with a count. */
function consoleLink(page: Page, label: string): Locator {
  return page.getByRole('navigation', { name: 'Console pages' })
    .getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: \\d+)?$`) });
}

async function consolePage(page: Page, label: string) {
  await consoleLink(page, label).click();
  await expect(page.getByRole('heading', { level: 1, name: label, exact: true })).toBeVisible();
}

/** The queue card button of an issue on the organiser phone. */
function phoneCard(page: Page, description: string): Locator {
  return page.getByRole('listitem').filter({ hasText: description }).getByRole('button', { name: /^Open ISS-\d+, / });
}

/** The current owner on an organiser issue view. */
function owner(scope: Locator): Locator {
  return scope.getByText('Owner', { exact: true }).locator('xpath=following-sibling::div[1]');
}

/** The time to first assignment on an organiser issue view. */
function firstAssignment(scope: Locator): Locator {
  return scope.locator('dl > div').filter({ has: scope.page().getByText('First assignment', { exact: true }) }).locator('dd').first();
}

/** The contestant's large unresolved timer. */
function contestantTimer(page: Page): Locator {
  return page.getByRole('region', { name: 'Your report', exact: true }).locator('p.font-mono');
}

async function chooseReport(page: Page, description: string) {
  await page.getByRole('navigation', { name: 'Reports' }).getByRole('button').filter({ hasText: description }).click();
  await expect(page.getByRole('region', { name: 'Your report', exact: true })).toContainText(description);
}

function contestantThumbs(page: Page): Locator {
  return page.getByRole('region', { name: 'Images', exact: true }).getByRole('button', { name: /^View image uploaded by / });
}

async function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

/** Uploads one fictional image from the open "Add an image" dialog. */
async function upload(dialog: Locator, visibility: 'public' | 'internal') {
  const base64 = await dialog.page().evaluate((visibility) => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The fictional image could not be prepared.');
    context.fillStyle = visibility === 'public' ? '#008844' : '#ee8800';
    context.fillRect(0, 0, 8, 8);
    return canvas.toDataURL('image/png').split(',')[1];
  }, visibility);
  await choose(dialog.getByRole('radio', { name: visibility === 'public' ? /^Visible to the team/ : /^Staff only/ }));
  await dialog.getByLabel('Image file').setInputFiles({
    name: `fictional-${visibility}.png`, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64'),
  });
  await dialog.getByRole('button', { name: 'Add image', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Image added.', { timeout: 45_000 });
}

/** Actual React pages and server responses. Provider fixtures stay in the wrappers. */
export async function runUiJourney(browser: Browser, fixture: UiFixture, options: { ignoreHTTPSErrors?: boolean } = {}): Promise<void> {
  const workspaces: Workspace[] = [];
  const requests = new Set<string>();
  let phase = 'fixture setup';

  async function login(actor: Actor, password?: string): Promise<Workspace> {
    const contestant = ['contestant', 'otherTeam', 'temporary'].includes(actor);
    // Organisers in the hall use phones. The console and contestants use a desktop.
    const onPhone = actor === 'volunteer' || actor === 'jury';
    const ui: Ui = contestant ? 'contestant' : onPhone ? 'organiser-phone' : 'organiser-desktop';
    const context = await browser.newContext({ viewport: onPhone ? phone : desktop, ignoreHTTPSErrors: options.ignoreHTTPSErrors ?? false });
    const page = await context.newPage();
    const probe: Probe = { ready: 0, changes: 0, closed: 0, invalid: false, violations: [] };
    // Record only the violated directive, never the blocked URL.
    await page.exposeFunction('reportCspViolation', (directive: string) => { probe.violations.push(directive); });
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { reportCspViolation(directive: string): void }).reportCspViolation(event.violatedDirective);
      });
    });
    const workspace = { page, context, probe };
    let currentOriginAuthentication = false;
    workspaces.push(workspace);
    page.on('request', (request) => {
      const url = new URL(request.url());
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
    await page.goto(new URL('/sign-in', fixture.origin).href);
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    // Establish the selected adapter before entering a fixture credential. A
    // frontend built for another provider must fail before any login attempt.
    await expect.poll(() => currentOriginAuthentication).toBe(true);
    await privateFill(page.getByLabel('Username', { exact: true }), fixture.accounts[actor].username);
    await privateFill(page.getByLabel('Password', { exact: true }), password ?? fixture.accounts[actor].password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    if (actor === 'temporary') {
      await expect(page.getByRole('heading', { name: 'Change your temporary password', exact: true })).toBeVisible();
      await expect(uiRoot(page)).toHaveCount(0);
      const replacement = crypto.randomUUID() + 'A9!';
      await privateFill(page.getByLabel('Current password', { exact: true }), password ?? fixture.accounts[actor].password);
      await privateFill(page.getByLabel('New password', { exact: true }), replacement);
      await privateFill(page.getByLabel('Confirm password', { exact: true }), replacement);
      await page.getByRole('button', { name: 'Save password', exact: true }).click();
      fixture.accounts[actor].password = replacement;
    }
    await expect(uiRoot(page, ui)).toBeVisible({ timeout: 45_000 });
    // A member of several sessions changes the session from a menu.
    const switcher = uiRoot(page).getByRole('button', { name: /^Contest session: / });
    if (await switcher.count() && !(await switcher.getAttribute('aria-label'))?.includes(sessionName)) {
      await switcher.click();
      await page.getByRole('menuitemradio', { name: sessionName, exact: true }).click();
    }
    await expect(uiRoot(page)).toContainText(sessionName);
    await expect(liveBadge(page)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => probe.ready).toBeGreaterThan(0);
    return workspace;
  }

  async function adminRequest(page: Page, button: Locator, path: string) {
    const response = page.waitForResponse((response) => response.url() === `${fixture.origin}${path}`
      && response.request().method() === 'POST');
    await button.click();
    expect((await response).status()).toBe(200);
  }

  async function adminAction(page: Page, button: Locator) {
    await adminRequest(page, button, '/api/admin');
    await expect(page.getByRole('status').filter({ hasText: 'Administration action completed.' })).toBeVisible();
  }

  /** Opens the Manage dialog of the account with this username. */
  async function manage(page: Page, actor: Actor): Promise<Locator> {
    await page.getByRole('row').filter({ hasText: fixture.accounts[actor].username })
      .getByRole('button', { name: /^Manage / }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: fixture.accounts[actor].username });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  function accountRow(page: Page, actor: Actor): Locator {
    return page.getByRole('row').filter({ hasText: fixture.accounts[actor].username });
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
    phase = 'account page password change';
    await admin.page.getByRole('button', { name: /^Account settings for / }).click();
    await expect(admin.page).toHaveURL(new URL('/account', fixture.origin).href);
    const replacement = crypto.randomUUID() + 'A9!';
    await privateFill(admin.page.getByLabel('Current password', { exact: true }), fixture.accounts.admin.password);
    await privateFill(admin.page.getByLabel('New password', { exact: true }), replacement);
    await privateFill(admin.page.getByLabel('Confirm password', { exact: true }), replacement);
    await admin.page.getByRole('button', { name: 'Save password', exact: true }).click();
    await expect(admin.page.getByRole('status').filter({ hasText: 'Your password was changed.' })).toBeVisible();
    fixture.accounts.admin.password = replacement;
    // The change replaces the login. The person stays signed in, also after a reload.
    await admin.page.reload();
    await expect(admin.page.getByRole('heading', { level: 1, name: 'My account', exact: true })).toBeVisible();
    await expect(liveBadge(admin.page)).toBeVisible({ timeout: 30_000 });
    phase = 'account picture';
    // The alt text of an avatar is empty, so the blob image inside the card is the evidence.
    const picture = admin.page.getByRole('button', { name: /^Account settings for / }).locator('img[src^="blob:"]');
    await expect(picture).toHaveCount(0);
    const stored = admin.page.waitForResponse((response) => new URL(response.url()).pathname.startsWith('/api/avatar/')
      && response.request().method() === 'PUT');
    await admin.page.getByLabel('Choose a profile picture', { exact: true })
      .setInputFiles({ name: 'admin.png', mimeType: 'image/png', buffer: leftRedRightBlue(640, 480) });
    await admin.page.getByRole('dialog', { name: 'Use this picture?' })
      .getByRole('button', { name: 'Save picture', exact: true }).click();
    expect((await stored).status()).toBe(200);
    await expect(admin.page.getByText('Profile picture updated.')).toBeVisible();
    await expect(picture).toBeVisible();
    // A reload reads the stored picture from the server and downloads it again.
    await admin.page.reload();
    await expect(picture).toBeVisible({ timeout: 30_000 });
    const listed = admin.page.waitForResponse((response) => new URL(response.url()).pathname === '/api/avatars'
      && response.request().method() === 'GET');
    await admin.page.getByRole('button', { name: 'Remove picture', exact: true }).click();
    await admin.page.getByRole('dialog', { name: 'Remove your picture?' })
      .getByRole('button', { name: 'Remove picture', exact: true }).click();
    await expect(admin.page.getByText('Profile picture removed.')).toBeVisible();
    await expect(picture).toHaveCount(0);
    await admin.page.reload();
    expect((await listed).status()).toBe(200);
    await expect(admin.page.getByRole('button', { name: 'Change picture', exact: true })).toBeVisible();
    await expect(picture).toHaveCount(0);
    phase = 'administration settings';
    const reportButton = contestant.page.getByRole('complementary', { name: 'Your reports' })
      .getByRole('button', { name: 'Report an issue', exact: true });
    await consolePage(admin.page, 'Session settings');
    await expect(admin.page).toHaveURL(new URL('/administration/settings', fixture.origin).href);
    // The settings page switch. The console header has a second, shorter one.
    const intake = admin.page.getByRole('switch', { name: /^Contestant intake (?:Open|Closed)\./ });
    await expect(intake).toBeChecked();
    await adminAction(admin.page, intake);
    await expect(intake).not.toBeChecked();
    await expect(reportButton).toBeDisabled();
    await expect(volunteer.page.getByText('Contestant intake closed', { exact: true })).toBeVisible();
    await adminAction(admin.page, intake);
    await expect(intake).toBeChecked();
    await expect(reportButton).toBeEnabled();
    await admin.page.getByLabel('Largest image (MB)', { exact: true }).fill('1');
    await admin.page.getByLabel('Images per issue', { exact: true }).fill('3');
    await admin.page.getByLabel('Total per issue (MB)', { exact: true }).fill('3');
    await adminAction(admin.page, admin.page.getByRole('button', { name: 'Save image limits', exact: true }));
    phase = 'roster editors';
    // Categories: add one from the keyboard, then see it in a contestant's open session.
    const category = `Power ${crypto.randomUUID().slice(0, 8)}`;
    const newCategory = admin.page.getByLabel('New category', { exact: true });
    await newCategory.focus();
    await admin.page.keyboard.type(category);
    await admin.page.keyboard.press('Enter');
    await adminRequest(admin.page, admin.page.getByRole('button', { name: 'Save categories', exact: true }), '/api/admin');
    await expect(admin.page.getByRole('status').filter({ hasText: 'Categories saved.' })).toBeVisible();
    // Teams: add one from the keyboard, rename it, and see that a team with an account stays.
    await consolePage(admin.page, 'Roster');
    await expect(admin.page).toHaveURL(new URL('/administration/roster', fixture.origin).href);
    const extraTeam = `Roster ${crypto.randomUUID().slice(0, 8)}`;
    await admin.page.getByLabel('Add teams', { exact: true }).focus();
    await admin.page.keyboard.type(`${extraTeam}, Hall Z`);
    const added = admin.page.waitForResponse((response) => response.url() === `${fixture.origin}/api/admin`
      && response.request().method() === 'POST');
    await admin.page.keyboard.press('Control+Enter');
    expect((await added).status()).toBe(200);
    await expect(admin.page.getByRole('status').filter({ hasText: 'Added 1 team.' })).toBeVisible();
    await expect(admin.page.getByLabel('Add teams', { exact: true })).toBeFocused();
    await expect(admin.page.getByRole('button', { name: `Edit ${extraTeam}`, exact: true })).toBeVisible();
    await expect(admin.page.getByText(/^In use: 1 account\. This team stays\.$/).first()).toBeVisible();
    await expect(admin.page.getByRole('button', { name: /^Delete /, disabled: true }).first()).toBeVisible();
    const renamed = `${extraTeam} B`;
    await admin.page.getByRole('button', { name: `Edit ${extraTeam}`, exact: true }).click();
    await admin.page.getByLabel('Team name', { exact: true }).fill(renamed);
    await adminRequest(admin.page, admin.page.getByRole('button', { name: 'Save', exact: true }), '/api/admin');
    await expect(admin.page.getByRole('button', { name: `Edit ${renamed}`, exact: true })).toBeVisible();
    await admin.page.getByRole('button', { name: `Delete ${renamed}`, exact: true }).click();
    await adminRequest(admin.page, admin.page.getByRole('button', { name: 'Delete team', exact: true }), '/api/admin');
    await expect(admin.page.getByRole('button', { name: `Edit ${renamed}`, exact: true })).toHaveCount(0);
    await consolePage(admin.page, 'Accounts');
    await expect(admin.page).toHaveURL(new URL('/administration/accounts', fixture.origin).href);
    let member = await manage(admin.page, 'volunteer');
    await choose(member.getByRole('checkbox', { name: 'Jury', exact: true }));
    await adminAction(admin.page, member.getByRole('button', { name: 'Save membership', exact: true }));
    await expect(member).toBeHidden();
    await expect(accountRow(admin.page, 'volunteer').getByText('Jury', { exact: true })).toBeVisible();
    await expect(accountRow(admin.page, 'volunteer').getByText('Volunteer', { exact: true })).toBeVisible();
    // Combined roles reach the member's open phone app.
    await expect(phoneTabs(volunteer.page).getByRole('button', { name: 'Awards', exact: true })).toBeVisible();
    member = await manage(admin.page, 'volunteer');
    await choose(member.getByRole('checkbox', { name: 'Jury', exact: true }), false);
    await adminAction(admin.page, member.getByRole('button', { name: 'Save membership', exact: true }));
    await expect(member).toBeHidden();
    await expect(accountRow(admin.page, 'volunteer').getByText('Jury', { exact: true })).toHaveCount(0);
    await expect(phoneTabs(volunteer.page).getByRole('button', { name: 'Awards', exact: true })).toHaveCount(0);
    phase = 'phone and keyboard navigation';
    await volunteer.page.setViewportSize({ width: 320, height: 740 });
    await expect(uiRoot(volunteer.page, 'organiser-phone')).toBeVisible();
    await phoneTabs(volunteer.page).getByRole('button', { name: 'Me', exact: true }).focus();
    await volunteer.page.keyboard.press('Enter');
    await expect(volunteer.page.getByRole('heading', { level: 1, name: 'Me', exact: true })).toBeFocused();
    await expect(volunteer.page).toHaveURL(new URL('/account', fixture.origin).href);
    await phoneTabs(volunteer.page).getByRole('button', { name: 'Queue', exact: true }).focus();
    await volunteer.page.keyboard.press('Enter');
    await expect(volunteer.page.getByRole('heading', { level: 1, name: 'Queue', exact: true })).toBeFocused();
    await expect(volunteer.page).toHaveURL(new URL('/issues', fixture.origin).href);
    expect(await fitsWidth(volunteer.page)).toBe(true);
    await volunteer.page.setViewportSize(phone);
    phase = 'contestant submission and first assignment';
    const description = `UI fictional device ${crypto.randomUUID()}`;
    let teamChanges = contestant.probe.changes;
    await reportButton.click();
    await expect(contestant.page.getByRole('heading', { name: 'Report an issue', exact: true })).toBeFocused();
    // The category that the admin added reached this open session.
    await expect(contestant.page.getByText(category, { exact: true })).toBeVisible();
    await contestant.page.getByText('Devices', { exact: true }).click();
    await contestant.page.getByLabel('What is happening?', { exact: true }).fill(description);
    await contestant.page.getByRole('button', { name: 'Send report', exact: true }).click();
    await expect(contestant.page.getByRole('region', { name: 'Your report', exact: true })).toContainText(description);
    await expect(contestantTimer(contestant.page)).toContainText('running');
    await expect.poll(() => contestant.probe.changes).toBeGreaterThan(teamChanges);
    const card = phoneCard(volunteer.page, description);
    await expect(card).toBeVisible();
    const issueReference = /^Open (ISS-\d+), /.exec((await card.textContent()) ?? '')?.[1] ?? '';
    expect(issueReference).toMatch(/^ISS-\d+$/);
    await card.focus();
    await volunteer.page.keyboard.press('Enter');
    const volunteerView = uiRoot(volunteer.page);
    await expect(volunteer.page.getByRole('heading', { level: 1, name: new RegExp(`^${issueReference},`) })).toBeFocused();
    teamChanges = contestant.probe.changes;
    await volunteer.page.getByRole('button', { name: 'Claim', exact: true }).click();
    await expect.poll(() => contestant.probe.changes).toBeGreaterThan(teamChanges);
    await expect(owner(volunteerView)).toHaveText(/^You \(.+\)$/);
    const volunteerName = /^You \((.+)\)$/.exec((await owner(volunteerView).textContent()) ?? '')![1];
    await expect(contestant.page.getByRole('region', { name: 'Your report', exact: true })).toContainText(description);
    phase = 'specialist handoff';
    teamChanges = contestant.probe.changes;
    await volunteer.page.getByRole('button', { name: 'More actions', exact: true }).click();
    await volunteer.page.getByRole('dialog', { name: 'More actions' }).getByRole('button', { name: /Escalate to a specialist/ }).click();
    const escalate = volunteer.page.getByRole('dialog', { name: 'Escalate to a specialist?' });
    await escalate.getByRole('button', { name: 'Escalate to specialist', exact: true }).click();
    await expect(escalate).toHaveCount(0);
    await expect.poll(() => contestant.probe.changes).toBeGreaterThan(teamChanges);
    await expect(volunteerView.getByRole('note')).toContainText(`${volunteerName} stays responsible until a specialist accepts.`);
    await expect(owner(volunteerView)).toHaveText(`You (${volunteerName})`);
    await expect(contestant.page.getByText(`${volunteerName} stays responsible until a specialist takes over.`, { exact: true })).toBeVisible();
    await consolePage(specialist.page, 'Handoffs');
    teamChanges = contestant.probe.changes;
    await specialist.page.getByRole('button', { name: `Accept handoff for ${issueReference}`, exact: true }).click();
    await expect(specialist.page.getByRole('button', { name: `Accept handoff for ${issueReference}`, exact: true })).toHaveCount(0);
    await expect.poll(() => contestant.probe.changes).toBeGreaterThan(teamChanges);
    await consolePage(specialist.page, 'Assigned to me');
    await specialist.page.getByRole('button', { name: `Open ${issueReference}`, exact: true }).click();
    const sheet = specialist.page.getByRole('dialog', { name: `${issueReference}: ${description}` });
    await expect(sheet).toBeVisible();
    await expect(owner(sheet)).toHaveText(/^You \(.+\)$/);
    const specialistName = /^You \((.+)\)$/.exec((await owner(sheet).textContent()) ?? '')![1];
    await expect(owner(volunteerView)).toHaveText(specialistName);
    const firstAssigned = (await firstAssignment(sheet).textContent())!;
    phase = 'private and public conversation';
    const privateText = `Private fictional diagnosis ${crypto.randomUUID()}`;
    const publicText = `Public fictional response ${crypto.randomUUID()}`;
    const teamBeforePrivate = contestant.probe.changes;
    const otherBeforePrivate = other.probe.changes;
    const staffBeforePrivate = volunteer.probe.changes;
    await choose(sheet.getByRole('radio', { name: 'Internal note', exact: true }));
    await sheet.getByRole('textbox', { name: 'Internal note', exact: true }).fill(privateText);
    await sheet.getByRole('button', { name: 'Add note', exact: true }).click();
    await expect(volunteer.page.getByText(privateText, { exact: true })).toBeVisible();
    await expect.poll(() => volunteer.probe.changes).toBeGreaterThan(staffBeforePrivate);
    expect(contestant.probe.changes).toBe(teamBeforePrivate);
    expect(other.probe.changes).toBe(otherBeforePrivate);
    await expect(contestant.page.getByText(privateText, { exact: true })).toHaveCount(0);
    await choose(sheet.getByRole('radio', { name: 'Public reply', exact: true }));
    await sheet.getByRole('textbox', { name: 'Message', exact: true }).fill(publicText);
    await sheet.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(contestant.page.getByText(publicText, { exact: true })).toBeVisible();
    await expect.poll(() => contestant.probe.changes).toBeGreaterThan(teamBeforePrivate);
    await expect(other.page.getByText(description)).toHaveCount(0);
    phase = 'private and team images';
    const teamBeforeImage = contestant.probe.changes;
    await sheet.getByRole('tab', { name: /^Images/ }).click();
    await expect(sheet.getByRole('region', { name: /^Images · / })).toHaveAccessibleName('Images · 0 of 3');
    await sheet.getByRole('button', { name: 'Add image', exact: true }).click();
    const uploadDialog = specialist.page.getByRole('dialog', { name: 'Add an image' });
    await expect(uploadDialog).toContainText('Up to 1 MB each, 3 images, and 3 MB per issue.');
    await upload(uploadDialog, 'internal');
    const volunteerThumbs = volunteerView.getByRole('region', { name: /^Images · / }).getByRole('button', { name: /^View image uploaded by / });
    await expect(volunteerThumbs).toHaveCount(1);
    expect(contestant.probe.changes).toBe(teamBeforeImage);
    await expect(contestantThumbs(contestant.page)).toHaveCount(0);
    await upload(uploadDialog, 'public');
    await uploadDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(uploadDialog).toBeHidden();
    await expect(contestantThumbs(contestant.page)).toHaveCount(1);
    await expect(volunteerThumbs).toHaveCount(2);
    const specialistThumbs = sheet.getByRole('region', { name: /^Images · / }).getByRole('button', { name: /^View image uploaded by / });
    await expect(specialistThumbs).toHaveCount(2);
    await expect(contestant.page.getByRole('region', { name: 'Images', exact: true }).getByText('Staff only')).toHaveCount(0);
    await contestantThumbs(contestant.page).click();
    const teamDialog = contestant.page.getByRole('dialog');
    await expect(teamDialog.getByRole('img')).toBeVisible();
    await expect.poll(() => teamDialog.getByRole('img').evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await expect(teamDialog.getByRole('button', { name: 'Remove image', exact: true })).toHaveCount(0);
    await teamDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(teamDialog).toBeHidden();
    await specialistThumbs.filter({ hasText: 'Staff' }).click();
    const preview = specialist.page.getByRole('dialog', { name: /^Image uploaded by / });
    await expect(preview).toContainText('Staff only');
    await expect(preview.getByRole('img')).toBeVisible();
    await preview.getByRole('button', { name: 'Remove image', exact: true }).click();
    await expect(preview).toBeHidden();
    await expect(specialistThumbs).toHaveCount(1);
    await expect(volunteerThumbs).toHaveCount(1);
    phase = 'resolution award and external confirmation';
    await sheet.getByRole('button', { name: 'Resolve', exact: true }).click();
    const resolve = specialist.page.getByRole('dialog', { name: 'Resolve issue' });
    await resolve.getByRole('radio', { name: 'Service restored', exact: true }).check();
    await resolve.getByRole('button', { name: 'Resolve issue', exact: true }).click();
    await expect(resolve).toHaveCount(0);
    await expect(contestant.page.getByRole('region', { name: 'Resolution', exact: true })).toContainText('Service restored');
    await expect(contestantTimer(contestant.page)).toContainText('stopped');
    const stoppedTimer = (await contestantTimer(contestant.page).textContent())!;
    await phoneTab(jury.page, 'Awards');
    await expect(jury.page).toHaveURL(new URL('/jury', fixture.origin).href);
    const juryRow = (list: string) => jury.page.getByRole('list', { name: list, exact: true }).getByRole('listitem')
      .filter({ has: jury.page.getByText(issueReference, { exact: true }) });
    await expect(juryRow('To decide')).toContainText('Resolution: Service restored');
    await juryRow('To decide').getByRole('button', { name: 'Decide award', exact: true }).click();
    const award = jury.page.getByRole('dialog', { name: 'Decide award' });
    await award.locator('label').filter({ hasText: /^5 min$/ }).click();
    await award.getByLabel('Public award explanation', { exact: true }).fill('Fictional device delay');
    await award.getByRole('button', { name: 'Record 5 minutes', exact: true }).click();
    await expect(award).toHaveCount(0);
    const timeAward = contestant.page.getByRole('region', { name: /^Time award\s*, 5 minutes$/ });
    await expect(timeAward).toContainText('Decided by the jury');
    await expect(timeAward).toContainText('Not yet applied to your contest time');
    // A recorded award opens its issue. Back returns to the lists.
    await expect(jury.page.getByRole('region', { name: 'Time award' })).toContainText('5 minutes');
    await jury.page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(jury.page.getByRole('heading', { level: 1, name: 'Awards', exact: true })).toBeFocused();
    await expect(juryRow('To decide')).toHaveCount(0);
    await jury.page.getByRole('group', { name: 'Award lists' }).getByRole('button', { name: /^To apply/ }).click();
    await juryRow('To apply').locator('[id^="issue-card-"]').click();
    await expect(jury.page.getByRole('heading', { level: 1, name: new RegExp(`^${issueReference},`) })).toBeFocused();
    await jury.page.getByRole('button', { name: 'Confirm applied', exact: true }).click();
    const apply = jury.page.getByRole('dialog', { name: 'Confirm external application' });
    await apply.getByRole('checkbox', { name: /I confirm this award was applied/ }).check();
    await apply.getByRole('button', { name: 'Confirm applied externally', exact: true }).click();
    await expect(apply).toHaveCount(0);
    await expect(timeAward).toContainText('Applied to your contest time');
    await expect(timeAward).not.toContainText('Not yet applied');
    await jury.page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(jury.page.getByRole('heading', { level: 1, name: 'Awards', exact: true })).toBeFocused();
    await jury.page.getByRole('group', { name: 'Award lists' }).getByRole('button', { name: /^To apply/ }).click();
    await expect(juryRow('To apply')).toHaveCount(0);
    await jury.page.getByRole('group', { name: 'Award lists' }).getByRole('button', { name: /^Applied/ }).click();
    await expect(juryRow('Applied')).toHaveCount(1);
    await expect(contestantTimer(contestant.page)).toHaveText(stoppedTimer);
    phase = 'reopening and persisted refresh';
    await contestant.page.getByRole('button', { name: 'The problem is back? Reopen this issue', exact: true }).click();
    await contestant.page.getByLabel(/What is still wrong\?/).fill('Fictional device failure returned');
    await contestant.page.getByRole('button', { name: 'Reopen issue', exact: true }).click();
    await expect(contestantTimer(contestant.page)).toContainText('running');
    await expect(contestant.page.getByRole('region', { name: 'Earlier resolutions' })).toContainText('Service restored');
    await expect(timeAward).toContainText('Applied to your contest time');
    await expect(owner(sheet)).toHaveText(`You (${specialistName})`);
    await expect(firstAssignment(sheet)).toHaveText(firstAssigned);
    const reloaded = await contestant.page.reload();
    expect(reloaded?.status()).toBe(200);
    await expect(contestant.page).toHaveURL(new URL('/issues', fixture.origin).href);
    await expect(uiRoot(contestant.page, 'contestant')).toBeVisible({ timeout: 30_000 });
    await chooseReport(contestant.page, description);
    await expect(contestant.page.getByText(publicText, { exact: true })).toBeVisible();
    await expect(contestant.page.getByText(privateText, { exact: true })).toHaveCount(0);
    await expect(contestant.page.getByRole('region', { name: 'Earlier resolutions' })).toContainText('Service restored');
    await expect(timeAward).toContainText('Applied to your contest time');
    await expect(contestantTimer(contestant.page)).toContainText('running');
    expect(seconds((await contestantTimer(contestant.page).textContent())!)).toBeGreaterThanOrEqual(seconds(stoppedTimer));
    await expect(contestantThumbs(contestant.page)).toHaveCount(1);
    await expect.poll(() => contestant.probe.ready).toBeGreaterThan(1);
    await expect(liveBadge(contestant.page)).toBeVisible();
    await specialist.page.reload();
    await expect(uiRoot(specialist.page, 'organiser-desktop')).toBeVisible({ timeout: 30_000 });
    await consolePage(specialist.page, 'Assigned to me');
    await specialist.page.getByRole('button', { name: `Open ${issueReference}`, exact: true }).click();
    await expect(owner(sheet)).toHaveText(`You (${specialistName})`);
    await expect(firstAssignment(sheet)).toHaveText(firstAssigned);
    phase = 'membership revocation and restoration';
    member = await manage(admin.page, 'otherTeam');
    await member.getByRole('button', { name: 'Revoke session access', exact: true }).click();
    await adminAction(admin.page, admin.page.getByRole('dialog', { name: /^Revoke .* access to this session\?$/ })
      .getByRole('button', { name: 'Revoke access', exact: true }));
    await expect.poll(() => other.probe.closed).toBeGreaterThan(0);
    await expect(other.page.getByRole('heading', { name: 'Session access', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(accountRow(admin.page, 'otherTeam')).toHaveCount(0);
    await admin.page.getByText('Assign an existing account by ID', { exact: true }).click();
    const assign = admin.page.locator('form').filter({ has: admin.page.getByLabel('Account ID', { exact: true }) });
    await assign.getByLabel('Account ID', { exact: true }).fill(fixture.accounts.otherTeam.id);
    await choose(assign.getByRole('radio', { name: /^Team/ }));
    await assign.getByLabel('Contestant team', { exact: true }).selectOption({ label: 'Provider team 1 · Fixture desk 1' });
    await adminAction(admin.page, assign.getByRole('button', { name: 'Assign membership', exact: true }));
    await expect(accountRow(admin.page, 'otherTeam')).toContainText('Provider team 1');
    await other.page.reload();
    await expect(uiRoot(other.page, 'contestant')).toBeVisible({ timeout: 30_000 });
    await expect(other.page.getByText(description)).toHaveCount(0);
    phase = 'organizer assisted account recovery';
    member = await manage(admin.page, 'temporary');
    await member.getByRole('button', { name: 'Reset password', exact: true }).click();
    // The one-time credentials replace the page notice in the account dialog.
    await adminRequest(admin.page, admin.page.getByRole('dialog', { name: /^Reset .*'s password\?$/ })
      .getByRole('button', { name: 'Reset password', exact: true }), '/api/accounts');
    const credentials = admin.page.getByRole('region', { name: 'Temporary account credentials', exact: true });
    await expect(credentials).toBeVisible({ timeout: 45_000 });
    const recoveredPassword = await privateValue(credentials.getByLabel('Temporary password', { exact: true }));
    await credentials.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(credentials).toBeHidden();
    expect(recoveredPassword.length > 0).toBe(true);
    await temporary.page.reload();
    await expect(temporary.page.getByRole('heading', { name: /Sign in/ })).toBeVisible({ timeout: 30_000 });
    const recovered = await login('temporary', recoveredPassword);
    await chooseReport(recovered.page, description);
    await expect(recovered.page.getByRole('region', { name: /^Time award\s*, 5 minutes$/ })).toContainText('Applied to your contest time');
    phase = 'final provider and notification assertions';
    expect(requests.has('POST /api/auth/sign-in')).toBe(true);
    expect(requests.has('POST /api/workflow')).toBe(true);
    expect(requests.has('POST /api/admin')).toBe(true);
    expect(requests.has('POST /api/accounts')).toBe(true);
    expect([...requests].some((request) => request.startsWith('PUT /api/image/'))).toBe(true);
    expect(workspaces.every(({ probe }) => !probe.invalid)).toBe(true);
    // The Worker sends a Content-Security-Policy. The whole journey must not break it.
    expect(workspaces.flatMap(({ probe }) => probe.violations)).toEqual([]);
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
