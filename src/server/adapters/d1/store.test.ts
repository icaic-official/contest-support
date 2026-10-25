import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openStoreDatabase } from '../cloudflare/tooling/store-database.mjs';
import type { Caller } from '../../authentication';
import { WorkflowService } from '../../workflow';
import { D1ApplicationService } from '../cloudflare/application';
import type { D1Connection, D1Statement } from "./connection";
import { D1ApplicationStore } from "./store";
import { D1Fixture, applyMigrations } from "./testFixture";
import { measureD1 } from './testMetrics';
import type { Command } from "../../../connected/model";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const connectorConfig = process.env.MINSKY_CONNECTOR_D1_CONFIG;
const remote = Boolean(connectorConfig);
const configPath = connectorConfig ?? 'src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc';

function workflowService(db: D1Connection) {
  return new WorkflowService(new D1ApplicationStore(db));
}

/** Insert a real competing commit after the store reads and before its batch. */
function beforeBatch(db: D1Connection, action: () => Promise<void>, repeat = false): D1Connection {
  let invoked = false;
  return {
    prepare: (sql) => db.prepare(sql),
    batch: async (statements) => {
      if (!invoked || repeat) {
        invoked = true;
        await action();
      }
      return db.batch(statements);
    },
  };
}

describe("D1 workflow persistence", () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  let fixture: D1Fixture;
  let creationComplete = false;
  let workflow: WorkflowService;
  let application: D1ApplicationService;

  beforeAll(async () => {
    const platform = await openStoreDatabase({ configPath, remoteBindings: remote });
    const metrics = process.env.MINSKY_D1_METRICS === '1'
      ? measureD1(platform.db, (line) => process.stdout.write(line + '\n')) : undefined;
    db = metrics?.db ?? platform.db;
    dispose = async () => { metrics?.flush(); await platform.dispose(); };
    if (!remote) {
      await applyMigrations(db);
    }
  });

  afterAll(async () => { if (dispose) await dispose(); });

  beforeEach(async () => {
    creationComplete = false;
    fixture = new D1Fixture(db, configPath, true);
    await fixture.create();
    creationComplete = true;
    workflow = workflowService(db);
    application = new D1ApplicationService(db);
  });

  afterEach(async () => { if (creationComplete) await fixture.cleanup(); });

  function claim(issueId = fixture.issueId) {
    return { type: "claim", issue_id: issueId, revision: 1 } as const;
  }

  function message(visibility: "public" | "internal", text = "Fictional fixture message"): Command {
    return { type: "message", issue_id: fixture.issueId, revision: 1, text, visibility };
  }

  async function execute(command: Command, caller: Caller = fixture.staff, requestId = randomUUID()) {
    return workflow.execute(caller, fixture.sessionId, requestId, command);
  }

  async function expectNoAssertions() {
    expect(await fixture.rows("SELECT id FROM command_assertions")).toEqual([]);
  }

  it("commits the claim, first assignment, receipt, history, and both audience records together", async () => {
    expect(await execute(claim())).toEqual({ outcome: "committed", issueId: fixture.issueId });
    const view = await application.snapshot(fixture.contestant, fixture.sessionId);
    const issue = view.issues.find((row) => row.id === fixture.issueId);
    expect(issue).toMatchObject({ status: "claimed", owner: fixture.staff.accountId, revision: 2 });
    expect(issue?.first_assigned_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(view.history).toMatchObject([{ actor: fixture.staff.accountId, text: "Issue claimed.", visibility: "public" }]);
    const state = await fixture.durableState();
    expect(state.receipts).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    expect(state.sequences.find((row) => row.audience === `team:${fixture.teamId}`)?.sequence).toBe(1);
    expect(state.notifications.map((row) => row.audience).sort()).toEqual(["staff", `team:${fixture.teamId}`].sort());
    await expectNoAssertions();
  });

  it("permits only one concurrent claim with different actors and request IDs", async () => {
    const results = await Promise.all([execute(claim()), execute(claim(), fixture.specialist)]);
    expect(results.filter((result) => result.outcome === "committed")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "rejected")).toHaveLength(1);
    const state = await fixture.durableState();
    expect(state.receipts).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    expect(state.notifications).toHaveLength(2);
    expect(state.sequences.every((row) => row.sequence === 1)).toBe(true);
  });

  it("replays concurrent identical request IDs without duplicate writes", async () => {
    const requestId = randomUUID();
    const results = await Promise.all([execute(claim(), fixture.staff, requestId), execute(claim(), fixture.staff, requestId)]);
    expect(results).toEqual([
      { outcome: "committed", issueId: fixture.issueId }, { outcome: "committed", issueId: fixture.issueId },
    ]);
    const state = await fixture.durableState();
    expect(state.receipts).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    expect(state.notifications).toHaveLength(2);
  });

  it("rejects concurrent reuse of a request ID with different commands", async () => {
    const requestId = randomUUID();
    const results = await Promise.all([
      execute(message("public", "First content"), fixture.staff, requestId),
      execute(message("internal", "Different content"), fixture.staff, requestId),
    ]);
    expect(results.filter((result) => result.outcome === "committed")).toHaveLength(1);
    expect(results).toContainEqual({ outcome: "rejected", reason: "request_id" });
    const state = await fixture.durableState();
    expect(state.receipts).toHaveLength(1);
    expect(state.history).toHaveLength(1);
  });

  it("compares canonical command content regardless of input key order", async () => {
    const requestId = randomUUID();
    await execute(claim(), fixture.staff, requestId);
    const before = await fixture.durableState();
    expect(await execute({ revision: 1, issue_id: fixture.issueId, type: "claim" }, fixture.staff, requestId))
      .toEqual({ outcome: "committed", issueId: fixture.issueId });
    expect(await fixture.durableState()).toEqual(before);
  });

  it("preserves an unknown outcome after committed response loss and safely retries", async () => {
    let lost = false;
    workflow = workflowService({
      prepare: (sql) => db.prepare(sql),
      batch: async (statements) => {
        const result = await db.batch(statements);
        if (!lost) { lost = true; throw new Error("Injected response loss after commit"); }
        return result;
      },
    });
    const requestId = randomUUID();
    expect(await execute(claim(), fixture.staff, requestId)).toEqual({ outcome: "unknown" });
    const committed = await fixture.durableState();
    expect(committed.history).toHaveLength(1);
    expect(await execute(claim(), fixture.staff, requestId)).toEqual({ outcome: "committed", issueId: fixture.issueId });
    expect(await fixture.durableState()).toEqual(committed);
  });

  it("rejects changed text whitespace with a reused request ID while replaying the original command", async () => {
    const requestId = randomUUID();
    const original = message("public", " Fictional text ");
    expect(await execute(original, fixture.staff, requestId))
      .toEqual({ outcome: "committed", issueId: fixture.issueId });
    const before = await fixture.durableState();
    expect(before.history[0].text).toBe("Fictional text");
    expect(await execute(message("public", "Fictional text"), fixture.staff, requestId))
      .toEqual({ outcome: "rejected", reason: "request_id" });
    expect(await execute(original, fixture.staff, requestId))
      .toEqual({ outcome: "committed", issueId: fixture.issueId });
    expect(await fixture.durableState()).toEqual(before);
  });

  it.each(["command", "issue", "session"])("rejects request ID reuse with another %s", async (changed) => {
    const requestId = randomUUID();
    await execute(claim(), fixture.staff, requestId);
    const before = await fixture.durableState();
    const command = changed === "command" ? message("public")
      : claim(changed === "session" ? fixture.secondSessionIssueId : fixture.otherIssueId);
    const result = await workflow.execute(fixture.staff,
      changed === "session" ? fixture.secondSessionId : fixture.sessionId, requestId, command);
    expect(result).toEqual({ outcome: "rejected", reason: "request_id" });
    expect(await fixture.durableState()).toEqual(before);
  });

  const accessChanges = ["membership", "disabled", "must_change", "archive", "expired", "revoked", "roles", "team"] as const;
  async function changeAccess(change: typeof accessChanges[number]) {
    const mutations: Record<typeof accessChanges[number], D1Statement> = {
      membership: fixture.statement("DELETE FROM memberships WHERE session_id = ? AND account_id = ?", fixture.sessionId, fixture.staff.accountId),
      disabled: fixture.statement("UPDATE accounts SET disabled = 1 WHERE id = ?", fixture.staff.accountId),
      must_change: fixture.statement("UPDATE accounts SET must_change = 1 WHERE id = ?", fixture.staff.accountId),
      archive: fixture.statement("UPDATE events SET archived = 1 WHERE id = ?", fixture.eventId),
      expired: fixture.statement("UPDATE logins SET expires_at = unixepoch() - 1 WHERE id = ?", fixture.staff.loginId),
      revoked: fixture.statement("UPDATE logins SET revoked = 1 WHERE id = ?", fixture.staff.loginId),
      roles: fixture.statement("DELETE FROM membership_roles WHERE session_id = ? AND account_id = ?", fixture.sessionId, fixture.staff.accountId),
      team: fixture.statement("UPDATE memberships SET team_id = ? WHERE session_id = ? AND account_id = ?", fixture.otherTeamId, fixture.sessionId, fixture.contestant.accountId),
    };
    await mutations[change].run();
  }

  it.each(accessChanges)("rolls back a command raced with %s changes inside the batch boundary", async (change) => {
    const before = await fixture.durableState();
    workflow = workflowService(beforeBatch(db, () => changeAccess(change)));
    const result = await execute(change === "team" ? message("public") : claim(),
      change === "team" ? fixture.contestant : fixture.staff);
    expect(result.outcome).toBe("rejected");
    expect(await fixture.durableState()).toEqual(before);
    await expectNoAssertions();
  });

  it("rereads changed session settings before committing", async () => {
    let batches = 0;
    const raced = beforeBatch(db, async () => {
      await fixture.statement("UPDATE sessions SET intake_open = 1 WHERE id = ?", fixture.sessionId).run();
    });
    workflow = workflowService({
      prepare: (sql) => raced.prepare(sql),
      batch: async (statements) => { batches++; return raced.batch(statements); },
    });
    expect(await execute(claim())).toEqual({ outcome: "committed", issueId: fixture.issueId });
    expect(batches).toBe(2);
    expect((await fixture.durableState()).history).toHaveLength(1);
    await expectNoAssertions();
  });

  it("commits a claim in one batch when a team is added after its read", async () => {
    let batches = 0;
    const raced = beforeBatch(db, async () => {
      await fixture.statement("INSERT INTO teams (id, session_id) VALUES (?, ?)", randomUUID(), fixture.sessionId).run();
    });
    workflow = workflowService({
      prepare: (sql) => raced.prepare(sql),
      batch: async (statements) => { batches++; return raced.batch(statements); },
    });
    expect(await execute(claim())).toEqual({ outcome: "committed", issueId: fixture.issueId });
    expect(batches).toBe(1);
    expect((await fixture.durableState()).history).toHaveLength(1);
    await expectNoAssertions();
  });

  it.each(["membership", "disabled", "must_change", "archive", "expired", "revoked"] as const)(
    "checks current %s access before replaying a saved receipt", async (change) => {
      const requestId = randomUUID();
      await execute(claim(), fixture.staff, requestId);
      const before = await fixture.durableState();
      await changeAccess(change);
      expect(await execute(claim(), fixture.staff, requestId)).toEqual({ outcome: "rejected", reason: "access" });
      expect(await fixture.durableState()).toEqual(before);
    },
  );

  it("denies the next consistent snapshot after membership revocation", async () => {
    expect((await application.snapshot(fixture.staff, fixture.sessionId)).issues)
      .toContainEqual(expect.objectContaining({ id: fixture.issueId }));
    await changeAccess("membership");
    expect((await application.snapshot(fixture.staff, fixture.sessionId)).issues).toEqual([]);
    expect((await application.snapshot(fixture.otherContestant, fixture.sessionId)).issues).toEqual([]);
  });

  it("checks revocation in the same primary operation that assembles a snapshot", async () => {
    let revoked = false;
    const wrap = (statement: D1Statement): D1Statement => ({
      bind: (...values) => wrap(statement.bind(...values)),
      all: () => statement.all(),
      run: () => statement.run(),
      first: async <T>() => {
        if (!revoked) { revoked = true; await changeAccess("membership"); }
        return statement.first<T>();
      },
    });
    application = new D1ApplicationService({
      prepare: (sql) => wrap(db.prepare(sql)),
      batch: (statements) => db.batch(statements),
    });
    expect((await application.snapshot(fixture.staff, fixture.sessionId)).issues).toEqual([]);
  });

  it("returns only a permitted snapshot or no snapshot when a read overlaps revocation", async () => {
    expect(await execute(message("internal", "Private fixture text")))
      .toEqual({ outcome: "committed", issueId: fixture.issueId });
    expect(await execute(message("public", "Public fixture text"), fixture.contestant))
      .toEqual({ outcome: "committed", issueId: fixture.issueId });
    const permitted = await application.snapshot(fixture.contestant, fixture.sessionId);
    const [raced] = await Promise.all([
      application.snapshot(fixture.contestant, fixture.sessionId),
      fixture.statement("DELETE FROM memberships WHERE session_id = ? AND account_id = ?",
        fixture.sessionId, fixture.contestant.accountId).run(),
    ]);
    // D1 can order the complete read before or after the revocation commit.
    if (raced.membership !== null) {
      expect({ ...raced, server_time: permitted.server_time }).toEqual(permitted);
      expect(raced.history).toMatchObject([{
        actor: fixture.contestant.accountId, text: "Public fixture text", visibility: "public",
      }]);
      expect(raced.issues.map((issue) => issue.id)).toContain(fixture.issueId);
    } else {
      expect(raced.issues).toEqual([]);
      expect(raced.history).toEqual([]);
    }
    expect((await application.snapshot(fixture.contestant, fixture.sessionId)).issues).toEqual([]);
  });

  it("keeps internal history, notifications, and revisions out of the contestant view", async () => {
    const before = await application.snapshot(fixture.contestant, fixture.sessionId);
    expect(await execute(message("internal"))).toEqual({ outcome: "committed", issueId: fixture.issueId });
    const after = await application.snapshot(fixture.contestant, fixture.sessionId);
    expect({ ...after, server_time: before.server_time }).toEqual(before);
    const staff = await application.snapshot(fixture.staff, fixture.sessionId);
    expect(staff.history).toHaveLength(1);
    const state = await fixture.durableState();
    expect(state.notifications.map((row) => row.audience)).toEqual(["staff"]);
    expect(state.sequences.map((row) => row.audience)).toEqual(["staff"]);
    expect(state.sequences[0].sequence).toBe(1);
    expect(state.issues.find((row) => row.id === fixture.issueId)).toMatchObject({ public_revision: 1, write_version: 2 });
  });

  it("rereads after a private change and commits the public command without exposing a private conflict", async () => {
    workflow = workflowService(beforeBatch(db, async () => {
      const privateStore = workflowService(db);
      expect(await privateStore.execute(fixture.staff, fixture.sessionId, randomUUID(), message("internal")))
        .toEqual({ outcome: "committed", issueId: fixture.issueId });
    }));
    expect(await execute(message("public"), fixture.contestant)).toEqual({ outcome: "committed", issueId: fixture.issueId });
    const contestant = await application.snapshot(fixture.contestant, fixture.sessionId);
    expect(contestant.issues.find((issue) => issue.id === fixture.issueId)).toMatchObject({ revision: 2 });
    expect(contestant.history).toMatchObject([{
      actor: fixture.contestant.accountId, text: "Fictional fixture message", visibility: "public",
    }]);
    const state = await fixture.durableState();
    expect(state.history).toHaveLength(2);
    expect(state.receipts).toHaveLength(2);
    expect(state.notifications).toHaveLength(3);
    expect(state.sequences.find((row) => row.audience === `team:${fixture.teamId}`)?.sequence).toBe(1);
  });

  it("bounds retries without changing the public view during repeated private conflicts", async () => {
    const before = await application.snapshot(fixture.contestant, fixture.sessionId);
    let attempts = 0;
    workflow = workflowService(beforeBatch(db, async () => {
      attempts++;
      expect(await workflowService(db).execute(fixture.staff, fixture.sessionId, randomUUID(), message("internal")))
        .toEqual({ outcome: "committed", issueId: fixture.issueId });
    }, true));
    expect(await execute(message("public"), fixture.contestant)).toEqual({ outcome: "unknown" });
    expect(attempts).toBe(3);
    const after = await application.snapshot(fixture.contestant, fixture.sessionId);
    expect({ ...after, server_time: before.server_time }).toEqual(before);
    const state = await fixture.durableState();
    expect(state.history).toHaveLength(3);
    expect(state.notifications.every((row) => row.audience === "staff")).toBe(true);
    await expectNoAssertions();
  });

  it("rolls back all writes when a late assertion fails after history and notification writes", async () => {
    const before = await fixture.durableState();
    workflow = workflowService({
      prepare: (sql) => db.prepare(sql),
      batch: (statements) => db.batch([
        ...statements,
        fixture.statement("INSERT INTO command_assertions (id, valid) VALUES (?, 0)", randomUUID()),
      ]),
    });
    expect(await execute(claim())).toEqual({ outcome: "unknown" });
    expect(await fixture.durableState()).toEqual(before);
    await expectNoAssertions();
  });

  it("rejects a NULL assertion instead of treating it as a successful SQLite CHECK", async () => {
    const before = await fixture.durableState();
    workflow = workflowService({
      prepare: (sql) => db.prepare(sql),
      batch: (statements) => db.batch([
        ...statements,
        fixture.statement("INSERT INTO command_assertions (id, valid) VALUES (?, NULL)", randomUUID()),
      ]),
    });
    expect(await execute(claim())).toEqual({ outcome: "unknown" });
    expect(await fixture.durableState()).toEqual(before);
    await expectNoAssertions();
  });

  it("rejects failed state and permission checks without creating any durable effect", async () => {
    const before = await fixture.durableState();
    expect(await execute(claim(), fixture.contestant)).toEqual({ outcome: "rejected", reason: "state" });
    expect(await execute(message("internal"), fixture.contestant)).toEqual({ outcome: "rejected", reason: "state" });
    expect(await execute(message("public"), fixture.otherContestant)).toEqual({ outcome: "rejected", reason: "access" });
    expect(await execute({ ...claim(), revision: 2 })).toEqual({ outcome: "rejected", reason: "state" });
    expect(await fixture.durableState()).toEqual(before);
  });

  it.each([
    "write_version = write_version",
    "write_version = write_version + 2",
    "write_version = write_version + 1, public_revision = public_revision + 2",
    "write_version = write_version + 1, public_revision = public_revision - 1",
  ])("rejects a raw issue writer with invalid versions: %s", async (assignments) => {
    const before = await fixture.durableState();
    await expect(fixture.statement(`UPDATE issues SET ${assignments} WHERE id = ?`, fixture.issueId).run())
      .rejects.toThrow("Issue versions must advance with each write");
    expect(await fixture.durableState()).toEqual(before);
  });

  it("retains the existing 2,000-character message limit", async () => {
    const before = await fixture.durableState();
    expect(await execute(message("public", "x".repeat(2001))))
      .toEqual({ outcome: "rejected", reason: "input" });
    expect(await fixture.durableState()).toEqual(before);
    expect(await execute(message("public", "x".repeat(2000))))
      .toEqual({ outcome: "committed", issueId: fixture.issueId });
  });

  it("prevents an admin without team membership or staff roles from posting messages", async () => {
    await db.batch([
      fixture.statement("DELETE FROM membership_roles WHERE session_id = ? AND account_id = ?", fixture.sessionId, fixture.staff.accountId),
      fixture.statement("UPDATE memberships SET is_admin = 1 WHERE session_id = ? AND account_id = ?", fixture.sessionId, fixture.staff.accountId),
    ]);
    const before = await fixture.durableState();
    expect(await execute(message("public"))).toEqual({ outcome: "rejected", reason: "state" });
    expect(await execute(message("internal"))).toEqual({ outcome: "rejected", reason: "state" });
    expect(await fixture.durableState()).toEqual(before);
  });

  it("rejects a claim after another command changes the issue state before its batch", async () => {
    workflow = workflowService(beforeBatch(db, async () => {
      expect(await workflowService(db).execute(fixture.specialist, fixture.sessionId, randomUUID(), claim()))
        .toEqual({ outcome: "committed", issueId: fixture.issueId });
    }));
    expect(await execute(claim())).toEqual({ outcome: "rejected", reason: "state" });
    const state = await fixture.durableState();
    expect(state.history).toHaveLength(1);
    expect(state.receipts).toHaveLength(1);
    expect(state.notifications).toHaveLength(2);
    expect((await application.snapshot(fixture.staff, fixture.sessionId)).issues.find((issue) => issue.id === fixture.issueId))
      .toMatchObject({ status: "claimed", owner: fixture.specialist.accountId, revision: 2 });
  });

  it("cleans only its own fixture while preserving another run's workflow and access records", async () => {
    expect(await execute(claim())).toEqual({ outcome: "committed", issueId: fixture.issueId });
    const ownState = await fixture.durableState();
    const other = new D1Fixture(db, configPath, true);
    await other.create();
    try {
      expect(await workflowService(db).execute(other.staff, other.sessionId, randomUUID(), {
        type: "claim", issue_id: other.issueId, revision: 1,
      })).toEqual({ outcome: "committed", issueId: other.issueId });
    } finally {
      await other.cleanup();
    }
    expect(await fixture.durableState()).toEqual(ownState);
    expect((await application.snapshot(fixture.staff, fixture.sessionId)).issues.find((issue) => issue.id === fixture.issueId))
      .toMatchObject({ status: "claimed", owner: fixture.staff.accountId });
  });

  describe('complete D1 workflow with current identity', () => {
    async function command(input: Command, caller = fixture.staff, requestId = randomUUID()) {
      return workflow.execute(caller, fixture.sessionId, requestId, input);
    }

    async function next(type: 'claim' | 'escalate' | 'accept' | 'apply', issueId: string, caller = fixture.staff) {
      const view = (await application.snapshot(caller, fixture.sessionId)).issues.find((issue) => issue.id === issueId);
      expect(view).toBeDefined();
      return command({ type, issue_id: issueId, revision: view!.revision }, caller);
    }

    async function submit(caller = fixture.contestant, requestId = randomUUID()) {
      await fixture.statement('UPDATE sessions SET intake_open = 1 WHERE id = ?', fixture.sessionId).run();
      return command({ type: 'submit', category: 'Devices', description: ' Fictional keyboard failure ', team_id: fixture.teamId }, caller, requestId);
    }

    async function resolvedIssue() {
      expect(await command(claim())).toEqual({ outcome: 'committed', issueId: fixture.issueId });
      expect(await command({ type: 'resolve', issue_id: fixture.issueId, revision: 2, summary: 'Fixed fixture' }))
        .toEqual({ outcome: 'committed', issueId: fixture.issueId });
    }

    async function giveJury() {
      await fixture.statement("INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'jury')",
        fixture.sessionId, fixture.staff.accountId).run();
    }

    it('persists all nine commands, ownership, timing, repeated resolutions, and an applied award', async () => {
      const submitted = await submit();
      expect(submitted.outcome).toBe('committed');
      if (submitted.outcome !== 'committed') throw new Error('Submission failed.');
      const issueId = submitted.issueId;
      const initial = (await fixture.rows('SELECT * FROM issues WHERE id = ?', issueId))[0];
      expect(initial).toMatchObject({ reporter: fixture.contestant.accountId, category: 'Devices',
        description: 'Fictional keyboard failure', status: 'open', public_revision: 1, number: 3 });
      expect(initial.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(await next('claim', issueId)).toMatchObject({ outcome: 'committed' });
      const assigned = (await fixture.rows('SELECT * FROM issues WHERE id = ?', issueId))[0];
      expect(assigned.owner).toBe(fixture.staff.accountId);
      const claimHistory = (await fixture.rows("SELECT * FROM history WHERE issue_id = ? AND text = 'Issue claimed.'", issueId))[0];
      expect(assigned.first_assigned_at).toBe(claimHistory.at);
      expect(await command({ type: 'message', issue_id: issueId, revision: 2, text: 'Private fixture', visibility: 'internal' }))
        .toMatchObject({ outcome: 'committed' });
      expect(await command({ type: 'message', issue_id: issueId, revision: 2, text: 'Public fixture', visibility: 'public' }, fixture.contestant))
        .toMatchObject({ outcome: 'committed' });
      expect(await next('escalate', issueId)).toMatchObject({ outcome: 'committed' });
      expect((await application.snapshot(fixture.staff, fixture.sessionId)).issues.find((issue) => issue.id === issueId)?.owner)
        .toBe(fixture.staff.accountId);
      expect(await next('accept', issueId, fixture.specialist)).toMatchObject({ outcome: 'committed' });
      expect(await command({ type: 'resolve', issue_id: issueId, revision: 5, summary: ' First resolution ' }, fixture.specialist))
        .toMatchObject({ outcome: 'committed' });
      const firstResolution = (await fixture.rows('SELECT * FROM resolutions WHERE issue_id = ?', issueId))[0];
      const firstResolved = (await fixture.rows('SELECT * FROM issues WHERE id = ?', issueId))[0];
      expect(firstResolved).toMatchObject({ resolved_at: firstResolution.at, owner: fixture.specialist.accountId,
        first_assigned_at: assigned.first_assigned_at });
      await giveJury();
      expect(await command({ type: 'award', issue_id: issueId, revision: 6, minutes: 7, explanation: ' Fixture delay ' }))
        .toMatchObject({ outcome: 'committed' });
      expect(await next('apply', issueId)).toMatchObject({ outcome: 'committed' });
      const award = (await fixture.rows('SELECT * FROM awards WHERE issue_id = ?', issueId))[0];
      expect(award).toMatchObject({ resolution_id: firstResolution.id, minutes: 7, explanation: 'Fixture delay', applied_by: fixture.staff.accountId });
      expect(award.applied_at).toMatch(/^\d{4}-/);
      expect(await command({ type: 'reopen', issue_id: issueId, revision: 8, reason: ' Fixture recurred ' }, fixture.contestant))
        .toMatchObject({ outcome: 'committed' });
      const reopened = (await fixture.rows('SELECT * FROM issues WHERE id = ?', issueId))[0];
      expect(reopened).toMatchObject({ status: 'claimed', resolved_at: null, owner: fixture.specialist.accountId,
        first_assigned_at: assigned.first_assigned_at, created_at: initial.created_at });
      const reopenedResolution = (await fixture.rows('SELECT * FROM resolutions WHERE id = ?', String(firstResolution.id)))[0];
      expect(reopenedResolution).toMatchObject({ reopened_by: fixture.contestant.accountId, reason: 'Fixture recurred', summary: 'First resolution' });
      expect(await command({ type: 'resolve', issue_id: issueId, revision: 9, summary: 'Second resolution' }, fixture.specialist))
        .toMatchObject({ outcome: 'committed' });
      expect(await fixture.rows('SELECT * FROM resolutions WHERE issue_id = ?', issueId)).toHaveLength(2);
      expect(await fixture.rows('SELECT * FROM awards WHERE issue_id = ?', issueId)).toEqual([award]);
      expect(await command({ type: 'award', issue_id: issueId, revision: 10, minutes: 8, explanation: 'Duplicate fixture' }))
        .toEqual({ outcome: 'rejected', reason: 'state' });
      expect(await next('apply', issueId)).toEqual({ outcome: 'rejected', reason: 'state' });
      const publicView = await application.snapshot(fixture.contestant, fixture.sessionId);
      expect(publicView.history.some((row) => row.text === 'Private fixture')).toBe(false);
      expect(publicView.history).toHaveLength(10);
      const durable = await fixture.durableState();
      expect(durable.receipts).toHaveLength(11);
      expect(durable.notifications).toHaveLength(21);
      expect(await fixture.rows('SELECT * FROM workflow_commit_times')).toEqual([]);
      await expectNoAssertions();
    });

    it('rejects a NUL character in resolve, reopen, and award text, and accepts the next command', async () => {
      await giveJury();
      expect(await command(claim())).toEqual({ outcome: 'committed', issueId: fixture.issueId });
      const rejected = { outcome: 'rejected', reason: 'input' };
      for (const text of ['\u0000Fixed', 'Fi\u0000xed', 'Fixed\u0000']) {
        expect(await command({ type: 'resolve', issue_id: fixture.issueId, revision: 2, summary: text })).toEqual(rejected);
      }
      expect(await command({ type: 'resolve', issue_id: fixture.issueId, revision: 2, summary: 'Fixed fixture' }))
        .toEqual({ outcome: 'committed', issueId: fixture.issueId });
      for (const text of ['\u0000Fixture delay', 'Fixture\u0000 delay']) {
        expect(await command({ type: 'award', issue_id: fixture.issueId, revision: 3, minutes: 1, explanation: text })).toEqual(rejected);
        expect(await command({ type: 'reopen', issue_id: fixture.issueId, revision: 3, reason: text })).toEqual(rejected);
      }
      expect(await fixture.rows('SELECT id FROM awards WHERE issue_id = ?', fixture.issueId)).toEqual([]);
      expect(await command({ type: 'reopen', issue_id: fixture.issueId, revision: 3, reason: 'Fixture recurred' }))
        .toEqual({ outcome: 'committed', issueId: fixture.issueId });
      await expectNoAssertions();
    });

    it('assigns unique persisted numbers to concurrent submissions and replays a lost submission response', async () => {
      await fixture.statement('UPDATE sessions SET intake_open = 1 WHERE id = ?', fixture.sessionId).run();
      const input: Command = { type: 'submit', category: 'Other', description: 'Fictional new issue' };
      const results = await Promise.all([command(input, fixture.contestant), command(input, fixture.otherContestant)]);
      expect(results.every((result) => result.outcome === 'committed')).toBe(true);
      expect((await fixture.rows("SELECT number FROM issues WHERE description = 'Fictional new issue' AND session_id = ? ORDER BY number", fixture.sessionId)))
        .toEqual([{ number: 3 }, { number: 4 }]);
      const requestId = randomUUID();
      let lost = false;
      workflow = workflowService({ prepare: (sql) => db.prepare(sql), batch: async (statements) => {
        const result = await db.batch(statements);
        if (!lost) { lost = true; throw new Error('Response lost after submission commit.'); }
        return result;
      } });
      expect(await command(input, fixture.contestant, requestId)).toEqual({ outcome: 'unknown' });
      const committed = await fixture.durableState();
      expect(await command(input, fixture.contestant, requestId)).toMatchObject({ outcome: 'committed' });
      expect(await fixture.durableState()).toEqual(committed);
      expect(committed.issue_sequences).toEqual([{ session_id: fixture.sessionId, number: 5 }]);
    });

    it('replays the same submit request concurrently without leaving an extra issue or number', async () => {
      await fixture.statement('UPDATE sessions SET intake_open = 1 WHERE id = ?', fixture.sessionId).run();
      const requestId = randomUUID();
      const input: Command = { type: 'submit', category: 'Other', description: 'Same fictional issue' };
      const results = await Promise.all([command(input, fixture.contestant, requestId), command(input, fixture.contestant, requestId)]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0].outcome).toBe('committed');
      const durable = await fixture.durableState();
      expect(durable.issues).toHaveLength(4);
      expect(durable.history).toHaveLength(1);
      expect(durable.issue_sequences).toEqual([{ session_id: fixture.sessionId, number: 3 }]);
    });

    it('rolls back a batch when its identity expires after the first access check', async () => {
      const before = await fixture.durableState();
      workflow = workflowService({
        prepare: (sql) => db.prepare(sql),
        batch: (statements) => db.batch([
          ...statements.slice(0, -3),
          fixture.statement("UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE id = ?", fixture.staff.loginId),
          ...statements.slice(-3),
        ]),
      });
      expect(await command(claim())).toEqual({ outcome: 'unknown' });
      expect(await fixture.durableState()).toEqual(before);
      expect(await fixture.rows('SELECT * FROM workflow_commit_times')).toEqual([]);
      await expectNoAssertions();
    });

    const credentialChanges = ['generation', 'login_generation', 'pending', 'identity_expiry', 'identity_removed', 'identity_account', 'identity_missing'] as const;
    async function changeCredential(change: typeof credentialChanges[number]) {
      const statements: Record<typeof credentialChanges[number], D1Statement> = {
        generation: fixture.statement('UPDATE accounts SET credential_generation = credential_generation + 1 WHERE id = ?', fixture.staff.accountId),
        login_generation: fixture.statement('UPDATE logins SET credential_generation = credential_generation + 1 WHERE id = ?', fixture.staff.loginId),
        pending: fixture.statement("UPDATE accounts SET credential_state = 'pending' WHERE id = ?", fixture.staff.accountId),
        identity_expiry: fixture.statement("UPDATE ba_session SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE id = ?", fixture.staff.loginId),
        identity_removed: fixture.statement('DELETE FROM ba_session WHERE id = ?', fixture.staff.loginId),
        identity_account: fixture.statement('UPDATE ba_session SET userId = ? WHERE id = ?', fixture.specialist.accountId, fixture.staff.loginId),
        identity_missing: fixture.statement('UPDATE logins SET identity_session_id = NULL WHERE id = ?', fixture.staff.loginId),
      };
      await statements[change].run();
    }

    it.each(credentialChanges)('checks %s at the atomic write boundary', async (change) => {
      const before = await fixture.durableState();
      workflow = workflowService(beforeBatch(db, () => changeCredential(change)));
      expect(await command(claim())).toEqual({ outcome: 'rejected', reason: 'access' });
      expect(await fixture.durableState()).toEqual(before);
      await expect(application.snapshot(fixture.staff, fixture.sessionId)).rejects.toMatchObject({ status: 403 });
      await expectNoAssertions();
    });

    it.each(credentialChanges)('checks %s at the atomic receipt replay boundary', async (change) => {
      const requestId = randomUUID();
      expect(await command(claim(), fixture.staff, requestId)).toMatchObject({ outcome: 'committed' });
      const before = await fixture.durableState();
      workflow = workflowService(beforeBatch(db, () => changeCredential(change)));
      expect(await command(claim(), fixture.staff, requestId)).toEqual({ outcome: 'rejected', reason: 'access' });
      expect(await fixture.durableState()).toEqual(before);
      await expectNoAssertions();
    });

    it.each(['categories', 'intake', 'team'] as const)('rejects submission when %s changes before its commit', async (change) => {
      await fixture.statement('UPDATE sessions SET intake_open = 1 WHERE id = ?', fixture.sessionId).run();
      const before = await fixture.durableState();
      workflow = workflowService(beforeBatch(db, async () => {
        if (change === 'categories') await fixture.statement("UPDATE sessions SET categories = '[]' WHERE id = ?", fixture.sessionId).run();
        if (change === 'intake') await fixture.statement('UPDATE sessions SET intake_open = 0 WHERE id = ?', fixture.sessionId).run();
        if (change === 'team') await fixture.statement('DELETE FROM teams WHERE id = ?', fixture.otherTeamId).run();
      }));
      const input: Command = { type: 'submit', category: 'Devices', description: 'Fictional report', team_id: fixture.otherTeamId };
      // Staff can submit with intake closed, so that case uses a team contestant.
      if (change === 'team') {
        await fixture.statement('DELETE FROM memberships WHERE session_id = ? AND account_id = ?', fixture.sessionId, fixture.otherContestant.accountId).run();
      }
      const result = await command(input, change === 'intake' ? fixture.contestant : fixture.staff);
      expect(result.outcome).toBe('rejected');
      expect(await fixture.durableState()).toEqual(before);
    });

    it.each(['resolve', 'reopen', 'award', 'apply'] as const)('rolls back every %s effect on a late batch failure', async (type) => {
      await resolvedIssue();
      await giveJury();
      let input: Command;
      if (type === 'resolve') {
        expect(await command({ type: 'reopen', issue_id: fixture.issueId, revision: 3, reason: 'Fixture recurrence' }, fixture.contestant))
          .toMatchObject({ outcome: 'committed' });
        input = { type, issue_id: fixture.issueId, revision: 4, summary: 'Second fixture resolution' };
      } else if (type === 'reopen') input = { type, issue_id: fixture.issueId, revision: 3, reason: 'Fixture recurrence' };
      else if (type === 'award') input = { type, issue_id: fixture.issueId, revision: 3, minutes: 1, explanation: 'Fixture award' };
      else {
        expect(await command({ type: 'award', issue_id: fixture.issueId, revision: 3, minutes: 1, explanation: 'Fixture award' }))
          .toMatchObject({ outcome: 'committed' });
        input = { type, issue_id: fixture.issueId, revision: 4 };
      }
      const before = await fixture.durableState();
      workflow = workflowService({ prepare: (sql) => db.prepare(sql), batch: (statements) => db.batch([
        ...statements, fixture.statement('INSERT INTO command_assertions (id, valid) VALUES (?, 0)', randomUUID()),
      ]) });
      expect(await command(input)).toEqual({ outcome: 'unknown' });
      expect(await fixture.durableState()).toEqual(before);
      expect(await fixture.rows('SELECT * FROM workflow_commit_times')).toEqual([]);
      await expectNoAssertions();
    });

    it('records credential-operation audit and account invalidations without team notifications', async () => {
      const operationId = randomUUID();
      await fixture.statement(`INSERT INTO account_operations
        (id, account_id, actor, session_id, action, state) VALUES (?, ?, ?, ?, 'reset_password', 'pending')`,
      operationId, fixture.contestant.accountId, fixture.staff.accountId, fixture.sessionId).run();
      expect(await fixture.rows('SELECT actor, action, target, detail FROM admin_audit WHERE id = ?', operationId))
        .toEqual([{ actor: fixture.staff.accountId, action: 'reset_password', target: fixture.contestant.accountId, detail: '{"state":"pending"}' }]);
      await fixture.statement("UPDATE account_operations SET state = 'completed' WHERE id = ?", operationId).run();
      expect(await fixture.rows('SELECT detail FROM admin_audit WHERE id = ?', operationId)).toEqual([{ detail: '{"state":"completed"}' }]);
      await fixture.statement('UPDATE accounts SET credential_generation = credential_generation + 1 WHERE id = ?', fixture.contestant.accountId).run();
      const signals = await fixture.rows('SELECT audience FROM notifications WHERE session_id = ? ORDER BY audience', fixture.sessionId);
      expect(signals).toEqual([{ audience: `account:${fixture.contestant.accountId}` },
        { audience: `account:${fixture.contestant.accountId}` }, { audience: 'staff' }]);
      expect(await fixture.rows("SELECT * FROM notifications WHERE audience LIKE 'team:%' AND session_id = ?", fixture.sessionId)).toEqual([]);
      await fixture.statement('DELETE FROM account_operations WHERE id = ?', operationId).run();
    });

    it('writes no account notification for an account that has no login', async () => {
      const accountId = randomUUID();
      const operationId = randomUUID();
      const accountSignals = () => fixture.rows('SELECT audience FROM notifications WHERE audience = ?', `account:${accountId}`);
      const staffSignals = async () => (await fixture.rows("SELECT audience FROM notifications WHERE session_id = ? AND audience = 'staff'", fixture.sessionId)).length;
      const staffBefore = await staffSignals();
      await db.batch([
        fixture.statement("INSERT INTO accounts (id, name, credential_state) VALUES (?, 'Fictional new person', 'pending')", accountId),
        fixture.statement('INSERT INTO memberships (session_id, account_id, team_id) VALUES (?, ?, ?)', fixture.sessionId, accountId, fixture.teamId),
        fixture.statement(`INSERT INTO account_operations (id, account_id, actor, session_id, action, state)
          VALUES (?, ?, ?, ?, 'create_account', 'pending')`, operationId, accountId, fixture.staff.accountId, fixture.sessionId),
        fixture.statement("UPDATE accounts SET credential_state = 'ready', credential_generation = credential_generation + 1 WHERE id = ?", accountId),
      ]);
      try {
        expect(await staffSignals()).toBe(staffBefore + 1);
        expect(await accountSignals()).toEqual([]);
        await fixture.statement('INSERT INTO logins (id, account_id, expires_at) VALUES (?, ?, unixepoch() + 3600)', randomUUID(), accountId).run();
        await fixture.statement('UPDATE accounts SET disabled = 1 WHERE id = ?', accountId).run();
        expect(await accountSignals()).toEqual([{ audience: `account:${accountId}` }]);
      } finally {
        await db.batch([
          fixture.statement('DELETE FROM account_operations WHERE id = ?', operationId),
          fixture.statement('DELETE FROM admin_audit WHERE id = ?', operationId),
          fixture.statement('DELETE FROM accounts WHERE id = ?', accountId),
        ]);
      }
    });

    it('rejects incomplete reopening and application records at the database boundary', async () => {
      await resolvedIssue();
      await giveJury();
      expect(await command({ type: 'award', issue_id: fixture.issueId, revision: 3, minutes: 1, explanation: 'Fixture award' }))
        .toMatchObject({ outcome: 'committed' });
      const before = await fixture.durableState();
      await expect(fixture.statement(`UPDATE resolutions SET reopened_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        reopened_by = ?, reopened_name = 'Fictional person', reason = NULL WHERE issue_id = ?`,
      fixture.staff.accountId, fixture.issueId).run()).rejects.toThrow('CHECK constraint failed');
      await expect(fixture.statement("UPDATE awards SET applied_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE issue_id = ?",
        fixture.issueId).run()).rejects.toThrow('CHECK constraint failed');
      expect(await fixture.durableState()).toEqual(before);
    });

    it('rereads a concurrent resolution change before recording an award', async () => {
      await resolvedIssue();
      await giveJury();
      workflow = workflowService(beforeBatch(db, async () => {
        await fixture.statement("UPDATE resolutions SET reopened_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), reopened_by = ?, reopened_name = 'Fictional person', reason = 'Fixture recurrence' WHERE issue_id = ?",
          fixture.contestant.accountId, fixture.issueId).run();
      }));
      expect(await command({ type: 'award', issue_id: fixture.issueId, revision: 3, minutes: 2, explanation: 'Fixture award' }))
        .toEqual({ outcome: 'rejected', reason: 'state' });
      expect((await fixture.durableState()).awards).toEqual([]);
    });
  });
});
