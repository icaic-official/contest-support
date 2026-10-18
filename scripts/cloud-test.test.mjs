import { afterEach, expect, it, vi } from "vitest";
import process from "node:process";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const cloud = vi.hoisted(() => ({ requests: [], failure: "" }));
vi.mock("@supabase/supabase-js", () => {
  function remove(table, column, value) {
    cloud.requests.push({ table, column, value });
    return {
      error: table === cloud.failure ? { message: "Delete rejected." } : null,
    };
  }
  return {
    createClient: () => ({
      from: (table) => ({
        select: (columns) => ({
          in: (column, value) => {
            cloud.requests.push({ table, columns, column, value });
            return { data: [], error: null };
          },
        }),
        delete: () => ({
          in: (column, value) => remove(table, column, value),
          eq: (column, value) => remove(table, column, value),
        }),
      }),
      auth: {
        admin: { deleteUser: (value) => remove("auth.users", "id", value) },
      },
    }),
  };
});

const directories = [];
const runner = resolve("scripts/cloud-test.mjs");
function directory() {
  const path = mkdtempSync(join(tmpdir(), "minsky-cleanup-check-"));
  directories.push(path);
  return path;
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

it("keeps exact fixture records after a rejected deletion and removes the file after a successful retry", async () => {
  const path = join(directory(), "fixture.json");
  const contents =
    '{"event":"event-one","sessions":["session-one"],"teams":["team-one"],"accounts":{"helper":{"id":"user-one"}}}';
  writeFileSync(path, contents, { mode: 0o600 });
  vi.stubEnv("MINSKY_CLOUD_FIXTURE", path);
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  const { default: teardown } = await import("../tests/cloud/teardown");
  cloud.failure = "history";
  cloud.requests = [];
  await expect(teardown()).rejects.toThrow(
    "Fixture cleanup failed for history: Delete rejected.",
  );
  expect(readFileSync(path, "utf8")).toBe(
    '{"event":"event-one","sessions":["session-one"],"teams":["team-one"],"accounts":{"helper":{"id":"user-one"}}}',
  );
  expect(cloud.requests).toEqual([
    {
      table: "attachments", columns: "id,session_id,issue_id",
      column: "session_id", value: ["session-one"],
    },
    { table: "attachments", column: "session_id", value: ["session-one"] },
    { table: "admin_audit", column: "session_id", value: ["session-one"] },
    { table: "history", column: "session_id", value: ["session-one"] },
  ]);
  cloud.failure = "";
  cloud.requests = [];
  await teardown();
  expect(cloud.requests).toEqual([
    {
      table: "attachments", columns: "id,session_id,issue_id",
      column: "session_id", value: ["session-one"],
    },
    { table: "attachments", column: "session_id", value: ["session-one"] },
    { table: "admin_audit", column: "session_id", value: ["session-one"] },
    { table: "history", column: "session_id", value: ["session-one"] },
    { table: "awards", column: "session_id", value: ["session-one"] },
    { table: "resolutions", column: "session_id", value: ["session-one"] },
    { table: "issues", column: "session_id", value: ["session-one"] },
    { table: "changes", column: "session_id", value: ["session-one"] },
    { table: "staff_changes", column: "session_id", value: ["session-one"] },
    { table: "memberships", column: "session_id", value: ["session-one"] },
    { table: "teams", column: "session_id", value: ["session-one"] },
    { table: "sessions", column: "id", value: ["session-one"] },
    { table: "events", column: "id", value: "event-one" },
    { table: "people", column: "id", value: "user-one" },
    { table: "auth.users", column: "id", value: "user-one" },
  ]);
  expect(existsSync(path)).toBe(false);
});

/** Runs the real CLI with a child process that reports only its fixture path. */
function runChild(cleanupSucceeds, status) {
  const cwd = directory();
  const executable = join(cwd, "node_modules/.bin/playwright");
  mkdirSync(dirname(executable), { recursive: true });
  writeFileSync(
    executable,
    `#!${process.execPath}
import { writeFileSync, unlinkSync } from 'node:fs';
const path = process.env.MINSKY_CLOUD_FIXTURE;
writeFileSync(path, '{"sessions":["session-one"],"accounts":{"helper":{"id":"user-one"}}}', {mode: 0o600});
writeFileSync('child-result.json', JSON.stringify({path}));
if (${cleanupSucceeds}) unlinkSync(path);
process.exit(${status});
`,
    { mode: 0o700 },
  );
  const result = spawnSync(process.execPath, [runner], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      MINSKY_TEST_PROJECT_REF: "abcdefghijklmnopqrst",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
      SUPABASE_ANON_KEY: "fixture-public-key",
    },
  });
  const { path } = JSON.parse(
    readFileSync(join(cwd, "child-result.json"), "utf8"),
  );
  directories.push(dirname(path));
  return { result, path };
}

it("reports the retained recovery file when the cloud child fails before cleanup completes", () => {
  const { result, path } = runChild(false, 1);
  expect(result.status).toBe(1);
  expect(readFileSync(path, "utf8")).toBe(
    '{"sessions":["session-one"],"accounts":{"helper":{"id":"user-one"}}}',
  );
  expect(result.stderr).toBe(
    `Fixture cleanup did not complete. Recovery file retained at ${path}\n`,
  );
});

it.each([0, 1])(
  "removes the temporary directory after completed cleanup and preserves exit status %i",
  (status) => {
    const { result, path } = runChild(true, status);
    expect(result.status).toBe(status);
    expect(result.stderr).toBe("");
    expect(existsSync(dirname(path))).toBe(false);
  },
);
