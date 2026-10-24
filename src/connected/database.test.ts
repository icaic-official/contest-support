import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { sessionTables } from "../../tests/support/supabaseCleanup";
import { migrateSupabaseTestDatabase } from "../../tests/support/supabaseDatabase";

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
async function actor(
  user: string,
  authSession = id(Number(user.slice(-12)) + 300),
) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ session_id: authSession }),
  ]);
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
  await migrateSupabaseTestDatabase(db);
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
});
beforeEach(async () => {
  await db.exec("reset role");
  await db.exec(
    "truncate public.attachments,public.admin_audit,public.history,public.awards,public.resolutions,public.issues,public.changes,public.staff_changes,app_private.receipts,public.announcements,public.person_avatars,public.memberships,storage.objects cascade",
  );
  await db.exec("truncate app_private.account_credentials,auth.sessions");
  await db.query("update public.people set username=null");
  await db.query("update auth.users set encrypted_password='initial-hash'");
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

describe("cloud database authorization and workflow", () => {
  it("lists every session table for hosted fixture cleanup", async () => {
    const tables = await db.query<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
        join information_schema.tables t using (table_schema, table_name)
        where c.table_schema = 'public' and c.column_name = 'session_id' and t.table_type = 'BASE TABLE'`,
    );
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([...sessionTables].sort());
  });

  it("blocks temporary-password reads and RPC writes until Auth records a changed password", async () => {
    await db.query("select public.initialize_account($1,'team-aurora')", [
      contestant,
    ]);
    await actor(contestant);
    const status = await db.query<{ status: { must_change: boolean } }>(
      "select public.account_status() as status",
    );
    expect(status.rows[0].status.must_change).toBe(true);
    for (
      const table of [
        "sessions",
        "memberships",
        "people",
        "teams",
        "issues",
        "history",
        "admin_audit",
        "attachments",
      ]
    ) {
      expect((await db.query(`select * from public.${table}`)).rows).toEqual(
        [],
      );
    }
    await expect(submit()).rejects.toThrow("temporary password");
    await expect(db.query("select public.complete_password_change()")).rejects
      .toThrow("Change your temporary");
    await expect(
      db.query("select public.initialize_account($1,'attack')", [contestant]),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query("select public.finish_password_reset($1,$2,true)", [
        contestant,
        id(500),
      ]),
    ).rejects.toThrow("permission denied");
    await db.exec("reset role");
    await db.query(
      "update auth.users set raw_user_meta_data='{\"must_change\":false}' where id=$1",
      [contestant],
    );
    await actor(contestant);
    await expect(db.query("select public.complete_password_change()")).rejects
      .toThrow("temporary password");
    await db.exec("reset role");
    await db.query(
      "update auth.users set encrypted_password='new-hash' where id=$1",
      [contestant],
    );
    await actor(contestant);
    await db.query("select public.complete_password_change()");
    expect(await submit()).toBeTruthy();
  });
  it("reset invalidates old sessions even after the replacement password is changed", async () => {
    const i = await submit();
    await actor(admin);
    const reset = await db.query<{ token: string }>(
      "select public.begin_password_reset($1,$2) as token",
      [session, contestant],
    );
    await expect(
      db.query("select public.begin_password_reset($1,$2)", [
        session,
        contestant,
      ]),
    ).rejects.toThrow("already in progress");
    await db.exec("reset role");
    await db.query(
      "update auth.users set encrypted_password='temporary-reset' where id=$1",
      [contestant],
    );
    await db.query("select public.finish_password_reset($1,$2,true)", [
      contestant,
      reset.rows[0].token,
    ]);
    await actor(contestant);
    expect((await db.query("select * from public.issues")).rows).toEqual([]);
    await expect(db.query("select public.complete_password_change()")).rejects
      .toThrow("Sign in again");
    await db.exec("reset role");
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [
      id(999),
      contestant,
    ]);
    await db.query(
      "update auth.users set encrypted_password='replacement-personal' where id=$1",
      [contestant],
    );
    await actor(contestant, id(999));
    await db.query("select public.complete_password_change()");
    expect((await issue(i)).status).toBe("open");
    await actor(contestant);
    expect((await db.query("select * from public.issues")).rows).toEqual([]);
    await expect(submit()).rejects.toThrow("sign in again");
  });
  it("limits account-wide resets and username assignment to admins of every affected session", async () => {
    await actor(admin);
    await expect(
      db.query("select public.begin_password_reset($1,$2)", [session, admin]),
    ).rejects.toThrow("own account");
    await db.query("select public.register_username($1,$2,'organizer')", [
      session,
      admin,
    ]);
    await expect(
      db.query("select public.register_username($1,$2,'organizer')", [
        session,
        contestant,
      ]),
    ).rejects.toThrow("unique");
    await expect(
      db.query("select public.register_username($1,$2,'two')", [
        session,
        admin,
      ]),
    ).rejects.toThrow("already has");
    await db.exec("reset role");
    await db.query(
      "insert into public.memberships values($1,$2,null,'{volunteer}',false)",
      [secondSession, volunteer],
    );
    await actor(admin);
    await expect(
      db.query("select public.begin_password_reset($1,$2)", [
        session,
        volunteer,
      ]),
    ).rejects.toThrow("all its active sessions");
    await expect(
      db.query("select public.register_username($1,$2,'helper')", [
        session,
        volunteer,
      ]),
    ).rejects.toThrow("all its active sessions");
    await actor(contestant);
    await expect(
      db.query("select public.begin_password_reset($1,$2)", [
        session,
        volunteer,
      ]),
    ).rejects.toThrow("Admin membership");
  });

  it("keeps sole-admin recovery behind trusted provider credentials", async () => {
    await actor(admin);
    await expect(db.query("select public.begin_admin_recovery($1)", [admin])).rejects.toThrow("permission denied");
    await db.exec("reset role");
    await expect(db.query("select public.begin_admin_recovery($1)", [contestant])).rejects.toThrow("existing admin");
    const reset = await db.query<{token: string}>("select public.begin_admin_recovery($1) as token", [admin]);
    expect(reset.rows[0].token).toBeTruthy();
    await actor(admin);
    expect((await db.query("select * from public.sessions")).rows).toEqual([]);
    await expect(db.query("select public.set_intake($1,false)", [session])).rejects.toThrow("Admin membership");
  });
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

type StartedImage = {
  id: string;
  original_path: string;
  thumbnail_path: string;
};
async function beginImage(
  user: string,
  issueId: string,
  options: {
    visibility?: string;
    bytes?: number;
    name?: string;
    requestId?: string;
    targetSession?: string;
  } = {},
): Promise<StartedImage> {
  await actor(user);
  const result = await db.query<{ image: StartedImage }>(
    "select public.begin_attachment($1,$2,$3,$4,$5,$6) as image",
    [
      options.targetSession ?? session,
      options.requestId ?? id(++request + 8000),
      issueId,
      options.visibility ?? "internal",
      options.name ?? "board.jpg",
      options.bytes ?? 2048,
    ],
  );
  return result.rows[0].image;
}
async function stageImage(
  started: StartedImage,
  size = 1024,
) {
  await db.exec("reset role");
  await db.query(
    "insert into storage.objects(bucket_id,name,metadata) values('issue-attachments',$1,$2::jsonb),('issue-attachments',$3,$4::jsonb)",
    [started.original_path, JSON.stringify({ size }), started.thumbnail_path, JSON.stringify({ size: 400 })],
  );
}
async function completeImage(
  uploader: string,
  started: StartedImage,
  size = 1024,
  header = "ffd8ffe0",
  authSession = id(Number(uploader.slice(-12)) + 300),
) {
  await db.exec("reset role; set role service_role");
  await db.query("select public.finish_attachment($1,$2,$3,$4,$5,400,'ffd8ffe1')", [
    uploader,
    authSession,
    started.id,
    size,
    header,
  ]);
}
async function finishImage(uploader: string, started: StartedImage, size = 1024, header = "ffd8ffe0") {
  await stageImage(started, size);
  await completeImage(uploader, started, size, header);
}

describe("issue image authorization and limits", () => {
  it("lets every staff role upload and keeps contestant, cross-session and direct writes out", async () => {
    const issueId = await submit();
    for (const user of [volunteer, specialist, jury, admin, combined]) {
      const started = await beginImage(user, issueId, { bytes: 1000 });
      expect(started.original_path).toContain(issueId);
    }
    await actor(contestant);
    await expect(beginImage(contestant, issueId)).rejects.toThrow(
      "permission",
    );
    await expect(
      beginImage(id(8), issueId, { targetSession: session }),
    ).rejects.toThrow("No access");
    await db.exec("reset role");
    await db.query(
      "insert into public.memberships(session_id,user_id,roles) values($1,$2,'{volunteer}')",
      [secondSession, volunteer],
    );
    await expect(
      beginImage(volunteer, issueId, { targetSession: secondSession }),
    ).rejects.toThrow("Issue unavailable");
    await actor(volunteer);
    await expect(
      db.query(
        "insert into public.attachments(session_id,issue_id,uploader,uploader_name,visibility,declared_bytes,original_name) values($1,$2,$3,'V','internal',10,'a.jpg')",
        [session, issueId, volunteer],
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query(
        "select public.finish_attachment($1,$2,$3,1,'ffd8ff',1,'ffd8ff')",
        [volunteer, id(303), id(9)],
      ),
    ).rejects.toThrow("permission denied");
  });

  it("enforces visibility, storage access, uploader deletion and live-update signals", async () => {
    const issueId = await submit();
    const internal = await beginImage(volunteer, issueId);
    await actor(volunteer);
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('issue-attachments',$1,'{\"size\":10}')",
      [internal.original_path],
    );
    await actor(contestant);
    await expect(
      db.query("insert into storage.objects(bucket_id,name) values('issue-attachments',$1)", [
        internal.original_path,
      ]),
    ).rejects.toThrow(/row-level security|permission denied/);
    await actor(specialist);
    await expect(
      db.query("insert into storage.objects(bucket_id,name) values('issue-attachments',$1)", [
        internal.original_path,
      ]),
    ).rejects.toThrow(/row-level security|permission denied/);
    await db.exec("reset role");
    await db.query("delete from storage.objects");
    await finishImage(volunteer, internal);
    await actor(contestant);
    expect((await db.query("select * from public.attachments")).rows).toHaveLength(0);
    expect(
      (await db.query("select * from storage.objects where name=$1", [internal.original_path])).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select * from public.history where text='Image added.'")).rows,
    ).toHaveLength(0);
    await actor(jury);
    expect((await db.query("select * from public.attachments")).rows).toHaveLength(1);
    expect(
      (await db.query("select * from storage.objects where name=$1", [internal.original_path])).rows,
    ).toHaveLength(1);
    expect((await db.query<{ revision: number }>("select revision from public.changes")).rows[0].revision).toBe(1);
    expect((await db.query<{ revision: number }>("select revision from public.staff_changes")).rows[0].revision).toBe(1);

    const visible = await beginImage(specialist, issueId, { visibility: "public", bytes: 1500 });
    await finishImage(specialist, visible, 1200, "89504e470d0a1a0a");
    await actor(contestant);
    const snapshot = (
      await db.query<{ state: { attachments: Array<{ visibility: string }> } }>(
        "select public.session_snapshot($1) as state",
        [session],
      )
    ).rows[0].state;
    expect(snapshot.attachments).toHaveLength(1);
    expect(snapshot.attachments[0].visibility).toBe("public");
    expect(
      (await db.query("select * from storage.objects where name=$1", [visible.original_path])).rows,
    ).toHaveLength(1);
    await actor(id(7));
    expect((await db.query("select * from public.attachments")).rows).toHaveLength(0);

    await actor(volunteer);
    await expect(
      db.query("select public.delete_attachment($1,$2)", [session, visible.id]),
    ).rejects.toThrow("Only the person");
    await actor(specialist);
    await db.query("select public.delete_attachment($1,$2)", [session, visible.id]);
    await actor(contestant);
    expect((await db.query("select * from public.attachments")).rows).toHaveLength(0);
    expect(
      (await db.query("select text from public.history where text='Image removed.'")).rows,
    ).toHaveLength(1);
    await db.exec("reset role");
    expect(
      (await db.query<{ status: string }>("select status from public.attachments where id=$1", [visible.id])).rows[0].status,
    ).toBe("deleted");
  });

  it("applies session limits, keeps resolved and lowered-limit images, and blocks archived writes", async () => {
    const issueId = await submit();
    await actor(volunteer);
    await expect(beginImage(volunteer, issueId, { bytes: 11 * 1048576 })).rejects.toThrow(
      "larger than 10 MB",
    );
    await actor(admin);
    await db.query("select public.set_image_limits($1,1,2,1)", [session]);
    await beginImage(volunteer, issueId, { bytes: 600000 });
    await expect(beginImage(specialist, issueId, { bytes: 600000 })).rejects.toThrow(
      "1 MB limit",
    );
    await db.exec("reset role");
    await db.query("update public.attachments set status='expired' where status='pending'");
    await actor(admin);
    await db.query("select public.set_image_limits($1,1,1,1)", [session]);
    const kept = await beginImage(jury, issueId, { bytes: 1000 });
    await finishImage(jury, kept, 1000);
    await expect(beginImage(admin, issueId, { bytes: 1000 })).rejects.toThrow(
      "already has 1",
    );
    await actor(contestant);
    expect((await db.query("select id from public.attachments")).rows).toHaveLength(0);
    await actor(admin);
    expect((await db.query("select id from public.attachments where status='ready'")).rows).toHaveLength(1);

    await resolve(issueId);
    await actor(admin);
    await db.query("select public.set_image_limits($1,10,12,120)", [session]);
    await expect(beginImage(volunteer, issueId)).resolves.toMatchObject({ id: expect.any(String) });

    const requestId = id(++request + 8000);
    const first = await beginImage(volunteer, issueId, { requestId, bytes: 2222 });
    const second = await beginImage(volunteer, issueId, { requestId, bytes: 2222 });
    expect(second.id).toBe(first.id);

    await db.exec("reset role");
    await db.query(
      "update public.attachments set created_at=clock_timestamp()-interval '2 hours' where id=$1",
      [first.id],
    );
    const renewed = await beginImage(volunteer, issueId, { bytes: 2222 });
    expect(renewed.id).not.toBe(first.id);
    await db.exec("reset role");
    expect(
      (await db.query<{ status: string }>("select status from public.attachments where id=$1", [first.id])).rows[0].status,
    ).toBe("expired");

    await actor(volunteer);
    await expect(
      db.query("select public.set_image_limits($1,10,12,120)", [session]),
    ).rejects.toThrow("Admin");
    await actor(admin);
    await expect(db.query("select public.set_image_limits($1,51,12,120)", [session])).rejects.toThrow(
      "1 to 50 MB",
    );
    await expect(db.query("select public.set_image_limits($1,10,0,120)", [session])).rejects.toThrow(
      "1 to 24",
    );
    await expect(db.query("select public.set_image_limits($1,20,12,10)", [session])).rejects.toThrow(
      "at least the maximum",
    );

    const archived = await beginImage(volunteer, issueId, { visibility: "public" });
    await finishImage(volunteer, archived, 1024, "524946460000000057454250");
    await db.exec("reset role");
    await db.query("update public.events set archived=true");
    await actor(contestant);
    expect((await db.query("select * from public.attachments")).rows).toHaveLength(1);
    expect(
      (await db.query("select name from storage.objects where name=$1", [archived.original_path])).rows,
    ).toHaveLength(1);
    await expect(beginImage(volunteer, issueId)).rejects.toThrow("archived");
    await actor(volunteer);
    await expect(
      db.query("select public.delete_attachment($1,$2)", [session, archived.id]),
    ).rejects.toThrow("archived");
    await actor(admin);
    await expect(
      db.query("select public.set_image_limits($1,10,12,120)", [session]),
    ).rejects.toThrow("archived");
    await actor(volunteer);
    await db.query("select public.abandon_attachment($1,$2)", [session, renewed.id]);
  });

  it("rejects a file whose stored bytes are not a JPEG, PNG, or WebP image", async () => {
    const issueId = await submit();
    const started = await beginImage(volunteer, issueId);
    await expect(finishImage(volunteer, started, 1024, "474946383961")).rejects.toThrow(
      "JPEG, PNG, or WebP",
    );
    await db.exec("reset role");
    expect(
      (await db.query<{ status: string }>("select status from public.attachments where id=$1", [started.id])).rows[0].status,
    ).toBe("pending");
  });

  it("stops pending file access and completion when membership is removed", async () => {
    const issueId = await submit();
    const started = await beginImage(volunteer, issueId);
    await stageImage(started);
    await actor(admin);
    await db.query("select public.manage_member($1,$2,p_remove=>true)", [session, volunteer]);
    await actor(volunteer);
    expect((await db.query("select name from storage.objects where name=$1", [started.original_path])).rows).toHaveLength(0);
    await expect(db.query("insert into storage.objects(bucket_id,name) values('issue-attachments',$1)", [started.thumbnail_path]))
      .rejects.toThrow(/row-level security|permission denied/);
    expect((await db.query("update storage.objects set metadata='{}' where name=$1 returning id", [started.original_path])).rows).toHaveLength(0);
    await expect(completeImage(volunteer, started)).rejects.toThrow("No access to this session");
    await db.exec("reset role");
    expect((await db.query<{ status: string }>("select status from public.attachments where id=$1", [started.id])).rows[0].status).toBe("pending");
    expect((await db.query("select * from public.history where text='Image added.'")).rows).toHaveLength(0);
  });

  it("stops pending access and completion when a member loses staff permissions", async () => {
    const issueId = await submit();
    const started = await beginImage(volunteer, issueId);
    await stageImage(started);
    await actor(admin);
    await db.query("select public.manage_member($1,$2,p_team=>$3,p_roles=>'{}'::text[])", [session, volunteer, aurora]);
    await actor(volunteer);
    expect((await db.query("select name from storage.objects where name=$1", [started.original_path])).rows).toHaveLength(0);
    await expect(completeImage(volunteer, started)).rejects.toThrow("permission to add images");
  });

  it("checks password resets and the verified login session at completion", async () => {
    const issueId = await submit();
    const started = await beginImage(volunteer, issueId);
    await stageImage(started);
    await expect(completeImage(volunteer, started, 1024, "ffd8ffe0", id(304))).rejects.toThrow("sign in again");
    await actor(admin);
    await db.query("select public.begin_password_reset($1,$2)", [session, volunteer]);
    await actor(volunteer);
    expect((await db.query("select * from storage.objects where name=$1", [started.original_path])).rows).toHaveLength(0);
    await expect(completeImage(volunteer, started)).rejects.toThrow("temporary password");
    await db.exec("reset role");
    await db.query("update app_private.account_credentials set must_change=false,operation=null where user_id=$1", [volunteer]);
    await expect(completeImage(volunteer, started)).rejects.toThrow("sign in again");
    await db.exec("reset role");
    await db.query("update auth.sessions set created_at=null where id=$1", [id(303)]);
    await expect(completeImage(volunteer, started)).rejects.toThrow("sign in again");
    await db.exec("reset role");
    const newLogin = id(9999);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [newLogin, volunteer]);
    await actor(volunteer, newLogin);
    const status = (await db.query<{ status: { auth_session_id: string } }>("select public.account_status() as status")).rows[0].status;
    expect(status.auth_session_id).toBe(newLogin);
    await completeImage(volunteer, started, 1024, "ffd8ffe0", newLogin);
    // A lost success response can be retried without another activity entry.
    await completeImage(volunteer, started, 1024, "ffd8ffe0", newLogin);
    await db.exec("reset role");
    expect((await db.query("select * from public.history where text='Image added.'")).rows).toHaveLength(1);
    expect((await db.query("select to_regprocedure('public.finish_attachment(uuid,uuid,bigint,text,bigint,text)') as old")).rows[0]).toEqual({ old: null });
  });

  it("rejects pending writes and completion if the event is archived during an upload", async () => {
    const issueId = await submit();
    const started = await beginImage(volunteer, issueId);
    await stageImage(started);
    await db.query("update public.events set archived=true");
    await actor(volunteer);
    await expect(db.query("insert into storage.objects(bucket_id,name) values('issue-attachments',$1)", [started.original_path]))
      .rejects.toThrow(/row-level security|permission denied/);
    await expect(completeImage(volunteer, started)).rejects.toThrow("archived");
  });

  it("rejects pending access and completion if the login session has been deleted", async () => {
    const issueId = await submit();
    const started = await beginImage(volunteer, issueId);
    await stageImage(started);
    await db.query("delete from auth.sessions where id=$1", [id(303)]);
    await actor(volunteer);
    expect((await db.query("select name from storage.objects where name=$1", [started.original_path])).rows).toHaveLength(0);
    await expect(db.query("insert into storage.objects(bucket_id,name) values('issue-attachments',$1)", [started.thumbnail_path]))
      .rejects.toThrow(/row-level security|permission denied/);
    await expect(completeImage(volunteer, started)).rejects.toThrow("sign in again");
  });

  it("accepts only the exact original and thumbnail paths for reads and writes", async () => {
    const issueId = await submit();
    const started = await beginImage(volunteer, issueId);
    const extra = started.original_path.replace("/original", "/extra/untracked/original");
    await actor(volunteer);
    for (const path of [extra, started.original_path.replace(session, secondSession), `${started.original_path}/thumbnail`]) {
      await expect(db.query("insert into storage.objects(bucket_id,name) values('issue-attachments',$1)", [path]))
        .rejects.toThrow(/row-level security|permission denied/);
    }
    await finishImage(volunteer, started);
    await db.exec("reset role");
    await db.query("insert into storage.objects(bucket_id,name) values('issue-attachments',$1)", [extra]);
    await actor(volunteer);
    expect((await db.query("select * from storage.objects where name=$1", [extra])).rows).toHaveLength(0);
    expect((await db.query("select * from storage.objects where name=$1", [started.original_path])).rows).toHaveLength(1);
  });

  it("uses the current image-count limit when pending uploads finish", async () => {
    const issueId = await submit();
    const first = await beginImage(volunteer, issueId);
    const second = await beginImage(specialist, issueId);
    await stageImage(first);
    await stageImage(second);
    await actor(admin);
    await db.query("select public.set_image_limits($1,10,1,120)", [session]);
    await completeImage(volunteer, first);
    await expect(completeImage(specialist, second)).rejects.toThrow("already has 1 images");
    await db.exec("reset role");
    expect((await db.query("select id from public.attachments where status='ready'")).rows).toHaveLength(1);
    await actor(admin);
    await db.query("select public.set_image_limits($1,10,2,120)", [session]);
    await completeImage(specialist, second);
    await actor(admin);
    await db.query("select public.set_image_limits($1,10,1,120)", [session]);
    expect((await db.query("select id from public.attachments where status='ready'")).rows).toHaveLength(2);
  });

  it("keeps expired cleanup paths available for a failed Storage request", async () => {
    const issueId = await submit();
    const expired = await beginImage(volunteer, issueId);
    await stageImage(expired);
    await db.query("update public.attachments set created_at=clock_timestamp()-interval '2 hours' where id=$1", [expired.id]);
    const started = await beginImage(volunteer, issueId);
    const requestPaths = async () => (await db.query<{ paths: string[] }>("select public.attachment_cleanup_paths($1,$2) as paths", [session, issueId])).rows[0].paths;
    expect((await requestPaths()).sort()).toEqual([expired.original_path, expired.thumbnail_path].sort());
    expect((await requestPaths()).sort()).toEqual([expired.original_path, expired.thumbnail_path].sort());
    await actor(contestant);
    await expect(requestPaths()).rejects.toThrow("No access");
    await db.exec("reset role");
    await db.query("delete from storage.objects where name=any($1)", [[expired.original_path, expired.thumbnail_path]]);
    await actor(volunteer);
    expect(await requestPaths()).toEqual([]);
    expect(started.id).not.toBe(expired.id);
  });

  it("keeps failed file removal in the uploader's snapshot until Storage confirms cleanup", async () => {
    const issueId = await submit();
    const started = await beginImage(volunteer, issueId);
    await finishImage(volunteer, started);
    await actor(volunteer);
    const paths = (await db.query<{ paths: string[] }>("select public.delete_attachment($1,$2) as paths", [session, started.id])).rows[0].paths;
    const pendingRemovals = async () => (await db.query<{ state: { pending_removals: Array<{ id: string }> } }>("select public.session_snapshot($1) as state", [session])).rows[0].state.pending_removals;
    expect(await pendingRemovals()).toEqual([{ id: started.id, issue_id: issueId, original_name: "board.jpg" }]);
    // A fresh authenticated read must still expose the retry after a failed
    // Storage call. The deleted image itself is never downloadable.
    await actor(volunteer);
    expect(await pendingRemovals()).toHaveLength(1);
    expect((await db.query("select * from storage.objects where name=$1", [started.original_path])).rows).toHaveLength(0);
    await expect(db.query("select public.finish_attachment_removal($1,$2)", [volunteer, started.id])).rejects.toThrow("permission denied");
    await actor(specialist);
    expect(await pendingRemovals()).toEqual([]);
    await actor(contestant);
    expect(await pendingRemovals()).toEqual([]);
    await actor(volunteer);
    expect((await db.query<{ paths: string[] }>("select public.delete_attachment($1,$2) as paths", [session, started.id])).rows[0].paths).toEqual(paths);
    await db.exec("reset role");
    await db.query("delete from storage.objects where name=any($1)", [paths]);
    await db.exec("set role service_role");
    await expect(db.query("select public.finish_attachment_removal($1,$2)", [specialist, started.id])).rejects.toThrow("Image unavailable");
    await db.query("select public.finish_attachment_removal($1,$2)", [volunteer, started.id]);
    await db.query("select public.finish_attachment_removal($1,$2)", [volunteer, started.id]);
    await actor(volunteer);
    expect(await pendingRemovals()).toEqual([]);
    expect((await db.query("select * from public.history where text='Image removed.'")).rows).toHaveLength(1);
  });
});

describe("session announcements", () => {
  const digest = "a".repeat(64);
  const publishAction = (extra = {}) => ({
    type: "publish",
    title: " Fictional title ",
    details: " Plain details. ",
    expires_at: null,
    ...extra,
  });
  async function announce(
    action: Record<string, unknown>,
    requestId = id(++request + 2000),
    s = session,
  ): Promise<string> {
    return (await db.query<{ id: string }>(
      "select public.announcement_command($1,$2,$3::jsonb) as id",
      [s, requestId, JSON.stringify(action)],
    )).rows[0].id;
  }
  async function snapshot(s = session) {
    return (await db.query<{
      state: {
        announcements: Array<Record<string, unknown>>;
        images: Array<Record<string, unknown>>;
      };
    }>("select public.announcement_snapshot($1) as state", [s])).rows[0].state;
  }
  async function reserve(
    announcementId: string,
    bytes = 12,
    requestId = id(++request + 2000),
  ) {
    const result = await db.query<{
      started: { id: string; status: string; expired_paths: string[] };
    }>(
      "select public.begin_announcement_image($1,$2,$3,'board.png',$4,'image/png',$5) as started",
      [session, announcementId, requestId, bytes, digest],
    );
    return result.rows[0].started;
  }
  async function store(announcementId: string, imageId: string, size = 12) {
    await db.exec("reset role");
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('announcement-images',$1,$2::jsonb)",
      [
        [session, announcementId, imageId].join("/"),
        JSON.stringify({ size, mimetype: "image/png" }),
      ],
    );
  }
  async function readyImage(announcementId: string) {
    await actor(admin);
    const started = await reserve(announcementId);
    await store(announcementId, started.id);
    await actor(admin);
    await db.query("select public.complete_announcement_image($1,$2)", [
      session,
      started.id,
    ]);
    return started.id;
  }

  it("lets admins and jury publish while every member reads only active records", async () => {
    for (const manager of [admin, jury, combined]) {
      await actor(manager);
      await announce(publishAction());
    }
    for (const denied of [contestant, volunteer, specialist]) {
      await actor(denied);
      await expect(announce(publishAction())).rejects.toThrow(
        "Only session admins and jury",
      );
      expect((await snapshot()).announcements).toHaveLength(3);
    }
    await actor(id(8));
    expect((await snapshot()).announcements).toEqual([]);
    await expect(announce(publishAction(), id(3000))).rejects.toThrow();
    await actor(admin);
    const [first] = (await snapshot()).announcements;
    expect(first).toMatchObject({
      title: "Fictional title",
      details: "Plain details.",
      author: expect.any(String),
      revision: 0,
    });
    await expect(db.query("insert into public.announcements(session_id,title,details,author,author_name) values($1,'x','y',$2,'x')", [session, admin])).rejects.toThrow("permission denied");
    await expect(db.query("update public.announcements set title='x'")).rejects.toThrow("permission denied");
  });

  it("uses the signed-in publisher, validates input, and applies server expiry", async () => {
    await actor(admin);
    const forged = await announce(publishAction({ author: contestant }));
    expect((await snapshot()).announcements[0]).toMatchObject({ id: forged, author: admin, author_name: "Person 1" });
    for (const bad of [{ title: " " }, { title: "x".repeat(161) }, { details: "" }, { details: "x".repeat(10001) }, { expires_at: "2000-01-01T00:00:00Z" }]) {
      await expect(announce(publishAction(bad))).rejects.toThrow();
    }
    const expiring = await announce(publishAction({ expires_at: new Date(Date.now() + 60000).toISOString() }));
    const removed = await announce(publishAction());
    await announce({ type: "remove", id: removed, revision: 0 });
    await db.exec("reset role");
    await db.query("update public.announcements set expires_at=published_at+interval '1 millisecond' where id=$1", [expiring]);
    await actor(contestant);
    expect((await snapshot()).announcements.map((a) => a.id)).toEqual([forged]);
    await actor(jury);
    expect((await snapshot()).announcements).toHaveLength(3);
    await announce({ type: "edit", id: expiring, revision: 0, title: "Back", details: "Active.", expires_at: null });
    await actor(contestant);
    expect((await snapshot()).announcements).toHaveLength(2);
    await actor(admin);
    await expect(announce({ type: "edit", id: removed, revision: 1, title: "x", details: "y", expires_at: null })).rejects.toThrow("Announcement unavailable");
  });

  it("repeats a request once and reports stale edits with the conflict code", async () => {
    await actor(admin);
    const requestId = id(4000);
    const first = await announce(publishAction(), requestId);
    expect(await announce(publishAction(), requestId)).toBe(first);
    await expect(announce(publishAction({ title: "Other" }), requestId)).rejects.toThrow("Request ID already used");
    expect((await snapshot()).announcements).toHaveLength(1);
    await announce({ type: "edit", id: first, revision: 0, title: "Edited", details: "Edited.", expires_at: null });
    await actor(jury);
    await expect(announce({ type: "edit", id: first, revision: 0, title: "Stale", details: "Stale.", expires_at: null })).rejects.toMatchObject({ code: "MN409" });
    await announce({ type: "edit", id: first, revision: 1, title: "Latest", details: "Latest.", expires_at: null });
    await actor(contestant);
    expect((await snapshot()).announcements[0]).toMatchObject({ title: "Latest", revision: 2, author: admin, edited_by: jury });
  });

  it("signals the existing session channel and blocks temporary or archived access", async () => {
    await actor(admin);
    const before = (await db.query<{ revision: number }>("select revision from public.sessions where id=$1", [session])).rows[0].revision;
    const created = await announce(publishAction());
    expect((await db.query<{ revision: number }>("select revision from public.sessions where id=$1", [session])).rows[0].revision).toBe(Number(before) + 1);
    await db.exec("reset role");
    await db.query("update public.events set archived=true");
    await actor(admin);
    await expect(announce(publishAction())).rejects.toThrow("archived");
    await expect(announce({ type: "remove", id: created, revision: 0 })).rejects.toThrow("archived");
    await expect(reserve(created)).rejects.toThrow("archived");
    await actor(contestant);
    expect((await snapshot()).announcements).toHaveLength(1);
    await db.exec("reset role");
    await db.query("update public.events set archived=false");
    await db.query("select public.initialize_account($1,'temporary')", [admin]);
    await actor(admin);
    await expect(announce(publishAction())).rejects.toThrow();
    expect((await snapshot()).announcements).toEqual([]);
  });

  it("publishes private images only after the stored object matches its reservation", async () => {
    await actor(admin);
    const parent = await announce(publishAction());
    const started = await reserve(parent);
    expect(started.status).toBe("pending");
    await expect(db.query("select public.complete_announcement_image($1,$2)", [session, started.id])).rejects.toThrow("Upload the image before finishing");
    await store(parent, started.id, 99);
    await actor(admin);
    await expect(db.query("select public.complete_announcement_image($1,$2)", [session, started.id])).rejects.toThrow("Upload the image before finishing");
    await db.exec("reset role");
    await db.query("update storage.objects set metadata='{\"size\":12,\"mimetype\":\"image/png\"}'");
    await actor(contestant);
    expect((await db.query("select * from storage.objects where bucket_id='announcement-images'")).rows).toHaveLength(0);
    await actor(jury);
    await expect(db.query("select public.complete_announcement_image($1,$2)", [session, started.id])).rejects.toThrow("Image unavailable");
    await actor(admin);
    await db.query("select public.complete_announcement_image($1,$2)", [session, started.id]);
    await db.query("select public.complete_announcement_image($1,$2)", [session, started.id]);
    await actor(contestant);
    expect((await snapshot()).images).toHaveLength(1);
    expect((await db.query("select * from storage.objects where bucket_id='announcement-images'")).rows).toHaveLength(1);
    expect((await snapshot()).announcements[0].revision).toBe(1);
    await actor(id(8));
    expect((await db.query("select * from storage.objects where bucket_id='announcement-images'")).rows).toHaveLength(0);
  });

  it("limits an announcement to four images and reclaims expired reservations", async () => {
    await actor(admin);
    const parent = await announce(publishAction());
    for (let n = 0; n < 3; n++) await readyImage(parent);
    await actor(admin);
    const pending = await reserve(parent);
    await expect(reserve(parent)).rejects.toThrow("up to four images");
    await expect(db.query("select public.begin_announcement_image($1,$2,$3,'a.png',10485761,'image/png',$4)", [session, parent, id(5000), digest])).rejects.toThrow();
    await db.exec("reset role");
    await db.query("update public.announcement_images set created_at=created_at-interval '16 minutes' where id=$1", [pending.id]);
    await actor(admin);
    const replacement = await reserve(parent);
    expect(replacement.expired_paths).toEqual([[session, parent, pending.id].join("/")]);
    await expect(db.query("select public.complete_announcement_image($1,$2)", [session, pending.id])).rejects.toThrow("expired");
    await actor(contestant);
    await expect(reserve(parent)).rejects.toThrow("Only session admins and jury");
  });

  it("removes images for any manager, hides them from readers, and keeps parent removal separate", async () => {
    await actor(admin);
    const parent = await announce(publishAction());
    const imageId = await readyImage(parent);
    await actor(contestant);
    await expect(db.query("select public.remove_announcement_image($1,$2)", [session, imageId])).rejects.toThrow("Only session admins and jury");
    await actor(jury);
    const path = (await db.query<{ path: string }>("select public.remove_announcement_image($1,$2) as path", [session, imageId])).rows[0].path;
    expect(path).toBe([session, parent, imageId].join("/"));
    expect((await db.query<{ path: string }>("select public.remove_announcement_image($1,$2) as path", [session, imageId])).rows[0].path).toBe(path);
    await actor(contestant);
    expect((await snapshot()).images).toEqual([]);
    expect((await db.query("select * from storage.objects where bucket_id='announcement-images'")).rows).toHaveLength(0);
    await actor(admin);
    const second = await readyImage(parent);
    const current = (await snapshot()).announcements[0].revision;
    await announce({ type: "remove", id: parent, revision: current });
    await actor(contestant);
    expect((await snapshot()).announcements).toEqual([]);
    expect((await db.query("select * from storage.objects where bucket_id='announcement-images'")).rows).toHaveLength(0);
    await actor(jury);
    expect((await snapshot()).images.map((i) => i.id)).toEqual([second]);
    await expect(reserve(parent)).rejects.toThrow("Announcement unavailable");
    const removed = (await snapshot()).announcements[0];
    await db.query("select public.remove_announcement_image($1,$2)", [session, second]);
    expect((await snapshot()).announcements[0]).toEqual(removed);
    expect((await snapshot()).images).toEqual([]);
  });

  it("leaves a pending image to its uploader", async () => {
    await actor(admin);
    const pending = await reserve(await announce(publishAction()));
    await actor(jury);
    await expect(db.query("select public.remove_announcement_image($1,$2)", [session, pending.id])).rejects.toThrow("Image unavailable");
  });
});

describe("person avatars", () => {
  const digest = "b".repeat(64);
  type Avatar = { person_id: string; avatar_id: string };
  async function begin(bytes = 12, requestId = id(++request + 3000), type = "image/png") {
    return (await db.query<{ started: { id: string; status: string; path: string } }>(
      "select public.begin_avatar($1,$2,$3,$4) as started",
      [requestId, bytes, type, digest],
    )).rows[0].started;
  }
  async function store(path: string, size = 12) {
    await db.exec("reset role");
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('person-avatars',$1,$2::jsonb)",
      [path, JSON.stringify({ size, mimetype: "image/png" })],
    );
  }
  async function complete(avatarId: string) {
    return (await db.query<{ finished: { status: string; cleanup: string[] } }>(
      "select public.complete_avatar($1) as finished",
      [avatarId],
    )).rows[0].finished;
  }
  async function readyAvatar(user: string, requestId?: string) {
    await actor(user);
    const started = await begin(12, requestId);
    await store(started.path);
    await actor(user);
    const finished = await complete(started.id);
    return { avatar: { person_id: user, avatar_id: started.id }, path: started.path, cleanup: finished.cleanup };
  }
  async function list(user: string, s = session) {
    await actor(user);
    return (await db.query<{ avatars: Avatar[] }>("select public.avatar_list($1) as avatars", [s])).rows[0].avatars;
  }
  async function readable(user: string) {
    await actor(user);
    return (await db.query<{ name: string }>(
      "select name from storage.objects where bucket_id='person-avatars' order by name",
    )).rows.map((row) => row.name);
  }

  it("shows staff avatars to the session's staff and a team account only its own", async () => {
    const volunteerAvatar = await readyAvatar(volunteer);
    const specialistAvatar = await readyAvatar(specialist);
    const teamAvatar = await readyAvatar(contestant);
    const staffAvatars = [volunteerAvatar.avatar, specialistAvatar.avatar];
    expect(await list(specialist)).toEqual(staffAvatars);
    expect(await list(admin)).toEqual(staffAvatars);
    expect(await list(contestant)).toEqual([teamAvatar.avatar]);
    expect(await list(id(7))).toEqual([]);
    expect(await readable(admin)).toEqual([volunteerAvatar.path, specialistAvatar.path].sort());
    expect(await readable(contestant)).toEqual([teamAvatar.path]);
    expect(await readable(id(7))).toEqual([]);
    // The specialist has no membership in the second session. Its list there has only its own avatar.
    expect(await list(specialist, secondSession)).toEqual([specialistAvatar.avatar]);
    expect(await list(id(8), secondSession)).toEqual([]);
    expect(await readable(id(8))).toEqual([]);
    await db.exec("reset role");
    await db.query("delete from public.memberships where session_id=$1 and user_id=$2", [session, volunteer]);
    expect(await list(specialist)).toEqual([specialistAvatar.avatar]);
    expect(await readable(specialist)).toEqual([specialistAvatar.path]);
  });

  it("replaces the avatar once per request ID and lists replaced files until the function confirms deletion", async () => {
    const first = await readyAvatar(volunteer);
    const requestId = id(3900);
    const second = await readyAvatar(volunteer, requestId);
    expect(second.cleanup).toEqual([first.path]);
    expect(await list(volunteer)).toEqual([second.avatar]);
    expect(await readable(specialist)).toEqual([second.path]);
    await actor(volunteer);
    expect(await begin(12, requestId)).toEqual({ id: second.avatar.avatar_id, status: "ready", path: second.path });
    await expect(begin(13, requestId)).rejects.toMatchObject({ code: "MN422", message: expect.stringContaining("different content") });
    await expect(db.query("select public.avatar_files_removed($1)", [[first.path]])).rejects.toThrow("permission denied");
    await db.exec("reset role; set role service_role");
    await db.query("select public.avatar_files_removed($1)", [[first.path]]);
    await actor(volunteer);
    const removed = (await db.query<{ removed: { cleanup: string[] } }>("select public.remove_avatar() as removed")).rows[0].removed;
    expect(removed.cleanup).toEqual([second.path]);
    expect((await db.query<{ removed: { cleanup: string[] } }>("select public.remove_avatar() as removed")).rows[0].removed.cleanup)
      .toEqual([second.path]);
    expect(await list(volunteer)).toEqual([]);
    expect(await readable(volunteer)).toEqual([]);
  });

  it("denies direct table access and object writes", async () => {
    const own = await readyAvatar(volunteer);
    await actor(volunteer);
    await expect(db.query("select * from public.person_avatars")).rejects.toThrow("permission denied");
    await expect(db.query(
      "insert into public.person_avatars(person_id,request_id,bytes,content_type,digest) values($1,$2,12,'image/png',$3)",
      [volunteer, id(3901), digest],
    )).rejects.toThrow("permission denied");
    await expect(db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('person-avatars',$1,'{}'::jsonb)",
      [`${volunteer}/${id(3902)}`],
    )).rejects.toThrow("row-level security");
    await expect(db.query("update storage.objects set metadata='{}'::jsonb where name=$1", [own.path])).resolves.toMatchObject({ affectedRows: 0 });
    await db.exec("set role anon");
    await expect(db.query("select public.avatar_list($1)", [session])).rejects.toThrow("permission denied");
  });

  it("rejects invalid files, unfinished or expired uploads, and temporary passwords", async () => {
    await actor(volunteer);
    await expect(begin(262145)).rejects.toMatchObject({ code: "MN422", message: expect.stringContaining("256 KB") });
    await expect(begin(12, undefined, "image/gif")).rejects.toMatchObject({ code: "MN422" });
    const requestId = id(3903);
    const started = await begin(12, requestId);
    await expect(complete(started.id)).rejects.toThrow("Upload the picture before finishing");
    await store(started.path, 13);
    await actor(volunteer);
    await expect(complete(started.id)).rejects.toThrow("Upload the picture before finishing");
    await actor(specialist);
    await expect(complete(started.id)).rejects.toThrow("Picture unavailable");
    await db.exec("reset role");
    await db.query("update public.person_avatars set created_at=created_at-interval '16 minutes' where id=$1", [started.id]);
    await actor(volunteer);
    expect(await complete(started.id)).toEqual({ status: "expired", cleanup: [started.path] });
    await expect(begin(12, requestId)).rejects.toMatchObject({ code: "MN410", message: expect.stringContaining("expired") });
    expect(await list(volunteer)).toEqual([]);
    const ready = await readyAvatar(volunteer);
    await db.exec("reset role");
    await db.query("select public.initialize_account($1,'avatar-volunteer')", [volunteer]);
    await actor(volunteer);
    await expect(begin()).rejects.toThrow("Sign in first");
    await expect(db.query("select public.remove_avatar()")).rejects.toThrow("Sign in first");
    expect(await list(volunteer)).toEqual([]);
    expect(await readable(volunteer)).toEqual([]);
    expect(await list(specialist)).toEqual([ready.avatar]);
  });
});
