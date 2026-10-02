import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

// Embedded PostgreSQL runs the actual migration and RLS, with a small stand-in
// for Supabase Auth's verified user context. Hosted Auth/Realtime need cloud tests.
const db = new PGlite();
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const session = id(100);
const secondSession = id(101);
const aurora = id(201);
const cedar = id(202);
const admin = id(1);
const contestant = id(2);
const volunteer = id(3);
const specialist = id(4);
const jury = id(5);
const combined = id(6);
let request = 0;
async function actor(user: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
}
async function workflow(
  action: Record<string, unknown>,
  requestId = id(++request + 1000),
  s = session,
): Promise<string> {
  const result = await db.query<{ id: string }>(
    "select public.workflow($1,$2,$3::jsonb) as id",
    [s, requestId, JSON.stringify(action)],
  );
  return result.rows[0].id;
}
async function submit() {
  await actor(contestant);
  return workflow({
    type: "submit",
    category: "Backend",
    description: "Connection broken",
  });
}
async function issue(issueId: string) {
  const result = await db.query<{
    revision: number;
    owner: string;
    status: string;
    first_assigned_at: Date;
  }>("select * from public.issues where id=$1", [issueId]);
  return result.rows[0];
}
async function action(issueId: string, type: string, extra = {}) {
  const current = await issue(issueId);
  return workflow({
    type,
    issue_id: issueId,
    revision: current.revision,
    ...extra,
  });
}
async function resolve(issueId: string) {
  await actor(specialist);
  await action(issueId, "claim");
  await action(issueId, "resolve", { summary: "Service restored" });
}
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create publication supabase_realtime;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  for (let n = 1; n <= 8; n++)
    await db.query("insert into auth.users values($1,$2::jsonb)", [
      id(n),
      JSON.stringify({ name: `Person ${n}` }),
    ]);
  await db.query("insert into public.events(id,name) values($1,$2)", [
    id(90),
    "Test event",
  ]);
  await db.query(
    "insert into public.sessions(id,event_id,name,intake_open) values($1,$3,'Primary',true),($2,$3,'Isolated',true)",
    [session, secondSession, id(90)],
  );
  await db.query(
    "insert into public.teams(id,session_id,name,location) values($1,$4,'Aurora','A12'),($2,$4,'Cedar','A18'),($3,$5,'Other session','B01')",
    [aurora, cedar, id(203), session, secondSession],
  );
}, 30000);
beforeEach(async () => {
  await db.exec("reset role");
  await db.exec(
    "truncate public.admin_audit,public.history,public.awards,public.resolutions,public.issues,public.changes,public.staff_changes,app_private.receipts,public.memberships cascade",
  );
  await db.query("update public.events set archived=false");
  await db.query("update public.sessions set intake_open=true");
  for (const [user, team, roles, isAdmin, s] of [
    [admin, null, [], true, session],
    [contestant, aurora, [], false, session],
    [volunteer, null, ["volunteer"], false, session],
    [specialist, null, ["specialist"], false, session],
    [jury, null, ["jury"], false, session],
    [combined, null, ["volunteer", "specialist", "jury"], false, session],
    [id(7), cedar, [], false, session],
    [id(8), id(203), [], false, secondSession],
  ] as const)
    await db.query("insert into public.memberships values($1,$2,$3,$4,$5)", [
      s,
      user,
      team,
      roles,
      isAdmin,
    ]);
});
afterAll(async () => {
  await db.close();
});

describe("cloud database authorization and workflow", () => {
  it("does not expose private-note activity through public revisions or live signals", async () => {
    const i = await submit();
    const before = await issue(i);
    const publicBefore = await db.query("select revision from public.changes");
    await actor(volunteer);
    await action(i, "message", { text: "Private", visibility: "internal" });
    expect(
      (await db.query("select * from public.staff_changes")).rows,
    ).toHaveLength(1);
    await actor(contestant);
    expect((await issue(i)).revision).toBe(before.revision);
    expect(
      (await db.query("select revision from public.changes")).rows,
    ).toEqual(publicBefore.rows);
    expect((await db.query("select * from public.staff_changes")).rows).toEqual(
      [],
    );
  });

  it("preserves the journey, handoff owner, award and separate application", async () => {
    const i = await submit();
    await actor(volunteer);
    await action(i, "claim");
    const first = await issue(i);
    await action(i, "escalate");
    expect((await issue(i)).owner).toBe(volunteer);
    await actor(specialist);
    await action(i, "accept");
    expect((await issue(i)).first_assigned_at).toEqual(first.first_assigned_at);
    await action(i, "resolve", { summary: "Fixed" });
    await actor(jury);
    await action(i, "award", {
      minutes: 0,
      explanation: "No extra time needed",
    });
    const award = (
      await db.query<{ minutes: number; applied_at: string | null }>(
        "select * from public.awards",
      )
    ).rows[0];
    expect(award.minutes).toBe(0);
    expect(award.applied_at).toBeNull();
    await actor(volunteer);
    await action(i, "apply");
    expect(
      (await db.query<{ applied_by: string }>("select * from public.awards"))
        .rows[0].applied_by,
    ).toBe(volunteer);
  });
  it("hides another team, another session and internal history through direct API reads and snapshots", async () => {
    const i = await submit();
    await actor(volunteer);
    await action(i, "message", {
      text: "Private diagnostic",
      visibility: "internal",
    });
    await actor(contestant);
    expect(
      (
        await db.query(
          "select * from public.history where visibility='internal'",
        )
      ).rows,
    ).toHaveLength(0);
    const snapshot = (
      await db.query<{ state: { history: Array<{ text: string }> } }>(
        "select public.session_snapshot($1) as state",
        [session],
      )
    ).rows[0].state;
    expect(snapshot.history.some((h) => h.text === "Private diagnostic")).toBe(
      false,
    );
    await actor(id(7));
    expect((await db.query("select * from public.issues")).rows).toHaveLength(
      0,
    );
    expect((await db.query("select * from public.history")).rows).toHaveLength(
      0,
    );
    await actor(id(8));
    expect((await db.query("select * from public.issues")).rows).toHaveLength(
      0,
    );
    expect((await db.query("select * from public.sessions")).rows).toHaveLength(
      1,
    );
    await expect(
      workflow(
        { type: "submit", category: "Backend", description: "Attack" },
        undefined,
        session,
      ),
    ).rejects.toThrow("No access");
  });
  it("denies anonymous reads and actions, and direct writes for authenticated users", async () => {
    await db.exec("set role anon");
    await expect(db.query("select * from public.issues")).rejects.toThrow(
      "permission denied",
    );
    await expect(workflow({ type: "submit" })).rejects.toThrow(
      "permission denied",
    );
    await actor(contestant);
    await expect(
      db.query(
        "insert into public.issues(session_id,team_id,reporter,reporter_name,category,description) values($1,$2,$3,'Spoof','Backend','Attack')",
        [session, aurora, contestant],
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query("update public.memberships set is_admin=true"),
    ).rejects.toThrow("permission denied");
  });
  it("combines capabilities but rejects accepting one’s own handoff and non-owner resolution", async () => {
    const i = await submit();
    await actor(combined);
    await action(i, "claim");
    await action(i, "escalate");
    await expect(action(i, "accept")).rejects.toThrow("Another specialist");
    await actor(volunteer);
    await expect(action(i, "resolve", { summary: "Not mine" })).rejects.toThrow(
      "active owner",
    );
    await actor(specialist);
    await action(i, "accept");
    await action(i, "resolve", { summary: "Fixed" });
    await actor(combined);
    await action(i, "award", { minutes: 5, explanation: "Lost time" });
  });
  it("retains every resolution, the owner and applied award through reopening cycles", async () => {
    const i = await submit();
    await resolve(i);
    await actor(jury);
    await action(i, "award", { minutes: 7, explanation: "Lost time" });
    await action(i, "apply");
    await actor(contestant);
    await action(i, "reopen", { reason: "Still broken" });
    expect((await issue(i)).owner).toBe(specialist);
    await actor(specialist);
    await action(i, "resolve", { summary: "Second fix" });
    await actor(volunteer);
    await action(i, "reopen", { reason: "Helper saw recurrence" });
    expect(
      (await db.query("select * from public.resolutions")).rows,
    ).toHaveLength(2);
    expect(
      (await db.query<{ applied_at: string }>("select * from public.awards"))
        .rows[0].applied_at,
    ).toBeTruthy();
    await actor(jury);
    await expect(
      action(i, "reopen", { reason: "Not support" }),
    ).rejects.toThrow("Only support");
  });
  it("does not grant admin-only accounts support or reopening powers", async () => {
    const i = await submit();
    await resolve(i);
    await actor(admin);
    await expect(
      action(i, "reopen", { reason: "Admin is not support" }),
    ).rejects.toThrow("Only support");
    await expect(
      action(i, "award", { minutes: 2, explanation: "Admin is not jury" }),
    ).rejects.toThrow("Only jury");
  });
  it("ignores a contestant’s forged team ID and forbids private messages", async () => {
    await actor(contestant);
    const i = await workflow({
      type: "submit",
      category: "Backend",
      description: "Own team",
      team_id: cedar,
    });
    expect(
      (await db.query<{ team_id: string }>("select * from public.issues"))
        .rows[0].team_id,
    ).toBe(aurora);
    await expect(
      action(i, "message", { text: "Secret", visibility: "internal" }),
    ).rejects.toThrow("staff only");
  });
  it("closes contestant intake while allowing staff submissions and reopening", async () => {
    const i = await submit();
    await resolve(i);
    await actor(admin);
    await db.query("select public.set_intake($1,false)", [session]);
    await actor(contestant);
    await expect(submit()).rejects.toThrow("intake is closed");
    await action(i, "reopen", { reason: "Still broken" });
    await actor(volunteer);
    await workflow({
      type: "submit",
      team_id: cedar,
      category: "Backend",
      description: "Staff report",
    });
    expect(
      (
        await db.query<{ reporter: string }>(
          "select * from public.issues where team_id=$1",
          [cedar],
        )
      ).rows[0].reporter,
    ).toBe(volunteer);
  });
  it("rejects stale competing claims and duplicate awards without altering ownership/history", async () => {
    const i = await submit();
    await actor(volunteer);
    await workflow({ type: "claim", issue_id: i, revision: 0 });
    await actor(specialist);
    await expect(
      workflow({ type: "claim", issue_id: i, revision: 0 }),
    ).rejects.toThrow("Issue changed");
    expect((await issue(i)).owner).toBe(volunteer);
    await actor(volunteer);
    await action(i, "resolve", { summary: "Fixed" });
    await actor(jury);
    const revision = (await issue(i)).revision;
    await workflow({
      type: "award",
      issue_id: i,
      revision,
      minutes: 5,
      explanation: "Lost time",
    });
    await expect(
      workflow({
        type: "award",
        issue_id: i,
        revision,
        minutes: 10,
        explanation: "Duplicate",
      }),
    ).rejects.toThrow("Issue changed");
    await expect(
      action(i, "award", { minutes: 10, explanation: "Duplicate" }),
    ).rejects.toThrow("unique");
    expect((await db.query("select * from public.awards")).rows).toHaveLength(
      1,
    );
  });
  it("uses persisted request IDs to retry submissions/messages without duplicates", async () => {
    await actor(contestant);
    const req = id(999);
    const cmd = { type: "submit", category: "Backend", description: "Retry" };
    const i = await workflow(cmd, req);
    expect(await workflow(cmd, req)).toBe(i);
    expect((await db.query("select * from public.issues")).rows).toHaveLength(
      1,
    );
    await expect(
      workflow({ ...cmd, description: "Changed request" }, req),
    ).rejects.toThrow("already used");
    const messageRequest = id(998);
    const message = {
      type: "message",
      issue_id: i,
      revision: 0,
      text: "Hello",
      visibility: "public",
    };
    await workflow(message, messageRequest);
    await workflow(message, messageRequest);
    expect((await db.query("select * from public.history")).rows).toHaveLength(
      2,
    );
  });
  it("enforces admin membership, current revocation and the last-admin safeguard", async () => {
    await actor(volunteer);
    await expect(
      db.query("select public.set_intake($1,false)", [session]),
    ).rejects.toThrow("Admin membership");
    await actor(admin);
    await expect(
      db.query("select public.manage_member($1,$2,null,$3,false,true)", [
        session,
        admin,
        [],
      ]),
    ).rejects.toThrow("last admin");
    await db.query("select public.manage_member($1,$2,null,$3,false,true)", [
      session,
      volunteer,
      [],
    ]);
    await actor(volunteer);
    expect((await db.query("select * from public.issues")).rows).toHaveLength(
      0,
    );
    await expect(
      workflow({
        type: "submit",
        team_id: aurora,
        category: "Backend",
        description: "Revoked",
      }),
    ).rejects.toThrow("No access");
  });
  it("rejects invalid contents/minutes and archived-event writes", async () => {
    await actor(contestant);
    await expect(
      workflow({ type: "submit", category: "Backend", description: "   " }),
    ).rejects.toThrow("2,000");
    const i = await submit();
    await resolve(i);
    await actor(jury);
    for (const minutes of [-1, 1.5, null])
      await expect(
        action(i, "award", { minutes, explanation: "Invalid" }),
      ).rejects.toThrow("whole minutes");
    await db.exec("reset role");
    await db.query("update public.events set archived=true");
    await actor(specialist);
    await expect(action(i, "reopen", { reason: "Read only" })).rejects.toThrow(
      "archived",
    );
    await actor(admin);
    await expect(
      db.query("select public.set_intake($1,true)", [session]),
    ).rejects.toThrow("archived");
  });
});
