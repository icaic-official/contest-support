import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { z } from "npm:zod@4.1.5";
import { imageKind } from "../../../src/connected/imageFile.ts";

const bucket = "announcement-images";
const maxBytes = 10485760;
// Ten megabytes of image plus multipart framing.
const maxRequestBytes = 11534336;
const uploadSchema = z.object({
  session_id: z.string().uuid(),
  announcement_id: z.string().uuid(),
  request_id: z.string().uuid(),
});
const removalSchema = z.object({
  action: z.literal("remove"),
  session_id: z.string().uuid(),
  image_id: z.string().uuid(),
});
const startedSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "ready"]),
  expired_paths: z.array(z.string()),
});

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface AnnouncementImageConfig {
  projectUrl: string;
  publicKey: string;
  serviceKey: string;
  origins: readonly string[];
}

type Connect = (
  url: string,
  key: string,
  authorization?: string,
) => SupabaseClient;

/**
 * The function is the only writer of stored files. It checks the signed-in caller,
 * then lets Postgres decide permissions again when it reserves and completes an image.
 */
export function createAnnouncementImageHandler(
  { projectUrl, publicKey, serviceKey, origins }: AnnouncementImageConfig,
  connect: Connect,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const origin = request.headers.get("Origin") ?? "";
    const headers = {
      "Access-Control-Allow-Origin": origins.includes(origin) ? origin : "",
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    const respond = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });
    if (origin && !origins.includes(origin)) {
      return respond({ error: "Origin is not allowed." }, 403);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return respond({ error: "POST required." }, 405);
    }
    const authorization = request.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return respond({ error: "Sign in first." }, 401);
    }
    if (!projectUrl || !publicKey || !serviceKey) {
      return respond({ error: "Announcement images are not configured." }, 503);
    }
    const caller = connect(projectUrl, publicKey, authorization);
    const { data: identity, error: identityError } = await caller.auth.getUser(
      authorization.slice(7),
    );
    if (identityError || !identity.user) {
      return respond({ error: "Sign in first." }, 401);
    }
    const files = connect(projectUrl, serviceKey).storage.from(bucket);
    try {
      if (
        (request.headers.get("content-type") ?? "").includes("application/json")
      ) {
        const input = removalSchema.parse(await request.json());
        const { data: path, error } = await caller.rpc(
          "remove_announcement_image",
          { p_session: input.session_id, p_image: input.image_id },
        );
        if (error) throw new Error(error.message);
        const removed = await files.remove([z.string().parse(path)]);
        if (removed.error) {
          throw new Error(
            "The image is hidden. Retry removal to finish deleting its file.",
          );
        }
        return respond({ ok: true });
      }
      if (Number(request.headers.get("content-length")) > maxRequestBytes) {
        throw new Error("Choose an image of up to 10 MB.");
      }
      const form = await request.formData();
      const input = uploadSchema.parse(Object.fromEntries(
        ["session_id", "announcement_id", "request_id"].map((
          field,
        ) => [field, form.get(field)]),
      ));
      const file = form.get("image");
      if (!(file instanceof File) || file.size < 1 || file.size > maxBytes) {
        throw new Error("Choose an image of up to 10 MB.");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = imageKind(bytes);
      if (!kind) throw new Error("Choose a JPEG, PNG, or WebP image.");
      const digest = hex(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      );
      const { data, error } = await caller.rpc("begin_announcement_image", {
        p_session: input.session_id,
        p_announcement: input.announcement_id,
        p_request: input.request_id,
        p_name: file.name,
        p_bytes: file.size,
        p_type: kind,
        p_digest: digest,
      });
      if (error) throw new Error(error.message);
      const started = startedSchema.parse(data);
      if (started.expired_paths.length) {
        await files.remove(started.expired_paths);
      }
      if (started.status === "ready") return respond({ ok: true });
      const path = [input.session_id, input.announcement_id, started.id].join(
        "/",
      );
      const stored = await files.upload(path, bytes, {
        contentType: kind,
        upsert: true,
        cacheControl: "0",
      });
      if (stored.error) {
        throw new Error("Image upload failed. Check your connection and retry.");
      }
      const finished = await caller.rpc("complete_announcement_image", {
        p_session: input.session_id,
        p_image: started.id,
      });
      // Completion may still commit, or a concurrent retry may finish it next.
      // Keep the file for retries and for cleanup of expired reservations.
      // Pending files stay unreadable under the database and Storage policies.
      if (finished.error) throw new Error(finished.error.message);
      return respond({ ok: true });
    } catch (cause) {
      return respond({
        error: cause instanceof z.ZodError
          ? "Choose a valid announcement and image."
          : cause instanceof Error
          ? cause.message
          : "Image upload failed. Try again.",
      }, 400);
    }
  };
}
