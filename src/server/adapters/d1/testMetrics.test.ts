import { expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { D1Binding } from './connection';
import { measureD1 } from './testMetrics';
import { D1Fixture, applyMigrations } from './testFixture';
import { D1AuthenticationService } from '../cloudflare/authentication';
import { createBetterAuthIdentity } from '../cloudflare/identity';
import { passwordHasher, randomSecret } from '../cloudflare/password';

it('measures the real D1 transport without exposing data or changing batch rollback', async () => {
  const platform = await getPlatformProxy<{ DB: D1Binding }>({
    configPath: 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc', persist: false, remoteBindings: false, envFiles: [],
  });
  const lines: string[] = [];
  const metrics = measureD1(platform.env.DB, (line) => lines.push(line));
  const db = metrics.db;
  const secret = 'fixture-private-password-cookie';
  try {
    expect('exec' in db).toBe(true);
    await db.batch([db.prepare('CREATE TABLE measurements (id INTEGER PRIMARY KEY, value TEXT)')]);
    await db.prepare('INSERT INTO measurements VALUES (?, ?)').bind(1, secret).run();
    expect(await db.prepare('SELECT value FROM measurements WHERE id = ?').bind(1).first())
      .toEqual({ value: secret });
    const failure = db.batch([
      db.prepare('INSERT INTO measurements VALUES (?, ?)').bind(2, secret),
      db.prepare('INSERT INTO measurements VALUES (?, ?)').bind(1, secret),
    ]);
    await expect(failure).rejects.toThrow();
    expect((await db.prepare('SELECT id FROM measurements ORDER BY id').all()).results).toEqual([{ id: 1 }]);
    metrics.flush();
    const summary = JSON.parse(lines.at(-1)!.slice('MINSKY_D1_METRICS '.length));
    expect(summary).toMatchObject({ calls: 5, statements: 6, inFlight: 0 });
    expect(summary.wallMs).toBeGreaterThanOrEqual(0);
    expect(summary.sqlMs).toBeGreaterThanOrEqual(0);
    expect(lines.join('\n')).not.toContain(secret);
    expect(lines.join('\n')).not.toContain('SELECT');
    expect(lines.join('\n')).not.toContain('constraint');
  } finally {
    await platform.dispose();
  }
}, 120_000);

it('keeps native D1 capabilities used by the maintained identity adapter', async () => {
  const platform = await getPlatformProxy<{ DB: D1Binding }>({
    configPath: 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc', persist: false, remoteBindings: false, envFiles: [],
  });
  const lines: string[] = [];
  const { db } = measureD1(platform.env.DB, (line) => lines.push(line));
  const fixture = new D1Fixture(db, 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc');
  let created = false;
  const password = randomSecret();
  const username = `metrics_${fixture.eventId.replaceAll('-', '').slice(0, 20)}`;
  try {
    await applyMigrations(db);
    await fixture.create();
    created = true;
    const id = fixture.staff.accountId;
    const now = new Date().toISOString();
    await db.batch([
      fixture.statement('UPDATE accounts SET username = ? WHERE id = ?', username, id),
      fixture.statement(`INSERT INTO ba_user (id, name, username, email, emailVerified, createdAt, updatedAt)
        VALUES (?, 'Fictional measured identity', ?, ?, 1, ?, ?)`, id, username, `${username}@metrics.minsky.invalid`, now, now),
      fixture.statement(`INSERT INTO ba_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
        VALUES (?, ?, 'credential', ?, ?, ?, ?)`, crypto.randomUUID(), id, id, await passwordHasher.hash(password), now, now),
    ]);
    const identity = createBetterAuthIdentity(db, {
      origin: 'http://127.0.0.1:8788', secret: randomSecret(), secureCookies: false,
    });
    const service = new D1AuthenticationService(db, identity, passwordHasher);
    const signed = await service.signIn(username, password);
    const current = await service.current(new Headers({ cookie: signed.cookie.split(';')[0] }));
    expect(current?.user.id).toBe(id);
    expect(lines.join('\n')).not.toContain(password);
    expect(lines.join('\n')).not.toContain(signed.cookie);
  } finally {
    if (created) {
      await fixture.statement('DELETE FROM ba_user WHERE id = ?', fixture.staff.accountId).run();
      await fixture.statement('DELETE FROM authentication_limits WHERE key = ?', `username:${username}`).run();
      await fixture.cleanup();
    }
    await platform.dispose();
  }
}, 120_000);
