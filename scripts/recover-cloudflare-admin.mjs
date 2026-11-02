import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { bundleProviderModule } from "../src/server/adapters/cloudflare/tooling/bundle.mjs";
import { enforceWranglerEnvironment } from "../src/server/adapters/cloudflare/tooling/safe-environment.mjs";

const usage = "Usage: npm run cloudflare:recover-admin -- [--config WRANGLER_CONFIG] --username NAME";

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(usage);
  return value;
}

/** Read a maintainer command. The password is never an argument. */
export function parseRecoveryArguments(argv) {
  const known = ["--config", "--username"];
  if (argv.some((argument) => argument.startsWith("--") && !known.includes(argument))) throw new Error(usage);
  const consumed = new Set();
  for (const flag of known) {
    const index = argv.indexOf(flag);
    if (index === -1) continue;
    consumed.add(index);
    consumed.add(index + 1);
  }
  if (argv.some((_, index) => !consumed.has(index))) throw new Error(usage);
  const username = valueAfter(argv, "--username");
  if (username === undefined) throw new Error("Provide the webmaster's --username. Recovery did not start.");
  return { config: valueAfter(argv, "--config") ?? "wrangler.jsonc", username };
}

/** Refuse CI and any stdout that is not an interactive terminal. */
export function assertMaintainerTerminal(env, stdout) {
  if (env.CI || env.GITHUB_ACTIONS || env.GITHUB_WORKFLOW) {
    throw new Error("Webmaster recovery runs only in a maintainer terminal. It refuses CI.");
  }
  if (!stdout?.isTTY) {
    throw new Error("Webmaster recovery prints the temporary password only on an interactive terminal.");
  }
}

/** Require one remote DB binding. Environment overrides can hide a second database. */
export function readRecoveryTarget(configText) {
  let config;
  try {
    config = JSON.parse(configText);
  } catch {
    throw new Error("The Wrangler configuration could not be read. Recovery did not start.");
  }
  if (!config || typeof config !== "object" || Array.isArray(config) || config.env) {
    throw new Error("Select a Wrangler configuration without environment overrides. Recovery did not start.");
  }
  const databases = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  const bindings = databases.filter((entry) => entry && entry.binding === "DB");
  const name = bindings[0]?.database_name;
  if (bindings.length !== 1 || bindings[0].remote !== true || typeof name !== "string" || !/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(name)) {
    throw new Error("The selected Wrangler configuration has no remote DB binding. Recovery did not start.");
  }
  return { databaseName: name };
}

function publicFailureHint(error) {
  const code = error?.code;
  if (typeof code === "string" && /^ERR_[A-Z0-9_]{1,48}$/.test(code)) return ` The error code is ${code}.`;
  const name = error instanceof Error ? error.name : "";
  if (/^[A-Z][A-Za-z0-9]{0,42}Error$/.test(name)) return ` The error class is ${name}.`;
  return "";
}

function publicError(error) {
  const message = error instanceof Error ? error.message : "";
  if (
    message === usage
    || message.endsWith("Recovery did not start.")
    || message.endsWith("The account was not changed.")
    || message.startsWith("Webmaster recovery runs only")
    || message.startsWith("Webmaster recovery prints")
  ) return message;
  return `Webmaster recovery failed. The temporary password was not shown.${publicFailureHint(error)}`;
}

/** Print the temporary password once. The message line does not contain it. */
export function writeTemporaryPassword(result, write) {
  if (
    typeof result.temporaryPassword !== "string"
    || result.temporaryPassword.length < 12
    || /[\r\n]/.test(result.temporaryPassword)
    || result.username.includes(result.temporaryPassword)
  ) {
    throw new Error("Webmaster recovery did not finish. The account was not changed.");
  }
  write(`Webmaster recovery completed for ${result.username}. Share this temporary password securely. The next sign-in must change it.`);
  write(result.temporaryPassword);
}

export function loadRecoveryLibrary() {
  return bundleProviderModule("src/server/adapters/cloudflare/installation.ts", "webmaster-recovery-");
}

async function openRemotePlatform(configPath) {
  enforceWranglerEnvironment();
  process.env.WRANGLER_LOG = "error";
  const { getPlatformProxy } = await import("wrangler");
  return getPlatformProxy({ configPath, remoteBindings: true, persist: false, envFiles: [] });
}

/**
 * Reset one webmaster password.
 * Tests inject the database and writer. The real command uses remote D1.
 */
export async function runRecoveryCommand(argv, dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;
  assertMaintainerTerminal(env, stdout);
  const options = parseRecoveryArguments(argv);
  const configPath = resolve(dependencies.cwd ?? process.cwd(), options.config);
  let text;
  try {
    text = await readFile(configPath, "utf8");
  } catch {
    throw new Error("The Wrangler configuration could not be read. Recovery did not start.");
  }
  const target = readRecoveryTarget(text);
  const write = dependencies.write ?? ((line) => { stdout.write(`${line}\n`); });
  write(`Recovering a webmaster in remote D1 database ${target.databaseName}.`);
  const prepared = await (dependencies.loadLibrary ?? loadRecoveryLibrary)();
  let platform;
  try {
    platform = await (dependencies.openPlatform ?? openRemotePlatform)(configPath);
    if (!platform?.env?.DB) throw new Error("The selected Wrangler configuration has no remote DB binding. Recovery did not start.");
    writeTemporaryPassword(await prepared.library.recoverWebmaster(platform.env.DB, { username: options.username }), write);
  } finally {
    await platform?.dispose?.();
    await prepared.dispose?.();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRecoveryCommand(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${publicError(error)}\n`);
    process.exitCode = 1;
  });
}

export { publicError };
