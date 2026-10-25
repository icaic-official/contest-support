import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readInstallationTarget } from "../src/server/adapters/cloudflare/tooling/configuration.mjs";
import { assertAdditiveMigrations, assertCurrentMigrations } from "../src/server/adapters/cloudflare/tooling/migrations.mjs";
import { confirmTarget } from "../src/server/adapters/cloudflare/tooling/operations.mjs";
import { safeWranglerEnvironment } from "../src/server/adapters/cloudflare/tooling/safe-environment.mjs";

const repository = "GiftedNovaHD/minsky";
const account = "458ad6a930b0fb717796dfa19ca6a2b1";
const docsWorker = { name: "minsky-docs", config: "wrangler.docs.jsonc", assets: "site/dist" };
// Branch previews replace one shared Worker that binds only test resources.
const previewWorker = { name: "minsky-preview", config: "src/server/adapters/cloudflare/deploy/preview.wrangler.jsonc" };
const workerOrigin = (name) => `https://${name}.icaic-minsky.workers.dev`;

/** Workers Builds supplies the pushed branch and commit. A manual run sets the same two values. */
export function deploymentPlan(env) {
  const sha = env.WORKERS_CI_COMMIT_SHA ?? "";
  if (!/^[a-f0-9]{40}$/.test(sha) || /^0+$/.test(sha)) {
    throw new Error("Deployment requires the pushed commit in WORKERS_CI_COMMIT_SHA.");
  }
  const branch = env.WORKERS_CI_BRANCH;
  if (!branch || /[\r\n]/.test(branch)) throw new Error("Missing or invalid branch name in WORKERS_CI_BRANCH.");
  return { branch, sha, preview: branch !== "main" };
}

export function validateBuildSettings(env) {
  if (env.CLOUDFLARE_ACCOUNT_ID !== account || env.VITE_ENVIRONMENT !== "development") {
    throw new Error("Deployment must use the configured Minsky development account and environment.");
  }
}

/** An older build must not replace a newer push. The public repository needs no token. */
export function isCurrentRevision(plan, execute = execFileSync) {
  const ref = `refs/heads/${plan.branch}`;
  let output;
  try {
    output = execute("git", ["ls-remote", "--exit-code", `https://github.com/${repository}.git`, ref], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch (error) {
    // Exit status 2 means that no branch matched: the branch was deleted.
    if (error?.status === 2) return false;
    throw new Error("The GitHub branch lookup failed.", { cause: error });
  }
  return output.split("\n").includes(`${plan.sha}\t${ref}`);
}

/** Return the commit that a Worker serves now, or null when it cannot be read. */
export async function publishedRevision(url, request = globalThis.fetch) {
  try {
    const response = await request(`${url}/minsky-revision.json`, {
      cache: "no-store", signal: globalThis.AbortSignal.timeout(10_000),
    });
    const sha = response.ok ? (await response.json()).sha : null;
    return typeof sha === "string" ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Return true when the Worker serves the expected marker. On a Worker that all branches share,
 * pass the revision it served before this upload as `previous`. Then a third revision means
 * that another build published after this one, and the result is false.
 */
export async function verifyRevision(url, expected, request = globalThis.fetch, pause = setTimeout, previous) {
  const marker = typeof expected === "string" ? { sha: expected } : expected;
  // New preview DNS records can take time to become available.
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await request(`${url}/minsky-revision.json?sha=${marker.sha}`, {
        cache: "no-store", signal: globalThis.AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const published = await response.json();
        if (Object.entries(marker).every(([key, value]) => published[key] === value)) return true;
        if (previous !== undefined && typeof published.sha === "string" &&
            published.sha !== marker.sha && published.sha !== previous) return false;
      }
    } catch { /* Retry network, DNS, and non-JSON responses within this limit. */ }
    if (attempt < 11) await pause(5000);
  }
  throw new Error(`The published source revision could not be verified at ${url}.`);
}

function summary(message) {
  process.stdout.write(`${message}\n`);
}

async function previewTarget(env, installation) {
  // The development build variables identify the minsky-dev build and its token.
  if (Object.entries(env).some(([key, value]) => key.startsWith("MINSKY_DEV_") && value)) {
    throw new Error("A preview build must not receive development target variables.");
  }
  const settings = await installation(previewWorker.config);
  // Branch code can edit this file. Only the build variable fixes the exact database.
  if (settings.accountId !== account || settings.workerName !== previewWorker.name ||
      settings.origin !== workerOrigin(previewWorker.name) ||
      [settings.databaseName, settings.bucketName].some((name) => !name?.startsWith("minsky-preview")) ||
      settings.databaseId !== env.MINSKY_PREVIEW_DATABASE_ID) {
    throw new Error("Confirm the exact preview Worker, database, bucket, origin, and account.");
  }
  return { name: previewWorker.name, config: previewWorker.config, assets: "dist", backend: "cloudflare", settings };
}

/** Validate the full provider configuration instead of maintaining another generator. */
export async function deploymentTargets(env, site = "both", {
  read = readFileSync, installation = readInstallationTarget,
} = {}) {
  if (!["app", "docs", "both"].includes(site)) throw new Error("Select app, docs, or both.");
  if (env.CLOUDFLARE_ACCOUNT_ID !== account) throw new Error("Unexpected Cloudflare deployment account.");
  const plan = deploymentPlan(env);
  const targets = [];
  // Only the minsky-preview build sets the preview environment. It also builds its
  // production branch, main, which minsky-dev publishes. Other branch builds skip the app.
  const previewBuild = env.VITE_ENVIRONMENT === "preview";
  if (site !== "docs" && plan.preview && previewBuild) {
    targets.push(await previewTarget(env, installation));
  }
  if (site !== "docs" && !plan.preview && !previewBuild) {
    validateBuildSettings(env);
    const path = env.MINSKY_DEV_CLOUDFLARE_CONFIG;
    if (!path || isAbsolute(path) || relative(process.cwd(), resolve(path)).startsWith("..")) {
      throw new Error("Select a provider-generated configuration inside the repository.");
    }
    const settings = await installation(path);
    if (settings.accountId !== account || settings.workerName !== "minsky-dev" ||
        settings.origin !== workerOrigin("minsky-dev") ||
        settings.databaseId !== env.MINSKY_DEV_DATABASE_ID ||
        settings.databaseName !== env.MINSKY_DEV_DATABASE_NAME ||
        settings.bucketName !== env.MINSKY_DEV_BUCKET_NAME ||
        [settings.databaseName, settings.bucketName].some((name) => /(?:^|-)(?:ci|test|install|installation)(?:-|$)/.test(name))) {
      throw new Error("Confirm the exact stable development Worker, database, bucket, origin, and account.");
    }
    targets.push({ name: "minsky-dev", config: path, assets: "dist", backend: "cloudflare", settings });
  }
  // The minsky-docs build uploads docs previews for other branches itself.
  if (site !== "app" && !plan.preview) {
    const config = JSON.parse(read(docsWorker.config, "utf8"));
    if (config.name !== docsWorker.name || config.account_id !== account ||
        config.assets?.directory !== `./${docsWorker.assets}` || config.main ||
        config.d1_databases || config.r2_buckets || config.durable_objects || config.env || config.routes) {
      throw new Error(`Unexpected deployment target in ${docsWorker.config}.`);
    }
    targets.push(docsWorker);
  }
  return targets;
}

async function workerSettings(worker, env, request) {
  const response = await request(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker.name}/settings`, {
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true || !Array.isArray(body.result?.bindings)) {
    throw new Error("Worker metadata unavailable");
  }
  return body.result;
}

/** Check deployed metadata and API behavior without creating a session or fixture. */
export async function verifyApplicationDeployment(worker, env, request = globalThis.fetch) {
  try {
    const settings = await workerSettings(worker, env, request);
    const byName = new Map();
    for (const binding of settings.bindings) {
      if (!binding || typeof binding.name !== "string" || byName.has(binding.name)) {
        throw new Error("Invalid binding metadata");
      }
      byName.set(binding.name, binding);
    }
    const database = byName.get("DB");
    const images = byName.get("IMAGES");
    const live = byName.get("LIVE_UPDATES");
    const origin = byName.get("AUTH_ORIGIN");
    if (database?.type !== "d1" || database.id !== worker.settings.databaseId ||
        images?.type !== "r2_bucket" || images.bucket_name !== worker.settings.bucketName ||
        live?.type !== "durable_object_namespace" || live.class_name !== "SessionLiveCoordinator" ||
        typeof live.namespace_id !== "string" || !live.namespace_id ||
        live.script_name && live.script_name !== worker.name ||
        origin?.type !== "plain_text" || origin.text !== worker.settings.origin ||
        byName.get("AUTH_SECRET")?.type !== "secret_text") {
      throw new Error("Deployed binding mismatch");
    }
    const response = await request(`${worker.settings.origin}/api/auth/session`, {
      headers: { Origin: worker.settings.origin }, cache: "no-store",
      signal: globalThis.AbortSignal.timeout(15_000),
    });
    if (response.status !== 401 || (await response.json()).error !== "Sign in to continue.") {
      throw new Error("The application API did not reject an anonymous session");
    }
  } catch {
    throw new Error("The deployed Cloudflare bindings or application API could not be verified. Provider output was withheld. Inspect the target before recovery.");
  }
}

function applicationMarker(worker, sha) {
  return {
    sha, backend: worker.backend, databaseId: worker.settings.databaseId,
    bucketName: worker.settings.bucketName, origin: worker.settings.origin,
  };
}

/** Confirm the exact live target, then bring its schema to this checkout's migrations. */
export async function prepareApplication(worker, env, execute = execFileSync, request = globalThis.fetch, report = summary) {
  await assertAdditiveMigrations();
  const runWrangler = (arguments_) => {
    try {
      return execute("node_modules/.bin/wrangler", [...arguments_, "--config", worker.config], {
        // CI lets the migration command proceed without an interactive confirmation.
        env: { ...safeWranglerEnvironment(env), CI: "true" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 2 * 1024 * 1024, timeout: 120_000,
      });
    } catch {
      throw new Error("Cloudflare target inspection failed. Provider output was withheld.");
    }
  };
  const preview = worker.name === previewWorker.name;
  // The build variable, not the committed configuration, names the expected database.
  const database = preview ? env.MINSKY_PREVIEW_DATABASE_ID : env.MINSKY_DEV_DATABASE_ID;
  await confirmTarget({ account, database }, worker.settings, runWrangler);
  try {
    const bucket = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${worker.settings.bucketName}`;
    const results = await Promise.all(["", "/domains/managed", "/domains/custom"].map(async (suffix) => {
      const response = await request(bucket + suffix, {
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
        signal: globalThis.AbortSignal.timeout(15_000),
      });
      const body = await response.json();
      if (!response.ok || body.success !== true) throw new Error("R2 metadata unavailable");
      return body.result;
    }));
    if (results[0]?.name !== worker.settings.bucketName || results[1]?.enabled !== false ||
        !Array.isArray(results[2]?.domains) || results[2].domains.length !== 0) {
      throw new Error("R2 target or privacy mismatch");
    }
  } catch {
    throw new Error("The exact private R2 bucket could not be confirmed. Provider output was withheld.");
  }
  try {
    const secrets = JSON.parse(runWrangler(["secret", "list", "--format", "json"]));
    if (!Array.isArray(secrets) || !secrets.some((entry) => entry?.name === "AUTH_SECRET")) {
      throw new Error("Missing authentication secret");
    }
  } catch {
    throw new Error("Confirm AUTH_SECRET on the selected Worker before deployment. Secret values were not requested.");
  }
  // Print the restore point first, so recovery from a damaged migration needs no lookup.
  let bookmark;
  try {
    bookmark = JSON.parse(await runWrangler(["d1", "time-travel", "info", worker.settings.databaseName, "--json"])).bookmark;
    if (typeof bookmark !== "string" || !/^[0-9a-f-]{16,128}$/.test(bookmark)) throw new Error("Invalid bookmark");
  } catch {
    throw new Error("The D1 restore point could not be recorded. No migration started.");
  }
  report(`Restore point before migrations: ${bookmark}. To restore it, run: npx wrangler d1 time-travel restore ` +
    `${worker.settings.databaseName} --bookmark=${bookmark} --config ${worker.config}`);
  // Apply only after every read-only check passes. assertAdditiveMigrations keeps a
  // Worker rollback runnable against the newer schema.
  try {
    await runWrangler(["d1", "migrations", "apply", worker.settings.databaseName, "--remote"]);
  } catch {
    throw new Error("The migration outcome is unknown. Provider output was withheld. Inspect applied versions before retrying.");
  }
  // All branches share the preview database. Another branch can add migrations that this checkout lacks.
  await assertCurrentMigrations(worker.settings, runWrangler, { allowExtra: preview });
}

/** The build and upload use the Cloudflare backend and confirmed public configuration. */
export async function buildWorkers(env, {
  site = "both", execute = execFileSync, write = writeFileSync, targets = deploymentTargets,
} = {}) {
  const plan = deploymentPlan(env);
  for (const worker of await targets(env, site)) {
    const childEnv = { ...env };
    for (const key of ["CLOUDFLARE_API_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "AUTH_SECRET"]) delete childEnv[key];
    execute("npm", ["run", worker.backend ? "build" : "docs:build"], { env: childEnv, stdio: "inherit" });
    if (worker.backend) write("dist/minsky-build.json", JSON.stringify({
      ...applicationMarker(worker, plan.sha), config: worker.config,
    }) + "\n");
  }
}

export async function deployWorkers(env, {
  site = "both", current = isCurrentRevision, execute = execFileSync, verify = verifyRevision,
  read = readFileSync, write = writeFileSync, report = summary, targets = deploymentTargets,
  application = prepareApplication, revision = publishedRevision,
  deployedApplication = verifyApplicationDeployment,
} = {}) {
  const plan = deploymentPlan(env);
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error("Missing CLOUDFLARE_API_TOKEN.");
  const workers = await targets(env, site, { read });
  const app = workers.find((worker) => worker.backend);
  if (site !== "docs" && !app) {
    report(plan.preview ? "Skipped the application preview. Only the minsky-preview build publishes it."
      : "Skipped the application. The minsky-dev build publishes main.");
  }
  if (site !== "app" && plan.preview) report("Skipped the docs. The minsky-docs build uploads docs previews.");
  const childEnv = safeWranglerEnvironment(env);
  delete childEnv.GH_TOKEN;
  delete childEnv.GITHUB_TOKEN;
  delete childEnv.AUTH_SECRET;
  if (!workers.length) return;
  report(app?.name === previewWorker.name ? `Target: shared preview Worker \`${previewWorker.name}\`.`
    : "Target: stable development sites.");
  for (const worker of workers) {
    if (!await current(plan)) {
      report(`Skipped remaining uploads because ${plan.sha} is no longer the branch's current commit.`);
      return;
    }
    if (worker.backend) {
      let build;
      try { build = JSON.parse(read("dist/minsky-build.json", "utf8")); } catch { /* Reject below. */ }
      if (!isDeepStrictEqual(build, { ...applicationMarker(worker, plan.sha), config: worker.config })) {
        throw new Error("Build the selected backend and revision with the guarded deployment build command before upload.");
      }
      await application(worker, childEnv, execute, globalThis.fetch, report);
    }
    const marker = worker.backend ? applicationMarker(worker, plan.sha) : { sha: plan.sha };
    // All branches publish to the preview Worker. Record what it serves before this upload.
    const previous = worker.name === previewWorker.name
      ? await revision(workerOrigin(worker.name)) : undefined;
    write(`${worker.assets}/minsky-revision.json`, `${JSON.stringify(marker)}\n`);
    try {
      execute("node_modules/.bin/wrangler", ["deploy", "--config", worker.config], {
        env: childEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
        timeout: 300_000,
      });
    } catch {
      throw new Error("Worker publication failed. Provider output was withheld. Inspect the exact target before retrying.");
    }
    const url = workerOrigin(worker.name);
    report(`Published ${worker.name} at ${url} from ${plan.sha}.`);
    if (!await verify(url, marker, globalThis.fetch, setTimeout, previous)) {
      report(`Another build replaced ${worker.name} after this upload. That build verifies its own deployment.`);
      continue;
    }
    if (worker.backend) await deployedApplication(worker, childEnv);
    report(`The revision and deployment checks passed for ${worker.name}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const options = { site: "both" };
    const site = args.find((argument) => argument.startsWith("--site="));
    if (site) options.site = site.slice("--site=".length);
    const operation = args.filter((argument) => argument !== site);
    if (operation.length > 1 || operation.some((argument) => !["--check", "--build"].includes(argument))) {
      throw new Error("Usage: node scripts/deploy-workers.mjs [--check|--build] [--site=app|docs|both]");
    }
    if (operation[0] === "--check") await deploymentTargets(process.env, options.site);
    else if (operation[0] === "--build") await buildWorkers(process.env, options);
    else await deployWorkers(process.env, options);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
