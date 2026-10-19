import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL, URL } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readInstallationTarget } from "../src/server/adapters/cloudflare/tooling/configuration.mjs";
import { assertCurrentMigrations } from "../src/server/adapters/cloudflare/tooling/migrations.mjs";
import { confirmTarget } from "../src/server/adapters/cloudflare/tooling/operations.mjs";
import { safeWranglerEnvironment } from "../src/server/adapters/cloudflare/tooling/safe-environment.mjs";

const repository = "GiftedNovaHD/minsky";
const project = "ovymmobupzowotvrywek";
const account = "458ad6a930b0fb717796dfa19ca6a2b1";
const staticWorkers = [
  { name: "minsky-dev", config: "wrangler.jsonc", assets: "dist" },
  { name: "minsky-docs", config: "wrangler.docs.jsonc", assets: "site/dist" },
];

export function deploymentPlan(env) {
  if (env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_REPOSITORY !== repository ||
      env.GITHUB_ACTOR === "dependabot[bot]" ||
      !env.GITHUB_REF?.startsWith("refs/heads/") ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") || /^0+$/.test(env.GITHUB_SHA)) {
    throw new Error("Deployment requires a branch push in the Minsky repository.");
  }
  const branch = env.GITHUB_REF.slice("refs/heads/".length);
  if (!branch || /[\r\n]/.test(branch)) throw new Error("Missing or invalid branch name.");
  // A hash distinguishes branches that normalize to the same lowercase name.
  const suffix = createHash("sha256").update(branch).digest("hex").slice(0, 12);
  const slug = branch.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .slice(0, 24).replace(/^-+|-+$/g, "") || "branch";
  return { branch, sha: env.GITHUB_SHA, preview: branch !== "main",
    name: `branch-${slug}-${suffix}` };
}

export function applicationBackend(env) {
  const backend = env.MINSKY_DEV_BACKEND || "supabase";
  if (!["supabase", "cloudflare"].includes(backend)) throw new Error("Select supabase or cloudflare for MINSKY_DEV_BACKEND.");
  return backend;
}

export function validateBuildSettings(env) {
  if (env.CLOUDFLARE_ACCOUNT_ID !== account || env.VITE_ENVIRONMENT !== "development") {
    throw new Error("Deployment must use the configured Minsky development account and backend.");
  }
  if (applicationBackend(env) === "cloudflare") return;
  if (env.VITE_SUPABASE_URL !== `https://${project}.supabase.co`) {
    throw new Error("Deployment must use the configured Minsky development account and backend.");
  }
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return;
  try {
    const parts = key.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (parts.length === 3 && payload.role === "anon" && payload.ref === project) return;
  } catch { /* Report a fixed message without including the supplied credential. */ }
  throw new Error("Use the development publishable key or legacy anon key. Privileged keys are forbidden.");
}

export async function isCurrentRevision(plan, env, request = globalThis.fetch) {
  if (!env.GH_TOKEN) throw new Error("Missing GitHub token for the branch revision check.");
  const response = await request(
    `https://api.github.com/repos/${repository}/git/ref/heads/${encodeURIComponent(plan.branch)}`,
    { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
      signal: globalThis.AbortSignal.timeout(15_000) },
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`GitHub branch lookup failed with HTTP ${response.status}.`);
  return (await response.json()).object?.sha === plan.sha;
}

export function wranglerArguments(worker, plan) {
  if (!plan.preview) return ["deploy", "--config", worker.config];
  return ["preview", "--config", worker.config, "--name", plan.name,
    "--tag", plan.sha, "--ignore-base-config", "--json"];
}

export function previewAddress(output) {
  const urls = JSON.parse(output).preview?.urls;
  const address = urls?.find((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname.endsWith(".icaic-minsky.workers.dev") &&
        !url.username && !url.password && !url.port && url.pathname === "/" && !url.search && !url.hash;
    } catch { return false; }
  });
  if (!address) throw new Error("Cloudflare did not return a Minsky preview URL.");
  return new URL(address).origin;
}

export async function verifyRevision(url, expected, request = globalThis.fetch, pause = setTimeout) {
  const marker = typeof expected === "string" ? { sha: expected } : expected;
  // New preview DNS records can take time to become available.
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await request(`${url}/minsky-revision.json?sha=${marker.sha}`, {
        cache: "no-store", signal: globalThis.AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const published = await response.json();
        if (Object.entries(marker).every(([key, value]) => published[key] === value)) return;
      }
    } catch { /* Retry network, DNS, and non-JSON responses within this limit. */ }
    if (attempt < 11) await pause(5000);
  }
  throw new Error(`The published source revision could not be verified at ${url}.`);
}

function summary(message, env) {
  process.stdout.write(`${message}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
}

/** Validate the full provider configuration instead of maintaining another generator. */
export async function deploymentTargets(env, site = "both", {
  read = readFileSync, installation = readInstallationTarget,
} = {}) {
  if (!["app", "docs", "both"].includes(site)) throw new Error("Select app, docs, or both.");
  if (env.CLOUDFLARE_ACCOUNT_ID !== account) throw new Error("Unexpected Cloudflare deployment account.");
  const plan = deploymentPlan(env);
  const targets = [];
  if (site !== "docs") {
    const backend = applicationBackend(env);
    if (plan.preview) {
      // Application previews require independent provider resources first.
    } else if (backend === "cloudflare") {
      validateBuildSettings(env);
      const path = env.MINSKY_DEV_CLOUDFLARE_CONFIG;
      if (!path || isAbsolute(path) || relative(process.cwd(), resolve(path)).startsWith("..")) {
        throw new Error("Select a provider-generated configuration inside the repository.");
      }
      const settings = await installation(path);
      if (settings.accountId !== account || settings.workerName !== "minsky-dev" ||
          settings.origin !== "https://minsky-dev.icaic-minsky.workers.dev" ||
          settings.databaseId !== env.MINSKY_DEV_DATABASE_ID ||
          settings.databaseName !== env.MINSKY_DEV_DATABASE_NAME ||
          settings.bucketName !== env.MINSKY_DEV_BUCKET_NAME ||
          [settings.databaseName, settings.bucketName].some((name) => /(?:^|-)(?:ci|test|install|installation)(?:-|$)/.test(name))) {
        throw new Error("Confirm the exact stable development Worker, database, bucket, origin, and account.");
      }
      targets.push({ name: "minsky-dev", config: path, assets: "dist", backend, settings });
    } else {
      validateBuildSettings(env);
      targets.push({ ...staticWorkers[0], backend });
    }
  }
  if (site !== "app") targets.push(staticWorkers[1]);
  for (const worker of targets.filter((target) => !target.settings)) {
    const config = JSON.parse(read(worker.config, "utf8"));
    if (config.name !== worker.name || config.account_id !== account ||
        config.assets?.directory !== `./${worker.assets}` || config.main ||
        config.d1_databases || config.r2_buckets || config.durable_objects || config.env || config.routes) {
      throw new Error(`Unexpected deployment target in ${worker.config}.`);
    }
  }
  return targets;
}

async function workerSettings(env, request) {
  const response = await request(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/minsky-dev/settings`, {
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true || !Array.isArray(body.result?.bindings)) {
    throw new Error("Worker metadata unavailable");
  }
  return body.result;
}

/** A changed repository variable cannot replace an activated Worker with static assets. */
export async function assertStaticApplication(env, request = globalThis.fetch) {
  try {
    const settings = await workerSettings(env, request);
    if (settings.bindings.some((binding) => !binding || typeof binding.name !== "string" || !binding.name ||
        !["plain_text", "secret_text", "assets"].includes(binding.type) ||
        ["DB", "IMAGES", "LIVE_UPDATES"].includes(binding.name))) {
      throw new Error("Unsafe Worker settings");
    }
  } catch {
    throw new Error("The stable Worker could not be confirmed as static. A Supabase asset upload is forbidden. Inspect the deployed bindings privately.");
  }
}

/** Check deployed metadata and API behavior without creating a session or fixture. */
export async function verifyApplicationDeployment(worker, env, request = globalThis.fetch) {
  try {
    const settings = await workerSettings(env, request);
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
    sha, backend: worker.backend, databaseId: worker.settings?.databaseId ?? null,
    bucketName: worker.settings?.bucketName ?? null,
    origin: worker.settings?.origin ?? "https://minsky-dev.icaic-minsky.workers.dev",
  };
}

export async function confirmApplication(worker, env, execute = execFileSync, request = globalThis.fetch) {
  const runWrangler = (arguments_) => {
    try {
      return execute("node_modules/.bin/wrangler", [...arguments_, "--config", worker.config], {
        env: safeWranglerEnvironment(env), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 2 * 1024 * 1024, timeout: 120_000,
      });
    } catch {
      throw new Error("Cloudflare target inspection failed. Provider output was withheld.");
    }
  };
  await confirmTarget({ account, database: env.MINSKY_DEV_DATABASE_ID }, worker.settings, runWrangler);
  await assertCurrentMigrations(worker.settings, runWrangler);
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
    throw new Error("The exact private development R2 bucket could not be confirmed. Provider output was withheld.");
  }
  try {
    const secrets = JSON.parse(runWrangler(["secret", "list", "--format", "json"]));
    if (!Array.isArray(secrets) || !secrets.some((entry) => entry?.name === "AUTH_SECRET")) {
      throw new Error("Missing authentication secret");
    }
  } catch {
    throw new Error("Confirm AUTH_SECRET on the selected Worker before deployment. Secret values were not requested.");
  }
}

/** The build and upload use the same backend and confirmed public configuration. */
export async function buildWorkers(env, {
  site = "both", execute = execFileSync, write = writeFileSync, targets = deploymentTargets,
} = {}) {
  const plan = deploymentPlan(env);
  for (const worker of await targets(env, site)) {
    const childEnv = { ...env };
    for (const key of ["CLOUDFLARE_API_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "AUTH_SECRET"]) delete childEnv[key];
    if (worker.backend) {
      childEnv.VITE_BACKEND = worker.backend;
      if (worker.backend === "cloudflare") {
        delete childEnv.VITE_SUPABASE_URL;
        delete childEnv.VITE_SUPABASE_PUBLISHABLE_KEY;
      }
    }
    execute("npm", ["run", worker.backend ? "build" : "docs:build"], { env: childEnv, stdio: "inherit" });
    if (worker.backend) write("dist/minsky-build.json", JSON.stringify({
      ...applicationMarker(worker, plan.sha), config: worker.config,
    }) + "\n");
  }
}

export async function deployWorkers(env, {
  site = "both", current = isCurrentRevision, execute = execFileSync, verify = verifyRevision,
  read = readFileSync, write = writeFileSync, report = summary, targets = deploymentTargets,
  staticApplication = assertStaticApplication, application = confirmApplication,
  deployedApplication = verifyApplicationDeployment,
} = {}) {
  const plan = deploymentPlan(env);
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error("Missing CLOUDFLARE_API_TOKEN.");
  const workers = await targets(env, site, { read });
  if (site !== "docs" && plan.preview) {
    report("Skipped the application preview. Independent preview data is not configured.", env);
  }
  const childEnv = safeWranglerEnvironment(env);
  delete childEnv.GH_TOKEN;
  delete childEnv.GITHUB_TOKEN;
  delete childEnv.AUTH_SECRET;
  report(plan.preview ? `Preview name: \`${plan.name}\`.` : "Target: stable development sites.", env);
  for (const worker of workers) {
    if (!await current(plan, env)) {
      report(`Skipped remaining uploads because ${plan.sha} is no longer the branch's current commit.`, env);
      return;
    }
    if (worker.backend) {
      let build;
      try { build = JSON.parse(read("dist/minsky-build.json", "utf8")); } catch { /* Reject below. */ }
      if (!isDeepStrictEqual(build, { ...applicationMarker(worker, plan.sha), config: worker.config })) {
        throw new Error("Build the selected backend and revision with the guarded deployment build command before upload.");
      }
      if (worker.settings) await application(worker, childEnv, execute);
      else if (!plan.preview) await staticApplication(childEnv);
    }
    const marker = worker.backend ? applicationMarker(worker, plan.sha) : { sha: plan.sha };
    write(`${worker.assets}/minsky-revision.json`, `${JSON.stringify(marker)}\n`);
    let output;
    try {
      output = execute("node_modules/.bin/wrangler", wranglerArguments(worker, plan), {
        env: childEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
        timeout: 300_000,
      });
    } catch {
      throw new Error("Worker publication failed. Provider output was withheld. Inspect the exact target before retrying.");
    }
    const url = plan.preview ? previewAddress(output) : `https://${worker.name}.icaic-minsky.workers.dev`;
    report(`Published [${worker.name}](${url}) from \`${plan.sha}\`.`, env);
    await verify(url, marker);
    if (worker.settings) await deployedApplication(worker, childEnv);
    report(`The revision and deployment checks passed for ${worker.name}.`, env);
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
