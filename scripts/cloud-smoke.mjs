import process from "node:process";
import { spawnSync } from "node:child_process";
// Run the same isolated fixtures against the built, deployed frontend.
const result = spawnSync(
  process.execPath,
  ["scripts/cloud-test.mjs", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      MINSKY_HOSTED_URL: "https://minsky-dev.icaic-minsky.workers.dev",
    },
  },
);
process.exitCode = result.status ?? 1;
