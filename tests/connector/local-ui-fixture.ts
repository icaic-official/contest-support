import { createHash, randomUUID } from 'node:crypto';
import { expect, type Browser } from '@playwright/test';
import type { EventCode } from '../../src/backend/contracts';
import type { D1Connection } from '../../src/server/adapters/d1/connection';
import { passwordHasher, randomSecret } from '../../src/server/adapters/cloudflare/password';
import { avatarKey } from '../../src/server/adapters/cloudflare/avatars';
import { advanceDeletions, type DeletionEnvironment } from '../../src/server/adapters/cloudflare/eventDeletion';
import { deleteFixtureRows, fenceFixtureEvent, forgetFixtureEvent } from '../../src/server/adapters/cloudflare/eventDeletionFixture';
import { maintainFixtureSessions, type LiveEnvironment } from '../../src/server/adapters/cloudflare/live';
import type { Actor, TestAccount } from '../providers/contracts';
import type { UiFixture } from './ui-journey';

interface LocalBucket {
  put(key: string, value: Uint8Array): Promise<unknown>;
  delete(keys: string[]): Promise<void>;
}
export interface LocalUiEnvironment extends LiveEnvironment { IMAGES: LocalBucket & DeletionEnvironment['IMAGES'] }

/** The caller supplies only temporary local bindings. No hosted target is accepted. */
export async function createLocalUiFixture(env: LocalUiEnvironment, origin: string, secret: string): Promise<UiFixture & {
  /** A webmaster deletes a second event in a real browser, and watches it reach "Deleted". */
  deleteEventInBrowser(browser: Browser): Promise<void>;
  close(): Promise<void>;
}> {
  if (!/^https:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('The local UI fixture requires loopback HTTPS.');
  const db: D1Connection = env.DB;
  const actors: Actor[] = ['eventAdmin', 'admin', 'otherAdmin', 'contestant', 'otherTeam', 'volunteer', 'specialist', 'jury', 'isolated', 'temporary', 'revoked'];
  const runId = randomUUID();
  const eventId = randomUUID();
  const sessionIds: [string, string] = [randomUUID(), randomUUID()];
  const teamIds: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
  const control = { event: randomUUID(), session: randomUUID(), account: randomUUID(), key: `control:${randomUUID()}` };
  const code = `local-${runId.slice(0, 12)}` as EventCode;
  const accounts = Object.fromEntries(actors.map((actor): [Actor, TestAccount] => [actor, {
    id: randomUUID(), target: { kind: 'event', code }, username: `local-${runId.slice(0, 12)}-${actor.toLowerCase()}`,
    password: randomSecret() + 'A9!',
  }])) as Record<Actor, TestAccount>;
  const write = (sql: string, ...values: Array<string | number | null>) => db.prepare(sql).bind(...values);
  const queries = [
    write('INSERT INTO events (id, name, code) VALUES (?, ?, ?), (?, ?, NULL)',
      eventId, `Provider contract ${runId}`, code, control.event, 'Unrelated local control'),
    ...sessionIds.map((id, index) => write('INSERT INTO sessions (id, event_id, name, intake_open) VALUES (?, ?, ?, 1)',
      id, eventId, index === 0 ? 'Provider primary' : 'Provider isolation')),
    write('INSERT INTO sessions (id, event_id) VALUES (?, ?)', control.session, control.event),
    write('INSERT INTO accounts (id, name) VALUES (?, ?)', control.account, 'Unrelated local control'),
    write('INSERT INTO authentication_limits (key, window_start, attempts) VALUES (?, unixepoch(), 1)', control.key),
    ...teamIds.map((id, index) => write('INSERT INTO teams (id, session_id, name, location) VALUES (?, ?, ?, ?)',
      id, sessionIds[index === 2 ? 1 : 0], `Provider team ${index}`, `Fixture desk ${index}`)),
  ];
  for (const actor of actors) {
    const account = accounts[actor];
    const name = `Fictional ${actor}`;
    const sessionId = sessionIds[actor === 'isolated' || actor === 'otherAdmin' ? 1 : 0];
    const team = actor === 'contestant' || actor === 'temporary' ? teamIds[0]
      : actor === 'otherTeam' ? teamIds[1] : actor === 'isolated' ? teamIds[2] : null;
    const role = actor === 'volunteer' || actor === 'revoked' ? 'volunteer'
      : actor === 'specialist' ? 'specialist' : actor === 'jury' ? 'jury' : undefined;
    queries.push(
      write('INSERT INTO accounts (id, name, username, handle, event_id, must_change) VALUES (?, ?, ?, ?, ?, ?)',
        account.id, name, account.username, account.username, eventId, Number(actor === 'temporary')),
      write(`INSERT INTO ba_user (id, name, email, username, emailVerified, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      account.id, name, `${account.username}@accounts.minsky.invalid`, account.username),
      write(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
        VALUES (?, ?, 'credential', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      randomUUID(), account.id, account.id, await passwordHasher.hash(account.password)),
      actor === 'eventAdmin'
        // The event admin holds no seat. Its grant reaches every contest of the event.
        ? write(`INSERT INTO grants (account_id, scope, event_id, granted_by) VALUES (?, 'event', ?, 'fixture')`, account.id, eventId)
        : write('INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, ?, ?)',
          sessionId, account.id, team, Number(actor === 'admin' || actor === 'otherAdmin')),
    );
    if (role) queries.push(write('INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, ?)', sessionId, account.id, role));
  }
  // A team's default entrant has the team's ID. Linking the sign-in lets an event admin move the seat.
  for (const actor of actors) {
    const team = actor === 'contestant' || actor === 'temporary' ? teamIds[0]
      : actor === 'otherTeam' ? teamIds[1] : actor === 'isolated' ? teamIds[2] : undefined;
    if (team) queries.push(write('UPDATE accounts SET entrant_id = ? WHERE id = ?', team, accounts[actor].id));
  }
  await db.batch(queries);
  await env.IMAGES.put(control.key, Uint8Array.from([1, 2, 3]));

  async function eraseLiveState() {
    const result = await maintainFixtureSessions(new Request('https://maintenance.internal/sessions', {
      method: 'POST', body: JSON.stringify({ eventId }),
    }), env);
    if (!result.ok || (await result.json() as { verified?: boolean }).verified !== true) {
      throw new Error('Local fixture Durable Object cleanup is unverified.');
    }
  }

  return { origin, sessionId: sessionIds[0], otherSessionId: sessionIds[1], teamId: teamIds[0], accounts,
    async deleteEventInBrowser(browser) {
      const doomed = { event: randomUUID(), session: randomUUID(), name: `Deleted in the browser ${runId.slice(0, 8)}`, code: `del-${runId.slice(0, 8)}` };
      const object = `${doomed.session}/${randomUUID()}/${randomUUID()}/original`;
      const webmaster = { id: randomUUID(), handle: `web-${runId.slice(0, 8)}`, password: randomSecret() + 'A9!' };
      await db.batch([
        write('INSERT INTO events (id, name, code) VALUES (?, ?, ?)', doomed.event, doomed.name, doomed.code),
        write(`INSERT INTO sessions (id, event_id, name) VALUES (?, ?, 'Doomed contest')`, doomed.session, doomed.event),
        write(`INSERT INTO accounts (id, name, username, handle, event_id) VALUES (?, 'Doomed person', ?, ?, ?)`,
          randomUUID(), `doomed-${runId.slice(0, 8)}`, `doomed-${runId.slice(0, 8)}`, doomed.event),
        write('INSERT INTO accounts (id, name, username, handle, must_change) VALUES (?, ?, ?, ?, 0)', webmaster.id, 'Fictional webmaster', webmaster.handle, webmaster.handle),
        write(`INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', 'fixture')`, webmaster.id),
        write(`INSERT INTO ba_user (id, name, email, username, emailVerified, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        webmaster.id, 'Fictional webmaster', `${webmaster.handle}@accounts.minsky.invalid`, webmaster.handle),
        write(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
          VALUES (?, ?, 'credential', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        randomUUID(), webmaster.id, webmaster.id, await passwordHasher.hash(webmaster.password)),
      ]);
      await env.IMAGES.put(object, Uint8Array.from([1, 2, 3]));
      const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const violations: string[] = [];
      await page.exposeFunction('reportCspViolation', (directive: string) => { violations.push(directive); });
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          (window as unknown as { reportCspViolation(directive: string): void }).reportCspViolation(event.violatedDirective);
        });
      });
      await page.goto(`${origin}/sign-in`);
      await page.getByRole('button', { name: 'Site sign-in', exact: true }).click();
      await page.getByLabel('Username', { exact: true }).fill(webmaster.handle);
      await page.getByLabel('Password', { exact: true }).fill(webmaster.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'));
      await page.goto(`${origin}/site`);
      await page.getByRole('button', { name: `Delete ${doomed.name}`, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `Delete ${doomed.name}?` });
      await expect(dialog).toContainText('1 contest and 1 account');
      const confirm = dialog.getByRole('button', { name: 'Delete event', exact: true });
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel('Type the event name to confirm').fill(`${doomed.name} `);
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel('Type the event name to confirm').fill(doomed.name);
      await confirm.click();
      const deletions = page.getByRole('region', { name: /^Deletions/ });
      await expect(deletions.getByText(doomed.name)).toBeVisible();
      await expect(page.getByRole('button', { name: `Delete ${doomed.name}`, exact: true })).toHaveCount(0);
      // After the POST, the Worker's waitUntil runs the rows and live steps. The page refreshes itself.
      await expect(deletions.getByText('Waiting for the final file check')).toBeVisible({ timeout: 60_000 });
      await write(`UPDATE event_deletions SET lease_until = 0, rows_done_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-66 minutes') WHERE event_id = ?`, doomed.event).run();
      await advanceDeletions(env);
      await expect(deletions.getByText('Deleted', { exact: true })).toBeVisible({ timeout: 60_000 });
      if ((await env.IMAGES.list({ prefix: `${doomed.session}/` })).objects.length !== 0) throw new Error('The deleted event kept a file.');
      if (violations.length) throw new Error('The deletion screens broke the content security policy.');
      await context.close();
      await forgetFixtureEvent(db, doomed.event);
    },
    async close() {
      // Browser contexts close before this fence. No new fixture command or
      // image reservation may commit while exact object IDs are collected.
      await fenceFixtureEvent(db, eventId);
      const ids = Object.values(accounts).map((account) => account.id);
      const marks = ids.map(() => '?').join(',');
      const images = (await write('SELECT original_path, thumbnail_path FROM issue_images WHERE session_id IN (?, ?)', ...sessionIds)
        .all<{ original_path: string; thumbnail_path: string }>()).results;
      const avatars = (await write(`SELECT id, account_id FROM account_avatars WHERE account_id IN (${marks})`, ...ids)
        .all<{ id: string; account_id: string }>()).results;
      const keys = [...images.flatMap((image) => [image.original_path, image.thumbnail_path]),
        ...avatars.map((avatar) => avatarKey(avatar.account_id, avatar.id))];
      if (keys.length) await env.IMAGES.delete(keys);
      await deleteFixtureRows(db, eventId);
      const rateKeys = ['127.0.0.1', '::1', '198.51.100.17'].map((ip) => `ip:${createHash('sha256').update(`${secret}:${ip}`).digest('hex')}`);
      await write(`DELETE FROM authentication_limits WHERE key IN (${rateKeys.map(() => '?').join(',')})`, ...rateKeys).run();
      if (keys.length) await env.IMAGES.delete(keys);
      await eraseLiveState();
      await forgetFixtureEvent(db, eventId);
      // The site records of the browser deletion stay: its webmaster, the audit row, and the receipt.
      const expected: Record<string, number> = { accounts: 2, events: 1, sessions: 1, authentication_limits: 1, logins: 1,
        ba_user: 1, ba_account: 1, ba_session: 1, authority_audit: 1, manage_receipts: 1 };
      const tables = ['accounts', 'events', 'sessions', 'authentication_limits', 'teams', 'issues', 'history', 'resolutions', 'awards',
        'memberships', 'membership_roles', 'admin_audit', 'command_receipts', 'audience_sequences', 'notifications', 'session_issue_sequences',
        'issue_images', 'image_deletions', 'logins', 'ba_user', 'ba_account', 'ba_session', 'account_operations', 'entrants', 'authority_audit', 'manage_receipts',
        'account_avatars'];
      for (const table of tables) {
        const row = await db.prepare(`SELECT count(*) AS count FROM ${table}`).first<{ count: number }>();
        if (row?.count !== (expected[table] ?? 0)) throw new Error(`Local UI cleanup left unexpected ${table} rows.`);
      }
      const objects = (await env.IMAGES.list({ prefix: '' })).objects;
      if (objects.length !== 1 || objects[0]!.key !== control.key ||
          !await write('SELECT id FROM accounts WHERE id = ?', control.account).first() ||
          !await write('SELECT id FROM sessions WHERE id = ?', control.session).first()) {
        throw new Error('Local UI cleanup did not preserve the unrelated controls.');
      }
    },
  };
}
