import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { createAnnouncementImageHandler } from "./handler.ts";

const session = "00000000-0000-4000-8000-000000000100";
const announcement = "00000000-0000-4000-8000-000000000200";
const image = "00000000-0000-4000-8000-000000000300";
const path = [session, announcement, image].join("/");
const png: Uint8Array<ArrayBuffer> = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface State {
  status: "pending" | "ready";
  files: Set<string>;
  uploads: number;
  removals: string[][];
  begins: Array<Record<string, unknown>>;
  complete: () => Promise<{ error: { message: string } | null }>;
  removeError: boolean;
}

// The fake clients stand in for Supabase. They record calls and never use a network.
function fixture(overrides: Partial<State> = {}) {
  const state: State = {
    status: "pending",
    files: new Set(),
    uploads: 0,
    removals: [],
    begins: [],
    complete: async () => ({ error: null }),
    removeError: false,
    ...overrides,
  };
  const caller = {
    auth: {
      getUser: async () => ({ data: { user: { id: "user" } }, error: null }),
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "begin_announcement_image") {
        state.begins.push(args);
        return {
          data: { id: image, status: state.status, expired_paths: [] },
          error: null,
        };
      }
      if (name === "complete_announcement_image") return await state.complete();
      if (name === "remove_announcement_image") {
        return { data: path, error: null };
      }
      throw new Error("Unexpected RPC " + name);
    },
  };
  const service = {
    storage: {
      from: () => ({
        async upload(file: string) {
          state.uploads++;
          state.files.add(file);
          return { error: null };
        },
        async remove(files: string[]) {
          state.removals.push(files);
          if (state.removeError) return { error: { message: "unavailable" } };
          files.forEach((file) => state.files.delete(file));
          return { error: null };
        },
      }),
    },
  };
  const handle = createAnnouncementImageHandler({
    projectUrl: "https://example.supabase.co",
    publicKey: "public",
    serviceKey: "service",
    origins: ["https://app.example"],
  }, ((_url: string, key: string) =>
    key === "service" ? service : caller) as unknown as (
      url: string,
      key: string,
      authorization?: string,
    ) => SupabaseClient);
  return { state, handle };
}

function upload(bytes: Uint8Array<ArrayBuffer> = png): Request {
  const body = new FormData();
  body.set("session_id", session);
  body.set("announcement_id", announcement);
  body.set("request_id", "00000000-0000-4000-8000-000000000400");
  body.set("image", new File([bytes], "fictional.png"));
  return new Request("https://example.supabase.co/functions/v1/announcement-images", {
    method: "POST",
    headers: { Authorization: "Bearer test-user" },
    body,
  });
}

function removal(): Request {
  return new Request("https://example.supabase.co/functions/v1/announcement-images", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-user",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "remove", session_id: session, image_id: image }),
  });
}

Deno.test("stores the file, then completes with its verified signature and digest", async () => {
  const { state, handle } = fixture();
  const response = await handle(upload());
  check(response.status === 200, "The upload succeeds.");
  check(state.files.has(path), "The file is stored under the reservation.");
  const [begin] = state.begins;
  check(begin.p_type === "image/png", "The signature chooses the content type.");
  check(begin.p_bytes === png.byteLength, "The size comes from the file.");
  check(/^[0-9a-f]{64}$/.test(String(begin.p_digest)), "The digest is SHA-256.");
});

Deno.test("keeps the file when completion fails so a retry can finish it", async () => {
  const { state, handle } = fixture({
    complete: async () => ({ error: { message: "Connection lost." } }),
  });
  const response = await handle(upload());
  check(response.status === 400, "The failed completion is reported.");
  check(state.files.has(path), "The stored file remains for the retry.");
  check(state.removals.length === 0, "A failed request deletes nothing.");
});

Deno.test("does not delete a file that an overlapping request finishes", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => release = resolve);
  let calls = 0;
  const { state, handle } = fixture({
    complete: async () => {
      calls++;
      if (calls === 1) {
        await gate;
        return { error: { message: "Reservation changed." } };
      }
      return { error: null };
    },
  });
  const first = handle(upload());
  const second = await handle(upload());
  release();
  const failed = await first;
  check(second.status === 200, "The overlapping retry publishes the image.");
  check(failed.status === 400, "The slower request reports its failure.");
  check(state.files.has(path), "The published file remains.");
  check(state.removals.length === 0, "No request deletes the file.");
});

Deno.test("skips storage when the reservation is already published", async () => {
  const { state, handle } = fixture({ status: "ready" });
  check((await handle(upload())).status === 200, "A repeat succeeds.");
  check(state.uploads === 0, "A repeat does not write the file again.");
});

Deno.test("rejects non-images and oversized files before reserving", async () => {
  const { state, handle } = fixture();
  const text = await handle(upload(new Uint8Array(32).fill(65)));
  check(text.status === 400, "A file without an image signature fails.");
  const large = await handle(upload(new Uint8Array(10485761)));
  check(large.status === 400, "A file above 10 MB fails.");
  check(state.begins.length === 0, "Nothing is reserved for invalid files.");
});

Deno.test("removal deletes the file and stays retryable when deletion fails", async () => {
  const ok = fixture();
  ok.state.files.add(path);
  check((await ok.handle(removal())).status === 200, "Removal succeeds.");
  check(!ok.state.files.has(path), "Removal deletes the file.");
  const failing = fixture({ removeError: true });
  const response = await failing.handle(removal());
  const body = await response.json();
  check(response.status === 400, "A failed deletion is reported.");
  check(String(body.error).includes("Retry removal"), "The message explains the retry.");
});

Deno.test("checks the origin, method, and bearer token", async () => {
  const { handle } = fixture();
  const url = "https://example.supabase.co/functions/v1/announcement-images";
  check(
    (await handle(new Request(url, { method: "POST", headers: { Origin: "https://other.example" } }))).status === 403,
    "A foreign origin fails.",
  );
  check((await handle(new Request(url, { method: "GET" }))).status === 405, "GET fails.");
  check((await handle(new Request(url, { method: "POST" }))).status === 401, "A missing token fails.");
});
