import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { z } from "npm:zod@4.1.5";
import { classifyAttachmentError } from "../../../src/connected/imageFile.ts";

const command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("begin"),
    session_id: z.string().uuid(),
    request_id: z.string().uuid(),
    issue_id: z.string().uuid(),
    visibility: z.enum(["public", "internal"]),
    name: z.string().min(1).max(200),
    bytes: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("finish"),
    session_id: z.string().uuid(),
    attachment_id: z.string().uuid(),
  }),
  z.object({
    action: z.enum(["remove", "abandon"]),
    session_id: z.string().uuid(),
    attachment_id: z.string().uuid(),
  }),
]);

const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const origins = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) =>
  s.trim()
).filter(Boolean);
const bucket = "issue-attachments";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function storedImage(
  service: SupabaseClient,
  path: string,
): Promise<{ size: number; header: string }> {
  const { data, error } = await service.storage.from(bucket).download(path);
  if (error || !data) throw new Error("Upload the image before finishing.");
  const bytes = new Uint8Array(await data.arrayBuffer());
  return { size: bytes.byteLength, header: hex(bytes.subarray(0, 16)) };
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
  const respond = (
    body: unknown,
    status: number,
    classified?: { validation: boolean; restart: boolean },
  ) =>
    new Response(
      JSON.stringify(
        body && typeof body === "object"
          ? { ...body as Record<string, unknown>, ...classified }
          : body,
      ),
      {
        status,
        headers: {
          ...cors,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  if (origin && !origins.includes(origin)) {
    return respond({ error: "Origin is not allowed." }, 403);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") return respond({ error: "POST required." }, 405);
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return respond({ error: "Sign in first." }, 401);
  }
  if (!projectUrl || !publicKey || !serviceKey) {
    return respond({ error: "Image uploads are not configured." }, 503);
  }
  const caller = createClient(projectUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: identity, error: identityError } = await caller.auth.getUser(
    authorization.slice(7),
  );
  if (identityError || !identity.user) return respond({ error: "Sign in first." }, 401);
  const service = createClient(projectUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const input = command.parse(await request.json());
    if (input.action === "begin") {
      const { data, error } = await caller.rpc("begin_attachment", {
        p_session: input.session_id,
        p_request: input.request_id,
        p_issue: input.issue_id,
        p_visibility: input.visibility,
        p_name: input.name,
        p_bytes: input.bytes,
      });
      if (error) throw new Error(error.message);
      const started = data as { expired_paths?: string[] };
      if (started.expired_paths?.length) {
        await service.storage.from(bucket).remove(started.expired_paths);
      }
      return respond(data, 200);
    }
    if (input.action === "finish") {
      const { data: row, error: rowError } = await service.from("attachments")
        .select("uploader,session_id,issue_id,status")
        .eq("id", input.attachment_id)
        .maybeSingle();
      if (rowError) throw new Error(rowError.message);
      if (
        !row || row.uploader !== identity.user.id ||
        row.session_id !== input.session_id || row.status !== "pending"
      ) {
        throw new Error("Upload the image before finishing.");
      }
      const original = `${row.session_id}/${row.issue_id}/${input.attachment_id}/original`;
      const thumbnail = `${row.session_id}/${row.issue_id}/${input.attachment_id}/thumbnail`;
      try {
        const image = await storedImage(service, original);
        const thumb = await storedImage(service, thumbnail);
        const { error } = await service.rpc("finish_attachment", {
          p_uploader: identity.user.id,
          p_attachment: input.attachment_id,
          p_size: image.size,
          p_header: image.header,
          p_thumb_size: thumb.size,
          p_thumb_header: thumb.header,
        });
        if (error) throw new Error(error.message);
      } catch (cause) {
        const message = cause instanceof Error
          ? cause.message
          : "Upload failed. Check your connection and try again.";
        const classified = classifyAttachmentError(message);
        if (classified.validation) {
          await service.storage.from(bucket).remove([original, thumbnail]);
          await caller.rpc("abandon_attachment", {
            p_session: input.session_id,
            p_attachment: input.attachment_id,
          });
        }
        return respond({ error: message }, 400, classified);
      }
      return respond({ ok: true }, 200);
    }
    const rpc = input.action === "remove" ? "delete_attachment" : "abandon_attachment";
    const { data, error } = await caller.rpc(rpc, {
      p_session: input.session_id,
      p_attachment: input.attachment_id,
    });
    if (error) throw new Error(error.message);
    const paths = Array.isArray(data) ? data.filter((item) => typeof item === "string") : [];
    if (paths.length) await service.storage.from(bucket).remove(paths);
    return respond({ ok: true }, 200);
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return respond({ error: "Choose a JPEG, PNG, or WebP image." }, 400, {
        validation: true,
        restart: false,
      });
    }
    const message = cause instanceof Error
      ? cause.message
      : "Upload failed. Check your connection and try again.";
    return respond({ error: message }, 400, classifyAttachmentError(message));
  }
});
