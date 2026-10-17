import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Caller } from "../../applicationStore";
import type { D1Connection, D1Statement } from "./connection";

type Row = Record<string, unknown>;

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

  constructor(readonly db: D1Connection) {}

  statement(sql: string, ...values: Array<string | number | null>): D1Statement {
    return this.db.prepare(sql).bind(...values);
  }

  async rows(sql: string, ...values: Array<string | number | null>): Promise<Row[]> {
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
    const config = JSON.parse(readFileSync("wrangler.d1-proof.jsonc", "utf8"));
    return {
      config: "wrangler.d1-proof.jsonc", remote: process.env.MINSKY_D1_REMOTE === "1",
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
    const statements = [
      this.statement("INSERT INTO events (id) VALUES (?)", this.eventId),
      this.statement("INSERT INTO sessions (id, event_id) VALUES (?, ?), (?, ?)",
        this.sessionId, this.eventId, this.secondSessionId, this.eventId),
      this.statement("INSERT INTO teams (id, session_id) VALUES (?, ?), (?, ?), (?, ?)",
        this.teamId, this.sessionId, this.otherTeamId, this.sessionId,
        this.secondSessionTeamId, this.secondSessionId),
    ];
    for (const [index, caller] of this.accounts().entries()) {
      statements.push(
        this.statement("INSERT INTO accounts (id, name, must_change) VALUES (?, ?, 0)",
          caller.accountId, `d1-proof:${this.eventId}:${index}`),
        this.statement("INSERT INTO logins (id, account_id, expires_at) VALUES (?, ?, unixepoch() + 3600)",
          caller.loginId, caller.accountId),
        this.statement("INSERT INTO memberships (session_id, account_id, team_id) VALUES (?, ?, ?)",
          this.sessionId, caller.accountId, index === 2 ? this.teamId : index === 3 ? this.otherTeamId : null),
      );
    }
    statements.push(
      this.statement("INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer'), (?, ?, 'specialist')",
        this.sessionId, this.staff.accountId, this.sessionId, this.specialist.accountId),
      this.statement("INSERT INTO memberships (session_id, account_id) VALUES (?, ?)",
        this.secondSessionId, this.staff.accountId),
      this.statement("INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')",
        this.secondSessionId, this.staff.accountId),
      this.statement("INSERT INTO issues (id, session_id, team_id, status) VALUES (?, ?, ?, 'open'), (?, ?, ?, 'open'), (?, ?, ?, 'open')",
        this.issueId, this.sessionId, this.teamId, this.otherIssueId, this.sessionId, this.teamId,
        this.secondSessionIssueId, this.secondSessionId, this.secondSessionTeamId),
    );
    try {
      await this.db.batch(statements);
    } catch (error) {
      throw this.recoveryError("Fixture creation failed.", error);
    }
  }

  /** Compare every command effect, including public and private counters. */
  async durableState(): Promise<Record<string, Row[]>> {
    const sessions = [this.sessionId, this.secondSessionId];
    const queries: Array<[string, string]> = [
      ["issues", "SELECT * FROM issues WHERE session_id IN (?, ?) ORDER BY id"],
      ["receipts", "SELECT * FROM command_receipts WHERE session_id IN (?, ?) ORDER BY actor, request_id"],
      ["history", "SELECT h.* FROM history h JOIN issues i ON i.id = h.issue_id WHERE i.session_id IN (?, ?) ORDER BY h.id"],
      ["sequences", "SELECT * FROM audience_sequences WHERE session_id IN (?, ?) ORDER BY session_id, audience"],
      ["notifications", "SELECT * FROM notifications WHERE session_id IN (?, ?) ORDER BY id"],
    ];
    const rows = await this.rowsBatch(queries.map(([, sql]) => this.statement(sql, ...sessions)));
    const result: Record<string, Row[]> = {};
    queries.forEach(([name], index) => { result[name] = rows[index]; });
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
    await this.db.batch([
      this.statement("DELETE FROM events WHERE id = ?", this.eventId),
      ...accounts.map((caller) => this.statement("DELETE FROM accounts WHERE id = ?", caller.accountId)),
    ]);
    const remaining = await this.durableState();
    if (Object.values(remaining).some((rows) => rows.length !== 0)) {
      throw new Error(`Fixture workflow records remain for ${this.eventId}.`);
    }
    const [people, logins, memberships, events, remainingSessions] = await this.rowsBatch([
      this.statement("SELECT id FROM accounts WHERE id IN (?, ?, ?, ?)",
        ...accounts.map((caller) => caller.accountId)),
      this.statement("SELECT id FROM logins WHERE id IN (?, ?, ?, ?)",
        ...accounts.map((caller) => caller.loginId)),
      this.statement("SELECT account_id FROM memberships WHERE account_id IN (?, ?, ?, ?)",
        ...accounts.map((caller) => caller.accountId)),
      this.statement("SELECT id FROM events WHERE id = ?", this.eventId),
      this.statement("SELECT id FROM sessions WHERE id IN (?, ?)", this.sessionId, this.secondSessionId),
    ]);
    if (people.length !== 0) throw new Error(`Fixture accounts remain for ${this.eventId}.`);
    if (logins.length || memberships.length || events.length || remainingSessions.length) {
      throw new Error(`Fixture access records remain for ${this.eventId}.`);
    }
  }
}
