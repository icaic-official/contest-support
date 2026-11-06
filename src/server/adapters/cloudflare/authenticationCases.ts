import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openStoreDatabase } from './tooling/store-database.mjs';
import type { D1Binding, D1Connection, D1Statement, D1Value } from '../d1/connection';
import { D1Fixture, applyMigrations } from '../d1/testFixture';
import { measureD1 } from '../d1/testMetrics';
import { parseHandle, type EventCode, type Handle, type SignInTarget } from '../../../backend/contracts';
import { D1ApplicationService } from './application';
import { D1AuthenticationService, signInFailureLimits } from './authentication';
import { D1ManageService } from './manage';
import { loginKeyFor } from './credentials';
import { createBetterAuthIdentity, type IdentityProvider } from './identity';
import { passwordHasher, randomSecret, type PasswordHasher } from './password';
import { createAuthenticationHandler } from '../../authenticationHttp';
import { createCloudflareAuthentication } from '../../../backend/cloudflare/authentication';
import { verifyTemporaryAuthentication } from '../../../../tests/providers/scenarios/authentication-lifecycle';

const connectorConfig = process.env.MINSKY_CONNECTOR_D1_CONFIG;
const historicalRemote = process.env.MINSKY_AUTH_REMOTE === '1';
if (connectorConfig && historicalRemote) throw new Error('Select the full connector account target or isolated authentication verification.');
const remote = historicalRemote || Boolean(connectorConfig);
const configPath = connectorConfig ?? 'wrangler.auth-ci.jsonc';
const origin = 'http://127.0.0.1:8788';

// Better Auth's scrypt takes about 110 ms per hash or check, and every case signs in.
// Local cases test credential flows, so they use a low-cost scrypt in the same stored format.
// password.test.ts covers the maintained hasher. Hosted runs keep it.
function quickKey(password: string, salt: string): string {
  return scryptSync(password.normalize('NFKC'), salt, 64, { N: 16, r: 1, p: 1 }).toString('hex');
}

const hasher: PasswordHasher = remote ? passwordHasher : {
  async hash(password) {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${quickKey(password, salt)}`;
  },
  async verify(password, hash) {
    const [salt, key] = hash.split(':');
    return /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash) && quickKey(password, salt!) === key;
  },
};

/** Failed rejection assertions must never print a password or cookie result. */
function expectFailure(operation: Promise<unknown>) {
  return expect(operation.then(() => undefined)).rejects;
}

export type AuthenticationCases = 'sessions' | 'recovery' | 'completion';

/** Each file owns its fixtures. Hosted files can run concurrently. */
export function registerAuthenticationCases(group: AuthenticationCases) {
  // Hosted runs use maintained scrypt, which took 1.5 to 8.3 seconds per account case
  // on Workers Builds. Their Vitest configurations set a limit above that.
  describe('Cloudflare account authentication', () => {
    let db: D1Binding;
    let dispose: () => Promise<void>;
    let fixture: D1Fixture;
    let identity: IdentityProvider;
    let service: D1AuthenticationService;
    let password: string;
    let username: string;
    let eventCode: EventCode;
    let adminHeaders: Headers;
    let extraIds: string[];
    let usernames: string[];
    let created: boolean;
    let fullApplication = false;

    beforeAll(async () => {
      const platform = await openStoreDatabase({ configPath, remoteBindings: remote });
      const metrics = process.env.MINSKY_D1_METRICS === '1'
        ? measureD1(platform.db, (line) => process.stdout.write(line + '\n'),
          { sessions: 1, recovery: 2, initiation: 3, completion: 4 }[group]) : undefined;
      db = metrics?.db ?? platform.db;
      dispose = async () => { metrics?.flush(); await platform.dispose(); };
      if (!remote) {
        await applyMigrations(db);
      }
      fullApplication = !!await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'admin_audit'").first();
      identity = createBetterAuthIdentity(db, {
        origin, secret: randomSecret(), secureCookies: false, hasher,
      });
    }, 120_000);

    afterAll(async () => { if (dispose) await dispose(); }, 120_000);

    function stmt(sql: string, ...values: D1Value[]): D1Statement {
      return db.prepare(sql).bind(...values);
    }

    async function rowsBatch(statements: D1Statement[]): Promise<Array<Array<Record<string, unknown>>>> {
      const results = await db.batch(statements) as Array<{ results: Array<Record<string, unknown>> }>;
      return results.map((result) => result.results);
    }

    async function signIn(accountUsername = username, accountPassword = password, instance = service, code = eventCode): Promise<Headers> {
      usernames.push(accountUsername.trim().toLowerCase());
      // The HTTP boundary parses typed text the same way.
      const handle = parseHandle(accountUsername);
      if (!handle) throw new Error(`The fixture handle ${accountUsername} is not a handle.`);
      const signed = await instance.signIn({ kind: 'event', code }, handle, accountPassword);
      return new Headers({ cookie: signed.cookie.split(';')[0]! });
    }

    /** The failure counter of a handle in the fixture event. */
    const limitKey = (handle: string, eventId = fixture.eventId) => `handle:${eventId}:${handle}`;

    async function credentialEffects(): Promise<string> {
      const people = `SELECT id FROM accounts WHERE id IN (?, ?) OR name = ?`;
      const values = [fixture.staff.accountId, fixture.contestant.accountId, `auth-fixture:${fixture.eventId}`];
      const rows = await rowsBatch([
        ...[
          ['accounts', 'id'], ['logins', 'account_id'], ['ba_user', 'id'],
          ['ba_account', 'userId'], ['ba_session', 'userId'], ['account_operations', 'account_id'],
        ].map(([table, column]) => stmt(`SELECT * FROM ${table} WHERE ${column} IN (${people}) ORDER BY id`, ...values)),
        ...['memberships', 'membership_roles', 'notifications', 'audience_sequences']
          .map((table) => stmt(`SELECT * FROM ${table} WHERE session_id IN (?, ?) ORDER BY 1, 2`, fixture.sessionId, fixture.secondSessionId)),
        ...(fullApplication ? [stmt('SELECT * FROM admin_audit WHERE session_id IN (?, ?) ORDER BY id', fixture.sessionId, fixture.secondSessionId)] : []),
      ]);
      // Failed comparisons must not print maintained password hashes or cookies.
      return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    }

    function changeAtFinalGuard(change: D1Statement, batchNumber = 1, checkpoint?: () => Promise<void>): D1AuthenticationService {
      let batches = 0;
      return new D1AuthenticationService({ prepare: (sql) => db.prepare(sql), batch: async (statements) => {
        if (++batches !== batchNumber) return db.batch(statements);
        if (checkpoint) await checkpoint();
        // These are actual writes inside the SQLite transaction. The final check
        // follows them, so a failure must undo the credential effects as well.
        const finalGuard = statements.length - 2;
        return db.batch([...statements.slice(0, finalGuard), change, ...statements.slice(finalGuard)]);
      } }, identity, hasher);
    }

    async function actorRestriction(restriction: string): Promise<D1Statement> {
      const current = await service.current(adminHeaders);
      const changes: Record<string, D1Statement> = {
        expired_login: stmt('UPDATE logins SET expires_at = unixepoch() - 1 WHERE id = ?', current!.caller.loginId),
        expired_identity: stmt("UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE userId = ?", fixture.staff.accountId),
        revoked: stmt('UPDATE logins SET revoked = 1 WHERE id = ?', current!.caller.loginId),
        generation: stmt('UPDATE accounts SET credential_generation = credential_generation + 1 WHERE id = ?', fixture.staff.accountId),
        must_change: stmt('UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.staff.accountId),
        disabled: stmt('UPDATE accounts SET disabled = 1 WHERE id = ?', fixture.staff.accountId),
        pending: stmt("UPDATE accounts SET must_change = 1, credential_state = 'pending' WHERE id = ?", fixture.staff.accountId),
        permission: stmt('UPDATE memberships SET is_admin = 0 WHERE account_id = ?', fixture.staff.accountId),
      };
      return changes[restriction]!;
    }

    beforeEach(async () => {
      created = false;
      extraIds = [];
      usernames = [];
      fixture = new D1Fixture(db, configPath);
      await fixture.create();
      created = true;
      eventCode = (await stmt('SELECT code FROM events WHERE id = ?', fixture.eventId).first<{ code: EventCode }>())!.code;
      password = randomSecret();
      username = `auth_${fixture.eventId.replaceAll('-', '').slice(0, 20)}`;
      const hash = await hasher.hash(password);
      const now = new Date().toISOString();
      const ids = [fixture.staff.accountId, fixture.contestant.accountId];
      const statements: D1Statement[] = [];
      for (const [index, id] of ids.entries()) {
        const name = index === 0 ? `${username}_a` : username;
        statements.push(
          stmt('UPDATE accounts SET username = ? WHERE id = ?', name, id),
          stmt(`INSERT INTO ba_user (id, name, username, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ?, ?)`, id, 'Fictional account', name, `${name}@accounts.minsky.invalid`, now, now),
          stmt(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)`, randomUUID(), id, id, hash, now, now),
        );
      }
      statements.push(stmt('UPDATE memberships SET is_admin = 1 WHERE account_id = ?', fixture.staff.accountId));
      await db.batch(statements);
      service = new D1AuthenticationService(db, identity, hasher);
      adminHeaders = await signIn(`${username}_a`);
    }, 120_000);

    afterEach(async () => {
      if (!created) return;
      // Remove only this UUID's identity records. The proof fixture independently
      // checks account markers, event ownership, and all application relationships.
      const extra = await stmt('SELECT id, handle AS username FROM accounts WHERE name = ?', `auth-fixture:${fixture.eventId}`).all<{ id: string; username: string }>();
      extraIds = [...new Set([...extraIds, ...extra.results.map((row) => row.id)])];
      usernames.push(...extra.results.map((row) => row.username));
      const uniqueUsernames = [...new Set(usernames)];
      const ids = [fixture.staff.accountId, fixture.contestant.accountId, ...extraIds];
      await db.batch([
        // Full local schemas also retain account audit targets. Remove only the
        // owned event's audit rows before deleting its extra fixture accounts.
        ...(fullApplication ? [stmt('DELETE FROM admin_audit WHERE session_id IN (?, ?)', fixture.sessionId, fixture.secondSessionId)] : []),
        ...ids.map((id) => stmt('DELETE FROM account_operations WHERE account_id = ?', id)),
        ...extraIds.map((id) => stmt('DELETE FROM accounts WHERE id = ? AND name = ?', id, `auth-fixture:${fixture.eventId}`)),
        ...ids.map((id) => stmt('DELETE FROM ba_user WHERE id = ?', id)),
        stmt('DELETE FROM authentication_limits WHERE key IN (?, ?, ?, ?)', limitKey(username), limitKey(`${username}_a`), `change:${fixture.staff.accountId}`, `change:${fixture.contestant.accountId}`),
        ...uniqueUsernames.map((name) => stmt('DELETE FROM authentication_limits WHERE key = ?', limitKey(name))),
      ]);
      const checks = await rowsBatch([
        ...ids.flatMap((id) => [
          stmt('SELECT count(*) AS n FROM ba_user WHERE id = ?', id),
          stmt('SELECT count(*) AS n FROM ba_session WHERE userId = ?', id),
          stmt('SELECT count(*) AS n FROM ba_account WHERE userId = ?', id),
        ]),
        ...uniqueUsernames.map((name) => stmt('SELECT key FROM authentication_limits WHERE key = ?', limitKey(name))),
      ]);
      for (let index = 0; index < ids.length; index++) {
        expect(checks[index * 3]![0]?.n).toBe(0);
        expect(checks[index * 3 + 1]![0]?.n).toBe(0);
        expect(checks[index * 3 + 2]![0]?.n).toBe(0);
      }
      for (const rows of checks.slice(ids.length * 3)) expect(rows[0] ?? null).toBeNull();
      await fixture.cleanup();
    }, 120_000);

    /**
     * One account in a second event, with a password. A legacy account passes
     * its handle as the login key. The test removes it.
     */
    async function otherEventAccount(handle: string, accountPassword: string, loginKey?: string) {
      const ids = { event: randomUUID(), account: randomUUID() };
      const key = loginKey ?? loginKeyFor(ids.account);
      const now = new Date().toISOString();
      await db.batch([
        stmt('INSERT INTO events (id) VALUES (?)', ids.event),
        stmt('INSERT INTO accounts (id, name, username, handle, event_id, must_change) VALUES (?, ?, ?, ?, ?, 0)',
          ids.account, 'Fictional other event account', key, handle, ids.event),
        stmt(`INSERT INTO ba_user (id, name, username, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ?, ?)`,
          ids.account, 'Fictional account', key, `${key}@accounts.minsky.invalid`, now, now),
        stmt(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
          randomUUID(), ids.account, ids.account, await hasher.hash(accountPassword), now, now),
      ]);
      const { code } = (await stmt('SELECT code FROM events WHERE id = ?', ids.event).first<{ code: EventCode }>())!;
      return {
        ...ids, code,
        remove: () => db.batch([
          stmt('DELETE FROM ba_user WHERE id = ?', ids.account),
          stmt('DELETE FROM accounts WHERE id = ?', ids.account),
          stmt('DELETE FROM events WHERE id = ?', ids.event),
          stmt('DELETE FROM authentication_limits WHERE key = ?', limitKey(handle, ids.event)),
        ]),
      };
    }

    if (group === 'sessions') {
      it('logs in with a normalized username and restores the stable account ID', async () => {
        const headers = await signIn(` ${username.toUpperCase()} `);
        const current = await service.current(headers);
        expect(current?.user.id).toBe(fixture.contestant.accountId);
        expect(current?.status).toMatchObject({ handle: username, must_change: false, session_valid: true });
        // A legacy account signs in with its old username, which is both its handle and its login key.
        expect(await stmt('SELECT username, handle FROM accounts WHERE id = ?', fixture.contestant.accountId).first())
          .toEqual({ username, handle: username });
      });

      it('signs the same handle in to the account of the named event', async () => {
        const otherPassword = randomSecret();
        const other = await otherEventAccount(username, otherPassword);
        try {
          expect((await service.current(await signIn(username, otherPassword, service, other.code)))?.user.id).toBe(other.account);
          expect((await service.current(await signIn()))?.user.id).toBe(fixture.contestant.accountId);
          await expectFailure(signIn(username, password, service, other.code)).toMatchObject({ status: 401 });
        } finally {
          await other.remove();
        }
      });

      it('refuses an unknown event code with the one message, and limits it as it limits a known code', async () => {
        const refusal = { status: 401, message: 'The event code, username, or password is incorrect.' };
        const absent = `absent-${randomSecret().slice(0, 12).toLowerCase().replace(/[^a-z0-9-]/g, '0')}` as EventCode;
        for (const code of [absent, eventCode]) {
          for (let attempt = 0; attempt < signInFailureLimits.perUsername; attempt++) {
            await expectFailure(signIn(username, randomSecret(), service, code)).toMatchObject(refusal);
          }
          await expectFailure(signIn(username, randomSecret(), service, code)).toMatchObject({ status: 429 });
        }
        expect(await stmt('SELECT attempts FROM authentication_limits WHERE key = ?', `handle:code:${absent}:${username}`).first())
          .toEqual({ attempts: signInFailureLimits.perUsername });
        await stmt('DELETE FROM authentication_limits WHERE key = ?', limitKey(username)).run();
        await expectFailure(signIn(`absent_${randomSecret().slice(0, 15)}`)).toMatchObject(refusal);
      });

      it('spends one password check on every refusal, so its time does not show which codes and handles exist', async () => {
        let work = 0;
        const counting: PasswordHasher = {
          hash: async (value) => { work++; return hasher.hash(value); },
          verify: async (value, stored) => { work++; return hasher.verify(value, stored); },
        };
        const watched = new D1AuthenticationService(db, createBetterAuthIdentity(db, {
          origin, secret: randomSecret(), secureCookies: false, hasher: counting,
        }), counting);
        const known = parseHandle(username)!;
        const absent = parseHandle(`absent_${randomSecret().slice(0, 15)}`)!;
        const absentCode = `absent-${randomSecret().slice(0, 12).toLowerCase().replace(/[^a-z0-9-]/g, '0')}` as EventCode;
        const event: SignInTarget = { kind: 'event', code: eventCode };
        usernames.push(absent);
        const workOf = async (target: SignInTarget, handle: Handle) => {
          work = 0;
          await expectFailure(watched.signIn(target, handle, randomSecret())).toMatchObject({ status: 401 });
          return work;
        };
        const spent: Record<string, number> = {
          wrongPassword: await workOf(event, known),
          unknownHandle: await workOf(event, absent),
          unknownCode: await workOf({ kind: 'event', code: absentCode }, known),
          unknownSiteHandle: await workOf({ kind: 'site' }, absent),
        };
        await stmt('UPDATE accounts SET disabled = 1 WHERE id = ?', fixture.contestant.accountId).run();
        spent.disabled = await workOf(event, known);
        await stmt("UPDATE accounts SET disabled = 0, must_change = 1, credential_state = 'pending' WHERE id = ?", fixture.contestant.accountId).run();
        spent.pending = await workOf(event, known);
        await stmt('DELETE FROM authentication_limits WHERE key IN (?, ?)', `handle:code:${absentCode}:${known}`, `handle:site:${absent}`).run();
        expect(spent).toEqual({ wrongPassword: 1, unknownHandle: 1, unknownCode: 1, unknownSiteHandle: 1, disabled: 1, pending: 1 });
      });

      it('never gives Better Auth an unknown handle, even when it is a login key in another event', async () => {
        const legacy = `legacy_${randomSecret().slice(0, 20)}`;
        const otherPassword = randomSecret();
        const other = await otherEventAccount(legacy, otherPassword, legacy);
        let calls = 0;
        const counting: IdentityProvider = { ...identity, signIn: async (key, value) => {
          calls++;
          return identity.signIn(key, value);
        } };
        const watched = new D1AuthenticationService(db, counting, hasher);
        try {
          await expectFailure(signIn(legacy, otherPassword, watched)).toMatchObject({ status: 401 });
          expect(calls).toBe(0);
          expect(await stmt('SELECT attempts FROM authentication_limits WHERE key = ?', limitKey(legacy)).first()).toEqual({ attempts: 1 });
          expect((await watched.current(await signIn(legacy, otherPassword, watched, other.code)))?.user.id).toBe(other.account);
          expect(calls).toBe(1);
        } finally {
          await other.remove();
        }
      });

      it('counts sign-in failures for each event separately', async () => {
        const otherPassword = randomSecret();
        const other = await otherEventAccount(username, otherPassword);
        try {
          await stmt('INSERT INTO authentication_limits (key, window_start, attempts) VALUES (?, unixepoch(), 10)',
            limitKey(username, other.event)).run();
          await expectFailure(signIn(username, otherPassword, service, other.code)).toMatchObject({ status: 429 });
          expect((await service.current(await signIn()))?.user.id).toBe(fixture.contestant.accountId);
        } finally {
          await other.remove();
        }
      });

      it.each(['expired_login', 'expired_identity', 'revoked', 'generation', 'disabled', 'pending'])(
        'rolls back a new application login when %s changes at its final check', async (restriction) => {
          const target = fixture.contestant.accountId;
          const changes: Record<string, D1Statement> = {
            expired_login: stmt('UPDATE logins SET expires_at = unixepoch() - 1 WHERE account_id = ?', target),
            expired_identity: stmt("UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE userId = ?", target),
            revoked: stmt('UPDATE logins SET revoked = 1 WHERE account_id = ?', target),
            generation: stmt('UPDATE accounts SET credential_generation = credential_generation + 1 WHERE id = ?', target),
            disabled: stmt('UPDATE accounts SET disabled = 1 WHERE id = ?', target),
            pending: stmt("UPDATE accounts SET must_change = 1, credential_state = 'pending' WHERE id = ?", target),
          };
          let before: string | undefined;
          const racing = changeAtFinalGuard(changes[restriction]!, 1, async () => { before = await credentialEffects(); });
          await expectFailure(signIn(username, password, racing)).toMatchObject({ status: 409 });
          expect(before).toBeDefined();
          expect(await credentialEffects()).toBe(before);
        });

      it('rejects incorrect passwords and nonexistent usernames', async () => {
        await expectFailure(signIn(username, randomSecret())).toMatchObject({ status: 401 });
        await expectFailure(signIn(`absent_${randomSecret().slice(0, 15)}`)).toMatchObject({ status: 401 });
      });

      it('never verifies an old credential when the captured account is pending', async () => {
        await stmt("UPDATE accounts SET must_change = 1, credential_state = 'pending', credential_generation = credential_generation + 1 WHERE id = ?", fixture.contestant.accountId).run();
        let invoked = false;
        const racing: IdentityProvider = { ...identity, signIn: async (name, value) => {
          invoked = true;
          // This simulates a late identity-session insert after reset completion.
          await stmt("UPDATE accounts SET credential_state = 'ready' WHERE id = ?", fixture.contestant.accountId).run();
          return identity.signIn(name, value);
        } };
        await expectFailure(signIn(username, password, new D1AuthenticationService(db, racing, hasher))).toMatchObject({ status: 401 });
        expect(invoked).toBe(false);
      });
    }

    if (group === 'recovery') {
      it('keeps a lone organizer able to retry an interrupted self password change', async () => {
        await stmt('UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.staff.accountId).run();
        const interrupted = new D1AuthenticationService(db, identity, { ...hasher, hash: async () => { throw new Error('Interrupted self hash'); } });
        await expectFailure(interrupted.changePassword(adminHeaders, password, randomSecret())).toThrow('Interrupted self hash');
        expect((await service.current(adminHeaders))?.status.must_change).toBe(true);
        const changed = await service.changePassword(adminHeaders, password, randomSecret());
        expect((await service.current(new Headers({ cookie: changed.cookie.split(';')[0]! })))?.status.must_change).toBe(false);
      });

      it('recovers a committed self change after the database response is lost', async () => {
        const headers = await signIn();
        const replacement = randomSecret();
        const lostResponse: D1Connection = { prepare: (sql) => db.prepare(sql), batch: async (statements) => {
          await db.batch(statements);
          throw new Error('Committed response lost');
        } };
        await expectFailure(new D1AuthenticationService(lostResponse, identity, hasher).changePassword(headers, password, replacement)).toMatchObject({ status: 409 });
        expect(await service.current(headers)).toBeUndefined();
        expect((await service.current(await signIn(username, replacement)))?.status.must_change).toBe(false);
      });
    }

    if (group === 'completion') {
      it.each(['expired_login', 'generation', 'disabled', 'pending'])(
        'rolls back a self password change when %s changes after old sessions are revoked', async (restriction) => {
          const before = await credentialEffects();
          const replacement = randomSecret();
          const racing = changeAtFinalGuard(await actorRestriction(restriction));
          await expectFailure(racing.changePassword(adminHeaders, password, replacement)).toMatchObject({ status: 409 });
          expect(await credentialEffects()).toBe(before);
          expect((await service.current(adminHeaders))?.status.must_change).toBe(false);
          expect((await service.current(await signIn(`${username}_a`)))?.status.must_change).toBe(false);
        });

      // Register this clock probe only for local SQLite. Hosted cases above inject
      // expiry in the actual batch without depending on request latency.
      // The previous probe ran an 18 million row query so SQLite's clock would pass
      // a 1.5 second deadline. Workers Builds reported 10029 ms and failed the 5 second
      // default. This probe moves a test clock inside the same batch.
      if (!remote) {
        describe('local SQLite expiry clock', () => {
          it('rejects a self change whose original identity expires after its row is deliberately deleted', async () => {
            const replacement = randomSecret();
            const hash = await hasher.hash(replacement);
            const clock = 'minsky_auth_test_clock';
            // Keep this text identical to the production strftime('now') expression.
            const sqliteNow = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
            const now = Date.now();
            const started = new Date(now).toISOString();
            const deadline = new Date(now + 60 * 60 * 1000).toISOString();
            const expiredAt = new Date(now + 2 * 60 * 60 * 1000).toISOString();
            await stmt(`CREATE TABLE ${clock} (now TEXT NOT NULL)`).run();
            await stmt(`INSERT INTO ${clock} (now) VALUES (?)`, started).run();
            await stmt('UPDATE ba_session SET expiresAt = ? WHERE userId = ?', deadline, fixture.staff.accountId).run();
            const before = await credentialEffects();
            let checkedBeforeExpiry = false;
            let rewrites = 0;
            const racing = new D1AuthenticationService({
              prepare: (sql) => {
                const rewritten = sql.replaceAll(sqliteNow, `(SELECT now FROM ${clock})`);
                if (rewritten !== sql) rewrites += 1;
                return db.prepare(rewritten);
              },
              batch: async (statements) => {
                const live = await stmt(`SELECT expiresAt > ${sqliteNow} AS valid FROM ba_session WHERE userId = ?`, fixture.staff.accountId).first<{ valid: number }>();
                checkedBeforeExpiry = live?.valid === 1;
                const finalGuard = statements.length - 2;
                // The session row is already deleted in this transaction. Move the test
                // clock past the captured deadline before the final guard reads it.
                const advance = stmt(`UPDATE ${clock} SET now = ?`, expiredAt);
                return db.batch([...statements.slice(0, finalGuard), advance, ...statements.slice(finalGuard)]);
              },
            }, identity, { ...hasher, hash: async () => hash });
            try {
              await expectFailure(racing.changePassword(adminHeaders, password, replacement)).toMatchObject({
                status: 409,
                message: 'Account changed. Check its status before retrying.',
              });
              expect(checkedBeforeExpiry).toBe(true);
              expect(rewrites).toBeGreaterThan(0);
              expect(new Date().toISOString() < deadline).toBe(true);
              expect(await credentialEffects()).toBe(before);
              expect((await stmt('SELECT id FROM ba_session WHERE userId = ?', fixture.staff.accountId).all()).results).toHaveLength(1);
            } finally {
              await stmt(`DROP TABLE IF EXISTS ${clock}`).run();
            }
          });
        });
      }
    }

    if (group === 'sessions') {
      it('bounds password attempts and releases an expired rate window', async () => {
        const key = limitKey(username);
        await service.limit(key, 2);
        await service.limit(key, 2);
        await expectFailure(service.limit(key, 2)).toMatchObject({ status: 429 });
        await stmt('UPDATE authentication_limits SET window_start = unixepoch() - 901 WHERE key = ?', key).run();
        await service.limit(key, 2);
      });

      it('requires a live identity cookie rather than browser account data', async () => {
        expect(await service.current(new Headers())).toBeUndefined();
      });

      it('blocks temporary passwords at session and application reads', async () => {
        await stmt('UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.contestant.accountId).run();
        const headers = await signIn();
        const current = await service.current(headers);
        expect(current?.status.must_change).toBe(true);
        // An auth-only target can retain the earlier schema. Check application
        // reads when the complete schema exists.
        if (fullApplication) {
          await expectFailure(new D1ApplicationService(db).snapshot(current!.caller, fixture.sessionId))
            .toMatchObject({ status: 403 });
        }
      });

      it('changes a temporary password, rotates the cookie, and revokes every older login', async () => {
        await stmt('UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.contestant.accountId).run();
        const first = await signIn();
        const second = await signIn();
        const replacement = randomSecret();
        const result = await service.changePassword(first, password, replacement);
        const fresh = new Headers({ cookie: result.cookie.split(';')[0]! });
        expect((await service.current(fresh))?.status.must_change).toBe(false);
        expect(await service.current(first)).toBeUndefined();
        expect(await service.current(second)).toBeUndefined();
        await expectFailure(signIn()).toMatchObject({ status: 401 });
        expect((await service.current(await signIn(username, replacement)))?.user.id).toBe(fixture.contestant.accountId);
      });

      it('does not count a successful sign-in or password change toward the username limit', async () => {
        const key = limitKey(username);
        const attempts = async () => (await stmt('SELECT attempts FROM authentication_limits WHERE key = ?', key).first<{ attempts: number }>())?.attempts;
        await db.batch([
          stmt('UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.contestant.accountId),
          stmt('INSERT INTO authentication_limits (key, window_start, attempts) VALUES (?, unixepoch(), 9)', key),
        ]);
        const headers = await signIn();
        const replacement = randomSecret();
        const changed = await service.changePassword(headers, password, replacement);
        const fresh = new Headers({ cookie: changed.cookie.split(';')[0]! });

        expect((await service.current(fresh))?.status).toMatchObject({ must_change: false, session_valid: true });
        expect(await service.current(headers)).toBeUndefined();
        expect(await attempts()).toBe(9);
        // A failure is the tenth. The username then refuses even the correct password.
        await expectFailure(signIn()).toMatchObject({ status: 401 });
        expect(await attempts()).toBe(10);
        await expectFailure(signIn(username, replacement)).toMatchObject({ status: 429 });
        await stmt('UPDATE authentication_limits SET window_start = unixepoch() - 901 WHERE key = ?', key).run();
        expect((await service.current(await signIn(username, replacement)))?.user.id).toBe(fixture.contestant.accountId);
      });

      it('retains the separate password-change attempt limit for an authenticated login', async () => {
        const headers = await signIn();
        await stmt('INSERT INTO authentication_limits (key, window_start, attempts) VALUES (?, unixepoch(), 10)',
          `change:${fixture.contestant.accountId}`).run();
        await expectFailure(service.changePassword(headers, password, randomSecret())).toMatchObject({ status: 429 });
        expect((await service.current(headers))?.status.session_valid).toBe(true);
        expect((await stmt('SELECT count(*) AS n FROM account_operations WHERE account_id = ?', fixture.contestant.accountId).first<{ n: number }>())?.n).toBe(0);
      });

      it('rejects incorrect current passwords and unchanged passwords', async () => {
        const headers = await signIn();
        await expectFailure(service.changePassword(headers, randomSecret(), randomSecret())).toMatchObject({ status: 400 });
        await expectFailure(service.changePassword(headers, password, password)).toMatchObject({ status: 400 });
        expect((await service.current(headers))?.status.session_valid).toBe(true);
      });

      it('rejects equivalent Unicode passwords as a mandatory password change', async () => {
        const original = randomSecret() + '\u2460';
        await stmt("UPDATE ba_account SET password = ? WHERE userId = ? AND providerId = 'credential'", await hasher.hash(original), fixture.contestant.accountId).run();
        await stmt('UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.contestant.accountId).run();
        const headers = await signIn(username, original);
        await expectFailure(service.changePassword(headers, original, original.normalize('NFKC'))).toMatchObject({ status: 400 });
        expect((await service.current(headers))?.status.must_change).toBe(true);
      });

      it('logs out and rejects the copied old cookie', async () => {
        const headers = await signIn();
        expect((await service.signOut(headers)).cookie).toContain('Max-Age=0');
        expect(await service.current(headers)).toBeUndefined();
      });

      it.each(['logins', 'ba_session'])('rejects expired %s sessions', async (table) => {
        const headers = await signIn();
        const current = await service.current(headers);
        if (table === 'logins') await stmt('UPDATE logins SET expires_at = unixepoch() - 1 WHERE id = ?', current!.caller.loginId).run();
        else await stmt("UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE userId = ?", current!.user.id).run();
        expect(await service.current(headers)).toBeUndefined();
      });

      it('rejects explicit revocation and disabled accounts with copied cookies', async () => {
        const headers = await signIn();
        const current = await service.current(headers);
        await stmt('UPDATE logins SET revoked = 1 WHERE id = ?', current!.caller.loginId).run();
        expect(await service.current(headers)).toBeUndefined();
        const newHeaders = await signIn();
        await stmt('UPDATE accounts SET disabled = 1 WHERE id = ?', fixture.contestant.accountId).run();
        expect(await service.current(newHeaders)).toBeUndefined();
        await expectFailure(signIn()).toMatchObject({ status: 401 });
      });
    }

    if (group === 'recovery') {
      it('rejects an old password login that races a completed reset', async () => {
        const racingIdentity: IdentityProvider = { ...identity, signIn: async (name, value) => {
          const signed = await identity.signIn(name, value);
          await new D1ManageService(db, hasher).issueCredentials((await service.current(adminHeaders))!.caller, crypto.randomUUID(),
            { eventId: fixture.eventId, accountIds: [fixture.contestant.accountId], contestId: fixture.sessionId });
          return signed;
        } };
        await expectFailure(signIn(username, password, new D1AuthenticationService(db, racingIdentity, hasher))).toMatchObject({ status: 409 });
      });

      it('passes the shared temporary-authentication lifecycle scenario', async () => {
        await stmt('UPDATE accounts SET must_change = 1 WHERE id = ?', fixture.contestant.accountId).run();
        const handle = createAuthenticationHandler(service, { origins: [origin] });
        let cookie = '';
        const auth = createCloudflareAuthentication({
          origin,
          fetch: async (input, init) => {
            const request = new Request(input, init);
            if (cookie) request.headers.set('Cookie', cookie);
            if (request.method === 'POST') request.headers.set('Origin', origin);
            const response = await handle(request);
            const replacement = response.headers.get('Set-Cookie');
            if (replacement) cookie = replacement.split(';')[0]!;
            return response;
          },
        });
        await verifyTemporaryAuthentication(auth, { id: fixture.contestant.accountId, target: { kind: 'event', code: eventCode }, username, password }, {
          restricted: async () => { expect((await auth.accountStatus()).must_change).toBe(true); },
          ready: async () => { expect(await auth.accountStatus()).toMatchObject({ must_change: false, session_valid: true }); },
        });
      });
    }

  });
}
