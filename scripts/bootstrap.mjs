import process from "node:process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const user = process.argv[process.argv.indexOf("--admin-user") + 1];
if (
  !process.argv.includes("--admin-user") ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    user ?? "",
  )
) {
  throw new Error(
    "Usage: npm run cloud:bootstrap -- --admin-user EXISTING_AUTH_UUID",
  );
}
const directory = await mkdtemp(join(tmpdir(), "minsky-bootstrap-"));
try {
  const sql = (await readFile("scripts/bootstrap.sql", "utf8")).replace(
    "REPLACE_WITH_EXISTING_AUTH_USER_UUID",
    user,
  );
  const path = join(directory, "bootstrap.sql");
  await writeFile(path, sql, { mode: 0o600 });
  execFileSync(
    "node_modules/.bin/supabase",
    ["db", "query", "--linked", "--file", path],
    { stdio: "inherit" },
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
