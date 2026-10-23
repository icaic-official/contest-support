import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { enforceWranglerEnvironment } from "../src/server/adapters/cloudflare/tooling/safe-environment.mjs";

const usage = "Usage: npm run cloudflare:recover-admin -- [--config WRANGLER_CONFIG] (--username NAME | --user ACCOUNT_ID)";
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(usage);
  return value;
}

/** Read a maintainer command. The password is never an argument. */
export function parseRecoveryArguments(argv) {
  const known = ["--config", "--username", "--user"];
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
  const userId = valueAfter(argv, "--user");
  if ((username === undefined) === (userId === undefined)) {
    throw new Error("Provide either --username or --user. Recovery did not start.");
  }
  return {
    config: valueAfter(argv, "--config") ?? "wrangler.jsonc",
    username,
    userId,
  };
}

/** Refuse CI and any stdout that is not an interactive terminal. */
export function assertMaintainerTerminal(env, stdout) {
  if (env.CI || env.GITHUB_ACTIONS || env.GITHUB_WORKFLOW) {
    throw new Error("Admin recovery runs only in a maintainer terminal. It refuses CI.");
  }
  if (!stdout?.isTTY) {
    throw new Error("Admin recovery prints the temporary password only on an interactive terminal.");
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

const hiddenFailure = "Admin recovery failed. The temporary password was not shown.";

function publicFailureHint(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  if (typeof code === "string" && /^ERR_[A-Z0-9_]{1,48}$/.test(code)) {
    return `The error code is ${code}.`;
  }
  const name = error instanceof Error ? error.name : "";
  if (name.length <= 48 && (name === "Error" || /^[A-Z][A-Za-z0-9]*Error$/.test(name))) {
    return `The error class is ${name}.`;
  }
  return "";
}

function publicError(error) {
  const message = error instanceof Error ? error.message : "";
  if (
    message === usage
    || message.endsWith("Recovery did not start.")
    || message.endsWith("The account was not changed.")
    || message.startsWith("Admin recovery runs only")
    || message.startsWith("Admin recovery prints")
  ) return message;
  const hint = publicFailureHint(error);
  return hint ? `${hiddenFailure} ${hint}` : hiddenFailure;
}

/** Bundle inside the repository. Node then finds packages in the repository node_modules. */
export async function loadRecoveryLibrary() {
  const { build } = await import("esbuild");
  const cacheRoot = resolve(repositoryRoot, "node_modules/.cache");
  await mkdir(cacheRoot, { recursive: true });
  const directory = await mkdtemp(resolve(cacheRoot, "minsky-admin-recovery-"));
  const output = resolve(directory, "admin-recovery.mjs");
  try {
    await build({
      entryPoints: [resolve(repositoryRoot, "src/server/adapters/cloudflare/adminRecovery.ts")],
      outfile: output,
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
      target: "node22",
      logLevel: "silent",
    });
    return {
      library: await import(pathToFileURL(output).href),
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function openRemotePlatform(configPath) {
  enforceWranglerEnvironment();
  process.env.WRANGLER_LOG = "error";
  const { getPlatformProxy } = await import("wrangler");
  return getPlatformProxy({ configPath, remoteBindings: true, persist: false, envFiles: [] });
}

/**
 * Reset one Cloudflare admin password.
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
  write(`Recovering an admin in remote D1 database ${target.databaseName}.`);
  const prepared = await (dependencies.loadLibrary ?? loadRecoveryLibrary)();
  let platform;
  try {
    platform = await (dependencies.openPlatform ?? openRemotePlatform)(configPath);
    if (!platform?.env?.DB) throw new Error("The selected Wrangler configuration has no remote DB binding. Recovery did not start.");
    const result = await prepared.library.recoverCloudflareAdmin(platform.env.DB, {
      username: options.username,
      userId: options.userId,
    });
    prepared.library.writeTemporaryPassword(result, write);
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
