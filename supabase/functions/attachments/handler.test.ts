import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { createAttachmentHandler } from "./handler.ts";

const session = "00000000-0000-4000-8000-000000000100";
const issue = "00000000-0000-4000-8000-000000000301";
const attachment = "00000000-0000-4000-8000-000000000401";
const uploader = "00000000-0000-4000-8000-000000000003";
const login = "00000000-0000-4000-8000-000000000303";
const paths = [
  `${session}/${issue}/${attachment}/original`,
  `${session}/${issue}/${attachment}/thumbnail`,
];

function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function fixture() {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const state = {
    account: {
      must_change: false,
      session_valid: true,
      auth_session_id: login as string | null,
    },
    accountError: "",
    finishError: "",
    abandonError: "",
    storageError: "",
    downloadError: false,
    status: "pending",
    removed: false,
  };
  const caller = {
    auth: {
      getUser: async () => ({ data: { user: { id: uploader } }, error: null }),
    },
    async rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "account_status") {
        return {
          data: state.account,
          error: state.accountError ? { message: state.accountError } : null,
        };
      }
      if (name === "begin_attachment") {
        return {
          data: {
            id: attachment,
            original_path: paths[0],
            thumbnail_path: paths[1],
            expired_paths: paths,
          },
          error: null,
        };
      }
      if (name === "attachment_cleanup_paths") {
        return { data: paths, error: null };
      }
      if (name === "abandon_attachment" && state.abandonError) {
        return { data: null, error: { message: state.abandonError } };
      }
      if (name === "delete_attachment") state.removed = true;
      return { data: paths, error: null };
    },
  };
  const lookup = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async maybeSingle() {
      return {
        data: {
          uploader,
          session_id: session,
          issue_id: issue,
          status: state.status,
        },
        error: null,
      };
    },
  };
  const service = {
    from: () => lookup,
    storage: {
      from: () => ({
        async download(path: string) {
          calls.push({ name: "download", args: { path } });
          if (state.downloadError) {
            return { data: null, error: { message: "Unavailable" } };
          }
          const bytes = new Uint8Array(path.endsWith("original") ? 1000 : 400);
          bytes.set([0xff, 0xd8, 0xff, 0xe0]);
          return { data: new Blob([bytes]), error: null };
        },
        async remove(files: string[]) {
          calls.push({ name: "storage_remove", args: { files } });
          return {
            data: null,
            error: state.storageError ? { message: state.storageError } : null,
          };
        },
      }),
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: null,
        error: state.finishError ? { message: state.finishError } : null,
      };
    },
  };
  // The handler uses only these SDK operations. Hosted transport is replaced
  // with controlled errors so tests never need credentials or create files.
  const handler = createAttachmentHandler(
    {
      projectUrl: "https://example.supabase.co",
      publicKey: "fixture-public",
      serviceKey: "fixture-service",
      origins: [],
    },
    (_url, key) =>
      (key === "fixture-service"
        ? service
        : caller) as unknown as SupabaseClient,
  );
  async function send(action: string, extra: Record<string, unknown> = {}) {
    return handler(
      new Request("https://example.supabase.co/functions/v1/attachments", {
        method: "POST",
        headers: {
          Authorization: "Bearer fixture-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          session_id: session,
          attachment_id: attachment,
          ...extra,
        }),
      }),
    );
  }
  return { state, calls, send };
}

Deno.test("completion uses the login context from the caller's authenticated RPC", async () => {
  const { calls, send } = fixture();
  equal((await send("finish")).status, 200);
  equal(calls[0].name, "account_status");
  const finish = calls.find((call) => call.name === "finish_attachment");
  equal(finish?.args?.p_uploader, uploader);
  equal(finish?.args?.p_auth_session, login);
  equal(finish?.args?.p_size, 1000);
  equal(finish?.args?.p_thumb_size, 400);
});

for (
  const condition of [
    "password",
    "old login",
    "missing login",
    "account RPC denied",
  ]
) {
  Deno.test(`completion rejects ${condition} before reading stored files`, async () => {
    const { state, calls, send } = fixture();
    if (condition === "password") state.account.must_change = true;
    if (condition === "old login") state.account.session_valid = false;
    if (condition === "missing login") state.account.auth_session_id = null;
    if (condition === "account RPC denied") {
      state.accountError = "No access to this session.";
    }
    equal((await send("finish")).status, 400);
    equal(calls.map((call) => call.name), ["account_status"]);
  });
}

Deno.test("completion checks permissions again in the service-only RPC", async () => {
  const { state, calls, send } = fixture();
  state.finishError = "No access to this session.";
  state.abandonError = "No access to this session.";
  const response = await send("finish");
  equal(response.status, 400);
  equal((await response.json()).error, "No access to this session.");
  equal(calls.some((call) => call.name === "finish_attachment"), true);
  equal(calls.some((call) => call.name === "storage_remove"), false);
});

Deno.test("a completed upload can retry its lost response without another file transfer", async () => {
  const { state, calls, send } = fixture();
  state.status = "ready";
  equal((await send("finish")).status, 200);
  equal(calls.map((call) => call.name), [
    "account_status",
    "finish_attachment",
  ]);
});

for (const action of ["remove", "abandon"]) {
  Deno.test(`${action} reports Storage failure and allows another request`, async () => {
    const { state, calls, send } = fixture();
    state.storageError = "Storage unavailable";
    const failed = await send(action);
    equal(failed.status, 400);
    equal(
      (await failed.json()).error,
      "The stored files could not be deleted. Try again.",
    );
    if (action === "remove") equal(state.removed, true);
    state.storageError = "";
    equal((await send(action)).status, 200);
    equal(calls.filter((call) => call.name === "storage_remove").length, 2);
    equal(
      calls.filter((call) => call.name === "finish_attachment_removal").length,
      action === "remove" ? 1 : 0,
    );
  });
}

Deno.test("expired file cleanup can be retried with the same begin request", async () => {
  const { state, calls, send } = fixture();
  const input = {
    request_id: "00000000-0000-4000-8000-000000008001",
    issue_id: issue,
    visibility: "internal",
    name: "photo.jpg",
    bytes: 1000,
  };
  state.storageError = "Storage unavailable";
  equal((await send("begin", input)).status, 400);
  state.storageError = "";
  equal((await send("begin", input)).status, 200);
  equal(
    calls.filter((call) => call.name === "attachment_cleanup_paths").length,
    2,
  );
  equal(
    calls.filter((call) => call.name === "storage_remove").map((call) =>
      call.args?.files
    ),
    [paths, paths],
  );
});

Deno.test("removal keeps a retry when its final database confirmation fails", async () => {
  const { state, calls, send } = fixture();
  state.finishError = "Database unavailable";
  const failed = await send("remove");
  equal(failed.status, 400);
  equal((await failed.json()).error, "Database unavailable");
  state.finishError = "";
  equal((await send("remove")).status, 200);
  equal(
    calls.filter((call) => call.name === "finish_attachment_removal").length,
    2,
  );
});

Deno.test("invalid-image cleanup reports deletion failure instead of success", async () => {
  const { state, calls, send } = fixture();
  state.finishError = "Choose a JPEG, PNG, or WebP image.";
  state.storageError = "Storage unavailable";
  const response = await send("finish");
  equal(response.status, 400);
  const body = await response.json();
  equal(body.error, "The stored files could not be deleted. Try again.");
  equal(body.validation, false);
  const cleanupCalls = calls.slice(-2).map((call) => call.name);
  equal(cleanupCalls, ["abandon_attachment", "storage_remove"]);
});
