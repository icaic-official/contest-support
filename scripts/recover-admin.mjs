import process from "node:process";
import console from "node:console";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Run privately in a maintainer terminal, never CI or a frontend build.
const target = process.argv[process.argv.indexOf("--user") + 1];
if (
  !process.argv.includes("--user") || !/^[0-9a-f-]{36}$/i.test(target ?? "")
) {
  throw new Error(
    "Usage: npm run cloud:recover-admin -- --user AUTH_USER_UUID",
  );
}
const project = (await readFile("supabase/.temp/project-ref", "utf8")).trim();
if (!/^[a-z]{20}$/.test(project)) {
  throw new Error("Link the intended Supabase project first.");
}
let rows;
try {
  const keys = JSON.parse(
    execFileSync("node_modules/.bin/supabase", [
      "projects",
      "api-keys",
      "--project-ref",
      project,
      "--reveal",
      "--output",
      "json",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  );
  rows = Array.isArray(keys) ? keys : (keys.api_keys ?? keys.keys ?? []);
} catch {
  throw new Error("Sign in using cloud:login with trusted provider access.");
}
const secret = rows.find((k) => k.name === "service_role")?.api_key;
const anon = rows.find((k) => k.name === "anon")?.api_key;
if (!secret || !anon) {
  throw new Error("Project Auth credentials are unavailable.");
}
const settings = { auth: { persistSession: false, autoRefreshToken: false } };
const url = `https://${project}.supabase.co`;
const service = createClient(url, secret, settings);
const started = await service.rpc("begin_admin_recovery", { p_target: target });
if (started.error) throw started.error;
const password = randomBytes(24).toString("hex") + "A9!";
try {
  const updated = await service.auth.admin.updateUserById(target, { password });
  if (updated.error) throw updated.error;
  const verifier = createClient(url, anon, settings);
  const signed = await verifier.auth.signInWithPassword({
    email: updated.data.user.email ?? "",
    password,
  });
  if (signed.error || !signed.data.session) {
    throw signed.error ?? new Error("Session invalidation failed.");
  }
  const signedOut = await service.auth.admin.signOut(
    signed.data.session.access_token,
    "global",
  );
  if (signedOut.error) throw signedOut.error;
  const finished = await service.rpc("finish_password_reset", {
    p_target: target,
    p_operation: started.data,
    p_success: true,
  });
  if (finished.error) throw finished.error;
  console.log(
    "Admin recovery completed. Share this temporary password securely; change it on login:",
  );
  console.log(password);
} catch (cause) {
  await service.rpc("finish_password_reset", {
    p_target: target,
    p_operation: started.data,
    p_success: false,
  });
  throw cause;
}
