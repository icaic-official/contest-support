import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { snapshotSchema, unresolvedTime, type Snapshot } from "../../../connected/model";
import type { Caller } from '../../authentication';
import type { CommandResult } from '../../workflow';
import { WorkflowService, type WorkflowPersistence } from "../../workflow";
import { createSupabaseWorkflowPersistence } from "./store";

// Execute the repository migrations and database guards. Only Supabase Auth and
// Storage infrastructure are supplied locally; workflow writes are never faked.
const db = new PGlite();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
const caller = (accountId: string): Caller => ({ accountId, loginId: id(Number(accountId.slice(-12)) + 300) });

async function actor(user: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ session_id: caller(user).loginId })]);
  await db.exec("set role authenticated");
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  if (!["shared_workflow_read", "shared_workflow_commit"].includes(name)) throw new Error("Unexpected RPC.");
  const entries = Object.entries(parameters);
  const sql = `select public.${name}(${entries.map(([key], index) => `${key} => $${index + 1}`).join(",")}) as value`;
  await db.exec("reset role");
  await db.exec("set role service_role");
  try {
    const result = await db.query<{ value: unknown }>(sql, entries.map(([, value]) => value));
    return { data: result.rows[0].value, error: null };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    return { data: null, error: { code, message: String(error) } };
  } finally {
    await db.exec("reset role");
  }
}

function persistence(): WorkflowPersistence { return createSupabaseWorkflowPersistence(rpc); }
function service(store = persistence()) { return new WorkflowService(store); }
async function execute(user: string, command: unknown, requestId = randomUUID(), s = session, app = service()) {
  return app.execute(caller(user), s, requestId, command);
}
function committed(result: CommandResult): string {
  expect(result.outcome).toBe("committed");
  if (result.outcome !== "committed") throw new Error(`Expected commit, got ${JSON.stringify(result)}.`);
  return result.issueId;
}
async function submit(user = contestant, fields = {}) {
  return committed(await execute(user, { type: "submit", category: "Backend", description: "Fixture connection broken", ...fields }));
}
async function snapshot(user = specialist, s = session): Promise<Snapshot> {
  await actor(user);
  try {
    const result = await db.query<{ value: unknown }>("select public.session_snapshot($1) as value", [s]);
    return snapshotSchema.parse(result.rows[0].value);
  } finally { await db.exec("reset role"); }
}
async function issue(issueId: string) {
  const found = (await snapshot()).issues.find((item) => item.id === issueId);
  if (!found) throw new Error("Fixture issue missing.");
  return found;
}
async function change(user: string, issueId: string, type: string, fields = {}, requestId = randomUUID(), app = service()) {
  return execute(user, { type, issue_id: issueId, revision: (await issue(issueId)).revision, ...fields }, requestId, session, app);
}
function beforeCommit(action: () => Promise<void>): WorkflowPersistence {
  const store = persistence();
  let invoked = false;
  return { read: (...args) => store.read(...args), commit: async (...args) => {
    if (!invoked) { invoked = true; await action(); }
    return store.commit(...args);
  } };
}
async function durableState() {
  await db.exec("reset role");
  return (await db.query<{ value: unknown }>(`select jsonb_build_object(
    'issues',(select jsonb_agg(x order by id) from public.issues x),
    'history',(select jsonb_agg(x order by id) from public.history x),
    'resolutions',(select jsonb_agg(x order by id) from public.resolutions x),
    'awards',(select jsonb_agg(x order by id) from public.awards x),
    'receipts',(select jsonb_agg(x order by request_id) from app_private.receipts x),
    'changes',(select jsonb_agg(x order by session_id,team_id) from public.changes x),
    'staff_changes',(select jsonb_agg(x order by session_id) from public.staff_changes x)) as value`)).rows[0].value;
}

beforeAll(async () => {
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}', encrypted_password text default 'initial-hash', banned_until timestamptz, deleted_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default clock_timestamp(),not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub',nullif(current_setting('request.jwt.claim.sub',true),''))::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create publication supabase_realtime;
    create schema if not exists storage;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text,
      name text,
      metadata jsonb
    );
    -- Match the managed Storage table's security before application migrations.
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
    declare parts text[];
    begin
      parts := string_to_array(name, '/');
      return parts[1:array_length(parts,1)-1];
    end $$;
    create function storage.filename(name text) returns text language plpgsql immutable as $$
    declare parts text[];
    begin
      parts := string_to_array(name, '/');
      return parts[array_length(parts,1)];
    end $$;
    grant usage on schema storage to authenticated, service_role;
    grant all on storage.buckets, storage.objects to authenticated, service_role;`,
  );
  for (
    const file of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()
  ) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  for (let n = 1; n <= 8; n++) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [
        id(n),
        JSON.stringify({ name: `Person ${n}` }),
      ],
    );
  }
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
    "truncate public.attachments,public.admin_audit,public.history,public.awards,public.resolutions,public.issues,public.changes,public.staff_changes,app_private.receipts,public.memberships,storage.objects cascade",
  );
  await db.exec("truncate app_private.account_credentials,auth.sessions");
  await db.query("update public.people set username=null");
  await db.query("update auth.users set encrypted_password='initial-hash',banned_until=null,deleted_at=null");
  for (let n = 1; n <= 8; n++) {
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [
      id(n + 300),
      id(n),
    ]);
  }
  await db.query("update public.events set archived=false");
  await db.query(
    "update public.sessions set intake_open=true, max_image_bytes=10485760, max_images_per_issue=12, max_image_bytes_per_issue=125829120",
  );
  for (
    const [user, team, roles, isAdmin, s] of [
      [admin, null, [], true, session],
      [contestant, aurora, [], false, session],
      [volunteer, null, ["volunteer"], false, session],
      [specialist, null, ["specialist"], false, session],
      [jury, null, ["jury"], false, session],
      [combined, null, ["volunteer", "specialist", "jury"], false, session],
      [id(7), cedar, [], false, session],
      [id(8), id(203), [], false, secondSession],
    ] as const
  ) {
    await db.query("insert into public.memberships values($1,$2,$3,$4,$5)", [
      s,
      user,
      team,
      roles,
      isAdmin,
    ]);
  }
});
afterAll(async () => {
  await db.close();
});

describe("shared workflow through the Supabase persistence adapter", () => {
  it("preserves all lifecycle commands, ownership, actors, and both resolution intervals", async () => {
    const issueId = await submit();
    const created = await issue(issueId);
    expect(created).toMatchObject({ status: "open", owner: null, first_assigned_at: null });
    expect(Number.isFinite(Date.parse(created.created_at))).toBe(true);
    committed(await change(volunteer, issueId, "claim"));
    const claimed = await issue(issueId);
    expect(claimed.owner).toBe(volunteer);
    expect((await snapshot()).history[1].at).toBe(claimed.first_assigned_at);
    expect(Date.parse(claimed.first_assigned_at!)).toBeGreaterThanOrEqual(Date.parse(created.created_at));
    expect(await change(specialist, issueId, "resolve", { summary: "Not the owner" })).toMatchObject({ outcome: "rejected" });
    committed(await change(volunteer, issueId, "escalate"));
    expect(await issue(issueId)).toMatchObject({ owner: volunteer, status: "escalated" });
    await db.query("update public.memberships set roles='{volunteer,specialist}' where user_id=$1", [volunteer]);
    expect(await change(volunteer, issueId, "accept")).toMatchObject({ outcome: "rejected" });
    committed(await change(specialist, issueId, "accept"));
    expect(await issue(issueId)).toMatchObject({ owner: specialist, first_assigned_at: claimed.first_assigned_at });
    committed(await change(specialist, issueId, "resolve", { summary: "Replaced fixture cable" }));
    const resolved = await issue(issueId);
    expect(resolved).toMatchObject({ status: "resolved", owner: specialist });
    expect(resolved.resolved_at).not.toBeNull();
    expect((await snapshot()).resolutions[0].at).toBe(resolved.resolved_at);
    expect((await snapshot()).history.at(-1)!.at).toBe(resolved.resolved_at);
    expect(await change(contestant, issueId, "message", { text: "Resolved reply", visibility: "public" })).toMatchObject({ outcome: "rejected" });
    committed(await change(jury, issueId, "award", { minutes: 2, explanation: "Fixture interruption" }));
    const originalAward = (await snapshot()).awards[0];
    expect(originalAward).toMatchObject({ minutes: 2, applied_at: null });
    expect((await snapshot()).history.at(-1)!.at).toBe(originalAward.at);
    committed(await change(contestant, issueId, "reopen", { reason: "Fixture failed again" }));
    expect(await issue(issueId)).toMatchObject({ status: "claimed", owner: specialist, resolved_at: null, created_at: created.created_at, first_assigned_at: claimed.first_assigned_at });
    // Application confirmation remains valid after reopening. It records an
    // external action, so it does not require the issue to remain resolved.
    committed(await change(volunteer, issueId, "apply"));
    expect((await snapshot()).awards[0]).toMatchObject({ id: originalAward.id, resolution_id: originalAward.resolution_id });
    expect((await snapshot()).awards[0].applied_at).not.toBeNull();
    expect(await change(volunteer, issueId, "apply")).toMatchObject({ outcome: "rejected" });
    committed(await change(specialist, issueId, "resolve", { summary: "Replaced fixture port" }));
    expect(await change(jury, issueId, "award", { minutes: 3, explanation: "Duplicate award" })).toMatchObject({ outcome: "rejected" });
    const final = await snapshot(contestant);
    const resolutions = final.resolutions.filter((item) => item.issue_id === issueId);
    expect(resolutions.map((item) => [item.summary, item.actor])).toEqual([["Replaced fixture cable", specialist], ["Replaced fixture port", specialist]]);
    expect(resolutions[0]).toMatchObject({ reopened_by: contestant, reason: "Fixture failed again" });
    expect(resolutions[0].reopened_at).not.toBeNull();
    expect(resolutions[1].reopened_at).toBeNull();
    const finalIssue = final.issues[0];
    const expectedTime = Date.parse(resolutions[0].at) - Date.parse(created.created_at) + Date.parse(resolutions[1].at) - Date.parse(resolutions[0].reopened_at!);
    expect(unresolvedTime(finalIssue, resolutions, Date.parse(final.server_time) + 60_000)).toBe(expectedTime);
    expect(final.history.map((item) => item.actor)).toEqual([contestant, volunteer, volunteer, specialist, specialist, jury, contestant, volunteer, specialist]);
    expect(final.history.every((item) => item.actor_name.length > 0)).toBe(true);
    expect(final.awards).toHaveLength(1);
    expect(final.awards[0].id).toBe(originalAward.id);
  });

  it("combines all assigned role capabilities and keeps admin-only powers distinct", async () => {
    const issueId = await submit(combined, { team_id: aurora });
    committed(await change(combined, issueId, "claim"));
    committed(await change(combined, issueId, "message", { text: "Combined staff note", visibility: "internal" }));
    committed(await change(combined, issueId, "resolve", { summary: "Combined-role repair" }));
    committed(await change(combined, issueId, "award", { minutes: 0, explanation: "No time lost" }));
    committed(await change(combined, issueId, "apply"));
    expect(await submit()).toBeTruthy();
    const open = (await snapshot()).issues.find((item) => item.status === "open")!;
    for (const user of [admin, jury, contestant]) {
      expect(await change(user, open.id, "claim")).toMatchObject({ outcome: "rejected" });
    }
    expect(await change(admin, open.id, "message", { text: "Admin without workflow role", visibility: "internal" })).toMatchObject({ outcome: "rejected" });
    expect(await execute(admin, { type: "submit", category: "Backend", description: "Admin-only report", team_id: aurora })).toMatchObject({ outcome: "rejected" });
    expect(await change(jury, issueId, "reopen", { reason: "Jury without support" })).toMatchObject({ outcome: "rejected" });
  });

  it("keeps private activity out of team reads, public revisions, and public notifications", async () => {
    const issueId = await submit();
    const before = await issue(issueId);
    const publicBefore = (await db.query("select * from public.changes")).rows;
    committed(await change(volunteer, issueId, "message", { text: " Staff diagnosis ", visibility: "internal" }));
    expect((await issue(issueId)).revision).toBe(before.revision);
    expect((await db.query("select * from public.changes")).rows).toEqual(publicBefore);
    expect((await db.query("select * from public.staff_changes")).rows).toHaveLength(1);
    committed(await change(jury, issueId, "message", { text: " Jury public response ", visibility: "public" }));
    expect((await snapshot()).history.some((item) => item.text === "Staff diagnosis")).toBe(true);
    const team = await snapshot(contestant);
    expect(team.history.some((item) => item.text === "Jury public response")).toBe(true);
    expect(team.history.every((item) => item.visibility === "public")).toBe(true);
    expect(await change(contestant, issueId, "message", { text: "Team internal note", visibility: "internal" })).toMatchObject({ outcome: "rejected" });
    expect((await snapshot(id(7))).issues).toEqual([]);
    expect((await snapshot(id(8))).issues).toEqual([]);
    for (const user of [id(7), id(8)]) {
      expect(await execute(user, { type: "message", issue_id: issueId, revision: (await issue(issueId)).revision, text: "Cross-boundary response", visibility: "public" })).toMatchObject({ outcome: "rejected" });
    }
  });

  it("retains request content across a lost committed response and rejects conflicting reuse", async () => {
    const base = persistence();
    let drop = true;
    const faulty: WorkflowPersistence = { read: (...args) => base.read(...args), commit: async (...args) => {
      const result = await base.commit(...args);
      if (drop) { drop = false; throw new Error("Connection lost after commit."); }
      return result;
    } };
    const app = service(faulty);
    const requestId = randomUUID();
    const command = { type: "submit", category: "Backend", description: "  Preserve exact retry content  " };
    expect(await execute(contestant, command, requestId, session, app)).toEqual({ outcome: "unknown" });
    const state = await durableState();
    const issueId = committed(await execute(contestant, command, requestId, session, app));
    expect(await durableState()).toEqual(state);
    expect(await execute(contestant, { ...command, description: command.description.trim() }, requestId)).toMatchObject({ outcome: "rejected", reason: "request_id" });
    expect(await execute(contestant, command, requestId, secondSession)).toMatchObject({ outcome: "rejected" });
    expect((await snapshot()).issues).toHaveLength(1);
    expect((await issue(issueId)).description).toBe(command.description.trim());
  });

  it("replays a successful old revision before evaluating current workflow state", async () => {
    const issueId = await submit();
    const revision = (await issue(issueId)).revision;
    const command = { type: "claim", issue_id: issueId, revision };
    const requestId = randomUUID();
    committed(await execute(volunteer, command, requestId));
    committed(await change(volunteer, issueId, "resolve", { summary: "Already finished" }));
    const before = await durableState();
    expect(await execute(volunteer, command, requestId)).toEqual({ outcome: "committed", issueId });
    expect(await durableState()).toEqual(before);
    await db.query("delete from public.memberships where user_id=$1", [volunteer]);
    expect(await execute(volunteer, command, requestId)).toMatchObject({ outcome: "rejected" });
  });

  it("rejects stale decisions when a second claim commits after the decision read", async () => {
    const issueId = await submit();
    const app = service(beforeCommit(async () => { committed(await change(specialist, issueId, "claim")); }));
    expect(await change(volunteer, issueId, "claim", {}, randomUUID(), app)).toMatchObject({ outcome: "rejected" });
    const state = await snapshot();
    expect(state.issues[0].owner).toBe(specialist);
    expect(state.history).toHaveLength(2);
    expect((await db.query("select * from app_private.receipts")).rows).toHaveLength(2);
  });

  it("allows only one of concurrent claims and concurrent uses of one request", async () => {
    const issueId = await submit();
    const command = { type: "claim", issue_id: issueId, revision: (await issue(issueId)).revision };
    const results = await Promise.all([execute(volunteer, command), execute(specialist, command)]);
    expect(results.filter((result) => result.outcome === "committed")).toHaveLength(1);
    expect((await snapshot()).history).toHaveLength(2);
    const second = await submit();
    const requestId = randomUUID();
    const same = { type: "claim", issue_id: second, revision: (await issue(second)).revision };
    expect(await Promise.all([execute(volunteer, same, requestId), execute(volunteer, same, requestId)])).toEqual([{ outcome: "committed", issueId: second }, { outcome: "committed", issueId: second }]);
    expect((await snapshot()).history.filter((item) => item.issue_id === second)).toHaveLength(2);
  });

  it("reserves one request atomically when concurrent content conflicts", async () => {
    const requestId = randomUUID();
    const command = { type: "submit", category: "Backend", description: "Concurrent request A" };
    const results = await Promise.all([
      execute(contestant, command, requestId),
      execute(contestant, { ...command, description: "Concurrent request B" }, requestId),
    ]);
    expect(results.filter((result) => result.outcome === "committed")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "rejected")).toEqual([{ outcome: "rejected", reason: "request_id" }]);
    expect((await snapshot()).issues).toHaveLength(1);
    expect((await snapshot()).history).toHaveLength(1);
    expect((await db.query("select * from app_private.receipts")).rows).toHaveLength(1);
  });

  it("invalidates a stale decision after private activity without changing public revision", async () => {
    const issueId = await submit();
    const originalRevision = (await issue(issueId)).revision;
    const base = persistence();
    let commits = 0;
    const raced: WorkflowPersistence = { read: (...args) => base.read(...args), commit: async (...args) => {
      commits++;
      if (commits === 1) {
        committed(await change(specialist, issueId, "message", { text: "Concurrent internal note", visibility: "internal" }));
        expect((await issue(issueId)).revision).toBe(originalRevision);
      }
      return base.commit(...args);
    } };
    committed(await change(volunteer, issueId, "claim", {}, randomUUID(), service(raced)));
    expect(commits).toBe(2);
    expect((await snapshot(contestant)).history).toHaveLength(2);
    expect((await snapshot()).history).toHaveLength(3);
  });

  it.each(["roles", "membership", "login", "password", "archive", "intake", "expired", "banned", "deleted"] as const)("rechecks %s changes between the decision and commit", async (kind) => {
    const issueId = await submit();
    const user = kind === "intake" ? contestant : volunteer;
    const app = service(beforeCommit(async () => {
      if (kind === "roles") await db.query("update public.memberships set roles='{jury}' where user_id=$1", [user]);
      if (kind === "membership") await db.query("delete from public.memberships where user_id=$1", [user]);
      if (kind === "login") await db.query("delete from auth.sessions where user_id=$1", [user]);
      if (kind === "expired") await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where user_id=$1", [user]);
      if (kind === "banned") await db.query("update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=$1", [user]);
      if (kind === "deleted") await db.query("update auth.users set deleted_at=clock_timestamp() where id=$1", [user]);
      if (kind === "password") await db.query("insert into app_private.account_credentials(user_id,must_change) values($1,true)", [user]);
      if (kind === "archive") await db.query("update public.events set archived=true");
      if (kind === "intake") await db.query("update public.sessions set intake_open=false where id=$1", [session]);
    }));
    const before = await durableState();
    const result = kind === "intake"
      ? await execute(user, { type: "submit", category: "Backend", description: "Intake raced" }, randomUUID(), session, app)
      : await change(user, issueId, "claim", {}, randomUUID(), app);
    expect(result).toMatchObject({ outcome: "rejected" });
    expect(await durableState()).toEqual(before);
  });

  it.each(["claim", "receipt replay"])("checks login expiry after a delayed %s commit", async (kind) => {
    const issueId = await submit();
    const command = { type: "claim", issue_id: issueId, revision: (await issue(issueId)).revision };
    const requestId = randomUUID();
    if (kind === "receipt replay") committed(await execute(volunteer, command, requestId));
    const before = await durableState();

    // A nested call retains the outer statement's start time, as a real commit
    // does while it waits for a row lock. Delay until this login expires.
    await db.exec(`
      alter function public.shared_workflow_commit(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb)
        rename to shared_workflow_commit_without_delay;
      create function public.shared_workflow_commit(p_actor uuid,p_login uuid,p_session uuid,p_request uuid,
        p_action jsonb,p_dependency jsonb,p_decision jsonb) returns jsonb
      language plpgsql security definer set search_path = '' as $$
      declare expiry timestamptz;
      begin
        select not_after into expiry from auth.sessions where id=p_login;
        if expiry <= statement_timestamp() then raise exception 'Fixture expired before the delayed statement began.'; end if;
        while clock_timestamp() <= expiry loop end loop;
        return public.shared_workflow_commit_without_delay(p_actor,p_login,p_session,p_request,p_action,p_dependency,p_decision);
      end $$;
    `);
    try {
      await db.query("update auth.sessions set not_after=clock_timestamp()+interval '1 second' where user_id=$1", [volunteer]);
      expect(await execute(volunteer, command, requestId)).toEqual({ outcome: "rejected", reason: "access" });
      expect(await durableState()).toEqual(before);
    } finally {
      await db.exec(`
        drop function public.shared_workflow_commit(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb);
        alter function public.shared_workflow_commit_without_delay(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb)
          rename to shared_workflow_commit;
      `);
    }
  });

  it("rolls back issue, receipt, history, and notifications if a final notification insert fails", async () => {
    const issueId = await submit();
    const before = await durableState();
    await db.exec(`create function app_private.fail_workflow_notification() returns trigger language plpgsql as $$ begin raise exception 'Injected notification failure'; end $$;
      create trigger fail_workflow_notification before update on public.changes for each row execute function app_private.fail_workflow_notification()`);
    try {
      expect(await change(volunteer, issueId, "claim")).not.toMatchObject({ outcome: "committed" });
      expect(await durableState()).toEqual(before);
    } finally {
      await db.exec("drop trigger fail_workflow_notification on public.changes; drop function app_private.fail_workflow_notification()");
    }
  });

  it("rejects malformed inputs and invalid caller sessions without writes", async () => {
    const before = await durableState();
    for (const command of [null, {}, { type: "impersonate", accountId: admin }, { type: "submit", category: "Backend", description: " " }, { type: "submit", category: "Unknown", description: "Bad category" }]) {
      expect(await execute(contestant, command)).toMatchObject({ outcome: "rejected" });
    }
    expect(await service().execute({ accountId: contestant, loginId: caller(admin).loginId }, session, randomUUID(), { type: "submit", category: "Backend", description: "Wrong login" })).toMatchObject({ outcome: "rejected" });
    expect(await durableState()).toEqual(before);
  });

  it("denies authenticated browsers the privileged plan RPCs and direct table writes", async () => {
    const issueId = await submit();
    const before = await durableState();
    await actor(contestant);
    await expect(db.query("select public.shared_workflow_read($1,$2,$3,$4,$5::jsonb)", [contestant, caller(contestant).loginId, session, randomUUID(), JSON.stringify({ type: "claim", issue_id: issueId, revision: 0 })])).rejects.toThrow("permission denied");
    await expect(db.query("select public.shared_workflow_commit($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)", [contestant, caller(contestant).loginId, session, randomUUID(), JSON.stringify({ type: "claim", issue_id: issueId, revision: 0 }), "{}", "{}"])) .rejects.toThrow("permission denied");
    await expect(db.query("select public.workflow($1,$2,$3::jsonb)", [session, randomUUID(), JSON.stringify({ type: "claim", issue_id: issueId, revision: 0 })])).rejects.toThrow("Only support");
    await expect(db.query("update public.issues set owner=$1,status='claimed' where id=$2", [contestant, issueId])).rejects.toThrow("permission denied");
    await db.exec("reset role");
    expect(await durableState()).toEqual(before);
  });
});
