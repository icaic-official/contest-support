import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { z } from "npm:zod@4.1.5";
import {
  AVATAR_MAX_BYTES,
  imageKind,
} from "../../../src/connected/imageFile.ts";

const bucket = "person-avatars";
// The picture plus multipart framing.
const maxRequestBytes = AVATAR_MAX_BYTES + 65536;
const tooLarge = `Choose a JPEG, PNG, or WebP picture of up to ${
  AVATAR_MAX_BYTES / 1024
} KB.`;
const removalSchema = z.object({ action: z.literal("remove") });
const startedSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "ready", "retired"]),
  path: z.string(),
});
const finishedSchema = z.object({
  status: z.enum(["ready", "retired", "expired"]),
  cleanup: z.array(z.string()),
});
const removedSchema = z.object({ cleanup: z.array(z.string()) });
// The avatar database functions mark rejected requests with these SQLSTATE codes.
const databaseFlags: Record<string, { validation?: true; restart?: true }> = {
  MN422: { validation: true },
  MN410: { restart: true },
};

class AvatarRequestError extends Error {
  constructor(
    message: string,
    readonly flags: { validation?: true; restart?: true } = {},
  ) {
    super(message);
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export interface AvatarConfig {
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
 * The function is the only writer of stored pictures. Postgres decides each change
 * for the signed-in caller. This adapter has no scheduled cleanup, so every
 * upload and removal also deletes the caller's replaced and expired files.
 */
export function createAvatarHandler(
  { projectUrl, publicKey, serviceKey, origins }: AvatarConfig,
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
      return respond({ error: "Profile pictures are not configured." }, 503);
    }
    const caller = connect(projectUrl, publicKey, authorization);
    const { data: identity, error: identityError } = await caller.auth.getUser(
      authorization.slice(7),
    );
    if (identityError || !identity.user) {
      return respond({ error: "Sign in first." }, 401);
    }
    const service = connect(projectUrl, serviceKey);
    const files = service.storage.from(bucket);

    /** The change has committed. A failed deletion stays listed for the caller's next request. */
    async function deleteFiles(paths: string[]): Promise<void> {
      if (!paths.length) return;
      try {
        const removed = await files.remove(paths);
        if (!removed.error) {
          await service.rpc("avatar_files_removed", { p_objects: paths });
        }
      } catch {
        // The next upload or removal by this person repeats the deletion.
      }
    }

    async function call(name: string, args?: Record<string, unknown>) {
      const { data, error } = await caller.rpc(name, args);
      if (error) {
        throw new AvatarRequestError(error.message, databaseFlags[error.code]);
      }
      return data;
    }

    try {
      if (
        (request.headers.get("content-type") ?? "").includes("application/json")
      ) {
        removalSchema.parse(await request.json());
        await deleteFiles(removedSchema.parse(await call("remove_avatar")).cleanup);
        return respond({});
      }
      if (Number(request.headers.get("content-length")) > maxRequestBytes) {
        throw new AvatarRequestError(tooLarge, { validation: true });
      }
      const form = await request.formData();
      const requestId = z.string().uuid().parse(form.get("request_id"));
      const file = form.get("image");
      if (
        !(file instanceof File) || file.size < 1 ||
        file.size > AVATAR_MAX_BYTES
      ) {
        throw new AvatarRequestError(tooLarge, { validation: true });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = imageKind(bytes);
      if (!kind) throw new AvatarRequestError(tooLarge, { validation: true });
      const digest = hex(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      );
      const started = startedSchema.parse(
        await call("begin_avatar", {
          p_request: requestId,
          p_bytes: bytes.byteLength,
          p_type: kind,
          p_digest: digest,
        }),
      );
      const avatar = { person_id: identity.user.id, avatar_id: started.id };
      if (started.status !== "pending") return respond(avatar);
      const stored = await files.upload(started.path, bytes, {
        contentType: kind,
        upsert: true,
        cacheControl: "0",
      });
      if (stored.error) {
        throw new AvatarRequestError(
          "Picture upload failed. Check your connection and retry.",
        );
      }
      // A failed completion keeps the file. A retry of this request can still finish it.
      const finished = finishedSchema.parse(
        await call("complete_avatar", { p_avatar: started.id }),
      );
      if (finished.status === "expired") {
        // An expired upload never becomes ready, so a late transfer must not keep its file.
        await deleteFiles([...finished.cleanup, started.path]);
        throw new AvatarRequestError(
          "The picture upload expired. Select the picture again.",
          { restart: true },
        );
      }
      await deleteFiles(finished.cleanup);
      return respond(avatar);
    } catch (cause) {
      if (cause instanceof AvatarRequestError) {
        return respond({ error: cause.message, ...cause.flags }, 400);
      }
      return respond({
        error: cause instanceof z.ZodError
          ? "Choose a valid picture request."
          : "Picture request failed. Try again.",
      }, 400);
    }
  };
}
