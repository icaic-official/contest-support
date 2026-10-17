import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy, unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import type { Caller, IssueCommand } from "../../applicationStore";
import type { D1Connection, D1Statement } from "./connection";
import { D1ApplicationStore } from "./store";
import { D1Fixture } from "./testFixture";

const timeout = 120_000;
const remote = process.env.MINSKY_D1_REMOTE === "1";

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

describe("D1 application-store transaction proof", () => {
  let db: D1Connection;
  let dispose: () => Promise<void>;
  let fixture: D1Fixture;
  let creationComplete = false;
  let store: D1ApplicationStore;

  beforeAll(async () => {
    const platform = await getPlatformProxy<{ DB: D1Connection }>({
      configPath: "wrangler.d1-proof.jsonc", persist: false, remoteBindings: remote, envFiles: [],
    });
    db = platform.env.DB;
    dispose = platform.dispose;
    if (!remote) {
      const directory = "src/server/adapters/d1/migrations";
      for (const filename of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
        const schema = readFileSync(`${directory}/${filename}`, "utf8");
        await db.batch(splitSqlQuery(schema).map((sql) => db.prepare(sql)));
      }
    }
  }, timeout);

  afterAll(async () => { if (dispose) await dispose(); }, timeout);

  beforeEach(async () => {
    creationComplete = false;
    fixture = new D1Fixture(db);
    await fixture.create();
    creationComplete = true;
    store = new D1ApplicationStore(db);
  }, timeout);

  afterEach(async () => { if (creationComplete) await fixture.cleanup(); }, timeout);

  function claim(issueId = fixture.issueId): IssueCommand {
    return { type: "claim", issue_id: issueId, revision: 1 };
  }

  function message(visibility: "public" | "internal", text = "Fictional fixture message"): IssueCommand {
    return { type: "message", issue_id: fixture.issueId, revision: 1, text, visibility };
  }

  async function execute(command: IssueCommand, caller: Caller = fixture.staff, requestId = randomUUID()) {
    return store.execute(caller, fixture.sessionId, requestId, command);
  }

  async function expectNoAssertions() {
    expect(await fixture.rows("SELECT id FROM command_assertions")).toEqual([]);
  }

  it("commits the claim, first assignment, receipt, history, and both audience records together", async () => {
    expect(await execute(claim())).toEqual({ outcome: "committed", issueId: fixture.issueId });
    const view = await store.issue(fixture.contestant, fixture.sessionId, fixture.issueId);
    expect(view).toMatchObject({ status: "claimed", owner: fixture.staff.accountId, revision: 2, sequence: 1 });
    expect(view?.firstAssignedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(view?.history).toEqual([{ actor: fixture.staff.accountId, text: "Issue claimed.", visibility: "public" }]);
    const state = await fixture.durableState();
    expect(state.receipts).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    expect(state.notifications.map((row) => row.audience).sort()).toEqual(["staff", `team:${fixture.teamId}`].sort());
    await expectNoAssertions();
  }, timeout);

  it("permits only one concurrent claim with different actors and request IDs", async () => {
    const results = await Promise.all([execute(claim()), execute(claim(), fixture.specialist)]);
    expect(results.filter((result) => result.outcome === "committed")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "rejected")).toHaveLength(1);
    const state = await fixture.durableState();
    expect(state.receipts).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    expect(state.notifications).toHaveLength(2);
    expect(state.sequences.every((row) => row.sequence === 1)).toBe(true);
  }, timeout);

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
  }, timeout);

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
  }, timeout);

  it("compares canonical command content regardless of input key order", async () => {
    const requestId = randomUUID();
    await execute(claim(), fixture.staff, requestId);
    const before = await fixture.durableState();
    expect(await execute({ revision: 1, issue_id: fixture.issueId, type: "claim" }, fixture.staff, requestId))
      .toEqual({ outcome: "committed", issueId: fixture.issueId });
    expect(await fixture.durableState()).toEqual(before);
  }, timeout);

  it("preserves an unknown outcome after committed response loss and safely retries", async () => {
    let lost = false;
    store = new D1ApplicationStore({
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
  }, timeout);

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
  }, timeout);

  it.each(["command", "issue", "session"])("rejects request ID reuse with another %s", async (changed) => {
    const requestId = randomUUID();
    await execute(claim(), fixture.staff, requestId);
    const before = await fixture.durableState();
    const command = changed === "command" ? message("public")
      : claim(changed === "session" ? fixture.secondSessionIssueId : fixture.otherIssueId);
    const result = await store.execute(fixture.staff,
      changed === "session" ? fixture.secondSessionId : fixture.sessionId, requestId, command);
    expect(result).toEqual({ outcome: "rejected", reason: "request_id" });
    expect(await fixture.durableState()).toEqual(before);
  }, timeout);

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
    store = new D1ApplicationStore(beforeBatch(db, () => changeAccess(change)));
    const result = await execute(change === "team" ? message("public") : claim(),
      change === "team" ? fixture.contestant : fixture.staff);
    expect(result.outcome).toBe("rejected");
    expect(await fixture.durableState()).toEqual(before);
    await expectNoAssertions();
  }, timeout);

  it("rereads changed session settings before committing", async () => {
    let batches = 0;
    const raced = beforeBatch(db, async () => {
      await fixture.statement("UPDATE sessions SET intake_open = 1 WHERE id = ?", fixture.sessionId).run();
    });
    store = new D1ApplicationStore({
      prepare: (sql) => raced.prepare(sql),
      batch: async (statements) => { batches++; return raced.batch(statements); },
    });
    expect(await execute(claim())).toEqual({ outcome: "committed", issueId: fixture.issueId });
    expect(batches).toBe(2);
    expect((await fixture.durableState()).history).toHaveLength(1);
    await expectNoAssertions();
  }, timeout);

  it.each(["membership", "disabled", "must_change", "archive", "expired", "revoked"] as const)(
    "checks current %s access before replaying a saved receipt", async (change) => {
      const requestId = randomUUID();
      await execute(claim(), fixture.staff, requestId);
      const before = await fixture.durableState();
      await changeAccess(change);
      expect(await execute(claim(), fixture.staff, requestId)).toEqual({ outcome: "rejected", reason: "access" });
      expect(await fixture.durableState()).toEqual(before);
    }, timeout,
  );

  it("denies the next consistent snapshot after membership revocation", async () => {
    expect(await store.issue(fixture.staff, fixture.sessionId, fixture.issueId)).toBeDefined();
    await changeAccess("membership");
    expect(await store.issue(fixture.staff, fixture.sessionId, fixture.issueId)).toBeUndefined();
    expect(await store.issue(fixture.otherContestant, fixture.sessionId, fixture.issueId)).toBeUndefined();
  }, timeout);

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
    store = new D1ApplicationStore({
      prepare: (sql) => wrap(db.prepare(sql)),
      batch: (statements) => db.batch(statements),
    });
    expect(await store.issue(fixture.staff, fixture.sessionId, fixture.issueId)).toBeUndefined();
  }, timeout);

  it("returns only a permitted snapshot or no snapshot when a read overlaps revocation", async () => {
    expect(await execute(message("internal", "Private fixture text")))
      .toEqual({ outcome: "committed", issueId: fixture.issueId });
    expect(await execute(message("public", "Public fixture text"), fixture.contestant))
      .toEqual({ outcome: "committed", issueId: fixture.issueId });
    const permitted = await store.issue(fixture.contestant, fixture.sessionId, fixture.issueId);
    const [raced] = await Promise.all([
      store.issue(fixture.contestant, fixture.sessionId, fixture.issueId),
      fixture.statement("DELETE FROM memberships WHERE session_id = ? AND account_id = ?",
        fixture.sessionId, fixture.contestant.accountId).run(),
    ]);
    // D1 can order the complete read before or after the revocation commit.
    if (raced !== undefined) {
      expect(raced).toEqual(permitted);
      expect(raced.history).toEqual([{
        actor: fixture.contestant.accountId, text: "Public fixture text", visibility: "public",
      }]);
      expect(raced.issueId).toBe(fixture.issueId);
    }
    expect(await store.issue(fixture.contestant, fixture.sessionId, fixture.issueId)).toBeUndefined();
  }, timeout);

  it("keeps internal history, notifications, and revisions out of the contestant view", async () => {
    const before = await store.issue(fixture.contestant, fixture.sessionId, fixture.issueId);
    expect(await execute(message("internal"))).toEqual({ outcome: "committed", issueId: fixture.issueId });
    expect(await store.issue(fixture.contestant, fixture.sessionId, fixture.issueId)).toEqual(before);
    const staff = await store.issue(fixture.staff, fixture.sessionId, fixture.issueId);
    expect(staff?.history).toHaveLength(1);
    expect(staff?.sequence).toBe(1);
    const state = await fixture.durableState();
    expect(state.notifications.map((row) => row.audience)).toEqual(["staff"]);
    expect(state.sequences.map((row) => row.audience)).toEqual(["staff"]);
    expect(state.issues.find((row) => row.id === fixture.issueId)).toMatchObject({ public_revision: 1, write_version: 2 });
  }, timeout);

  it("rereads after a private change and commits the public command without exposing a private conflict", async () => {
    store = new D1ApplicationStore(beforeBatch(db, async () => {
      const privateStore = new D1ApplicationStore(db);
      expect(await privateStore.execute(fixture.staff, fixture.sessionId, randomUUID(), message("internal")))
        .toEqual({ outcome: "committed", issueId: fixture.issueId });
    }));
    expect(await execute(message("public"), fixture.contestant)).toEqual({ outcome: "committed", issueId: fixture.issueId });
    const contestant = await store.issue(fixture.contestant, fixture.sessionId, fixture.issueId);
    expect(contestant).toMatchObject({ revision: 2, sequence: 1 });
    expect(contestant?.history).toEqual([{
      actor: fixture.contestant.accountId, text: "Fictional fixture message", visibility: "public",
    }]);
    const state = await fixture.durableState();
    expect(state.history).toHaveLength(2);
    expect(state.receipts).toHaveLength(2);
    expect(state.notifications).toHaveLength(3);
  }, timeout);

  it("bounds retries without changing the public view during repeated private conflicts", async () => {
    const before = await store.issue(fixture.contestant, fixture.sessionId, fixture.issueId);
    let attempts = 0;
    store = new D1ApplicationStore(beforeBatch(db, async () => {
      attempts++;
      expect(await new D1ApplicationStore(db).execute(fixture.staff, fixture.sessionId, randomUUID(), message("internal")))
        .toEqual({ outcome: "committed", issueId: fixture.issueId });
    }, true));
    expect(await execute(message("public"), fixture.contestant)).toEqual({ outcome: "unknown" });
    expect(attempts).toBe(3);
    expect(await store.issue(fixture.contestant, fixture.sessionId, fixture.issueId)).toEqual(before);
    const state = await fixture.durableState();
    expect(state.history).toHaveLength(3);
    expect(state.notifications.every((row) => row.audience === "staff")).toBe(true);
    await expectNoAssertions();
  }, timeout);

  it("rolls back all writes when a late assertion fails after history and notification writes", async () => {
    const before = await fixture.durableState();
    store = new D1ApplicationStore({
      prepare: (sql) => db.prepare(sql),
      batch: (statements) => db.batch([
        ...statements,
        fixture.statement("INSERT INTO command_assertions (id, valid) VALUES (?, 0)", randomUUID()),
      ]),
    });
    expect(await execute(claim())).toEqual({ outcome: "unknown" });
    expect(await fixture.durableState()).toEqual(before);
    await expectNoAssertions();
  }, timeout);

  it("rejects a NULL assertion instead of treating it as a successful SQLite CHECK", async () => {
    const before = await fixture.durableState();
    store = new D1ApplicationStore({
      prepare: (sql) => db.prepare(sql),
      batch: (statements) => db.batch([
        ...statements,
        fixture.statement("INSERT INTO command_assertions (id, valid) VALUES (?, NULL)", randomUUID()),
      ]),
    });
    expect(await execute(claim())).toEqual({ outcome: "unknown" });
    expect(await fixture.durableState()).toEqual(before);
    await expectNoAssertions();
  }, timeout);

  it("rejects failed state and permission checks without creating any durable effect", async () => {
    const before = await fixture.durableState();
    expect(await execute(claim(), fixture.contestant)).toEqual({ outcome: "rejected", reason: "state" });
    expect(await execute(message("internal"), fixture.contestant)).toEqual({ outcome: "rejected", reason: "state" });
    expect(await execute(message("public"), fixture.otherContestant)).toEqual({ outcome: "rejected", reason: "access" });
    expect(await execute({ ...claim(), revision: 2 })).toEqual({ outcome: "rejected", reason: "state" });
    expect(await fixture.durableState()).toEqual(before);
  }, timeout);

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
  }, timeout);

  it("retains the existing 2,000-character message limit", async () => {
    const before = await fixture.durableState();
    expect(await execute(message("public", "x".repeat(2001))))
      .toEqual({ outcome: "rejected", reason: "input" });
    expect(await fixture.durableState()).toEqual(before);
    expect(await execute(message("public", "x".repeat(2000))))
      .toEqual({ outcome: "committed", issueId: fixture.issueId });
  }, timeout);

  it("prevents an admin without team membership or staff roles from posting messages", async () => {
    await db.batch([
      fixture.statement("DELETE FROM membership_roles WHERE session_id = ? AND account_id = ?", fixture.sessionId, fixture.staff.accountId),
      fixture.statement("UPDATE memberships SET is_admin = 1 WHERE session_id = ? AND account_id = ?", fixture.sessionId, fixture.staff.accountId),
    ]);
    const before = await fixture.durableState();
    expect(await execute(message("public"))).toEqual({ outcome: "rejected", reason: "state" });
    expect(await execute(message("internal"))).toEqual({ outcome: "rejected", reason: "state" });
    expect(await fixture.durableState()).toEqual(before);
  }, timeout);

  it("rejects a claim after another command changes the issue state before its batch", async () => {
    store = new D1ApplicationStore(beforeBatch(db, async () => {
      expect(await new D1ApplicationStore(db).execute(fixture.specialist, fixture.sessionId, randomUUID(), claim()))
        .toEqual({ outcome: "committed", issueId: fixture.issueId });
    }));
    expect(await execute(claim())).toEqual({ outcome: "rejected", reason: "state" });
    const state = await fixture.durableState();
    expect(state.history).toHaveLength(1);
    expect(state.receipts).toHaveLength(1);
    expect(state.notifications).toHaveLength(2);
    expect(await store.issue(fixture.staff, fixture.sessionId, fixture.issueId))
      .toMatchObject({ status: "claimed", owner: fixture.specialist.accountId, revision: 2 });
  }, timeout);

  it("cleans only its own fixture while preserving another run's workflow and access records", async () => {
    expect(await execute(claim())).toEqual({ outcome: "committed", issueId: fixture.issueId });
    const ownState = await fixture.durableState();
    const other = new D1Fixture(db);
    await other.create();
    try {
      expect(await new D1ApplicationStore(db).execute(other.staff, other.sessionId, randomUUID(), {
        type: "claim", issue_id: other.issueId, revision: 1,
      })).toEqual({ outcome: "committed", issueId: other.issueId });
    } finally {
      await other.cleanup();
    }
    expect(await fixture.durableState()).toEqual(ownState);
    expect(await store.issue(fixture.staff, fixture.sessionId, fixture.issueId))
      .toMatchObject({ status: "claimed", owner: fixture.staff.accountId });
  }, timeout);
});
