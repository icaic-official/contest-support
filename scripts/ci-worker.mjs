import { spawnSync } from 'node:child_process';
import process from 'node:process';

// Validate the CI sentinel without uploading it or changing minsky-dev or minsky-docs.
const result = spawnSync(
  'node_modules/.bin/wrangler',
  ['versions', 'upload', '--config', 'wrangler.ci.jsonc', '--dry-run'],
  {
    stdio: 'inherit',
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
