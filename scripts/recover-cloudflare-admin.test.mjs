import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  assertMaintainerTerminal,
  parseRecoveryArguments,
  publicError,
  readRecoveryTarget,
  runRecoveryCommand,
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

it("requires exactly one account selector", () => {
  expect(parseRecoveryArguments(["--username", "organizer"])).toEqual({
    config: "wrangler.jsonc", username: "organizer", userId: undefined,
  });
  expect(parseRecoveryArguments(["--config", "worker.jsonc", "--user", "e102228c-f5c8-4180-962f-3a8b87d99b13"]).userId)
    .toBe("e102228c-f5c8-4180-962f-3a8b87d99b13");
  expect(() => parseRecoveryArguments([])).toThrow("either --username or --user");
  expect(() => parseRecoveryArguments(["--username", "organizer", "--user", "e102228c-f5c8-4180-962f-3a8b87d99b13"])).toThrow("either --username or --user");
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
        recoverCloudflareAdmin: async (database, selector) => {
          expect(database.marker).toBe(true);
          expect(selector.username).toBe("organizer");
          expect(selector.userId).toBeUndefined();
          return { accountId: "e102228c-f5c8-4180-962f-3a8b87d99b13", username: "organizer", temporaryPassword: password };
        },
        writeTemporaryPassword: (result, write) => {
          write(`Admin recovery completed for ${result.username}. Share this temporary password securely. The next sign-in must change it.`);
          write(result.temporaryPassword);
        },
      },
      dispose: async () => undefined,
    }),
  });
  expect(disposed).toBe(true);
  expect(lines[0]).toBe("Recovering an admin in remote D1 database minsky-development.");
  expect(passwordAppearsOnce(lines, password)).toBe(true);
  const hidden = publicError(new Error("provider output includes password hunter2"));
  expect(hidden.startsWith("Admin recovery failed")).toBe(true);
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
        recoverCloudflareAdmin: async () => { throw new Error("The account is not an admin of an active event or the installation owner. Recovery did not start."); },
        writeTemporaryPassword: () => { throw new Error("printed"); },
      },
      dispose: async () => undefined,
    }),
  })).rejects.toThrow("not an admin");
  expect(lines).toEqual(["Recovering an admin in remote D1 database minsky-development."]);
});
