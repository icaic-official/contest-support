import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import type { Caller } from '../../authentication';
import type { D1Connection, D1Statement } from "./connection";
import type { D1Value } from './connection.ts';

type Row = Record<string, unknown>;

const migrations = fileURLToPath(new URL("./migrations", import.meta.url));

/** Apply every repository migration, in order, to an empty local database. Returns the file names. */
export async function applyMigrations(db: D1Connection): Promise<string[]> {
  const names = readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort();
  for (const name of names) {
    await db.batch(splitSqlQuery(readFileSync(join(migrations, name), "utf8")).map((sql) => db.prepare(sql)));
  }
  return names;
}

/** Fictional records owned by one UUID. This helper never resets a database. */
export class D1Fixture {
  readonly eventId = randomUUID();
  readonly sessionId = randomUUID();
  readonly secondSessionId = randomUUID();
  readonly teamId = randomUUID();
  readonly otherTeamId = randomUUID();
  readonly secondSessionTeamId = randomUUID();
  readonly issueId = randomUUID();
  readonly otherIssueId = randomUUID();
  readonly secondSessionIssueId = randomUUID();
  readonly staff: Caller = { accountId: randomUUID(), loginId: randomUUID() };
  readonly specialist: Caller = { accountId: randomUUID(), loginId: randomUUID() };
  readonly contestant: Caller = { accountId: randomUUID(), loginId: randomUUID() };
  readonly otherContestant: Caller = { accountId: randomUUID(), loginId: randomUUID() };
  private journalDirectory: string | undefined;

  constructor(
    readonly db: D1Connection,
    private readonly configPath: string,
    private readonly workflow = false,
  ) {}

  statement(sql: string, ...values: D1Value[]): D1Statement {
    return this.db.prepare(sql).bind(...values);
  }

  async rows(sql: string, ...values: D1Value[]): Promise<Row[]> {
    return (await this.statement(sql, ...values).all<Row>()).results;
  }

  private async rowsBatch(statements: D1Statement[]): Promise<Row[][]> {
    const results = await this.db.batch(statements) as Array<{ results: Row[] }>;
    return results.map((result) => result.results);
  }

  private accounts(): Caller[] {
    return [this.staff, this.specialist, this.contestant, this.otherContestant];
  }

  private recoveryDetails() {
    const config = JSON.parse(readFileSync(this.configPath, "utf8"));
    return {
      config: this.configPath, workflow: this.workflow, remote: process.env.MINSKY_AUTH_REMOTE === "1" || Boolean(process.env.MINSKY_CONNECTOR_D1_CONFIG),
      accountId: config.account_id, databaseId: config.d1_databases[0].database_id,
      databaseName: config.d1_databases[0].database_name,
      eventId: this.eventId, sessionIds: [this.sessionId, this.secondSessionId],
      teamIds: [this.teamId, this.otherTeamId, this.secondSessionTeamId],
      issueIds: [this.issueId, this.otherIssueId, this.secondSessionIssueId],
      accounts: this.accounts(),
    };
  }

  private recoveryError(message: string, cause?: unknown): Error {
    const journal = this.journalDirectory ? join(this.journalDirectory, "fixture.json") : "None";
    return new Error(`${message} Recovery journal: ${journal}. Fixture IDs: ${JSON.stringify(this.recoveryDetails())}`, { cause });
  }

  async create(): Promise<void> {
    // Save IDs before the first write. An interrupted hosted run needs no secret for recovery.
    this.journalDirectory = mkdtempSync(join(tmpdir(), "minsky-d1-proof-"));
    writeFileSync(join(this.journalDirectory, "fixture.json"),
      JSON.stringify(this.recoveryDetails(), null, 2), { mode: 0o600 });
    // Local D1 charges each batch statement, so each table receives its rows in one statement.
    const accounts = this.accounts();
    const repeat = (count: number, row: string) => Array(count).fill(row).join(", ");
    const statements = [
      this.statement("INSERT INTO events (id) VALUES (?)", this.eventId),
      this.statement("INSERT INTO sessions (id, event_id) VALUES (?, ?), (?, ?)",
        this.sessionId, this.eventId, this.secondSessionId, this.eventId),
      this.statement("INSERT INTO teams (id, session_id) VALUES (?, ?), (?, ?), (?, ?)",
        this.teamId, this.sessionId, this.otherTeamId, this.sessionId,
        this.secondSessionTeamId, this.secondSessionId),
      this.statement(`INSERT INTO accounts (id, name, must_change) VALUES ${repeat(accounts.length, "(?, ?, 0)")}`,
        ...accounts.flatMap((caller, index) => [caller.accountId, `d1-proof:${this.eventId}:${index}`])),
      this.statement(`INSERT INTO logins (id, account_id, expires_at) VALUES ${repeat(accounts.length, "(?, ?, unixepoch() + 3600)")}`,
        ...accounts.flatMap((caller) => [caller.loginId, caller.accountId])),
      this.statement(`INSERT INTO memberships (session_id, account_id, team_id) VALUES ${repeat(accounts.length + 1, "(?, ?, ?)")}`,
        ...accounts.flatMap((caller, index) => [
          this.sessionId, caller.accountId, index === 2 ? this.teamId : index === 3 ? this.otherTeamId : null,
        ]),
        this.secondSessionId, this.staff.accountId, null),
    ];
    if (this.workflow) {
      const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
      statements.push(
        this.statement(`INSERT INTO ba_user (id, name, email, createdAt, updatedAt)
          SELECT id, name, id || '@workflow.minsky.invalid', ${now}, ${now}
          FROM accounts WHERE id IN (${repeat(accounts.length, "?")})`, ...accounts.map((caller) => caller.accountId)),
        this.statement(`INSERT INTO ba_session (id, userId, token, expiresAt, createdAt, updatedAt)
          VALUES ${repeat(accounts.length, `(?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'), ${now}, ${now})`)}`,
        ...accounts.flatMap((caller) => [caller.loginId, caller.accountId, randomUUID()])),
        this.statement(`UPDATE logins SET identity_session_id = id WHERE id IN (${repeat(accounts.length, "?")})`,
          ...accounts.map((caller) => caller.loginId)),
      );
    }
    statements.push(
      this.statement("INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer'), (?, ?, 'specialist'), (?, ?, 'volunteer')",
        this.sessionId, this.staff.accountId, this.sessionId, this.specialist.accountId,
        this.secondSessionId, this.staff.accountId),
    );
    if (this.workflow) {
      statements.push(this.statement(`INSERT INTO issues
        (id, session_id, team_id, status, number, reporter, reporter_name, category, description, created_at)
        SELECT issue.column1, issue.column2, issue.column3, 'open', issue.column4, accounts.id, accounts.name,
          'Devices', 'Fictional existing issue', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM (VALUES (?, ?, ?, 1), (?, ?, ?, 2), (?, ?, ?, 1)) AS issue JOIN accounts ON accounts.id = ?`,
      this.issueId, this.sessionId, this.teamId,
      this.otherIssueId, this.sessionId, this.teamId,
      this.secondSessionIssueId, this.secondSessionId, this.secondSessionTeamId,
      this.staff.accountId));
    } else {
      statements.push(this.statement("INSERT INTO issues (id, session_id, team_id, status) VALUES (?, ?, ?, 'open'), (?, ?, ?, 'open'), (?, ?, ?, 'open')",
        this.issueId, this.sessionId, this.teamId, this.otherIssueId, this.sessionId, this.teamId,
        this.secondSessionIssueId, this.secondSessionId, this.secondSessionTeamId));
    }
    try {
      await this.db.batch(statements);
    } catch (error) {
      throw this.recoveryError("Fixture creation failed.", error);
    }
  }

  private durableQueries(): Array<[string, string]> {
    const queries: Array<[string, string]> = [
      ["issues", "SELECT * FROM issues WHERE session_id IN (?, ?) ORDER BY id"],
      ["receipts", "SELECT * FROM command_receipts WHERE session_id IN (?, ?) ORDER BY actor, request_id"],
      ["history", "SELECT h.* FROM history h JOIN issues i ON i.id = h.issue_id WHERE i.session_id IN (?, ?) ORDER BY h.id"],
      ["sequences", "SELECT * FROM audience_sequences WHERE session_id IN (?, ?) AND audience NOT LIKE 'account:%' ORDER BY session_id, audience"],
      ["notifications", "SELECT * FROM notifications WHERE session_id IN (?, ?) AND audience NOT LIKE 'account:%' ORDER BY id"],
    ];
    if (this.workflow) queries.push(
      ["resolutions", "SELECT * FROM resolutions WHERE session_id IN (?, ?) ORDER BY id"],
      ["awards", "SELECT * FROM awards WHERE session_id IN (?, ?) ORDER BY id"],
      ["issue_sequences", "SELECT * FROM session_issue_sequences WHERE session_id IN (?, ?) ORDER BY session_id"],
    );
    return queries;
  }

  /** Compare workflow effects. Account-only invalidations belong to credential operations. */
  async durableState(): Promise<Record<string, Row[]>> {
    const queries = this.durableQueries();
    const rows = await this.rowsBatch(queries.map(([, sql]) =>
      this.statement(sql, this.sessionId, this.secondSessionId)));
    const result: Record<string, Row[]> = {};
    queries.forEach(([name], index) => { result[name] = rows[index]!; });
    return result;
  }

  async cleanup(): Promise<void> {
    try {
      await this.removeOwnedRecords();
      if (this.journalDirectory) rmSync(this.journalDirectory, { recursive: true });
      this.journalDirectory = undefined;
    } catch (error) {
      throw this.recoveryError("Fixture cleanup failed.", error);
    }
  }

  private async removeOwnedRecords(): Promise<void> {
    const accounts = this.accounts();
    const [owned, sessions] = await this.rowsBatch([
      this.statement("SELECT id, name FROM accounts WHERE id IN (?, ?, ?, ?) ORDER BY id",
        ...accounts.map((caller) => caller.accountId)),
      this.statement("SELECT id FROM sessions WHERE event_id = ? ORDER BY id", this.eventId),
    ]);
    const expected = accounts.map((caller, index) => ({
      id: caller.accountId, name: `d1-proof:${this.eventId}:${index}`,
    })).sort((left, right) => left.id.localeCompare(right.id));
    if (JSON.stringify(owned) !== JSON.stringify(expected)) {
      throw new Error(`Fixture ownership mismatch for ${this.eventId}. Cleanup stopped.`);
    }
    const expectedSessions = [this.sessionId, this.secondSessionId].sort().map((id) => ({ id }));
    if (JSON.stringify(sessions) !== JSON.stringify(expectedSessions)) {
      throw new Error(`Fixture session ownership mismatch for ${this.eventId}. Cleanup stopped.`);
    }
    // Remove owned history before deleting its authenticated actors.
    const accountIds = accounts.map((caller) => caller.accountId);
    await this.db.batch([
      this.statement("DELETE FROM events WHERE id = ?", this.eventId),
      ...(this.workflow ? [this.statement("DELETE FROM ba_user WHERE id IN (?, ?, ?, ?)", ...accountIds)] : []),
      this.statement("DELETE FROM accounts WHERE id IN (?, ?, ?, ?)", ...accountIds),
    ]);
    const workflowQueries = this.durableQueries();
    const checks = await this.rowsBatch([
      ...workflowQueries.map(([, sql]) => this.statement(sql, this.sessionId, this.secondSessionId)),
      this.statement("SELECT id FROM accounts WHERE id IN (?, ?, ?, ?)",
        ...accounts.map((caller) => caller.accountId)),
      this.statement("SELECT id FROM logins WHERE id IN (?, ?, ?, ?)",
        ...accounts.map((caller) => caller.loginId)),
      this.statement("SELECT account_id FROM memberships WHERE account_id IN (?, ?, ?, ?)",
        ...accounts.map((caller) => caller.accountId)),
      this.statement("SELECT id FROM events WHERE id = ?", this.eventId),
      this.statement("SELECT id FROM sessions WHERE id IN (?, ?)", this.sessionId, this.secondSessionId),
      this.statement("SELECT * FROM audience_sequences WHERE session_id IN (?, ?)", this.sessionId, this.secondSessionId),
      this.statement("SELECT * FROM notifications WHERE session_id IN (?, ?)", this.sessionId, this.secondSessionId),
      ...(this.workflow ? [
        this.statement("SELECT id FROM ba_user WHERE id IN (?, ?, ?, ?)", ...accounts.map((caller) => caller.accountId)),
        this.statement("SELECT id FROM ba_session WHERE userId IN (?, ?, ?, ?)", ...accounts.map((caller) => caller.accountId)),
      ] : []),
    ]);
    if (checks.slice(0, workflowQueries.length).some((rows) => rows.length !== 0)) {
      throw new Error(`Fixture workflow records remain for ${this.eventId}.`);
    }
    const [people, logins, memberships, events, remainingSessions, sequences, notifications,
      identityUsers, identitySessions] = checks.slice(workflowQueries.length);
    if (this.workflow) {
      if (identityUsers!.length || identitySessions!.length) throw new Error(`Fixture identities remain for ${this.eventId}.`);
    }
    if (people!.length !== 0) throw new Error(`Fixture accounts remain for ${this.eventId}.`);
    if (logins!.length || memberships!.length || events!.length || remainingSessions!.length || sequences!.length || notifications!.length) {
      throw new Error(`Fixture access records remain for ${this.eventId}.`);
    }
  }
}
