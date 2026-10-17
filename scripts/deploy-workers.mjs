import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL, URL } from "node:url";

const repository = "GiftedNovaHD/minsky";
const project = "ovymmobupzowotvrywek";
const account = "458ad6a930b0fb717796dfa19ca6a2b1";
const workers = [
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

export function validateBuildSettings(env) {
  if (env.CLOUDFLARE_ACCOUNT_ID !== account ||
      env.VITE_SUPABASE_URL !== `https://${project}.supabase.co` ||
      env.VITE_ENVIRONMENT !== "development") {
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

export async function verifyRevision(url, sha, request = globalThis.fetch, pause = setTimeout) {
  // New preview DNS records can take time to become available.
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await request(`${url}/minsky-revision.json?sha=${sha}`, {
        cache: "no-store", signal: globalThis.AbortSignal.timeout(10_000),
      });
      if (response.ok && (await response.json()).sha === sha) return;
    } catch { /* Retry network, DNS, and non-JSON responses within this limit. */ }
    if (attempt < 11) await pause(5000);
  }
  throw new Error(`The published source revision could not be verified at ${url}.`);
}

function summary(message, env) {
  process.stdout.write(`${message}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
}

export async function deployWorkers(env, {
  current = isCurrentRevision,
  execute = execFileSync,
  verify = verifyRevision,
  read = readFileSync,
  write = writeFileSync,
  report = summary,
} = {}) {
  const plan = deploymentPlan(env);
  validateBuildSettings(env);
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error("Missing CLOUDFLARE_API_TOKEN.");
  // Validate both targets before publishing either one.
  for (const worker of workers) {
    const config = JSON.parse(read(worker.config, "utf8"));
    if (config.name !== worker.name || config.account_id !== account ||
        config.assets?.directory !== `./${worker.assets}`) {
      throw new Error(`Unexpected deployment target in ${worker.config}.`);
    }
  }
  const childEnv = { ...env };
  delete childEnv.GH_TOKEN;
  delete childEnv.GITHUB_TOKEN;
  report(plan.preview ? `Preview name: \`${plan.name}\`.` : "Target: stable development sites.", env);
  for (const worker of workers) {
    // Recheck before each upload. A retry of an old run must not replace newer code.
    if (!await current(plan, env)) {
      report(`Skipped remaining uploads because ${plan.sha} is no longer the branch's current commit.`, env);
      return;
    }
    write(`${worker.assets}/minsky-revision.json`, `${JSON.stringify({ sha: plan.sha })}\n`);
    const output = execute("node_modules/.bin/wrangler", wranglerArguments(worker, plan), {
      env: childEnv, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 8 * 1024 * 1024,
    });
    const url = plan.preview ? previewAddress(output) : `https://${worker.name}.icaic-minsky.workers.dev`;
    report(`Published [${worker.name}](${url}) from \`${plan.sha}\`.`, env);
    await verify(url, plan.sha);
    report(`The revision check passed for ${worker.name}.`, env);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "--check") {
      deploymentPlan(process.env);
      validateBuildSettings(process.env);
    } else if (process.argv.length === 2) {
      await deployWorkers(process.env);
    } else {
      throw new Error("Usage: node scripts/deploy-workers.mjs [--check]");
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
