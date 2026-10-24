import { expect, it } from "vitest";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const runner = resolve("scripts/workflow-proof.mjs");

/** A missing recovery journal stops the runner after the target check and before any request. */
function run(project) {
  const env = {
    ...process.env, SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key", SUPABASE_ANON_KEY: "fixture-public-key",
  };
  delete env.MINSKY_TEST_PROJECT_REF;
  if (project !== undefined) env.MINSKY_TEST_PROJECT_REF = project;
  return spawnSync(process.execPath, [runner, "--recover=/minsky-missing/fixture.json"], { encoding: "utf8", env });
}

it.each([undefined, "", "invalid", "ovymmobupzowotvrywek"])("refuses project %s before any request", (project) => {
  const result = run(project);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Set MINSKY_TEST_PROJECT_REF to an isolated Supabase test project.");
});

it("accepts any explicit isolated project", () => {
  const result = run("abcdefghijklmnopqrst");
  expect(result.status).not.toBe(0);
  expect(result.stderr).not.toContain("isolated Supabase test project");
  expect(result.stderr).toContain("Supply the absolute path to an existing recovery journal.");
});
