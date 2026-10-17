import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";

// An explicit target is required before this runner can touch hosted fixtures.
const config = JSON.parse(readFileSync(new URL("../wrangler.d1-proof.jsonc", import.meta.url), "utf8"));
const binding = config.d1_databases[0];
const expected = [
  `--account=${config.account_id}`,
  `--database=${binding.database_id}`,
];
if (process.argv.length !== 4 || !expected.every((arg) => process.argv.slice(2).includes(arg))) {
  console.error(`Supply the exact isolated target: ${expected.join(" ")}`);
  process.exit(1);
}
if (config.account_id !== "458ad6a930b0fb717796dfa19ca6a2b1" ||
    binding.database_name !== "minsky-d1-proof-ci" ||
    binding.database_id !== "06560c1c-8907-47d6-b2b6-f22e129ebbe4" ||
    binding.remote !== true) {
  throw new Error("The isolated D1 proof target changed. Review its configuration before testing.");
}
console.log(`Hosted D1 proof: account ${config.account_id}, database ${binding.database_name} (${binding.database_id})`);
const result = spawnSync("npx", ["vitest", "run", "--config", "vitest.d1.config.ts"], {
  stdio: "inherit",
  env: { ...process.env, MINSKY_D1_REMOTE: "1", WRANGLER_SEND_METRICS: "false" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
