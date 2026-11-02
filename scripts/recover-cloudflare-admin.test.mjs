import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
  assertMaintainerTerminal,
  parseRecoveryArguments,
  publicError,
  readRecoveryTarget,
  runRecoveryCommand,
  writeTemporaryPassword,
} from "./recover-cloudflare-admin.mjs";

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const configText = JSON.stringify({
  name: "minsky-dev",
  d1_databases: [{
    binding: "DB",
    database_name: "minsky-development",
    database_id: "a1832f97-4d4c-45c2-a848-8d3dfd0b74f5",
    remote: true,
  }],
});

function passwordAppearsOnce(lines, password) {
  return lines.filter((line) => line === password).length === 1
    && lines.every((line) => line === password || !line.includes(password));
}

it("reads the development database and rejects a config without a remote DB binding", async () => {
  const development = await readFile("src/server/adapters/cloudflare/deploy/development.wrangler.jsonc", "utf8");
  const rootConfig = await readFile("wrangler.jsonc", "utf8");
  expect(readRecoveryTarget(development).databaseName).toBe("minsky-development");
  expect(() => readRecoveryTarget(rootConfig)).toThrow("no remote DB binding");
  expect(() => readRecoveryTarget(JSON.stringify({ env: { production: {} }, d1_databases: [] }))).toThrow("environment overrides");
});

it("requires the webmaster's username", () => {
  expect(parseRecoveryArguments(["--username", "organizer"])).toEqual({ config: "wrangler.jsonc", username: "organizer" });
  expect(parseRecoveryArguments(["--config", "worker.jsonc", "--username", "organizer"]).config).toBe("worker.jsonc");
  expect(() => parseRecoveryArguments([])).toThrow("--username");
  expect(() => parseRecoveryArguments(["--user", "e102228c-f5c8-4180-962f-3a8b87d99b13"])).toThrow("Usage:");
  expect(() => parseRecoveryArguments(["--password", "secret"])).toThrow("Usage:");
});

it("refuses CI and a non-interactive terminal before opening a database", async () => {
  const openPlatform = () => { throw new Error("platform opened"); };
  await expect(runRecoveryCommand(["--username", "organizer"], {
    env: { CI: "true" }, stdout: { isTTY: true }, openPlatform,
  })).rejects.toThrow("refuses CI");
  await expect(runRecoveryCommand(["--username", "organizer"], {
    env: {}, stdout: { isTTY: false }, openPlatform,
  })).rejects.toThrow("interactive terminal");
  expect(() => assertMaintainerTerminal({ GITHUB_ACTIONS: "true" }, { isTTY: true })).toThrow("refuses CI");
});

it("prints the temporary password once and hides provider errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "minsky-recover-admin-"));
  directories.push(directory);
  const config = join(directory, "wrangler.jsonc");
  await writeFile(config, configText);
  const lines = [];
  let disposed = false;
  const password = "fixture-temporary-password";
  await runRecoveryCommand(["--config", config, "--username", "organizer"], {
    env: {},
    stdout: { isTTY: true },
    cwd: directory,
    write: (line) => lines.push(line),
    openPlatform: async () => ({ env: { DB: { marker: true } }, dispose: async () => { disposed = true; } }),
    loadLibrary: async () => ({
      library: {
        recoverWebmaster: async (database, selector) => {
          expect(database.marker).toBe(true);
          expect(selector).toEqual({ username: "organizer" });
          return { accountId: "e102228c-f5c8-4180-962f-3a8b87d99b13", username: "organizer", temporaryPassword: password };
        },
      },
      dispose: async () => undefined,
    }),
  });
  expect(disposed).toBe(true);
  expect(lines[0]).toBe("Recovering a webmaster in remote D1 database minsky-development.");
  expect(passwordAppearsOnce(lines, password)).toBe(true);
  const hidden = publicError(new Error("provider output includes password hunter2"));
  expect(hidden.startsWith("Webmaster recovery failed")).toBe(true);
  expect(hidden.includes("hunter2")).toBe(false);
});

it("does not print a password when recovery refuses the account", async () => {
  const directory = await mkdtemp(join(tmpdir(), "minsky-recover-admin-"));
  directories.push(directory);
  const config = join(directory, "wrangler.jsonc");
  await writeFile(config, configText);
  const lines = [];
  await expect(runRecoveryCommand(["--config", config, "--username", "contestant"], {
    env: {},
    stdout: { isTTY: true },
    cwd: directory,
    write: (line) => lines.push(line),
    openPlatform: async () => ({ env: { DB: {} }, dispose: async () => undefined }),
    loadLibrary: async () => ({
      library: {
        recoverWebmaster: async () => { throw new Error("The account is not a webmaster. Recovery did not start."); },
      },
      dispose: async () => undefined,
    }),
  })).rejects.toThrow("not a webmaster");
  expect(lines).toEqual(["Recovering a webmaster in remote D1 database minsky-development."]);
});

it("does not print a rejected password", () => {
  expect(() => writeTemporaryPassword({ username: "organizer", temporaryPassword: "short" }, () => undefined)).toThrow("was not changed");
  const lines = [];
  writeTemporaryPassword({ username: "organizer", temporaryPassword: "fixture-temporary-password" }, (line) => lines.push(line));
  expect(passwordAppearsOnce(lines, "fixture-temporary-password")).toBe(true);
  expect(lines[0].includes("fixture-temporary-password")).toBe(false);
});

async function recoveryBundles() {
  const names = await readdir(".wrangler").catch(() => []);
  return names.filter((name) => name.startsWith("webmaster-recovery-"));
}

// Vitest resolves packages from the repository root, so only plain Node shows where the bundle can find them.
const loadInNode = `
import { loadRecoveryLibrary } from "./scripts/recover-cloudflare-admin.mjs";
const { library, dispose } = await loadRecoveryLibrary();
await dispose();
console.log(typeof library.recoverWebmaster);
`;

it("loads the recovery library in Node without a database or a password", async () => {
  const before = await recoveryBundles();
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "--eval", loadInNode]);
  expect(stdout.trim()).toBe("function");
  expect(await recoveryBundles()).toEqual(before);
});

it("adds an error code or class and omits messages, stacks, and secrets", () => {
  const missing = new Error("Cannot find package 'better-auth' imported from /tmp/minsky-admin-recovery/admin-recovery.mjs");
  missing.code = "ERR_MODULE_NOT_FOUND";
  missing.stack = "Error: hunter2\n    at load (/tmp/secret-token)";
  expect(publicError(missing)).toBe("Webmaster recovery failed. The temporary password was not shown. The error code is ERR_MODULE_NOT_FOUND.");

  const named = new TypeError("session token sk-live");
  expect(publicError(named)).toBe("Webmaster recovery failed. The temporary password was not shown. The error class is TypeError.");

  const unsafe = new Error("hunter2");
  unsafe.code = "hunter2";
  expect(publicError(unsafe)).toBe("Webmaster recovery failed. The temporary password was not shown.");
  expect(publicError(new Error("The username is invalid. Recovery did not start.")))
    .toBe("The username is invalid. Recovery did not start.");
});
