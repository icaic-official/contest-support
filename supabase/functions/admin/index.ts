import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { z } from "npm:zod@4.1.5";

const membership = z.object({
  team_id: z.string().uuid().nullable().default(null),
  roles: z.array(z.enum(["volunteer", "specialist", "jury"])).default([]),
  is_admin: z.boolean().default(false),
});
const command = z.discriminatedUnion("action", [
  membership.extend({
    action: z.literal("invite"),
    session_id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().trim().min(1).max(200),
  }),
  z.object({
    action: z.enum(["resend_invitation", "recovery"]),
    session_id: z.string().uuid(),
    user_id: z.string().uuid(),
  }),
]);
const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const appUrl = Deno.env.get("APP_URL") ?? "";
const origins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (origin && !origins.includes(origin))
    return respond({ error: "Origin is not allowed." }, 403);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST")
    return respond({ error: "POST required." }, 405);
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return respond({ error: "Sign in first." }, 401);
  if (!appUrl || !projectUrl || !publicKey || !serviceKey)
    return respond({ error: "Account administration is not configured." }, 503);
  const caller = createClient(projectUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Auth server verifies the caller. Client-provided IDs never establish identity.
  const { data: identity, error: identityError } = await caller.auth.getUser(
    authorization.slice(7),
  );
  if (identityError || !identity.user)
    return respond({ error: "Sign in first." }, 401);
  try {
    const body: unknown = await request.json();
    const input = command.parse(body);
    const { data: isAdmin, error: permissionError } = await caller.rpc(
      "is_session_admin",
      { p_session: input.session_id },
    );
    if (permissionError || !isAdmin)
      return respond({ error: "Admin membership required." }, 403);
    const { data: session, error: sessionError } = await caller
      .from("sessions")
      .select("event_id")
      .eq("id", input.session_id)
      .single();
    if (sessionError) throw sessionError;
    const { data: event, error: eventError } = await caller
      .from("events")
      .select("archived")
      .eq("id", session.event_id)
      .single();
    if (eventError) throw eventError;
    if (event.archived)
      return respond({ error: "This event is archived." }, 403);
    const service = createClient(projectUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let target: string;
    if (input.action === "invite") {
      if (
        input.team_id
          ? input.roles.length > 0 || input.is_admin
          : input.roles.length === 0 && !input.is_admin
      )
        return respond(
          {
            error: "Choose a contestant team or staff roles/admin membership.",
          },
          400,
        );
      if (input.team_id) {
        const { data: team, error } = await caller
          .from("teams")
          .select("id")
          .eq("id", input.team_id)
          .eq("session_id", input.session_id)
          .single();
        if (error || !team)
          return respond({ error: "Choose a team in this session." }, 400);
      }
      const { data, error } = await service.auth.admin.inviteUserByEmail(
        input.email,
        { data: { name: input.name }, redirectTo: appUrl },
      );
      if (error) throw error;
      target = data.user.id;
      // Recheck current permissions in the transactional DB function. If revoked
      // during mail delivery, the invited account receives no session permissions.
      const { error: assignmentError } = await caller.rpc("manage_member", {
        p_session: input.session_id,
        p_user: target,
        p_team: input.team_id,
        p_roles: input.roles,
        p_admin: input.is_admin,
        p_remove: false,
      });
      if (assignmentError) throw assignmentError;
    } else {
      target = input.user_id;
      const { data: member, error: memberError } = await caller
        .from("memberships")
        .select("user_id")
        .eq("session_id", input.session_id)
        .eq("user_id", target)
        .single();
      if (memberError || !member)
        return respond({ error: "Account is not in this session." }, 404);
      const { data, error } = await service.auth.admin.getUserById(target);
      if (error) throw error;
      if (!data.user.email)
        return respond({ error: "Account has no email address." }, 400);
      const result =
        input.action === "recovery"
          ? await service.auth.resetPasswordForEmail(data.user.email, {
              redirectTo: appUrl,
            })
          : await service.auth.admin.inviteUserByEmail(data.user.email, {
              redirectTo: appUrl,
            });
      if (result.error) throw result.error;
    }
    const { error: auditError } = await caller.rpc("record_account_action", {
      p_session: input.session_id,
      p_target: target,
      p_action: input.action,
    });
    if (auditError) throw auditError;
    return respond({ ok: true, user_id: target }, 200);
  } catch (cause) {
    const message =
      cause && typeof cause === "object" && "message" in cause
        ? String(cause.message)
        : "Account request failed.";
    return respond({ error: message }, 400);
  }
});
