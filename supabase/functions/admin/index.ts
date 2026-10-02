import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { z } from "npm:zod@4.1.5";

const username = z.string().trim().toLowerCase().regex(
  /^[a-z0-9][a-z0-9_-]{2,31}$/,
  "Use 3–32 letters, digits, underscores or hyphens.",
);
const membership = z.object({
  team_id: z.string().uuid().nullable().default(null),
  roles: z.array(z.enum(["volunteer", "specialist", "jury"])).default([]),
  is_admin: z.boolean().default(false),
});
const command = z.discriminatedUnion("action", [
  membership.extend({
    action: z.literal("create_account"),
    session_id: z.string().uuid(),
    username,
    name: z.string().trim().min(1).max(200),
  }),
  z.object({
    action: z.literal("set_username"),
    session_id: z.string().uuid(),
    user_id: z.string().uuid(),
    username,
  }),
  z.object({
    action: z.literal("reset_password"),
    session_id: z.string().uuid(),
    user_id: z.string().uuid(),
  }),
]);
const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const origins = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) =>
  s.trim()
).filter(Boolean);

function temporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") +
    "A9!";
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") ?? "";
  const cors = {
    "Access-Control-Allow-Origin": origins.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  const respond = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...cors,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  if (origin && !origins.includes(origin)) {
    return respond({ error: "Origin is not allowed." }, 403);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return respond({ error: "POST required." }, 405);
  }
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return respond({ error: "Sign in first." }, 401);
  }
  if (!projectUrl || !publicKey || !serviceKey) {
    return respond({ error: "Account administration is not configured." }, 503);
  }
  const caller = createClient(projectUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: identity, error: identityError } = await caller.auth.getUser(
    authorization.slice(7),
  );
  if (identityError || !identity.user) {
    return respond({ error: "Sign in first." }, 401);
  }
  try {
    const input = command.parse(await request.json());
    const { data: isAdmin, error: permissionError } = await caller.rpc(
      "is_session_admin",
      { p_session: input.session_id },
    );
    if (permissionError || !isAdmin) {
      return respond({ error: "Admin membership required." }, 403);
    }
    const { data: session, error: sessionError } = await caller.from("sessions")
      .select("event_id").eq("id", input.session_id).single();
    if (sessionError) throw sessionError;
    const { data: event, error: eventError } = await caller.from("events")
      .select("archived").eq("id", session.event_id).single();
    if (eventError) throw eventError;
    if (event.archived) {
      return respond({ error: "This event is archived." }, 403);
    }
    const service = createClient(projectUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let target: string;
    let password: string | undefined;
    if (input.action === "create_account") {
      if (
        input.team_id
          ? input.roles.length > 0 || input.is_admin
          : input.roles.length === 0 && !input.is_admin
      ) {
        return respond({
          error: "Choose a contestant team or staff roles/admin membership.",
        }, 400);
      }
      if (input.team_id) {
        const { data, error } = await caller.from("teams").select("id").eq(
          "id",
          input.team_id,
        ).eq("session_id", input.session_id).single();
        if (error || !data) {
          return respond({ error: "Choose a team in this session." }, 400);
        }
      }
      password = temporaryPassword();
      const { data, error } = await service.auth.admin.createUser({
        email: `${input.username}@accounts.minsky.invalid`,
        password,
        email_confirm: true,
        user_metadata: { name: input.name },
      });
      if (error) throw error;
      target = data.user.id;
      try {
        const initialized = await service.rpc("initialize_account", {
          p_target: target,
          p_username: input.username,
        });
        if (initialized.error) throw initialized.error;
        // Recheck current membership in the transactional RPC before granting access.
        const assigned = await caller.rpc("manage_member", {
          p_session: input.session_id,
          p_user: target,
          p_team: input.team_id,
          p_roles: input.roles,
          p_admin: input.is_admin,
          p_remove: false,
        });
        if (assigned.error) throw assigned.error;
      } catch (cause) {
        const person = await service.from("people").delete().eq("id", target);
        if (!person.error) await service.auth.admin.deleteUser(target);
        throw cause;
      }
    } else {
      target = input.user_id;
      const authorized = await caller.rpc("authorize_account_admin", {
        p_session: input.session_id,
        p_target: target,
      });
      if (authorized.error) {
        return respond({ error: authorized.error.message }, 403);
      }
      if (input.action === "set_username") {
        const registered = await caller.rpc("register_username", {
          p_session: input.session_id,
          p_target: target,
          p_username: input.username,
        });
        if (registered.error) throw registered.error;
        const updated = await service.auth.admin.updateUserById(target, {
          email: `${input.username}@accounts.minsky.invalid`,
          email_confirm: true,
        });
        if (updated.error) {
          // Release the reserved username if Auth rejects the identity update.
          await service.from("people").update({username: null}).eq("id", target).eq("username", input.username);
          throw updated.error;
        }
      } else {
        const started = await caller.rpc("begin_password_reset", {
          p_session: input.session_id,
          p_target: target,
        });
        if (started.error) throw started.error;
        password = temporaryPassword();
        try {
          const updated = await service.auth.admin.updateUserById(target, {
            password,
          });
          if (updated.error) throw updated.error;
          // Delete Auth sessions as well as guarding old JWTs at the database boundary.
          // The Auth schema is not exposed through PostgREST. Global sign-out takes
          // a target access token, so generate a short-lived password login here.
          const verifier = createClient(projectUrl, publicKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const signed = await verifier.auth.signInWithPassword({
            email: updated.data.user.email ?? "",
            password,
          });
          if (signed.error || !signed.data.session) {
            throw signed.error ??
              new Error("Could not invalidate prior sessions.");
          }
          const signedOut = await service.auth.admin.signOut(
            signed.data.session.access_token,
            "global",
          );
          if (signedOut.error) throw signedOut.error;
          const finished = await service.rpc("finish_password_reset", {
            p_target: target,
            p_operation: started.data,
            p_success: true,
          });
          if (finished.error) throw finished.error;
        } catch (cause) {
          await service.rpc("finish_password_reset", {
            p_target: target,
            p_operation: started.data,
            p_success: false,
          });
          throw cause;
        }
      }
    }
    const audit = await caller.rpc("record_account_action", {
      p_session: input.session_id,
      p_target: target,
      p_action: input.action,
    });
    if (audit.error) throw audit.error;
    return respond(
      { ok: true, user_id: target, temporary_password: password },
      200,
    );
  } catch (cause) {
    const message = cause && typeof cause === "object" && "message" in cause
      ? String(cause.message)
      : "Account request failed.";
    return respond({ error: message }, 400);
  }
});
