import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { createAvatarHandler } from "./handler.ts";

const person = "00000000-0000-4000-8000-000000000001";
const avatar = "00000000-0000-4000-8000-000000000300";
const replaced = "00000000-0000-4000-8000-000000000301";
const path = `${person}/${avatar}`;
const replacedPath = `${person}/${replaced}`;
const png: Uint8Array<ArrayBuffer> = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const url = "https://example.supabase.co/functions/v1/avatars";

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface State {
  status: "pending" | "ready" | "retired";
  files: Set<string>;
  uploads: number;
  removals: string[][];
  confirmed: string[][];
  begins: Array<Record<string, unknown>>;
  complete: () => { data: unknown; error: { message: string } | null };
  cleanup: string[];
  removeError: boolean;
}

// The fake clients stand in for Supabase. They record calls and never use a network.
function fixture(overrides: Partial<State> = {}) {
  const state: State = {
    status: "pending",
    files: new Set([replacedPath]),
    uploads: 0,
    removals: [],
    confirmed: [],
    begins: [],
    complete: () => ({ data: { status: "ready", cleanup: [replacedPath] }, error: null }),
    cleanup: [replacedPath],
    removeError: false,
    ...overrides,
  };
  const caller = {
    auth: {
      getUser: async () => ({ data: { user: { id: person } }, error: null }),
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "begin_avatar") {
        state.begins.push(args);
        return { data: { id: avatar, status: state.status, path }, error: null };
      }
      if (name === "complete_avatar") return state.complete();
      if (name === "remove_avatar") return { data: { cleanup: state.cleanup }, error: null };
      throw new Error("Unexpected caller RPC " + name);
    },
  };
  const service = {
    async rpc(name: string, args: { p_objects: string[] }) {
      if (name !== "avatar_files_removed") throw new Error("Unexpected service RPC " + name);
      state.confirmed.push(args.p_objects);
      return { data: null, error: null };
    },
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
  const handle = createAvatarHandler({
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
  body.set("request_id", "00000000-0000-4000-8000-000000000400");
  body.set("image", new File([bytes], "fictional.png"));
  return new Request(url, { method: "POST", headers: { Authorization: "Bearer test-user" }, body });
}

function removal(): Request {
  return new Request(url, {
    method: "POST",
    headers: { Authorization: "Bearer test-user", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "remove" }),
  });
}

Deno.test("stores the picture, completes it, and deletes the replaced file", async () => {
  const { state, handle } = fixture();
  const response = await handle(upload());
  check(response.status === 200, "The upload succeeds.");
  const body = await response.json();
  check(body.person_id === person && body.avatar_id === avatar, "The response names the new avatar.");
  check(state.files.has(path), "The file is stored under the reservation.");
  check(!state.files.has(replacedPath), "The replaced file is deleted.");
  check(JSON.stringify(state.confirmed) === JSON.stringify([[replacedPath]]), "The deletion is confirmed.");
  const [begin] = state.begins;
  check(begin.p_type === "image/png", "The signature chooses the content type.");
  check(begin.p_bytes === png.byteLength, "The size comes from the file.");
  check(/^[0-9a-f]{64}$/.test(String(begin.p_digest)), "The digest is SHA-256.");
});

Deno.test("returns the first result without another file for a repeated request", async () => {
  const { state, handle } = fixture({ status: "ready" });
  const response = await handle(upload());
  check(response.status === 200, "A repeat succeeds.");
  check((await response.json()).avatar_id === avatar, "A repeat returns the same avatar.");
  check(state.uploads === 0, "A repeat does not write the file again.");
});

Deno.test("keeps the file when completion fails so a retry can finish it", async () => {
  const { state, handle } = fixture({
    complete: () => ({ data: null, error: { message: "Connection lost." } }),
  });
  const response = await handle(upload());
  check(response.status === 400, "The failed completion is reported.");
  check(state.files.has(path), "The stored file remains for the retry.");
  check(state.removals.length === 0, "A failed completion deletes nothing.");
});

Deno.test("deletes a late file when the upload expired and asks for a new picture", async () => {
  const { state, handle } = fixture({
    complete: () => ({ data: { status: "expired", cleanup: [] }, error: null }),
  });
  const response = await handle(upload());
  const body = await response.json();
  check(response.status === 400 && body.restart === true, "The caller must select the picture again.");
  check(!state.files.has(path), "The expired file is deleted.");
  check(JSON.stringify(state.confirmed) === JSON.stringify([[path]]), "The deletion is confirmed.");
});

Deno.test("rejects non-images and oversized files before reserving", async () => {
  const { state, handle } = fixture();
  for (const bytes of [new Uint8Array(32).fill(65), new Uint8Array(262145)]) {
    const response = await handle(upload(bytes));
    check(response.status === 400, "An invalid file fails.");
    check((await response.json()).validation === true, "The failure is a validation error.");
  }
  check(state.begins.length === 0, "Nothing is reserved for invalid files.");
});

Deno.test("removal deletes the listed files and succeeds when deletion must be repeated", async () => {
  const ok = fixture();
  check((await ok.handle(removal())).status === 200, "Removal succeeds.");
  check(!ok.state.files.has(replacedPath), "Removal deletes the file.");
  check(ok.state.confirmed.length === 1, "The deletion is confirmed.");
  const failing = fixture({ removeError: true });
  check((await failing.handle(removal())).status === 200, "The removal commits before file deletion.");
  check(failing.state.files.has(replacedPath), "The file stays for the next request.");
  check(failing.state.confirmed.length === 0, "An unconfirmed deletion stays listed.");
});

Deno.test("checks the origin, method, and bearer token", async () => {
  const { handle } = fixture();
  check(
    (await handle(new Request(url, { method: "POST", headers: { Origin: "https://other.example" } }))).status === 403,
    "A foreign origin fails.",
  );
  check((await handle(new Request(url, { method: "GET" }))).status === 405, "GET fails.");
  check((await handle(new Request(url, { method: "POST" }))).status === 401, "A missing token fails.");
});
