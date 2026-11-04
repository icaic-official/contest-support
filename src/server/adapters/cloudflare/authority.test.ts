import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../../../connected/model';
import type { Caller } from '../../authentication';
import { WorkflowService } from '../../workflow';
import type { D1Connection, D1Value } from '../d1/connection';
import { D1ApplicationStore } from '../d1/store';
import { applyMigrations } from '../d1/testFixture';
import { D1AnnouncementService } from './announcements';
import { D1ApplicationService } from './application';
import { authorityGuard, contestDataSql, resolveAuthority } from './authority';
import { D1ManageService } from './manage';
import { R2AvatarService } from './avatars';
import { R2ImageService, type PrivateBucket } from './images';
import { openStoreDatabase } from './tooling/store-database.mjs';

const configPath = 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';

/** What one person holds in one contest, as the readers report it. */
type Seat = 'none' | 'plain' | 'contestant' | { admin: boolean; roles: Role[] };

const people = ['webmaster', 'assignedWebmaster', 'eventAdmin', 'otherEventAdmin', 'contestAdmin', 'jury', 'volunteer',
  'specialist', 'plain', 'contestant', 'otherContestant', 'otherVolunteer', 'legacyVolunteer'] as const;
type Person = typeof people[number];
const contests = ['first', 'second', 'other'] as const;
type Contest = typeof contests[number];

const admin = (...roles: Role[]): Seat => ({ admin: true, roles });
const staff = (...roles: Role[]): Seat => ({ admin: false, roles });

/**
 * Two events. The first holds the contests `first` and `second`, the other
 * event holds `other`. Every person not named in a column has no seat there.
 * `legacyVolunteer` held memberships in both events before migration 0017,
 * which placed the account in the first event. Its membership in `other` stays
 * and grants nothing.
 */
const openSeats: Record<Contest, Partial<Record<Person, Seat>>> = {
  first: {
    webmaster: admin(), assignedWebmaster: admin('jury'), eventAdmin: admin(), contestAdmin: admin(),
    jury: staff('jury'), volunteer: staff('volunteer'), specialist: staff('specialist'), plain: 'plain', contestant: 'contestant',
    legacyVolunteer: staff('volunteer'),
  },
  second: { webmaster: admin(), assignedWebmaster: admin(), eventAdmin: admin(), legacyVolunteer: staff('volunteer') },
  other: { webmaster: admin(), assignedWebmaster: admin(), otherEventAdmin: admin(), otherContestant: 'contestant', otherVolunteer: staff('volunteer') },
};
const seatOf = (seats: typeof openSeats, contest: Contest, person: Person): Seat => seats[contest][person] ?? 'none';
const isStaff = (seat: Seat) => typeof seat === 'object';
/** The assigned staff of each contest, whose avatars every staff seat there reads. */
const assignedStaff: Record<Contest, Person[]> = {
  first: ['assignedWebmaster', 'contestAdmin', 'jury', 'volunteer', 'specialist', 'legacyVolunteer'],
  second: ['legacyVolunteer'],
  other: ['otherVolunteer', 'legacyVolunteer'],
};

describe('one authority resolver for every reader', () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  const callers = Object.fromEntries(people.map((person) => [person, { accountId: randomUUID(), loginId: randomUUID() }])) as Record<Person, Caller>;
  const ids = { event: randomUUID(), otherEvent: randomUUID(), team: randomUUID(), secondTeam: randomUUID(), otherTeam: randomUUID() };
  const teams: Record<Contest, string> = { first: ids.team, second: ids.secondTeam, other: ids.otherTeam };
  const contestIds = Object.fromEntries(contests.map((contest) => [contest, randomUUID()])) as Record<Contest, string>;
  const issues = new Map<Contest, { issue: string; image: string }>();
  const bucket: PrivateBucket = {
    get: async () => ({ size: 1, body: new Response('x').body!, arrayBuffer: async () => new ArrayBuffer(1) }),
    put: async () => null,
    delete: async () => {},
  };
  const run = (sql: string, ...values: D1Value[]) => db.prepare(sql).bind(...values).run();

  beforeAll(async () => {
    ({ db, dispose } = await openStoreDatabase({ configPath, remoteBindings: false }));
    await applyMigrations(db, (name) => name < '0017');
    const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
    await run('INSERT INTO events (id, name) VALUES (?, ?), (?, ?)', ids.event, 'First event', ids.otherEvent, 'Other event');
    await run(`INSERT INTO sessions (id, event_id, name, intake_open, categories) VALUES (?, ?, 'First', 1, '["Devices"]'),
      (?, ?, 'Second', 1, '["Devices"]'), (?, ?, 'Other', 1, '["Devices"]')`,
    contestIds.first, ids.event, contestIds.second, ids.event, contestIds.other, ids.otherEvent);
    // Distinct names: 0019 makes teams that share a name inside an event one entrant.
    for (const contest of contests) {
      await run("INSERT INTO teams (id, session_id, name, location) VALUES (?, ?, ?, 'A1')", teams[contest], contestIds[contest], `Team ${contest}`);
    }
    for (const person of people) {
      const { accountId, loginId } = callers[person];
      await run('INSERT INTO accounts (id, name, username, must_change) VALUES (?, ?, ?, 0)', accountId, `Fictional ${person}`, person.toLowerCase());
      await run(`INSERT INTO ba_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ${now}, ${now})`, accountId, person, `${accountId}@authority.minsky.invalid`);
      await run(`INSERT INTO ba_session (id, userId, token, expiresAt, createdAt, updatedAt)
        VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'), ${now}, ${now})`, loginId, accountId, randomUUID());
      await run('INSERT INTO logins (id, account_id, expires_at, identity_session_id) VALUES (?, ?, unixepoch() + 3600, ?)', loginId, accountId, loginId);
      await run(`INSERT INTO account_avatars (id, account_id, request_id, byte_size, content_type, digest, state, ready_at)
        VALUES (?, ?, ?, 1, 'image/png', ?, 'ready', ${now})`, randomUUID(), accountId, randomUUID(), 'a'.repeat(64));
    }
    for (const contest of contests) {
      await run('INSERT INTO memberships (session_id, account_id) VALUES (?, ?)', contestIds[contest], callers.legacyVolunteer.accountId);
      await run(`INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')`,
        contestIds[contest], callers.legacyVolunteer.accountId);
    }
    await applyMigrations(db, (name) => name >= '0017');
    for (const person of ['webmaster', 'assignedWebmaster'] as const) {
      await run(`INSERT INTO grants (account_id, scope, granted_by) VALUES (?, 'site', 'fixture')`, callers[person].accountId);
    }
    for (const [person, event] of [['eventAdmin', ids.event], ['otherEventAdmin', ids.otherEvent]] as const) {
      await run('UPDATE accounts SET event_id = ? WHERE id = ?', event, callers[person].accountId);
      await run(`INSERT INTO grants (account_id, scope, event_id, granted_by) VALUES (?, 'event', ?, 'fixture')`, callers[person].accountId, event);
    }
    const seat = async (contest: Contest, person: Person, team: string | null, isAdmin: boolean, roles: Role[] = []) => {
      await run('INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, ?, ?)',
        contestIds[contest], callers[person].accountId, team, Number(isAdmin));
      for (const role of roles) {
        await run('INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, ?)', contestIds[contest], callers[person].accountId, role);
      }
    };
    await seat('first', 'assignedWebmaster', null, false, ['jury']);
    await seat('first', 'contestAdmin', null, true);
    await seat('first', 'jury', null, false, ['jury']);
    await seat('first', 'volunteer', null, false, ['volunteer']);
    await seat('first', 'specialist', null, false, ['specialist']);
    await seat('first', 'plain', null, false);
    await seat('first', 'contestant', ids.team, false);
    await seat('other', 'otherContestant', ids.otherTeam, false);
    await seat('other', 'otherVolunteer', null, false, ['volunteer']);
    for (const contest of contests) {
      const team = teams[contest];
      const issue = randomUUID();
      const image = randomUUID();
      await run(`INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at)
        VALUES (?, ?, ?, 'open', 1, ?, 'Fictional', 'Devices', 'Fictional issue', ${now})`, issue, contestIds[contest], team, callers.webmaster.accountId);
      await run(`INSERT INTO issue_images (id, session_id, issue_id, uploader, request_id, uploader_name, uploaded_at, visibility,
          declared_bytes, byte_size, content_type, original_name, state, original_path, thumbnail_path)
        VALUES (?, ?, ?, ?, ?, 'Fictional', ${now}, 'public', 1, 1, 'image/png', 'a.png', 'ready', ?, ?)`,
      image, contestIds[contest], issue, callers.webmaster.accountId, randomUUID(),
      `${contestIds[contest]}/${issue}/${image}/original`, `${contestIds[contest]}/${issue}/${image}/thumbnail`);
      issues.set(contest, { issue, image });
    }
  });
  afterAll(async () => { await dispose?.(); });

  const application = () => new D1ApplicationService(db);

  /** The seat that each reader reports, or 'none' when the reader refuses. */
  async function readers(person: Person, contest: Contest) {
    const caller = callers[person];
    const contestId = contestIds[contest];
    const snapshot = await application().snapshot(caller, contestId).catch(() => undefined);
    const listed = (await application().contests(caller)).some((summary) => summary.id === contestId);
    const announcements = await new D1AnnouncementService(db).snapshot(caller, contestId).then(() => true, () => false);
    const avatars = await new R2AvatarService(db, bucket).list(caller, contestId);
    const { issue, image } = issues.get(contest) ?? { issue: '', image: '' };
    const imageRead = await new R2ImageService(db, bucket).download(caller, `${contestId}/${issue}/${image}/original`)
      .then(async (download) => { await download.body.cancel(); return true; }, () => false);
    const live = (await db.prepare(contestDataSql('logins')).bind(contestId, JSON.stringify([caller.loginId]))
      .all<{ staff: number; team_id: string | null }>()).results.filter((row) => row.staff || row.team_id).length === 1;
    const membership = snapshot?.membership;
    const seat: Seat = !membership ? 'none' : membership.team_id ? 'contestant'
      : membership.is_admin || membership.roles.length ? { admin: membership.is_admin, roles: [...membership.roles] } : 'plain';
    return { seat, listed, announcements, avatars: avatars.map((avatar) => avatar.person_id).sort(), imageRead, live };
  }

  function expected(person: Person, contest: Contest, seat: Seat) {
    const owners = new Set([person, ...(isStaff(seat) ? assignedStaff[contest] : [])]);
    return {
      seat, listed: seat !== 'none', announcements: seat !== 'none',
      avatars: [...owners].map((owner) => callers[owner].accountId).sort(),
      imageRead: isStaff(seat) || seat === 'contestant', live: isStaff(seat) || seat === 'contestant',
    };
  }

  async function submits(person: Person, contest: Contest): Promise<boolean> {
    const command = person === 'contestant' || person === 'otherContestant'
      ? { type: 'submit' as const, category: 'Devices', description: 'Fictional report' }
      : { type: 'submit' as const, category: 'Devices', description: 'Fictional report', team_id: teams[contest] };
    const result = await new WorkflowService(new D1ApplicationStore(db)).execute(callers[person], contestIds[contest], randomUUID(), command);
    return result.outcome === 'committed';
  }

  async function setsIntake(person: Person, contest: Contest): Promise<boolean> {
    return new D1ManageService(db, { hash: async () => '', verify: async () => false })
      .execute(callers[person], randomUUID(), { type: 'set_intake', contestId: contestIds[contest], mode: 'open' }).then(() => true, () => false);
  }

  it('gives every reader the same seat for every person in every contest', async () => {
    for (const contest of contests) {
      for (const person of people) {
        expect(await readers(person, contest), `${person} in ${contest}`).toEqual(expected(person, contest, seatOf(openSeats, contest, person)));
      }
    }
  });

  it('lets staff seats and contestants submit, and nobody across events', async () => {
    for (const contest of contests) {
      for (const person of people) {
        const seat = seatOf(openSeats, contest, person);
        expect(await submits(person, contest), `${person} in ${contest}`).toBe(isStaff(seat) || seat === 'contestant');
      }
    }
  });

  it('lets contest admins, event admins, and webmasters change contest settings, and nobody across events', async () => {
    for (const contest of contests) {
      for (const person of people) {
        const seat = seatOf(openSeats, contest, person);
        expect(await setsIntake(person, contest), `${person} in ${contest}`).toBe(typeof seat === 'object' && seat.admin);
      }
    }
  });

  describe('while the site restricts webmaster reads', () => {
    beforeAll(async () => {
      await run(`INSERT INTO site_settings (singleton, restrict_webmaster_reads, changed_by) VALUES (1, 1, ?)`, callers.webmaster.accountId);
    });

    it('gives a webmaster no contest data until a join, even with an assigned role', async () => {
      for (const person of ['webmaster', 'assignedWebmaster'] as const) {
        for (const contest of contests) {
          expect(await readers(person, contest), `${person} in ${contest}`).toEqual(expected(person, contest, 'none'));
          expect(await submits(person, contest), `${person} submits in ${contest}`).toBe(false);
        }
      }
      for (const person of people.filter((name) => !name.endsWith('ebmaster'))) {
        expect(await readers(person, 'first'), person).toEqual(expected(person, 'first', seatOf(openSeats, 'first', person)));
      }
    });

    it('keeps a webmaster structure authority without a join', async () => {
      expect(await setsIntake('webmaster', 'other')).toBe(true);
      expect(await setsIntake('assignedWebmaster', 'first')).toBe(true);
    });

    it('opens one contest after an audited join that the contest admins see', async () => {
      await run(`INSERT INTO grants (account_id, scope, session_id, granted_by) VALUES (?, 'contest', ?, ?)`,
        callers.assignedWebmaster.accountId, contestIds.first, callers.assignedWebmaster.accountId);
      expect(await readers('assignedWebmaster', 'first')).toEqual(expected('assignedWebmaster', 'first', admin('jury')));
      expect(await readers('assignedWebmaster', 'second')).toEqual(expected('assignedWebmaster', 'second', 'none'));
      const audit = (await application().snapshot(callers.contestAdmin, contestIds.first)).audit;
      expect(audit).toContainEqual(expect.objectContaining({ action: 'webmaster_join', actor: callers.assignedWebmaster.accountId }));
      const site = await db.prepare(`SELECT count(*) AS n FROM authority_audit WHERE event_id IS NULL AND action = 'webmaster_join' AND target = ?`)
        .bind(contestIds.first).first<{ n: number }>();
      expect(site?.n).toBe(1);
    });

    it('refuses a webmaster write whose authority predates a change of the setting', async () => {
      const authority = await resolveAuthority(db, callers.webmaster, { scope: 'contest', contestId: contestIds.second });
      await run('UPDATE site_settings SET restrict_webmaster_reads = 0');
      expect(await readers('webmaster', 'second')).toEqual(expected('webmaster', 'second', admin()));
      await expect(db.batch([authorityGuard(db, randomUUID(), authority!)])).rejects.toThrow(/CHECK constraint failed/);
      const current = await resolveAuthority(db, callers.webmaster, { scope: 'contest', contestId: contestIds.second });
      const id = randomUUID();
      await db.batch([authorityGuard(db, id, current!), db.prepare('DELETE FROM command_assertions WHERE id = ?').bind(id)]);
    });
  });

  it('refuses to remove or disable the last enabled webmaster', async () => {
    await run(`DELETE FROM grants WHERE account_id = ? AND scope = 'site'`, callers.webmaster.accountId);
    await expect(run(`DELETE FROM grants WHERE account_id = ? AND scope = 'site'`, callers.assignedWebmaster.accountId))
      .rejects.toThrow(/last webmaster/);
    await expect(run('UPDATE accounts SET disabled = 1 WHERE id = ?', callers.assignedWebmaster.accountId)).rejects.toThrow(/last webmaster/);
  });
});
