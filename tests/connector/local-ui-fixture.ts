import { createHash, randomUUID } from 'node:crypto';
import type { D1Connection } from '../../src/server/adapters/d1/connection';
import { passwordHasher, randomSecret } from '../../src/server/adapters/cloudflare/password';
import { maintainFixtureSessions, type LiveEnvironment } from '../../src/server/adapters/cloudflare/live';
import type { Actor, TestAccount } from '../providers/contracts';
import type { UiFixture } from './ui-journey';

interface LocalBucket {
  put(key: string, value: Uint8Array): Promise<unknown>;
  delete(keys: string[]): Promise<void>;
  list(): Promise<{ objects: Array<{ key: string }> }>;
}
export interface LocalUiEnvironment extends LiveEnvironment { IMAGES: LocalBucket }

/** The caller supplies only temporary local bindings. No hosted target is accepted. */
export async function createLocalUiFixture(env: LocalUiEnvironment, origin: string, secret: string): Promise<UiFixture & { close(): Promise<void> }> {
  if (!/^https:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('The local UI fixture requires loopback HTTPS.');
  const db: D1Connection = env.DB;
  const actors: Actor[] = ['admin', 'otherAdmin', 'contestant', 'otherTeam', 'volunteer', 'specialist', 'jury', 'isolated', 'temporary', 'revoked'];
  const runId = randomUUID();
  const eventId = randomUUID();
  const sessionIds: [string, string] = [randomUUID(), randomUUID()];
  const teamIds = [randomUUID(), randomUUID(), randomUUID()];
  const control = { event: randomUUID(), session: randomUUID(), account: randomUUID(), key: `control:${randomUUID()}` };
  const accounts = {} as Record<Actor, TestAccount>;
  const write = (sql: string, ...values: Array<string | number | null>) => db.prepare(sql).bind(...values);
  const queries = [
    write('INSERT INTO events (id, name) VALUES (?, ?), (?, ?)', eventId, `Provider contract ${runId}`, control.event, 'Unrelated local control'),
    ...sessionIds.map((id, index) => write('INSERT INTO sessions (id, event_id, name, intake_open) VALUES (?, ?, ?, 1)',
      id, eventId, index === 0 ? 'Provider primary' : 'Provider isolation')),
    write('INSERT INTO sessions (id, event_id) VALUES (?, ?)', control.session, control.event),
    write('INSERT INTO accounts (id, name) VALUES (?, ?)', control.account, 'Unrelated local control'),
    write('INSERT INTO authentication_limits (key, window_start, attempts) VALUES (?, unixepoch(), 1)', control.key),
    ...teamIds.map((id, index) => write('INSERT INTO teams (id, session_id, name, location) VALUES (?, ?, ?, ?)',
      id, sessionIds[index === 2 ? 1 : 0], `Provider team ${index}`, `Fixture desk ${index}`)),
  ];
  for (const actor of actors) {
    const account = { id: randomUUID(), username: `local-${runId.slice(0, 12)}-${actor.toLowerCase()}`, password: randomSecret() + 'A9!' };
    accounts[actor] = account;
    const name = `Fictional ${actor}`;
    const sessionId = sessionIds[actor === 'isolated' || actor === 'otherAdmin' ? 1 : 0];
    const team = actor === 'contestant' || actor === 'temporary' ? teamIds[0]
      : actor === 'otherTeam' ? teamIds[1] : actor === 'isolated' ? teamIds[2] : null;
    const role = actor === 'volunteer' || actor === 'revoked' ? 'volunteer'
      : actor === 'specialist' ? 'specialist' : actor === 'jury' ? 'jury' : undefined;
    queries.push(
      write('INSERT INTO accounts (id, name, username, must_change) VALUES (?, ?, ?, ?)', account.id, name, account.username, Number(actor === 'temporary')),
      write(`INSERT INTO ba_user (id, name, email, username, emailVerified, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      account.id, name, `${account.username}@accounts.minsky.invalid`, account.username),
      write(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
        VALUES (?, ?, 'credential', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      randomUUID(), account.id, account.id, await passwordHasher.hash(account.password)),
      write('INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, ?, ?)',
        sessionId, account.id, team, Number(actor === 'admin' || actor === 'otherAdmin')),
    );
    if (role) queries.push(write('INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, ?)', sessionId, account.id, role));
  }
  await db.batch(queries);
  await env.IMAGES.put(control.key, Uint8Array.from([1, 2, 3]));

  async function maintain(phase: 'prepare' | 'finish') {
    const result = await maintainFixtureSessions(new Request('https://maintenance.internal/sessions', {
      method: 'POST', body: JSON.stringify({ phase, runId, eventId, sessionIds }),
    }), env);
    if (!result.ok || (await result.json() as { verified?: boolean }).verified !== true) {
      throw new Error('Local fixture Durable Object cleanup is unverified.');
    }
  }

  return { origin, sessionId: sessionIds[0], otherSessionId: sessionIds[1], teamId: teamIds[0], accounts,
    async close() {
      // Browser contexts close before this fence. No new fixture command or
      // image reservation may commit while exact object IDs are collected.
      const ids = Object.values(accounts).map((account) => account.id);
      const marks = ids.map(() => '?').join(',');
      await db.batch([write('UPDATE events SET archived = 1 WHERE id = ?', eventId),
        write(`UPDATE accounts SET disabled = 1 WHERE id IN (${marks})`, ...ids)]);
      await maintain('prepare');
      const images = (await write('SELECT original_path, thumbnail_path FROM issue_images WHERE session_id IN (?, ?)', ...sessionIds)
        .all<{ original_path: string; thumbnail_path: string }>()).results;
      const keys = images.flatMap((image) => [image.original_path, image.thumbnail_path]);
      if (keys.length) await env.IMAGES.delete(keys);
      const rateKeys = Object.values(accounts).flatMap((account) => [`username:${account.username}`, `change:${account.id}`]);
      rateKeys.push(...['127.0.0.1', '::1', '198.51.100.17'].map((ip) => `ip:${createHash('sha256').update(`${secret}:${ip}`).digest('hex')}`));
      await db.batch([
        write('DELETE FROM events WHERE id = ?', eventId),
        write(`DELETE FROM account_operations WHERE account_id IN (${marks}) OR actor IN (${marks})`, ...ids, ...ids),
        write(`DELETE FROM ba_user WHERE id IN (${marks})`, ...ids),
        write(`DELETE FROM authentication_limits WHERE key IN (${rateKeys.map(() => '?').join(',')})`, ...rateKeys),
        write(`DELETE FROM accounts WHERE id IN (${marks})`, ...ids),
      ]);
      if (keys.length) await env.IMAGES.delete(keys);
      await maintain('finish');
      const expected: Record<string, number> = { accounts: 1, events: 1, sessions: 1, authentication_limits: 1 };
      const tables = ['accounts', 'events', 'sessions', 'authentication_limits', 'teams', 'issues', 'history', 'resolutions', 'awards',
        'memberships', 'membership_roles', 'admin_audit', 'command_receipts', 'audience_sequences', 'notifications', 'session_issue_sequences',
        'issue_images', 'image_deletions', 'logins', 'ba_user', 'ba_account', 'ba_session', 'account_operations', 'installation'];
      for (const table of tables) {
        const row = await db.prepare(`SELECT count(*) AS count FROM ${table}`).first<{ count: number }>();
        if (row?.count !== (expected[table] ?? 0)) throw new Error(`Local UI cleanup left unexpected ${table} rows.`);
      }
      const objects = (await env.IMAGES.list()).objects;
      if (objects.length !== 1 || objects[0].key !== control.key ||
          !await write('SELECT id FROM accounts WHERE id = ?', control.account).first() ||
          !await write('SELECT id FROM sessions WHERE id = ?', control.session).first()) {
        throw new Error('Local UI cleanup did not preserve the unrelated controls.');
      }
    },
  };
}
