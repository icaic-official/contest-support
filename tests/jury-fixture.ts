import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import type { BrowserContext, WebSocketRoute } from "@playwright/test";
import type { Command, Snapshot } from "../src/connected/model";

// Uses actual migrations, RLS, snapshots, and workflow transactions. Only the
// hosted Auth/HTTP/Realtime transport is simulated; this is not a cloud test.
// `seedIssues: false` starts the first session without issues, for the full
// local journey.
export async function createJuryFixture({ seedIssues = true } = {}) {
  const db = new PGlite();
  const event = crypto.randomUUID();
  const sessions = [crypto.randomUUID(), crypto.randomUUID()];
  const teams = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const names = [
    "jury",
    "combined",
    "volunteer",
    "specialist",
    "admin",
    "contestant",
  ] as const;
  const users = Object.fromEntries(
    names.map((name) => [name, crypto.randomUUID()]),
  );
  const tokens = new Map<string, string>();
  const logins = new Map<string, string>();
  const workflowRequests: Array<{
    actor: string;
    request: string;
    session: string;
    command: Command;
  }> = [];
  const channels = new Map<WebSocketRoute, Map<string, boolean>>();
  let loseResponse = false;
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}', encrypted_password text default 'initial-hash');
    create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default clock_timestamp());
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create publication supabase_realtime;
    create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name,'/'))[array_length(string_to_array(name,'/'),1)] $$;
    grant usage on schema storage to authenticated,service_role;
    grant all on storage.buckets,storage.objects to authenticated,service_role;
  `);
  for (const file of readdirSync("supabase/migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  for (const name of names) {
    logins.set(users[name], crypto.randomUUID());
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [users[name], JSON.stringify({ name: `Test ${name}` })],
    );
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [
      logins.get(users[name]),
      users[name],
    ]);
  }
  await db.query(
    "insert into public.events(id,name) values($1,'Jury verification')",
    [event],
  );
  await db.query(
    "insert into public.sessions(id,event_id,name,intake_open) values($1,$3,'Primary',true),($2,$3,'Secondary',true)",
    [...sessions, event],
  );
  await db.query(
    "insert into public.teams(id,session_id,name,location) values($1,$4,'Aurora','A12'),($2,$4,'Cedar','A18'),($3,$5,'Isolated','B01')",
    [...teams, ...sessions],
  );
  for (const name of names) {
    const roles =
      name === "jury"
        ? ["jury"]
        : name === "combined"
          ? ["volunteer", "specialist", "jury"]
          : name === "volunteer"
            ? ["volunteer"]
            : name === "specialist"
              ? ["specialist"]
              : [];
    await db.query(
      "insert into public.memberships(session_id,user_id,team_id,roles,is_admin) values($1,$2,$3,$4,$5)",
      [
        sessions[0],
        users[name],
        name === "contestant" ? teams[0] : null,
        roles,
        name === "admin",
      ],
    );
  }
  await db.query(
    "insert into public.memberships(session_id,user_id,roles) values($1,$2,array['volunteer'])",
    [sessions[1], users.jury],
  );
  const issues: string[] = [];
  const stamp = (minutes: number) =>
    new Date(Date.now() - minutes * 60000).toISOString();
  for (let n = 1; seedIssues && n <= 6; n++) {
    const issue = crypto.randomUUID();
    const resolution = crypto.randomUUID();
    const reopened = n === 4 || n === 6;
    issues.push(issue);
    await db.query(
      `insert into public.issues(id,session_id,team_id,reporter,reporter_name,category,description,status,created_at,first_assigned_at,owner,owner_name,resolved_at)
      values($1,$2,$3,$4,'Test volunteer','Backend',$5,$6,$7,$8,$4,'Test volunteer',$9)`,
      [
        issue,
        sessions[0],
        teams[n % 2 === 1 ? 0 : 1],
        users.volunteer,
        `Issue ${n} verification`,
        reopened ? "claimed" : "resolved",
        stamp(30),
        stamp(29),
        reopened ? null : stamp(25 - n),
      ],
    );
    await db.query(
      `insert into public.resolutions(id,session_id,issue_id,actor,actor_name,at,summary,reopened_at,reopened_by,reopened_name,reason)
      values($1,$2,$3,$4,'Test volunteer',$5,$6,$7,$8,$9,$10)`,
      [
        resolution,
        sessions[0],
        issue,
        users.volunteer,
        stamp(25 - n),
        `Resolution ${n}: service restored`,
        reopened ? stamp(15) : null,
        reopened ? users.volunteer : null,
        reopened ? "Test volunteer" : null,
        reopened ? "Still failing" : null,
      ],
    );
    if (n >= 3 && n <= 5) {
      await db.query(
        `insert into public.awards(session_id,issue_id,resolution_id,minutes,explanation,actor,actor_name,at,applied_at,applied_by,applied_name)
        values($1,$2,$3,$4,$5,$6,'Test jury',$7,$8,$9,$10)`,
        [
          sessions[0],
          issue,
          resolution,
          n === 3 ? 0 : 5,
          `Decision ${n} explanation`,
          users.jury,
          stamp(20 - n / 10),
          n === 5 ? stamp(10) : null,
          n === 5 ? users.jury : null,
          n === 5 ? "Test jury" : null,
        ],
      );
    }
  }

  async function run<T>(
    user: string,
    operation: (tx: Pick<PGlite, "query">) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        user,
      ]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: user, session_id: logins.get(user), role: "authenticated" }),
      ]);
      await tx.exec("set local role authenticated");
      return operation(tx);
    });
  }
  async function snapshot(
    user: string = users.jury,
    session: string = sessions[0],
  ): Promise<Snapshot> {
    return run(
      user,
      async (tx) =>
        (
          await tx.query<{ result: Snapshot }>(
            "select public.session_snapshot($1) as result",
            [session],
          )
        ).rows[0].result,
    );
  }
  function broadcast() {
    for (const [socket, topics] of channels) {
      for (const [topic, array] of topics) {
        const payload = {
          ids: [1],
          data: {
            schema: "public",
            table: "changes",
            type: "UPDATE",
            commit_timestamp: new Date().toISOString(),
            columns: [{ name: "session_id", type: "uuid" }],
            record: { session_id: sessions[0] },
            old_record: {},
            errors: [],
          },
        };
        socket.send(
          JSON.stringify(
            array
              ? [null, null, topic, "postgres_changes", payload]
              : { topic, event: "postgres_changes", payload, ref: null },
          ),
        );
      }
    }
  }
  async function act(
    user: string,
    command: Command,
    request: string = crypto.randomUUID(),
    session: string = sessions[0],
  ) {
    workflowRequests.push({ actor: user, request, session, command });
    const result = await run(
      user,
      async (tx) =>
        (
          await tx.query<{ result: string }>(
            "select public.workflow($1,$2,$3::jsonb) as result",
            [session, request, JSON.stringify(command)],
          )
        ).rows[0].result,
    );
    broadcast();
    return result;
  }
  async function attach(context: BrowserContext) {
    await context.routeWebSocket(
      /example\.supabase\.co\/realtime\//,
      (socket) => {
        const topics = new Map<string, boolean>();
        channels.set(socket, topics);
        socket.onClose(() => channels.delete(socket));
        socket.onMessage((raw) => {
          const message = JSON.parse(String(raw));
          const array = Array.isArray(message);
          const topic: string = array ? message[2] : message.topic;
          const kind: string = array ? message[3] : message.event;
          const ref: string = array ? message[1] : message.ref;
          const join: string = array ? message[0] : message.join_ref;
          const config = array ? message[4] : message.payload;
          if (kind === "phx_join") topics.set(topic, array);
          if (kind === "phx_leave") topics.delete(topic);
          const payload = {
            status: "ok",
            response:
              kind === "phx_join"
                ? {
                    postgres_changes: (
                      config.config?.postgres_changes ?? []
                    ).map((binding: object, index: number) => ({
                      ...binding,
                      id: index + 1,
                    })),
                  }
                : {},
          };
          socket.send(
            JSON.stringify(
              array
                ? [join, ref, topic, "phx_reply", payload]
                : { topic, event: "phx_reply", payload, ref, join_ref: join },
            ),
          );
        });
      },
    );
    await context.route("https://example.supabase.co/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers":
          "authorization,apikey,content-type,x-client-info",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      };
      if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers });
        return;
      }
      try {
        const body = request.postDataJSON() as Record<string, unknown> | null;
        const token = request.headers().authorization?.replace(/^Bearer /, "");
        let user = tokens.get(token ?? "");
        let result: unknown;
        if (path === "/auth/v1/token") {
          const name = String(body?.email).split("@")[0];
          user = users[name];
          if (!user) throw new Error("Unknown local test user");
          const encode = (value: object) =>
            Buffer.from(JSON.stringify(value)).toString("base64url");
          const expires = Math.floor(Date.now() / 1000) + 3600;
          const access = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user, session_id: logins.get(user), aud: "authenticated", role: "authenticated", exp: expires })}.${Buffer.from(crypto.randomUUID()).toString("base64url")}`;
          tokens.set(access, user);
          result = {
            access_token: access,
            refresh_token: crypto.randomUUID(),
            token_type: "bearer",
            expires_in: 3600,
            expires_at: expires,
            user: {
              id: user,
              aud: "authenticated",
              role: "authenticated",
              email: `${name}@accounts.minsky.invalid`,
              app_metadata: {},
              user_metadata: { name: `Test ${name}` },
              created_at: new Date().toISOString(),
            },
          };
        } else {
          if (!user) throw new Error("Missing local authentication");
          if (path === "/rest/v1/memberships") {
            result = await run(
              user,
              async (tx) =>
                (
                  await tx.query(
                    "select * from public.memberships where user_id=$1",
                    [user],
                  )
                ).rows,
            );
          } else if (path === "/rest/v1/sessions") {
            result = await run(
              user,
              async (tx) =>
                (
                  await tx.query(
                    "select id,name from public.sessions order by name",
                  )
                ).rows,
            );
          } else if (path === "/rest/v1/rpc/account_status") {
            result = await run(
              user,
              async (tx) =>
                (
                  await tx.query<{ result: unknown }>(
                    "select public.account_status() as result",
                  )
                ).rows[0].result,
            );
          } else if (path === "/rest/v1/rpc/session_snapshot") {
            result = await snapshot(user, String(body?.p_session));
          } else if (path === "/rest/v1/rpc/workflow") {
            result = await act(
              user,
              body?.p_action as Command,
              String(body?.p_request),
              String(body?.p_session),
            );
            if (loseResponse) {
              loseResponse = false;
              await route.abort("failed");
              return;
            }
          } else {
            throw new Error(`Unexpected test endpoint ${path}`);
          }
        }
        await route.fulfill({ json: result, headers });
      } catch (cause) {
        const error = cause as { message: string; code?: string };
        await route.fulfill({
          status: 400,
          json: { message: error.message, code: error.code ?? "P0001" },
          headers,
        });
      }
    });
  }
  return {
    db,
    event,
    sessions,
    users,
    teams,
    issues,
    workflowRequests,
    attach,
    snapshot,
    act,
    broadcast,
    loseNextResponse: () => {
      loseResponse = true;
    },
    close: () => db.close(),
  };
}
