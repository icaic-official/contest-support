import console from "node:console";
import process from "node:process";
import { readdir } from "node:fs/promises";
import { pathToFileURL, URL } from "node:url";
import { isolatedSupabaseProject } from "../tests/providers/supabase/target.mjs";

// Read provider metadata before a cloud test can create any fixtures.
export async function checkCloudBackend({
  env = process.env,
  request = globalThis.fetch,
  migrations,
  report = console.log,
} = {}) {
  const project = isolatedSupabaseProject(env.MINSKY_TEST_PROJECT_REF);
  if (!env.SUPABASE_ACCESS_TOKEN) throw new Error("Set SUPABASE_ACCESS_TOKEN.");
  const expected = migrations ?? (await readdir(new URL("../supabase/migrations/", import.meta.url)))
    .filter(name => name.endsWith(".sql")).map(name => name.split("_")[0]);
  const base = `https://api.supabase.com/v1/projects/${project}`;
  async function read(path, options = {}) {
    const response = await request(`${base}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      signal: globalThis.AbortSignal.timeout(30000),
    });
    // Provider error bodies can contain credentials or unrelated account data.
    if (!response.ok) throw new Error(`CI backend metadata request failed: HTTP ${response.status}.`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("Invalid CI backend metadata response.");
    return rows;
  }
  const applied = await read("/database/query", {
    method: "POST",
    body: JSON.stringify({
      query: "select version from supabase_migrations.schema_migrations order by version",
      read_only: true,
    }),
  });
  const versions = new Set(applied.map(row => row.version));
  const missing = expected.filter(version => !versions.has(version));
  if (missing.length) throw new Error(`CI backend is missing migrations: ${missing.join(", ")}. No fixtures were created.`);
  const functions = await read("/functions");
  const required = ["admin", "attachments", "announcement-images", "avatars"];
  const absent = required.filter(slug =>
    !functions.some(fn => fn.slug === slug && fn.status === "ACTIVE"));
  if (absent.length) throw new Error(`CI backend is missing active functions: ${absent.join(", ")}. No fixtures were created.`);
  const extra = [...versions].filter(version => !expected.includes(version));
  report(`CI backend has all ${expected.length} required migration versions and all ${required.length} active functions.`);
  if (extra.length) report(`Additional remote migration versions: ${extra.join(", ")}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkCloudBackend();
}
