import process from "node:process";
import console from "node:console";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isolatedSupabaseProject } from "../tests/providers/supabase/target.mjs";

// Never fall back to a linked project. Fixtures must target an explicit isolated project.
const project = isolatedSupabaseProject(process.env.MINSKY_TEST_PROJECT_REF);
let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
let anon = process.env.SUPABASE_ANON_KEY;
if (!key || !anon) {
  let keys;
  try {
    // Capture credentials in memory; never inherit CLI output into test logs.
    const output = execFileSync(
      "node_modules/.bin/supabase",
      [
        "projects",
        "api-keys",
        "--project-ref",
        project,
        "--reveal",
        "--output",
        "json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    keys = JSON.parse(output);
  } catch {
    throw new Error(
      "Cannot retrieve test credentials. Sign in with cloud:login or set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY.",
    );
  }
  const rows = Array.isArray(keys) ? keys : (keys.api_keys ?? keys.keys ?? []);
  key = rows.find(
    (k) => k.name === "service_role" || k.type === "secret",
  )?.api_key;
  anon = rows.find(
    (k) => k.name === "anon" || k.type === "publishable",
  )?.api_key;
}
if (!key || !anon) throw new Error("Test project credentials are unavailable.");
const directory = await mkdtemp(join(tmpdir(), "minsky-cloud-test-"));
const fixturePath = join(directory, "fixture.json");
try {
  const result = spawnSync(
    "node_modules/.bin/playwright",
    ["test", "--config=playwright.cloud.config.ts", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        MINSKY_CLOUD_FIXTURE: fixturePath,
        MINSKY_TEST_PROJECT_REF: project,
        SUPABASE_URL: `https://${project}.supabase.co`,
        SUPABASE_ANON_KEY: anon,
        SUPABASE_SERVICE_ROLE_KEY: key,
        // Cloudflare is the default browser backend. This suite tests the Supabase adapter.
        VITE_BACKEND: "supabase",
        VITE_SUPABASE_URL: `https://${project}.supabase.co`,
        VITE_SUPABASE_PUBLISHABLE_KEY: anon,
      },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  if (existsSync(fixturePath)) {
    console.error(
      `Fixture cleanup did not complete. Recovery file retained at ${fixturePath}`,
    );
  } else {
    await rm(directory, { recursive: true, force: true });
  }
}
