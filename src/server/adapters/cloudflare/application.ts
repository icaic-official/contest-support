import { z } from 'zod';
import type { MembershipInput, RosterCommand, SessionSummary } from '../../../backend/contracts';
import { rosterCommandSchema, rosterKey } from '../../../connected/roster';
import { snapshotSchema, type Snapshot } from '../../../connected/model';
import type { Caller } from '../../authentication';
import { AuthenticationError } from '../../authentication';
import type { D1Connection, D1Statement } from '../d1/connection';

type BindValue = string | number | null;

export interface CurrentAccessRow {
  account_id: string;
  account_name: string;
  login_id: string;
  login_expires_at: number;
  identity_expires_at: string;
  access_version: number;
  credential_generation: number;
  login_version: number;
  membership_version: number;
  session_version: number;
  event_version: number;
  archived: number;
  team_id: string | null;
  is_admin: number;
  staff: number;
  roles: string;
}

// Every use checks both identity-session and application-login expiry against
// database time, including inside write batches.
const accessSql = (selection: string) => `SELECT a.id AS account_id, a.name AS account_name, l.id AS login_id,
  l.expires_at AS login_expires_at, b.expiresAt AS identity_expires_at,
  a.access_version, a.credential_generation, l.version AS login_version,
  m.version AS membership_version, s.version AS session_version,
  e.version AS event_version, e.archived, m.team_id, m.is_admin,
  (m.team_id IS NULL AND (m.is_admin = 1 OR EXISTS (
    SELECT 1 FROM membership_roles mr WHERE mr.session_id = m.session_id
      AND mr.account_id = m.account_id))) AS staff,
  (SELECT json_group_array(role) FROM (SELECT role FROM membership_roles mr
    WHERE mr.session_id = m.session_id AND mr.account_id = m.account_id ORDER BY role)) AS roles
  FROM accounts a JOIN logins l ON l.account_id = a.id
  JOIN ba_session b ON b.id = l.identity_session_id AND b.userId = a.id
  JOIN memberships m ON m.account_id = a.id
  JOIN sessions s ON s.id = m.session_id JOIN events e ON e.id = s.event_id
  WHERE ${selection}
    AND a.disabled = 0 AND a.must_change = 0 AND a.credential_state = 'ready'
    AND l.revoked = 0 AND l.expires_at > unixepoch()
    AND l.credential_generation = a.credential_generation
    AND b.expiresAt > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

// Bind accountId, loginId, sessionId in this order. Callers must come from the
// trusted authentication service.
export const currentAccessSql = accessSql('a.id = ? AND l.id = ? AND m.session_id = ?');

// Bind sessionId, then a JSON array of login IDs. One JSON value stays under
// D1's 100 bound-parameter limit. Match each row on account_id and login_id.
export const currentAccessForLoginsSql = accessSql('m.session_id = ? AND l.id IN (SELECT value FROM json_each(?))');

export function currentAccessBindings(caller: Caller, sessionId: string): BindValue[] {
  return [caller.accountId, caller.loginId, sessionId];
}

const memberSchema = z.object({
  teamId: z.string().uuid().nullable(),
  roles: z.array(z.enum(['volunteer', 'specialist', 'jury'])).max(3),
  isAdmin: z.boolean(),
}).strict().refine((member) => member.teamId
  ? member.roles.length === 0 && !member.isAdmin
  : member.roles.length > 0 || member.isAdmin);
const limitsSchema = z.object({
  fileMegabytes: z.number().int().min(1).max(50),
  count: z.number().int().min(1).max(24),
  totalMegabytes: z.number().int().min(1).max(120),
}).strict().refine((limits) => limits.fileMegabytes <= limits.totalMegabytes);

/** Bind accountId, loginId. This check also works after an authorized self-removal. */
export const currentReadyLoginSql = `SELECT a.id FROM accounts a JOIN logins l ON l.account_id = a.id
  JOIN ba_session b ON b.id = l.identity_session_id AND b.userId = a.id
  WHERE a.id = ? AND l.id = ? AND a.disabled = 0 AND a.must_change = 0
    AND a.credential_state = 'ready' AND l.revoked = 0 AND l.expires_at > unixepoch()
    AND l.credential_generation = a.credential_generation
    AND b.expiresAt > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

export function currentReadyLoginBindings(caller: Caller): BindValue[] {
  return [caller.accountId, caller.loginId];
}

interface AdminGate { id: string; caller: Caller; statements: D1Statement[] }

export const snapshotSql = `WITH login AS (${currentReadyLoginSql}), access AS MATERIALIZED (${currentAccessSql}),
  visible_issues AS MATERIALIZED (
    SELECT i.* FROM access a CROSS JOIN issues i WHERE i.session_id = ? AND i.team_id = a.team_id
    UNION ALL SELECT i.* FROM access a CROSS JOIN issues i WHERE a.staff = 1 AND i.session_id = ?)
SELECT json_object(
  'session', (SELECT json_object('id', s.id, 'event_id', s.event_id, 'name', s.name,
    'intake_open', json(CASE WHEN s.intake_open THEN 'true' ELSE 'false' END),
    'categories', json(s.categories), 'revision', s.version,
    'max_image_bytes', s.max_image_bytes, 'max_images_per_issue', s.max_images_per_issue,
    'max_image_bytes_per_issue', s.max_image_bytes_per_issue) FROM sessions s WHERE s.id = ? AND EXISTS (SELECT 1 FROM access)),
  'event', (SELECT json_object('id', e.id, 'name', e.name,
    'archived', json(CASE WHEN e.archived THEN 'true' ELSE 'false' END))
    FROM events e JOIN sessions s ON s.event_id = e.id WHERE s.id = ? AND EXISTS (SELECT 1 FROM access)),
  'membership', (SELECT json_object('session_id', ?, 'user_id', account_id,
    'team_id', team_id, 'roles', json(roles), 'is_admin', json(CASE WHEN is_admin THEN 'true' ELSE 'false' END)) FROM access),
  'teams', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', t.id, 'session_id', t.session_id, 'name', t.name, 'location', t.location) AS row
    FROM teams t CROSS JOIN access a WHERE t.session_id = ? AND (a.staff = 1 OR t.id = a.team_id) ORDER BY t.name, t.id)), '[]')),
  'issues', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', i.id, 'number', i.number, 'session_id', i.session_id,
      'team_id', i.team_id, 'reporter', i.reporter, 'reporter_name', i.reporter_name,
      'category', i.category, 'description', i.description, 'status', i.status,
      'created_at', i.created_at, 'first_assigned_at', i.first_assigned_at,
      'owner', i.owner, 'owner_name', i.owner_name, 'resolved_at', i.resolved_at,
      'revision', i.public_revision) AS row FROM visible_issues i ORDER BY i.number DESC, i.id)), '[]')),
  'resolutions', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', r.id, 'session_id', r.session_id, 'issue_id', r.issue_id,
      'actor', r.actor, 'actor_name', r.actor_name, 'at', r.at, 'summary', r.summary,
      'reopened_at', r.reopened_at, 'reopened_by', r.reopened_by,
      'reopened_name', r.reopened_name, 'reason', r.reason) AS row
    FROM resolutions r JOIN visible_issues i ON i.id = r.issue_id ORDER BY r.at, r.id)), '[]')),
  'history', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', h.id, 'issue_id', h.issue_id, 'at', h.at,
      'actor', h.actor, 'actor_name', h.actor_name, 'text', h.text, 'visibility', h.visibility) AS row
    FROM history h JOIN visible_issues i ON i.id = h.issue_id CROSS JOIN access a
    WHERE h.visibility = 'public' OR a.staff = 1 ORDER BY h.at, h.id)), '[]')),
  'awards', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', w.id, 'issue_id', w.issue_id, 'resolution_id', w.resolution_id,
      'minutes', w.minutes, 'explanation', w.explanation, 'actor_name', w.actor_name,
      'at', w.at, 'applied_at', w.applied_at, 'applied_name', w.applied_name) AS row
    FROM awards w JOIN visible_issues i ON i.id = w.issue_id ORDER BY w.at, w.id)), '[]')),
  'attachments', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', x.id, 'issue_id', x.issue_id, 'uploader', x.uploader,
      'uploader_name', x.uploader_name, 'uploaded_at', x.uploaded_at,
      'visibility', x.visibility, 'byte_size', x.byte_size, 'content_type', x.content_type,
      'original_name', x.original_name) AS row
    FROM visible_issues i CROSS JOIN issue_images x CROSS JOIN access a
    WHERE x.issue_id = i.id AND x.state = 'ready' AND (x.visibility = 'public' OR a.staff = 1)
    ORDER BY x.uploaded_at, x.id)), '[]')),
  'pending_removals', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', x.id, 'issue_id', x.issue_id, 'original_name', x.original_name) AS row
    FROM issue_images x CROSS JOIN access a WHERE x.session_id = ? AND a.staff = 1
      AND x.state IN ('deleting', 'deleted') AND x.files_removed_at IS NULL AND x.deleted_by = a.account_id
    ORDER BY x.deleted_at, x.id)), '[]')),
  'members', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('membership', json_object('session_id', m.session_id, 'user_id', m.account_id,
      'team_id', m.team_id, 'roles', json((SELECT json_group_array(role) FROM (SELECT role
        FROM membership_roles mr WHERE mr.session_id = m.session_id AND mr.account_id = m.account_id ORDER BY role))),
      'is_admin', json(CASE WHEN m.is_admin THEN 'true' ELSE 'false' END)),
      'person', json_object('id', p.id, 'name', p.name, 'username', p.username)) AS row
    FROM access a CROSS JOIN memberships m JOIN accounts p ON p.id = m.account_id
    WHERE a.is_admin = 1 AND m.session_id = ? ORDER BY p.name, p.id)), '[]')),
  'audit', json(COALESCE((SELECT json_group_array(json(row)) FROM (
    SELECT json_object('id', d.id, 'actor', d.actor, 'at', d.at, 'action', d.action, 'target', d.target) AS row
    FROM admin_audit d CROSS JOIN access a WHERE d.session_id = ? AND a.is_admin = 1
    ORDER BY d.at DESC, d.id DESC LIMIT 50)), '[]')),
  'server_time', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
) AS snapshot WHERE EXISTS (SELECT 1 FROM login)`;

/** Appends opaque invalidations to the same transaction as the changed data. */
export function notificationStatements(db: D1Connection, sessionId: string, audiences: readonly string[]): D1Statement[] {
  return [...new Set(audiences)].flatMap((audience) => [
    db.prepare(`INSERT INTO audience_sequences (session_id, audience, sequence) VALUES (?, ?, 1)
      ON CONFLICT(session_id, audience) DO UPDATE SET sequence = sequence + 1`).bind(sessionId, audience),
    db.prepare(`INSERT INTO notifications (id, session_id, audience, sequence)
      SELECT ?, session_id, audience, sequence FROM audience_sequences WHERE session_id = ? AND audience = ?`)
      .bind(crypto.randomUUID(), sessionId, audience),
  ]);
}

/** Bind accountId, loginId. */
export const sessionsListSql = `SELECT s.id, s.name FROM sessions s
  JOIN memberships m ON m.session_id = s.id JOIN accounts a ON a.id = m.account_id
  JOIN logins l ON l.account_id = a.id
  JOIN ba_session b ON b.id = l.identity_session_id AND b.userId = a.id
  WHERE a.id = ? AND l.id = ? AND a.disabled = 0 AND a.must_change = 0
    AND a.credential_state = 'ready' AND l.revoked = 0 AND l.expires_at > unixepoch()
    AND l.credential_generation = a.credential_generation
    AND b.expiresAt > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ORDER BY s.name, s.id`;

/** D1 owns current access, consistent snapshots, and atomic administration. */
export class D1ApplicationService {
  constructor(private readonly db: D1Connection) {}

  private statement(sql: string, ...values: BindValue[]): D1Statement {
    return this.db.prepare(sql).bind(...values);
  }

  private validIds(sessionId: string, userId?: string): void {
    if (!z.string().uuid().safeParse(sessionId).success ||
        (userId !== undefined && !z.string().uuid().safeParse(userId).success)) {
      throw new AuthenticationError(400, 'Invalid session or account.');
    }
  }

  async sessions(caller: Caller): Promise<SessionSummary[]> {
    const result = await this.statement(sessionsListSql, caller.accountId, caller.loginId).all<SessionSummary>();
    return result.results;
  }

  async snapshot(caller: Caller, sessionId: string): Promise<Snapshot> {
    this.validIds(sessionId);
    const row = await this.statement(snapshotSql, caller.accountId, caller.loginId, ...currentAccessBindings(caller, sessionId),
      ...Array<string>(9).fill(sessionId)).first<{ snapshot: string }>();
    if (!row) throw new AuthenticationError(403, 'Sign in again or change your temporary password.');
    return snapshotSchema.parse(JSON.parse(row.snapshot));
  }

  private assertion(id: string, sql: string, ...values: BindValue[]): D1Statement {
    return this.statement(`INSERT INTO command_assertions (id, valid)
      VALUES (?, CASE WHEN EXISTS (${sql}) THEN 1 ELSE 0 END)`, id, ...values);
  }

  private async adminGate(caller: Caller, sessionId: string): Promise<AdminGate> {
    const current = await this.statement(currentAccessSql, ...currentAccessBindings(caller, sessionId)).first<CurrentAccessRow>();
    const event = await this.statement(`SELECT e.archived FROM events e JOIN sessions s ON s.event_id = e.id WHERE s.id = ?`, sessionId)
      .first<{ archived: number }>();
    if (!current?.is_admin || event?.archived !== 0) {
      throw new AuthenticationError(403, 'Admin membership in an active event is required.');
    }
    const id = crypto.randomUUID();
    return { id, caller, statements: [this.assertion(id, `SELECT 1 FROM (${currentAccessSql})
      WHERE is_admin = 1 AND access_version = ? AND credential_generation = ?
        AND login_version = ? AND membership_version = ? AND session_version = ? AND event_version = ?
        AND EXISTS (SELECT 1 FROM events e JOIN sessions s ON s.event_id = e.id WHERE s.id = ? AND e.archived = 0)`,
    ...currentAccessBindings(caller, sessionId), current.access_version, current.credential_generation,
    current.login_version, current.membership_version, current.session_version, current.event_version, sessionId)] };
  }

  private async commit(gate: AdminGate, statements: D1Statement[]): Promise<void> {
    try {
      await this.db.batch([...gate.statements, ...statements,
        // Time can advance between D1 batch statements. Recheck credentials
        // after the writes, without requiring a membership just removed by its owner.
        this.assertion(`${gate.id}:access`, currentReadyLoginSql, ...currentReadyLoginBindings(gate.caller)),
        this.statement('DELETE FROM command_assertions WHERE id IN (?, ?)', gate.id, `${gate.id}:access`)]);
    } catch (error) {
      const rejected = error instanceof Error && /(?:CHECK|UNIQUE|FOREIGN KEY|NOT NULL) constraint failed/.test(error.message);
      throw new AuthenticationError(409, rejected
        ? 'The session or account changed. Refresh before retrying.'
        : 'The request outcome is unknown. Refresh before retrying.');
    }
  }

  private audit(sessionId: string, actor: string, action: string, target: string | null, detail: object): D1Statement {
    return this.statement('INSERT INTO admin_audit (id, session_id, actor, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), sessionId, actor, action, target, JSON.stringify(detail));
  }

  private async sessionAudiences(sessionId: string): Promise<string[]> {
    const teams = await this.statement('SELECT id FROM teams WHERE session_id = ?', sessionId).all<{ id: string }>();
    return ['staff', ...teams.results.map((team) => `team:${team.id}`)];
  }

  async setIntake(caller: Caller, sessionId: string, open: boolean): Promise<void> {
    this.validIds(sessionId);
    if (typeof open !== 'boolean') throw new AuthenticationError(400, 'Choose intake state.');
    const gate = await this.adminGate(caller, sessionId);
    await this.commit(gate, [
      this.statement('UPDATE sessions SET intake_open = ? WHERE id = ?', Number(open), sessionId),
      this.audit(sessionId, caller.accountId, 'set_intake', null, { open }),
      ...notificationStatements(this.db, sessionId, await this.sessionAudiences(sessionId)),
    ]);
  }

  async setImageLimits(caller: Caller, sessionId: string, input: {
    fileMegabytes: number; count: number; totalMegabytes: number;
  }): Promise<void> {
    this.validIds(sessionId);
    const parsed = limitsSchema.safeParse(input);
    if (!parsed.success) throw new AuthenticationError(400, 'Choose valid image limits: 1 to 50 MB per image, 1 to 24 images, and 1 to 120 MB per issue.');
    const limits = parsed.data;
    const gate = await this.adminGate(caller, sessionId);
    await this.commit(gate, [
      this.statement(`UPDATE sessions SET max_image_bytes = ?, max_images_per_issue = ?,
        max_image_bytes_per_issue = ? WHERE id = ?`, limits.fileMegabytes * 1048576,
      limits.count, limits.totalMegabytes * 1048576, sessionId),
      this.audit(sessionId, caller.accountId, 'set_image_limits', null,
        { file_mb: limits.fileMegabytes, count: limits.count, total_mb: limits.totalMegabytes }),
      ...notificationStatements(this.db, sessionId, await this.sessionAudiences(sessionId)),
    ]);
  }

  /**
   * Edits the teams and categories of a session. Every rule is checked twice.
   * A read first gives a clear message. A guard inside the same batch then
   * covers a write that lands between the read and the commit.
   */
  async editRoster(caller: Caller, sessionId: string, input: unknown): Promise<void> {
    this.validIds(sessionId);
    const parsed = rosterCommandSchema.safeParse(input);
    if (!parsed.success) {
      throw new AuthenticationError(400, 'Use different names of 1 to 200 characters. A team location can be empty.');
    }
    const command = parsed.data;
    const gate = await this.adminGate(caller, sessionId);
    const guardIds: string[] = [];
    const guards = (...checks: Array<[string, ...BindValue[]]>) => checks.map(([sql, ...values]) => {
      guardIds.push(crypto.randomUUID());
      return this.assertion(guardIds.at(-1)!, sql, ...values);
    });
    const changes = await this.rosterChanges(sessionId, command, guards);
    await this.commit(gate, [
      ...changes.statements,
      this.statement('DELETE FROM command_assertions WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(guardIds)),
      this.audit(sessionId, caller.accountId, command.type, null, changes.detail),
      ...notificationStatements(this.db, sessionId, changes.audiences ?? await this.sessionAudiences(sessionId)),
    ]);
  }

  private async rosterChanges(
    sessionId: string,
    command: RosterCommand,
    guards: (...checks: Array<[string, ...BindValue[]]>) => D1Statement[],
  ): Promise<{ statements: D1Statement[]; detail: object; audiences?: string[] }> {
    const teams = (await this.statement('SELECT id, name FROM teams WHERE session_id = ?', sessionId)
      .all<{ id: string; name: string }>()).results;
    const sameName = (name: string, exceptIds: ReadonlySet<string>) =>
      teams.find((team) => !exceptIds.has(team.id) && rosterKey(team.name) === rosterKey(name));
    const noClash = `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM teams a JOIN teams b ON b.session_id = a.session_id
      AND b.id <> a.id AND lower(trim(b.name)) = lower(trim(a.name)) WHERE a.session_id = ? AND a.id IN (SELECT value FROM json_each(?)))`;
    switch (command.type) {
      case 'add_teams': {
        const ids = new Set(command.teams.map((team) => team.id));
        const clash = command.teams.find((team) => sameName(team.name, ids));
        if (clash) throw new AuthenticationError(409, `A team named "${clash.name}" already exists.`);
        const idList = JSON.stringify([...ids]);
        return {
          detail: { count: command.teams.length },
          audiences: ['staff'],
          statements: [
            // A repeated request keeps its first rows. The guards below fail when an ID belongs to another session.
            this.statement(`INSERT INTO teams (id, session_id, name, location)
              SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.name'), json_extract(value, '$.location')
              FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING`, sessionId, JSON.stringify(command.teams)),
            ...guards(
              ['SELECT 1 WHERE (SELECT count(*) FROM teams WHERE session_id = ? AND id IN (SELECT value FROM json_each(?))) = ?',
                sessionId, idList, ids.size],
              [noClash, sessionId, idList],
            ),
          ],
        };
      }
      case 'update_team': {
        const current = teams.find((team) => team.id === command.teamId);
        if (!current) throw new AuthenticationError(409, 'That team no longer exists. Refresh the page.');
        if (sameName(command.name, new Set([command.teamId]))) {
          throw new AuthenticationError(409, `A team named "${command.name}" already exists.`);
        }
        return {
          detail: { team: command.teamId, from: current.name, name: command.name, location: command.location },
          audiences: ['staff', `team:${command.teamId}`],
          statements: [
            this.statement('UPDATE teams SET name = ?, location = ? WHERE id = ? AND session_id = ?',
              command.name, command.location, command.teamId, sessionId),
            ...guards(['SELECT 1 WHERE changes() = 1'], [noClash, sessionId, JSON.stringify([command.teamId])]),
          ],
        };
      }
      case 'delete_team': {
        const current = teams.find((team) => team.id === command.teamId);
        if (!current) throw new AuthenticationError(409, 'That team no longer exists. Refresh the page.');
        const used = await this.statement(`SELECT
          (SELECT count(*) FROM issues WHERE session_id = ?1 AND team_id = ?2) AS issues,
          (SELECT count(*) FROM memberships WHERE session_id = ?1 AND team_id = ?2) AS accounts`, sessionId, command.teamId)
          .first<{ issues: number; accounts: number }>();
        if (used?.issues) {
          throw new AuthenticationError(409, `${current.name} has ${used.issues} ${used.issues === 1 ? 'issue' : 'issues'} and stays in the roster.`);
        }
        if (used?.accounts) {
          throw new AuthenticationError(409, `${used.accounts} ${used.accounts === 1 ? 'account belongs' : 'accounts belong'} to ${current.name}. Move or remove ${used.accounts === 1 ? 'it' : 'them'} first.`);
        }
        return {
          detail: { team: command.teamId, name: current.name },
          audiences: ['staff'],
          statements: [
            ...guards(['SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM issues WHERE session_id = ? AND team_id = ?) AND NOT EXISTS (SELECT 1 FROM memberships WHERE session_id = ? AND team_id = ?)',
              sessionId, command.teamId, sessionId, command.teamId]),
            this.statement('DELETE FROM teams WHERE id = ? AND session_id = ?', command.teamId, sessionId),
            ...guards(['SELECT 1 WHERE changes() = 1']),
          ],
        };
      }
      case 'set_categories': {
        const kept = new Set(command.categories);
        const used = (await this.statement(`SELECT category, count(*) AS issues FROM issues
          WHERE session_id = ? AND category <> '' GROUP BY category ORDER BY category`, sessionId)
          .all<{ category: string; issues: number }>()).results;
        const stuck = used.filter((row) => !kept.has(row.category));
        if (stuck.length) {
          const [first] = stuck;
          throw new AuthenticationError(409, `${first.category} has ${first.issues} ${first.issues === 1 ? 'issue' : 'issues'} and stays in the list.${
            stuck.length > 1 ? ` ${stuck.length - 1} more ${stuck.length === 2 ? 'category stays' : 'categories stay'} too.` : ''}`);
        }
        return {
          detail: { categories: command.categories },
          statements: [
            this.statement('UPDATE sessions SET categories = ? WHERE id = ?', JSON.stringify(command.categories), sessionId),
            ...guards(['SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM issues WHERE session_id = ? AND category <> \'\' AND category NOT IN (SELECT value FROM json_each(?)))',
              sessionId, JSON.stringify(command.categories)]),
          ],
        };
      }
    }
  }

  async saveMember(caller: Caller, sessionId: string, userId: string, input: MembershipInput): Promise<void> {
    const parsed = memberSchema.safeParse(input);
    if (!parsed.success) throw new AuthenticationError(400, 'Choose a contestant team or staff roles or admin membership.');
    await this.manageMember(caller, sessionId, userId, parsed.data);
  }

  async removeMember(caller: Caller, sessionId: string, userId: string): Promise<void> {
    await this.manageMember(caller, sessionId, userId, undefined);
  }

  private async manageMember(caller: Caller, sessionId: string, userId: string, input: MembershipInput | undefined): Promise<void> {
    this.validIds(sessionId, userId);
    const gate = await this.adminGate(caller, sessionId);
    const prior = await this.statement('SELECT team_id FROM memberships WHERE session_id = ? AND account_id = ?', sessionId, userId)
      .first<{ team_id: string | null }>();
    const guardId = crypto.randomUUID();
    const changes: D1Statement[] = [this.assertion(guardId, `SELECT 1 FROM accounts WHERE id = ? AND
      (? = 1 OR NOT EXISTS (SELECT 1 FROM memberships WHERE session_id = ? AND account_id = ? AND is_admin = 1)
      OR EXISTS (SELECT 1 FROM memberships WHERE session_id = ? AND account_id <> ? AND is_admin = 1))`,
    userId, Number(input?.isAdmin ?? false), sessionId, userId, sessionId, userId)];
    if (input) {
      changes.push(
        this.statement(`INSERT INTO memberships (session_id, account_id, team_id, is_admin) VALUES (?, ?, ?, ?)
          ON CONFLICT(session_id, account_id) DO UPDATE SET team_id = excluded.team_id, is_admin = excluded.is_admin`,
        sessionId, userId, input.teamId, Number(input.isAdmin)),
        this.statement('DELETE FROM membership_roles WHERE session_id = ? AND account_id = ?', sessionId, userId),
        ...[...new Set(input.roles)].map((role) => this.statement(
          'INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, ?)', sessionId, userId, role)),
      );
    } else {
      changes.push(this.statement('DELETE FROM memberships WHERE session_id = ? AND account_id = ?', sessionId, userId));
    }
    const audiences = ['staff', `account:${userId}`];
    if (prior?.team_id) audiences.push(`team:${prior.team_id}`);
    if (input?.teamId) audiences.push(`team:${input.teamId}`);
    changes.push(
      this.statement('UPDATE sessions SET version = version + 1 WHERE id = ?', sessionId),
      this.audit(sessionId, caller.accountId, input ? 'assign_membership' : 'revoke_membership', userId,
        { team: input?.teamId ?? null, roles: input?.roles ?? [], admin: input?.isAdmin ?? false }),
      ...notificationStatements(this.db, sessionId, audiences),
      this.statement('DELETE FROM command_assertions WHERE id = ?', guardId),
    );
    await this.commit(gate, changes);
  }
}
