import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export const ACCOUNT_ID = "458ad6a930b0fb717796dfa19ca6a2b1";
export const TOKEN_PREFIX = "minsky-agent-";
export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 90;
const API = "https://api.cloudflare.com/client/v4";

// Only the products Minsky runs on. Everything else, including tokens, members, billing, Access, Zero Trust,
// Workers Admin, and Workers CI Write (build triggers), stays with the owner.
const ALLOWED_PERMISSION = new RegExp([
  String.raw`^Workers (Scripts|Routes|KV Storage|R2 Storage|R2 Storage Bucket Item|R2 Storage Metadata|Observability|Tail) (Read|Write)$`,
  String.raw`^Workers (Editor|Metadata Read-Only|Content Read-Only|CI Read)$`,
  String.raw`^D1 (Metadata Read|Read|Write)$`,
  String.raw`^(Account Analytics|Zone|DNS) Read$`,
  String.raw`^DNS Write$`,
].join("|"));
const ZONE_KEY = /^com\.cloudflare\.api\.account\.zone\.[0-9a-f]{32}$/;
const R2_BUCKET_KEY = new RegExp(`^com\\.cloudflare\\.edge\\.r2\\.bucket\\.${ACCOUNT_ID}_default_[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`);
const ACCOUNT_KEY = `com.cloudflare.api.account.${ACCOUNT_ID}`;

/**
 * Turns a token request into the body of POST /accounts/{account}/tokens.
 * A request is {purpose, days?, policies: [{permissions: [group names], resources: {key: "*"}}]}.
 * `groups` is the result of GET /accounts/{account}/tokens/permission_groups.
 */
export function tokenBody(request, groups, now = new Date()) {
  const purpose = String(request?.purpose ?? "");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(purpose) || purpose.length > 40) {
    throw new Error("purpose must be 1 to 40 lowercase letters, digits, and single hyphens.");
  }
  const days = request.days ?? DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new Error(`days must be a whole number from 1 to ${MAX_DAYS}.`);
  }
  if (!Array.isArray(request.policies) || request.policies.length === 0) {
    throw new Error("policies must list at least one policy.");
  }
  const groupIds = new Map(groups.map((group) => [group.name, group.id]));
  const policies = request.policies.map((policy) => {
    if (!Array.isArray(policy.permissions) || policy.permissions.length === 0) {
      throw new Error("Each policy must list at least one permission.");
    }
    const permission_groups = policy.permissions.map((name) => {
      if (!ALLOWED_PERMISSION.test(name)) throw new Error(`Agents may not grant "${name}".`);
      const id = groupIds.get(name);
      if (!id) throw new Error(`Unknown permission group "${name}".`);
      return { id };
    });
    return { effect: "allow", permission_groups, resources: checkedResources(policy.resources) };
  });
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const expires = new Date(now.getTime() + days * 86_400_000);
  return {
    name: `${TOKEN_PREFIX}${purpose}-${date}`,
    policies,
    expires_on: expires.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

function checkedResources(resources) {
  const entries = Object.entries(resources ?? {});
  if (entries.length === 0) throw new Error("Each policy must name at least one resource.");
  for (const [key, value] of entries) {
    if (value !== "*") throw new Error(`Resource ${key} must map to "*". Nested and wildcard scopes are refused.`);
    if (key !== ACCOUNT_KEY && !ZONE_KEY.test(key) && !R2_BUCKET_KEY.test(key)) {
      throw new Error(`Resource ${key} is not the Minsky account, one zone, or one R2 bucket in the Minsky account.`);
    }
  }
  return Object.fromEntries(entries);
}

export function isAgentToken(token) {
  return typeof token?.name === "string" && token.name.startsWith(TOKEN_PREFIX);
}

export function readAdminKey(env = process.env, cwd = process.cwd()) {
  if (env.CLOUDFLARE_TOKEN_ADMIN) return env.CLOUDFLARE_TOKEN_ADMIN;
  // A linked worktree has no .env.local of its own, so fall back to the main checkout's file.
  const roots = [cwd];
  try {
    const list = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
    roots.push(list.split("\n")[0].replace(/^worktree /, ""));
  } catch {
    // Outside a Git checkout, only the current directory counts.
  }
  for (const root of roots) {
    const file = join(root, ".env.local");
    if (!existsSync(file)) continue;
    const key = parseEnv(readFileSync(file, "utf8")).CLOUDFLARE_TOKEN_ADMIN;
    if (key) return key;
  }
  throw new Error("Set CLOUDFLARE_TOKEN_ADMIN in .env.local. The owner creates that key.");
}

async function call(key, method, path, body) {
  const response = await globalThis.fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!json.success) {
    throw new Error(`${method} ${path} failed: ${json.errors?.map((error) => `${error.code} ${error.message}`).join("; ")}`);
  }
  return json.result;
}

async function listAgentTokens(key) {
  const tokens = await call(key, "GET", `/accounts/${ACCOUNT_ID}/tokens?per_page=100`);
  return tokens.filter(isAgentToken);
}

async function main([command, ...args]) {
  const option = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const key = readAdminKey();
  if (command === "create") {
    const requestFile = args[0];
    const out = option("--out");
    if (!requestFile || !out) throw new Error("Usage: npm run token:create -- <request.json> --out <file>");
    if (existsSync(out)) throw new Error(`${out} already exists. Choose a new file.`);
    const groups = await call(key, "GET", `/accounts/${ACCOUNT_ID}/tokens/permission_groups?per_page=1000`);
    const body = tokenBody(JSON.parse(readFileSync(requestFile, "utf8")), groups);
    const token = await call(key, "POST", `/accounts/${ACCOUNT_ID}/tokens`, body);
    writeFileSync(out, `${token.value}\n`, { mode: 0o600, flag: "wx" });
    process.stdout.write(`Created ${token.name} (${token.id}), expires ${token.expires_on}. The value is in ${out}.\n`);
  } else if (command === "list") {
    for (const token of await listAgentTokens(key)) {
      const scopes = token.policies.map((policy) =>
        `${policy.permission_groups.map((group) => group.name).join(", ")} on ${Object.keys(policy.resources).join(", ")}`);
      process.stdout.write(`${token.name} ${token.id} ${token.status} expires ${token.expires_on}\n  ${scopes.join("\n  ")}\n`);
    }
  } else if (command === "delete") {
    const id = args[0];
    const token = (await listAgentTokens(key)).find((candidate) => candidate.id === id);
    if (!token) throw new Error(`${id} is not a token that an agent created.`);
    await call(key, "DELETE", `/accounts/${ACCOUNT_ID}/tokens/${id}`);
    process.stdout.write(`Deleted ${token.name} (${id}).\n`);
  } else {
    throw new Error("Usage: npm run token:create|token:list|token:delete");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
